"""Multi-View Presets Router."""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_profile, get_conn

router = APIRouter(prefix="/api/me/multiview", tags=["multiview"])


class PresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    layout: str = Field(default="quad", pattern="^(dual|triple|quad|focus)$")
    channel_ids: list[str] = Field(min_length=1, max_length=4)


@router.get("")
def list_presets(
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM multiview_presets WHERE profile_id = ? ORDER BY created_at DESC",
        (profile["id"],),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "layout": r["layout"],
            "channel_ids": db.jload(r["channel_ids"], []),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("", status_code=201)
def create_preset(
    body: PresetCreate,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    cur = conn.execute(
        "INSERT INTO multiview_presets(profile_id, name, layout, channel_ids, created_at) VALUES (?,?,?,?,?)",
        (profile["id"], body.name.strip(), body.layout, db.jdump(body.channel_ids), now),
    )
    return {
        "id": cur.lastrowid,
        "name": body.name.strip(),
        "layout": body.layout,
        "channel_ids": body.channel_ids,
        "created_at": now,
    }


@router.delete("/{preset_id}", status_code=204)
def delete_preset(
    preset_id: int,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    res = conn.execute(
        "DELETE FROM multiview_presets WHERE id = ? AND profile_id = ?",
        (preset_id, profile["id"]),
    )
    if res.rowcount == 0:
        raise HTTPException(404, "Preset not found")

