"""Virtual Watch Parties Router (Feature 44)."""
from __future__ import annotations

import secrets
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_profile, get_conn

router = APIRouter(prefix="/api/party", tags=["party"])


class CreatePartyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    channel_id: str | None = None
    stream_url: str | None = None


class SyncPartyRequest(BaseModel):
    playback_time: float = Field(ge=0)
    is_playing: bool


class PartyMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)


@router.post("/create", status_code=201)
def create_party(
    body: CreatePartyRequest,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    party_id = f"WP-{secrets.token_hex(2).upper()}"

    stream_url = body.stream_url
    if not stream_url and body.channel_id:
        st = conn.execute("SELECT url FROM streams WHERE channel_id = ? ORDER BY id ASC LIMIT 1", (body.channel_id,)).fetchone()
        if st:
            stream_url = st["url"]

    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO watch_parties (id, name, host_profile_id, channel_id, stream_url, playback_time, is_playing, last_updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (party_id, body.name, profile["id"], body.channel_id, stream_url, 0.0, 1, now, now),
        )

    return {
        "party_id": party_id,
        "name": body.name,
        "channel_id": body.channel_id,
        "stream_url": stream_url,
        "created_at": now,
    }


@router.get("/{party_id}")
def get_party(
    party_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM watch_parties WHERE id = ?", (party_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Watch party room not found")

    ch_name = None
    ch_logo = None
    if row["channel_id"]:
        ch = conn.execute("SELECT name, logo FROM channels WHERE id = ?", (row["channel_id"],)).fetchone()
        if ch:
            ch_name = ch["name"]
            ch_logo = ch["logo"]

    msgs = conn.execute(
        "SELECT * FROM watch_party_messages WHERE party_id = ? ORDER BY created_at ASC LIMIT 50",
        (party_id,),
    ).fetchall()

    return {
        "party_id": row["id"],
        "name": row["name"],
        "channel_id": row["channel_id"],
        "channel_name": ch_name,
        "channel_logo": ch_logo,
        "stream_url": row["stream_url"],
        "playback_time": row["playback_time"],
        "is_playing": bool(row["is_playing"]),
        "last_updated_at": row["last_updated_at"],
        "messages": [
            {
                "id": m["id"],
                "user_name": m["user_name"],
                "user_color": m["user_color"],
                "message": m["message"],
                "created_at": m["created_at"],
            }
            for m in msgs
        ],
    }


@router.post("/{party_id}/sync")
def sync_party_playback(
    party_id: str,
    body: SyncPartyRequest,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    with db.transaction(conn):
        res = conn.execute(
            """
            UPDATE watch_parties
            SET playback_time = ?, is_playing = ?, last_updated_at = ?
            WHERE id = ?
            """,
            (body.playback_time, int(body.is_playing), now, party_id),
        )
        if res.rowcount == 0:
            raise HTTPException(404, "Watch party not found")

    return {"synced": True, "playback_time": body.playback_time, "is_playing": body.is_playing}


@router.post("/{party_id}/message")
def post_party_message(
    party_id: str,
    body: PartyMessageRequest,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO watch_party_messages (party_id, user_name, user_color, message, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (party_id, profile["name"], profile["color"], body.message, now),
        )

    return {"sent": True}

