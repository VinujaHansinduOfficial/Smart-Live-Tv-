"""Per-profile data: favourites, watch history, continue watching, reminders."""
from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..deps import current_profile, get_conn
from ..services import attach_now_next, can_watch, channel_dict, channel_select, now_next, restriction_sql

router = APIRouter(prefix="/api/me", tags=["me"])

RESUME_GAP_S = 5 * 60      # re-opening a channel within 5 min continues the same history entry


# ------------------------------------------------------------------ favorites

@router.get("/favorites")
def favorites(profile: sqlite3.Row = Depends(current_profile), conn: sqlite3.Connection = Depends(get_conn)):
    base, params = channel_select(profile["id"])
    cond, rparams = restriction_sql(profile)
    rows = conn.execute(
        f"{base} JOIN favorites fv ON fv.channel_id = c.id AND fv.profile_id = ?"
        f" WHERE {cond} ORDER BY fv.added_at DESC",
        [*params, profile["id"], *rparams],
    ).fetchall()
    return attach_now_next(conn, [channel_dict(r) for r in rows], int(time.time()))


@router.put("/favorites/{channel_id}", status_code=204)
def add_favorite(channel_id: str, profile: sqlite3.Row = Depends(current_profile),
                 conn: sqlite3.Connection = Depends(get_conn)):
    if not can_watch(conn, profile, channel_id):
        raise HTTPException(404, "Channel not found or not available for this profile")
    conn.execute("INSERT OR IGNORE INTO favorites(profile_id, channel_id, added_at) VALUES (?,?,?)",
                 (profile["id"], channel_id, int(time.time())))


@router.delete("/favorites/{channel_id}", status_code=204)
def remove_favorite(channel_id: str, profile: sqlite3.Row = Depends(current_profile),
                    conn: sqlite3.Connection = Depends(get_conn)):
    conn.execute("DELETE FROM favorites WHERE profile_id = ? AND channel_id = ?", (profile["id"], channel_id))


# -------------------------------------------------------------------- history

class WatchStart(BaseModel):
    channel_id: str
    stream_url: str | None = Field(default=None, max_length=2000)


@router.post("/history")
def start_watching(body: WatchStart, profile: sqlite3.Row = Depends(current_profile),
                   conn: sqlite3.Connection = Depends(get_conn)):
    if not can_watch(conn, profile, body.channel_id):
        raise HTTPException(404, "Channel not found or not available for this profile")
    now = int(time.time())
    airing = now_next(conn, [body.channel_id], now)[body.channel_id]["now"]
    title = airing["title"] if airing else None
    last = conn.execute(
        "SELECT * FROM watch_history WHERE profile_id = ? ORDER BY last_seen_at DESC LIMIT 1",
        (profile["id"],),
    ).fetchone()
    conn.execute("UPDATE profiles SET last_channel_id = ? WHERE id = ?", (body.channel_id, profile["id"]))
    if last and last["channel_id"] == body.channel_id and now - last["last_seen_at"] <= RESUME_GAP_S:
        conn.execute("UPDATE watch_history SET last_seen_at = ?, stream_url = COALESCE(?, stream_url),"
                     " programme_title = COALESCE(?, programme_title) WHERE id = ?",
                     (now, body.stream_url, title, last["id"]))
        return {"id": last["id"], "resumed": True}
    cur = conn.execute(
        "INSERT INTO watch_history(profile_id, channel_id, stream_url, programme_title, started_at, last_seen_at)"
        " VALUES (?,?,?,?,?,?)",
        (profile["id"], body.channel_id, body.stream_url, title, now, now),
    )
    return {"id": cur.lastrowid, "resumed": False}


class Heartbeat(BaseModel):
    stream_url: str | None = Field(default=None, max_length=2000)


@router.post("/history/{entry_id}/heartbeat", status_code=204)
def heartbeat(entry_id: int, body: Heartbeat | None = None, profile: sqlite3.Row = Depends(current_profile),
              conn: sqlite3.Connection = Depends(get_conn)):
    """Called by the player every ~30 s while video is actually playing."""
    now = int(time.time())
    row = conn.execute("SELECT * FROM watch_history WHERE id = ? AND profile_id = ?",
                       (entry_id, profile["id"])).fetchone()
    if not row:
        raise HTTPException(404, "History entry not found")
    # Count at most 90 s per heartbeat so a sleeping laptop doesn't log hours.
    gained = min(max(now - row["last_seen_at"], 0), 90)
    conn.execute(
        "UPDATE watch_history SET last_seen_at = ?, duration_s = duration_s + ?,"
        " stream_url = COALESCE(?, stream_url) WHERE id = ?",
        (now, gained, body.stream_url if body else None, entry_id),
    )


