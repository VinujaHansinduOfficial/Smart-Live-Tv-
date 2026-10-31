"""Shared query helpers: serialization, now/next, restrictions, FTS queries."""
from __future__ import annotations

import re
import sqlite3
from typing import Any, Iterable

from . import db

# --------------------------------------------------------------- serialization


def channel_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "name": row["name"],
        "logo": row["logo"],
        "country": row["country"],
        "network": row["network"] if "network" in keys else None,
        "categories": db.jload(row["categories"], []),
        "languages": db.jload(row["languages"], []),
        "stream_count": row["stream_count"],
        "has_guide": bool(row["has_guide"]) if "has_guide" in keys else False,
        "is_favorite": bool(row["is_favorite"]) if "is_favorite" in keys else False,
        "radio": bool(row["radio"]) if "radio" in keys and row["radio"] is not None else False,
        "channel_number": row["channel_number"] if "channel_number" in keys else None,
        "source_id": row["source_id"] if "source_id" in keys else None,
        "catchup_days": row["catchup_days"] if "catchup_days" in keys and row["catchup_days"] is not None else 14,
        "catchup_type": row["catchup_type"] if "catchup_type" in keys and row["catchup_type"] is not None else "append",
        "catchup_source": row["catchup_source"] if "catchup_source" in keys else None,
    }


def programme_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "start": row["start"],
        "stop": row["stop"],
        "title": row["title"],
        "sub_title": row["sub_title"],
        "description": row["description"],
        "categories": db.jload(row["categories"], []),
        "episode": row["episode"],
        "rating": row["rating"],
        "icon": row["icon"],
    }


def stream_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "url": row["url"],
        "title": row["title"],
        "feed_id": row["feed_id"],
        "quality": row["quality"],
        "referrer": row["referrer"],
        "user_agent": row["user_agent"],
        "labels": db.jload(row["labels"], []),
        "catchup": row["catchup"] if "catchup" in keys else None,
        "catchup_days": row["catchup_days"] if "catchup_days" in keys and row["catchup_days"] is not None else 14,
        "catchup_source": row["catchup_source"] if "catchup_source" in keys else None,
    }


CHANNEL_COLUMNS = (
    "c.id, c.name, c.logo, c.country, c.network, c.categories, c.languages, c.stream_count,"
    " (gf.channel_id IS NOT NULL) AS has_guide"
)


def channel_select(profile_id: int | None) -> tuple[str, list]:
    """SELECT ... FROM channels c with guide + favorite flags."""
    fav = "0"
    params: list = []
    if profile_id is not None:
        fav = "EXISTS (SELECT 1 FROM favorites fv WHERE fv.profile_id = ? AND fv.channel_id = c.id)"
        params.append(profile_id)
    return (
        f"SELECT {CHANNEL_COLUMNS}, {fav} AS is_favorite FROM channels c"
        " LEFT JOIN channel_guide_feed gf ON gf.channel_id = c.id",
        params,
    )


# ---------------------------------------------------------------- restrictions


def restriction_sql(profile: sqlite3.Row | dict | None, alias: str = "c") -> tuple[str, list]:
    """SQL condition limiting channels to what this profile may watch."""
    if not profile:
        return "1=1", []
    clauses, params = [], []
    allowed = db.jload(profile["allowed_categories"], None)
    if allowed is not None:
        if not allowed:
            return "0=1", []
        clauses.append(
            f"EXISTS (SELECT 1 FROM channel_categories rc WHERE rc.channel_id = {alias}.id"
            f" AND rc.category IN ({','.join('?' * len(allowed))}))"
        )
        params += allowed
    blocked = db.jload(profile["blocked_categories"], [])
    if blocked:
        clauses.append(
            f"NOT EXISTS (SELECT 1 FROM channel_categories rb WHERE rb.channel_id = {alias}.id"
            f" AND rb.category IN ({','.join('?' * len(blocked))}))"
        )
        params += blocked
    return (" AND ".join(clauses) or "1=1"), params


def can_watch(conn: sqlite3.Connection, profile: sqlite3.Row | dict | None, channel_id: str) -> bool:
    cond, params = restriction_sql(profile)
    row = conn.execute(f"SELECT 1 FROM channels c WHERE c.id = ? AND {cond}", [channel_id, *params]).fetchone()
    return row is not None


# ------------------------------------------------------------------- now/next


def now_next(conn: sqlite3.Connection, channel_ids: Iterable[str], now: int) -> dict[str, dict]:
    ids = list(dict.fromkeys(channel_ids))
    out: dict[str, dict] = {cid: {"now": None, "next": None} for cid in ids}
    if not ids:
        return out
    for chunk in (ids[i:i + 500] for i in range(0, len(ids), 500)):
        rows = conn.execute(f"""
            SELECT * FROM (
                SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.channel_id ORDER BY p.start) AS rn
                FROM programmes p
                JOIN channel_guide_feed g ON g.channel_id = p.channel_id AND p.feed_id IS g.feed_id
                WHERE p.channel_id IN ({','.join('?' * len(chunk))})
                  AND p.stop > ? AND p.start < ?
            ) WHERE rn <= 2 ORDER BY channel_id, start
        """, [*chunk, now, now + 86400]).fetchall()
        for r in rows:
            slot = out[r["channel_id"]]
            p = programme_dict(r)
            if r["start"] <= now and slot["now"] is None and slot["next"] is None:
                slot["now"] = p
            elif slot["next"] is None:
                slot["next"] = p
    return out


def attach_now_next(conn: sqlite3.Connection, channels: list[dict], now: int) -> list[dict]:
    nn = now_next(conn, [c["id"] for c in channels if c.get("has_guide")], now)
    for c in channels:
        slot = nn.get(c["id"], {"now": None, "next": None})
        c["now"], c["next"] = slot["now"], slot["next"]
    return channels


# ------------------------------------------------------------------------ FTS

_TOKEN = re.compile(r"\w+", re.UNICODE)


def fts_query(text: str) -> str | None:
    """Turn user text into a safe FTS5 query: every word must match as a prefix."""
    tokens = _TOKEN.findall(text or "")
    if not tokens:
        return None
    return " AND ".join(f'"{t}"*' for t in tokens[:12])
