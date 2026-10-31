"""Universal Watchlist Router (Feature 40)."""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_profile, get_conn

router = APIRouter(prefix="/api/me/watchlist", tags=["watchlist"])


class WatchlistAddRequest(BaseModel):
    item_type: str = Field(pattern="^(channel|programme|vod)$")
    item_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.get("")
def list_watchlist(
    item_type: str | None = None,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    where = ["profile_id = ?"]
    params: list = [profile["id"]]

    if item_type:
        where.append("item_type = ?")
        params.append(item_type)

    sql = f"""
        SELECT * FROM watchlists
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
    """
    rows = conn.execute(sql, params).fetchall()
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "item_type": r["item_type"],
            "item_id": r["item_id"],
            "title": r["title"],
            "metadata": db.jload(r["metadata"], {}),
            "created_at": r["created_at"],
        })
    return items


@router.get("/check")
def check_watchlist(
    item_type: str = Query(..., pattern="^(channel|programme|vod)$"),
    item_id: str = Query(...),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id FROM watchlists WHERE profile_id = ? AND item_type = ? AND item_id = ?",
        (profile["id"], item_type, item_id),
    ).fetchone()
    return {"in_watchlist": bool(row), "watchlist_id": row["id"] if row else None}


@router.post("", status_code=201)
def add_to_watchlist(
    body: WatchlistAddRequest,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    with db.transaction(conn):
        conn.execute(
            """
            INSERT OR REPLACE INTO watchlists (profile_id, item_type, item_id, title, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (profile["id"], body.item_type, body.item_id, body.title, db.jdump(body.metadata), now),
        )
        row = conn.execute(
            "SELECT id FROM watchlists WHERE profile_id = ? AND item_type = ? AND item_id = ?",
            (profile["id"], body.item_type, body.item_id),
        ).fetchone()

    return {
        "id": row["id"],
        "item_type": body.item_type,
        "item_id": body.item_id,
        "title": body.title,
        "created_at": now,
    }


@router.delete("/{watchlist_id}", status_code=204)
def remove_from_watchlist(
    watchlist_id: int,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    with db.transaction(conn):
        conn.execute(
            "DELETE FROM watchlists WHERE id = ? AND profile_id = ?",
            (watchlist_id, profile["id"]),
        )