@router.get("/history")
def history(limit: int = Query(50, ge=1, le=500), profile: sqlite3.Row = Depends(current_profile),
            conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute("""
        SELECT h.*, c.name AS channel_name, c.logo AS channel_logo
        FROM watch_history h LEFT JOIN channels c ON c.id = h.channel_id
        WHERE h.profile_id = ? ORDER BY h.last_seen_at DESC, h.id DESC LIMIT ?
    """, (profile["id"], limit)).fetchall()
    return [{
        "id": r["id"], "channel_id": r["channel_id"], "channel_name": r["channel_name"] or r["channel_id"],
        "channel_logo": r["channel_logo"], "programme_title": r["programme_title"],
        "started_at": r["started_at"], "last_seen_at": r["last_seen_at"], "duration_s": r["duration_s"],
        "available": r["channel_name"] is not None,
    } for r in rows]


@router.delete("/history", status_code=204)
def clear_history(profile: sqlite3.Row = Depends(current_profile), conn: sqlite3.Connection = Depends(get_conn)):
    conn.execute("DELETE FROM watch_history WHERE profile_id = ?", (profile["id"],))


@router.delete("/history/{entry_id}", status_code=204)
def delete_history_entry(entry_id: int, profile: sqlite3.Row = Depends(current_profile),
                         conn: sqlite3.Connection = Depends(get_conn)):
    conn.execute("DELETE FROM watch_history WHERE id = ? AND profile_id = ?", (entry_id, profile["id"]))


@router.get("/continue")
def continue_watching(limit: int = Query(12, ge=1, le=50), profile: sqlite3.Row = Depends(current_profile),
                      conn: sqlite3.Connection = Depends(get_conn)):
    """Recently watched channels (most recent first) with what's on now."""
    base, params = channel_select(profile["id"])
    cond, rparams = restriction_sql(profile)
    rows = conn.execute(f"""
        WITH recent AS (
            SELECT channel_id, MAX(last_seen_at) AS seen, SUM(duration_s) AS watched, MAX(id) AS last_id
            FROM watch_history WHERE profile_id = ? GROUP BY channel_id
        )
        SELECT * FROM ({base}) c2 JOIN recent r ON r.channel_id = c2.id
        WHERE c2.id IN (SELECT c.id FROM channels c WHERE {cond})
        ORDER BY r.seen DESC, r.last_id DESC LIMIT ?
    """, [profile["id"], *params, *rparams, limit]).fetchall()
    out = []
    for r in rows:
        d = channel_dict(r)
        d["last_watched_at"] = r["seen"]
        d["watched_s"] = r["watched"]
        out.append(d)
    return attach_now_next(conn, out, int(time.time()))


# ------------------------------------------------------------------ reminders

class ReminderIn(BaseModel):
    programme_id: int
    notify_before_min: int = Field(5, ge=0, le=120)


def reminder_dict(r: sqlite3.Row, now: int) -> dict:
    return {
        "id": r["id"], "programme_id": r["programme_id"], "channel_id": r["channel_id"],
        "channel_name": r["channel_name"], "channel_logo": r["channel_logo"],
        "title": r["title"], "start": r["start"], "stop": r["stop"],
        "notify_before_min": r["notify_before_s"] // 60,
        "status": "airing" if r["start"] <= now < r["stop"] else ("ended" if now >= r["stop"] else "upcoming"),
    }


REMINDER_SELECT = ("SELECT r.*, c.name AS channel_name, c.logo AS channel_logo FROM reminders r"
                   " LEFT JOIN channels c ON c.id = r.channel_id")


@router.get("/reminders")
def list_reminders(profile: sqlite3.Row = Depends(current_profile), conn: sqlite3.Connection = Depends(get_conn)):
    now = int(time.time())
    rows = conn.execute(f"{REMINDER_SELECT} WHERE r.profile_id = ? AND r.stop > ? AND r.dismissed = 0"
                        " ORDER BY r.start", (profile["id"], now)).fetchall()
    return [reminder_dict(r, now) for r in rows]


@router.post("/reminders", status_code=201)
def add_reminder(body: ReminderIn, profile: sqlite3.Row = Depends(current_profile),
                 conn: sqlite3.Connection = Depends(get_conn)):
    now = int(time.time())
    p = conn.execute("SELECT * FROM programmes WHERE id = ?", (body.programme_id,)).fetchone()
    if not p or not can_watch(conn, profile, p["channel_id"]):
        raise HTTPException(404, "Programme not found")
    if p["start"] <= now:
        raise HTTPException(400, "This programme has already started — watch it now instead.")
    conn.execute(
        "INSERT INTO reminders(profile_id, programme_id, channel_id, title, start, stop, notify_before_s, created_at)"
        " VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(profile_id, channel_id, start) DO UPDATE SET"
        " notify_before_s = excluded.notify_before_s, dismissed = 0, title = excluded.title",
        (profile["id"], p["id"], p["channel_id"], p["title"], p["start"], p["stop"],
         body.notify_before_min * 60, now),
    )
    r = conn.execute(f"{REMINDER_SELECT} WHERE r.profile_id = ? AND r.channel_id = ? AND r.start = ?",
                     (profile["id"], p["channel_id"], p["start"])).fetchone()
    return reminder_dict(r, now)


@router.get("/reminders/due")
def due_reminders(profile: sqlite3.Row = Depends(current_profile), conn: sqlite3.Connection = Depends(get_conn)):
    """Reminders whose alert time has arrived and that haven't been dismissed."""
    now = int(time.time())
    rows = conn.execute(f"{REMINDER_SELECT} WHERE r.profile_id = ? AND r.dismissed = 0"
                        " AND r.start - r.notify_before_s <= ? AND r.stop > ? ORDER BY r.start",
                        (profile["id"], now, now)).fetchall()
    return [reminder_dict(r, now) for r in rows]


@router.post("/reminders/{reminder_id}/dismiss", status_code=204)
def dismiss_reminder(reminder_id: int, profile: sqlite3.Row = Depends(current_profile),
                     conn: sqlite3.Connection = Depends(get_conn)):
    conn.execute("UPDATE reminders SET dismissed = 1 WHERE id = ? AND profile_id = ?", (reminder_id, profile["id"]))


@router.delete("/reminders/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: int, profile: sqlite3.Row = Depends(current_profile),
                    conn: sqlite3.Connection = Depends(get_conn)):
    conn.execute("DELETE FROM reminders WHERE id = ? AND profile_id = ?", (reminder_id, profile["id"]))
