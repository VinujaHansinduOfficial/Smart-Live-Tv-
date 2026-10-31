"""IPTV Sources Router: M3U, Xtream Codes, and Stalker Portals."""
from __future__ import annotations

import re
import sqlite3
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import adult_profile, current_profile, get_conn

router = APIRouter(prefix="/api/sources", tags=["sources"])


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str = Field(pattern="^(m3u|xtream|stalker)$")
    url: str = Field(min_length=1, max_length=1000)
    username: str | None = None
    password: str | None = None
    mac_address: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    epg_url: str | None = None
    catchup_type: str = "append"
    catchup_days: int = Field(default=14, ge=1, le=30)
    catchup_source: str | None = None


def parse_m3u_content(content: str, source_id: int) -> list[dict[str, Any]]:
    """Parses standard extended M3U/M3U8 playlist format."""
    lines = content.strip().splitlines()
    channels = []
    current_meta: dict[str, Any] | None = None

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("#EXTINF:"):
            # Parse EXTINF line: #EXTINF:-1 tvg-id="CNN.us" tvg-name="CNN" tvg-logo="http://..." group-title="News" catchup="append" catchup-days="14",CNN HD
            meta: dict[str, Any] = {
                "id": None,
                "name": "Untitled Channel",
                "logo": None,
                "group": "General",
                "radio": False,
                "catchup": "append",
                "catchup_days": 14,
                "catchup_source": None,
            }

            # Extract tags with regex
            tags = dict(re.findall(r'([\w-]+)="([^"]*)"', line))
            meta["id"] = tags.get("tvg-id") or tags.get("channel-id")
            meta["name"] = tags.get("tvg-name")
            meta["logo"] = tags.get("tvg-logo")
            meta["group"] = tags.get("group-title") or "General"
            meta["catchup"] = tags.get("catchup") or "append"
            if tags.get("catchup-days"):
                try:
                    meta["catchup_days"] = int(tags["catchup-days"])
                except ValueError:
                    pass
            meta["catchup_source"] = tags.get("catchup-source")

            if "radio" in tags and tags["radio"].lower() in ("true", "1"):
                meta["radio"] = True

            # Channel display name is after last comma
            if "," in line:
                display_name = line.split(",", 1)[1].strip()
                if display_name and not meta["name"]:
                    meta["name"] = display_name
                elif display_name:
                    meta["name"] = display_name

            current_meta = meta

        elif line.startswith("#"):
            # Other directives
            continue
        else:
            # Stream URL
            if current_meta:
                stream_url = line
                ch_id = current_meta["id"] or f"m3u-{source_id}-{len(channels) + 1}"
                name = current_meta["name"] or f"Channel {len(channels) + 1}"
                channels.append({
                    "id": ch_id,
                    "name": name,
                    "logo": current_meta["logo"],
                    "group": current_meta["group"],
                    "radio": current_meta["radio"],
                    "catchup": current_meta["catchup"],
                    "catchup_days": current_meta["catchup_days"],
                    "catchup_source": current_meta["catchup_source"],
                    "stream_url": stream_url,
                })
                current_meta = None

    return channels


@router.get("")
def list_sources(
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM iptv_sources ORDER BY created_at DESC").fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "type": r["type"],
            "url": r["url"],
            "username": r["username"],
            "channel_count": r["channel_count"],
            "vod_count": r["vod_count"],
            "series_count": r["series_count"],
            "catchup_days": r["catchup_days"],
            "catchup_type": r["catchup_type"],
            "last_synced_at": r["last_synced_at"],
            "enabled": bool(r["enabled"]),
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def add_source(
    body: SourceCreate,
    profile: sqlite3.Row = Depends(adult_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    cur = conn.execute(
        """
        INSERT INTO iptv_sources(
            name, type, url, username, password, mac_address, headers,
            epg_url, catchup_type, catchup_days, catchup_source, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            body.name.strip(), body.type, body.url.strip(), body.username, body.password,
            body.mac_address, db.jdump(body.headers), body.epg_url, body.catchup_type,
            body.catchup_days, body.catchup_source, now,
        ),
    )
    source_id = cur.lastrowid

    # If M3U URL or pasted content, sync immediately
    channel_count = 0
    if body.type == "m3u":
        content = ""
        if body.url.startswith("http://") or body.url.startswith("https://"):
            try:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    resp = await client.get(body.url, headers=body.headers)
                    if resp.status_code == 200:
                        content = resp.text
            except Exception:
                pass
        else:
            # Inline / pasted M3U text
            content = body.url

        if content:
            parsed = parse_m3u_content(content, source_id)
            channel_count = len(parsed)
            with db.transaction(conn):
                for p in parsed[:500]:  # Cap single batch for responsiveness
                    cat = p["group"].lower().replace(" ", "-")
                    conn.execute("INSERT OR IGNORE INTO categories(id, name) VALUES (?,?)", (cat, p["group"]))
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO channels(
                            id, name, logo, country, categories, stream_count,
                            radio, source_id, catchup_days, catchup_type, catchup_source
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            p["id"], p["name"], p["logo"], "US", db.jdump([cat]), 1,
                            int(p["radio"]), source_id, p["catchup_days"],
                            p["catchup"], p["catchup_source"],
                        ),
                    )
                    conn.execute("INSERT OR IGNORE INTO channel_categories(channel_id, category) VALUES (?,?)", (p["id"], cat))
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO streams(
                            channel_id, title, url, quality, catchup, catchup_days, catchup_source
                        ) VALUES (?,?,?,?,?,?,?)
                        """,
                        (
                            p["id"], f"{p['name']} Stream", p["stream_url"], "1080p",
                            p["catchup"], p["catchup_days"], p["catchup_source"],
                        ),
                    )

            conn.execute(
                "UPDATE iptv_sources SET channel_count = ?, last_synced_at = ? WHERE id = ?",
                (channel_count, now, source_id),
            )

    return {
        "id": source_id,
        "name": body.name,
        "type": body.type,
        "channel_count": channel_count,
        "catchup_days": body.catchup_days,
    }


@router.delete("/{source_id}", status_code=204)
def delete_source(
    source_id: int,
    profile: sqlite3.Row = Depends(adult_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    source = conn.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,)).fetchone()
    if not source:
        raise HTTPException(404, "Source not found")

    with db.transaction(conn):
        conn.execute("DELETE FROM channels WHERE source_id = ?", (source_id,))
        conn.execute("DELETE FROM vod_items WHERE source_id = ?", (source_id,))
        conn.execute("DELETE FROM iptv_sources WHERE id = ?", (source_id,))

