"""Cross-Device Synchronization and TV Companion Remote Router.

Supports device pairing via short codes, real-time remote control command
dispatch between mobile companions and TV displays, and full household backup/restore.
"""
from __future__ import annotations

import random
import secrets
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..deps import adult_profile, current_profile, get_conn

router = APIRouter(prefix="/api/sync", tags=["sync"])

CODE_EXPIRES_S = 15 * 60  # 15 minutes


class PairRequest(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    device_name: str | None = Field(default="Mobile Remote", max_length=50)


class CommandRequest(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    command: str = Field(min_length=1, max_length=50)
    payload: dict[str, Any] = Field(default_factory=dict)


class BackupData(BaseModel):
    version: int = 1
    exported_at: int
    profiles: list[dict[str, Any]]
    favorites: list[dict[str, Any]]
    reminders: list[dict[str, Any]]
    history: list[dict[str, Any]]
    multiview_presets: list[dict[str, Any]]


# ----------------------------------------------------------------- Pairing & Remote Control

def _generate_code() -> str:
    # Easy to type 6-digit pairing code e.g. "TV-8492"
    digits = "".join(random.choices("0123456789", k=4))
    return f"TV-{digits}"


@router.post("/code")
def create_pairing_code(
    name: str = Query("Smart TV Display", max_length=50),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    expires = now + CODE_EXPIRES_S

    # Find active token for this profile
    sess = conn.execute(
        "SELECT token FROM profile_sessions WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1",
        (profile["id"],),
    ).fetchone()
    token = sess["token"] if sess else secrets.token_urlsafe(32)

    code = _generate_code()
    # Ensure uniqueness
    for _ in range(5):
        try:
            conn.execute(
                "INSERT INTO device_pairs(code, profile_id, token, name, created_at, expires_at) VALUES (?,?,?,?,?,?)",
                (code, profile["id"], token, name, now, expires),
            )
            break
        except sqlite3.IntegrityError:
            code = _generate_code()

    return {
        "code": code,
        "profile_id": profile["id"],
        "profile_name": profile["name"],
        "expires_in": CODE_EXPIRES_S,
        "expires_at": expires,
    }


@router.post("/pair")
def pair_device(
    body: PairRequest,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    code = body.code.strip().upper()
    row = conn.execute(
        "SELECT p.*, pr.name AS profile_name FROM device_pairs p"
        " JOIN profiles pr ON pr.id = p.profile_id WHERE p.code = ?",
        (code,),
    ).fetchone()

    if not row:
        raise HTTPException(404, "Invalid pairing code. Check the code shown on your TV.")
    if row["expires_at"] < now:
        conn.execute("DELETE FROM device_pairs WHERE code = ?", (code,))
        raise HTTPException(410, "Pairing code expired. Please generate a new code on your TV.")

    return {
        "paired": True,
        "token": row["token"],
        "profile_id": row["profile_id"],
        "profile_name": row["profile_name"],
        "code": code,
    }


@router.post("/command")
def send_command(
    body: CommandRequest,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    code = body.code.strip().upper()
    pair = conn.execute("SELECT * FROM device_pairs WHERE code = ?", (code,)).fetchone()
    if not pair:
        raise HTTPException(404, "Pairing session not found or expired")

    now = time.time()
    cur = conn.execute(
        "INSERT INTO device_commands(pair_code, command, payload, created_at) VALUES (?,?,?,?)",
        (code, body.command, db.jdump(body.payload), now),
    )
    # Prune commands older than 2 minutes to keep table lean
    conn.execute("DELETE FROM device_commands WHERE created_at < ?", (now - 120,))
    return {"ok": True, "command_id": cur.lastrowid}


@router.get("/poll")
def poll_commands(
    code: str = Query(..., min_length=4, max_length=12),
    since: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    code = code.strip().upper()
    rows = conn.execute(
        "SELECT id, command, payload, created_at FROM device_commands WHERE pair_code = ? AND id > ? ORDER BY id ASC LIMIT 20",
        (code, since),
    ).fetchall()

    return [
        {
            "id": r["id"],
            "command": r["command"],
            "payload": db.jload(r["payload"], {}),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


# ----------------------------------------------------------------- Backup & Restore

@router.get("/backup")
def export_backup(
    profile: sqlite3.Row = Depends(adult_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    profiles = [dict(r) for r in conn.execute("SELECT * FROM profiles").fetchall()]
    favorites = [dict(r) for r in conn.execute("SELECT * FROM favorites").fetchall()]
    reminders = [dict(r) for r in conn.execute("SELECT * FROM reminders").fetchall()]
    history = [dict(r) for r in conn.execute("SELECT * FROM watch_history").fetchall()]
    multiview = [dict(r) for r in conn.execute("SELECT * FROM multiview_presets").fetchall()]

    return {
        "version": 1,
        "exported_at": int(time.time()),
        "profiles": profiles,
        "favorites": favorites,
        "reminders": reminders,
        "history": history,
        "multiview_presets": multiview,
    }


@router.post("/restore")
def import_backup(
    body: BackupData,
    profile: sqlite3.Row = Depends(adult_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    with db.transaction(conn):
        # Merge favorites
        fav_count = 0
        for f in body.favorites:
            cur = conn.execute(
                "INSERT OR IGNORE INTO favorites(profile_id, channel_id, added_at) VALUES (?,?,?)",
                (f.get("profile_id", profile["id"]), f["channel_id"], f.get("added_at", int(time.time()))),
            )
            fav_count += cur.rowcount

        # Merge multiview presets
        mv_count = 0
        for m in body.multiview_presets:
            cur = conn.execute(
                "INSERT INTO multiview_presets(profile_id, name, layout, channel_ids, created_at) VALUES (?,?,?,?,?)",
                (m.get("profile_id", profile["id"]), m["name"], m["layout"], m["channel_ids"] if isinstance(m["channel_ids"], str) else db.jdump(m["channel_ids"]), m.get("created_at", int(time.time()))),
            )
            mv_count += cur.rowcount

    return {
        "restored": True,
        "favorites_added": fav_count,
        "presets_added": mv_count,
    }

