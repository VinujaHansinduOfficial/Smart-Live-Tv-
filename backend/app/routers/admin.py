"""Catalog sync and EPG source management (grown-up profiles only)."""
from __future__ import annotations

import re
import sqlite3
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import config, db, sync
from ..deps import adult_profile, get_conn
from ..epg import channels_xml, demo, ingest

router = APIRouter(prefix="/api/admin", tags=["admin"])

EPG_DIR = config.DATA_DIR / "epg"
_job_lock = threading.Lock()
_job_state: dict = {"running": None, "last": None}


def _run_job(name: str, fn) -> None:
    def worker():
        conn = db.connect(config.DB_PATH)
        try:
            result = fn(conn)
            _job_state["last"] = {"job": name, "status": "ok", "result": result}
        except Exception as exc:
            _job_state["last"] = {"job": name, "status": "error", "error": str(exc)}
        finally:
            conn.close()
            _job_state["running"] = None
            _job_lock.release()

    if not _job_lock.acquire(blocking=False):
        raise HTTPException(409, f"'{_job_state['running']}' is still running.")
    _job_state["running"] = name
    threading.Thread(target=worker, daemon=True).start()


@router.get("/jobs")
def jobs(_: sqlite3.Row = Depends(adult_profile)):
    return _job_state


@router.post("/sync", status_code=202)
def start_sync(_: sqlite3.Row = Depends(adult_profile)):
    def job(conn):
        stats = sync.sync(conn)
        ingest.rebuild_indexes(conn)
        return stats
    _run_job("catalog sync", job)
    return {"started": True}


# ----------------------------------------------------------------- EPG sources

class SourceIn(BaseModel):
    location: str = Field(min_length=3, max_length=2000)
    label: str | None = Field(default=None, max_length=80)


def _validate_location(location: str) -> str:
    if re.match(r"^https?://", location) or location == demo.DEMO_LOCATION:
        return location
    # Local files must live in data/epg so the API cannot read arbitrary paths.
    path = (EPG_DIR / location).resolve() if not Path(location).is_absolute() else Path(location).resolve()
    if EPG_DIR.resolve() not in path.parents:
        raise HTTPException(400, f"Local guide files must be inside {EPG_DIR}")
    if not path.is_file():
        raise HTTPException(400, f"File not found: {path}")
    return str(path)


@router.get("/epg/sources")
def list_sources(_: sqlite3.Row = Depends(adult_profile), conn: sqlite3.Connection = Depends(get_conn)):
    return [dict(r) for r in conn.execute("SELECT * FROM epg_sources ORDER BY id")]


@router.post("/epg/sources", status_code=202)
def add_source(body: SourceIn, _: sqlite3.Row = Depends(adult_profile),
               conn: sqlite3.Connection = Depends(get_conn)):
    location = _validate_location(body.location.strip())
    sid = ingest.add_source(conn, location, body.label)

    def job(c):
        result = ingest.refresh_source(c, sid)
        ingest.rebuild_indexes(c)
        return result
    _run_job("guide load", job)
    return {"id": sid, "started": True}


@router.post("/epg/demo", status_code=202)
def load_demo(_: sqlite3.Row = Depends(adult_profile), conn: sqlite3.Connection = Depends(get_conn)):
    sid = ingest.add_source(conn, demo.DEMO_LOCATION, "Demo guide (generated)")

    def job(c):
        result = ingest.refresh_source(c, sid)
        ingest.rebuild_indexes(c)
        return result
    _run_job("demo guide", job)
    return {"id": sid, "started": True}


@router.delete("/epg/sources/{source_id}", status_code=204)
def delete_source(source_id: int, _: sqlite3.Row = Depends(adult_profile),
                  conn: sqlite3.Connection = Depends(get_conn)):
    conn.execute("DELETE FROM programmes WHERE source_id = ?", (source_id,))
    conn.execute("DELETE FROM epg_sources WHERE id = ?", (source_id,))
    ingest.rebuild_indexes(conn)


@router.post("/epg/refresh", status_code=202)
def refresh(_: sqlite3.Row = Depends(adult_profile)):
    _run_job("guide refresh", ingest.refresh_all)
    return {"started": True}


@router.get("/epg/channels-xml")
def export_channels_xml(
    country: str | None = None,
    category: str | None = None,
    ids: str | None = None,
    favorites: bool = False,
    limit: int = Query(500, ge=1, le=5000),
    profile: sqlite3.Row = Depends(adult_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """channels.xml for `npm run grab --- --channels=custom.channels.xml` in iptv-org/epg."""
    id_list = [i.strip() for i in ids.split(",") if i.strip()] if ids else None
    if favorites:
        favs = [r[0] for r in conn.execute("SELECT channel_id FROM favorites WHERE profile_id = ?", (profile["id"],))]
        id_list = (id_list or []) + favs
        if not id_list:
            raise HTTPException(400, "No favourites yet.")
    entries = channels_xml.select_entries(conn, id_list, country, category, limit)
    if not entries:
        raise HTTPException(404, "None of the selected channels has a known guide site.")
    return Response(
        channels_xml.render(entries), media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="custom.channels.xml"',
                 "X-Channel-Count": str(len(entries))},
    )
