"""Smart IPTV API.

Run:  uvicorn app.main:app --reload
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .epg import ingest
from .routers import admin, ai, catalog, catchup, downloads, guide, me, multiview, party, profiles, recommendations, recordings, sources, sync, vod, watchlist, world

log = logging.getLogger("smart_iptv")
REFRESH_HOURS = float(os.environ.get("SMART_IPTV_EPG_REFRESH_HOURS", "12"))


async def _epg_refresher() -> None:
    """Reload guide sources periodically so Now/Next stays current."""
    while True:
        await asyncio.sleep(REFRESH_HOURS * 3600)
        def work():
            conn = db.connect(config.DB_PATH)
            try:
                if conn.execute("SELECT COUNT(*) FROM epg_sources WHERE enabled = 1").fetchone()[0]:
                    ingest.refresh_all(conn)
            finally:
                conn.close()
        try:
            await asyncio.to_thread(work)
        except Exception:  # keep the loop alive
            log.exception("scheduled guide refresh failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    (config.DATA_DIR / "epg").mkdir(parents=True, exist_ok=True)   # drop guide.xml files here
    config.RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    config.DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    conn = db.connect(config.DB_PATH)
    db.init(conn)
    ingest.ensure_guide_feed_table(conn)
    conn.close()
    task = asyncio.create_task(_epg_refresher()) if REFRESH_HOURS > 0 else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Smart IPTV", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["X-Channel-Count"])

for r in (
    profiles.router,
    catalog.router,
    guide.router,
    catchup.router,
    downloads.router,
    vod.router,
    recordings.router,
    sources.router,
    me.router,
    recommendations.router,
    ai.router,
    world.router,
    multiview.router,
    sync.router,
    watchlist.router,
    party.router,
    admin.router,
):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve the built frontend (frontend/dist) when present.
DIST = Path(os.environ.get("SMART_IPTV_FRONTEND", config.BASE_DIR.parent / "frontend" / "dist"))
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        candidate = (DIST / path).resolve()
        if path and DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
