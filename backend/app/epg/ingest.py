"""Load XMLTV guides into the programmes table.

A guide source is a URL or a local file path (plain or .gz). XMLTV channel ids
are mapped onto catalog channels in this order:

1. iptv-org/epg style ids: ``Channel.cc@Feed`` -> (Channel.cc, Feed)
2. plain catalog ids: ``Channel.cc``
3. a unique match between a <display-name> and a channel name / alt name
"""
from __future__ import annotations

import logging
import re
import sqlite3
import time
import unicodedata
from pathlib import Path

import httpx

from .. import config, db
from . import demo
from .xmltv import XChannel, XProgramme, iter_xmltv

log = logging.getLogger("smart_iptv.epg")

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_NOISE = re.compile(r"\b(hd|fhd|uhd|sd|4k|tv|channel|live)\b")


def normalize_name(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    name = _NOISE.sub(" ", name)
    return _NON_ALNUM.sub("", name)


class ChannelMapper:
    def __init__(self, conn: sqlite3.Connection):
        self.ids = {r["id"] for r in conn.execute("SELECT id FROM channels")}
        self.by_name: dict[str, set[str]] = {}
        for r in conn.execute("SELECT id, name, alt_names FROM channels"):
            for n in [r["name"], *db.jload(r["alt_names"], [])]:
                key = normalize_name(n)
                if len(key) >= 3:
                    self.by_name.setdefault(key, set()).add(r["id"])
        self.cache: dict[str, tuple[str, str | None] | None] = {}

    def learn(self, ch: XChannel) -> None:
        self.cache[ch.id] = self._resolve(ch.id, ch.names)

    def resolve(self, xmltv_id: str) -> tuple[str, str | None] | None:
        if xmltv_id not in self.cache:
            self.cache[xmltv_id] = self._resolve(xmltv_id, [])
        return self.cache[xmltv_id]

    def _resolve(self, xmltv_id: str, names: list[str]) -> tuple[str, str | None] | None:
        if "@" in xmltv_id:
            cid, feed = xmltv_id.split("@", 1)
            if cid in self.ids:
                return cid, feed or None
        if xmltv_id in self.ids:
            return xmltv_id, None
        for n in names:
            hits = self.by_name.get(normalize_name(n))
            if hits and len(hits) == 1:
                return next(iter(hits)), None
        return None


def fetch(location: str) -> bytes:
    if re.match(r"^https?://", location):
        with httpx.Client(follow_redirects=True, timeout=180) as client:
            r = client.get(location)
            r.raise_for_status()
            return r.content
    return Path(location).expanduser().read_bytes()


def ingest_bytes(conn: sqlite3.Connection, source_id: int, data: bytes,
                 now: int | None = None) -> dict[str, int]:
    now = now or int(time.time())
    cutoff = now - config.EPG_KEEP_PAST_HOURS * 3600
    mapper = ChannelMapper(conn)
    unmapped: set[str] = set()
    mapped: set[str] = set()
    rows = []
    for item in iter_xmltv(data):
        if isinstance(item, XChannel):
            mapper.learn(item)
            continue
        p: XProgramme = item
        if p.stop < cutoff:
            continue
        target = mapper.resolve(p.channel)
        if not target:
            unmapped.add(p.channel)
            continue
        mapped.add(target[0])
        rows.append((source_id, target[0], target[1], p.start, p.stop, p.title, p.sub_title,
                     p.description, db.jdump(p.categories), p.episode, p.rating, p.icon))

    with db.transaction(conn):
        conn.execute("DELETE FROM programmes WHERE source_id = ?", (source_id,))
        conn.executemany(
            "INSERT OR IGNORE INTO programmes(source_id, channel_id, feed_id, start, stop, title,"
            " sub_title, description, categories, episode, rating, icon)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            rows,
        )
        count = conn.execute("SELECT COUNT(*) FROM programmes WHERE source_id = ?",
                             (source_id,)).fetchone()[0]
        conn.execute(
            "UPDATE epg_sources SET last_loaded_at=?, last_status='ok', last_error=NULL,"
            " programme_count=?, mapped_channels=?, unmapped_channels=? WHERE id=?",
            (now, count, len(mapped), len(unmapped), source_id),
        )
    return {"programmes": count, "mapped_channels": len(mapped), "unmapped_channels": len(unmapped)}


def rebuild_indexes(conn: sqlite3.Connection, now: int | None = None) -> None:
    """Prune old programmes, rebuild FTS, and pick one guide feed per channel."""
    now = now or int(time.time())
    with db.transaction(conn):
        conn.execute("DELETE FROM programmes WHERE stop < ?", (now - config.EPG_KEEP_PAST_HOURS * 3600,))
        conn.execute("INSERT INTO programmes_fts(programmes_fts) VALUES ('rebuild')")
        conn.execute("DROP TABLE IF EXISTS channel_guide_feed")
        # A channel may have programmes for several regional feeds. Prefer the
        # feed of the channel's best stream, then the main feed, then whichever
        # feed has the most programmes.
        conn.execute("""
            CREATE TABLE channel_guide_feed AS
            WITH counts AS (
                SELECT channel_id, feed_id, COUNT(*) AS n
                FROM programmes GROUP BY channel_id, feed_id
            ),
            best_stream AS (
                SELECT channel_id, feed_id FROM streams s
                WHERE s.id = (SELECT MIN(id) FROM streams s2 WHERE s2.channel_id = s.channel_id)
            ),
            ranked AS (
                SELECT c.channel_id, c.feed_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY c.channel_id
                           ORDER BY (bs.feed_id IS NOT NULL AND bs.feed_id = c.feed_id) DESC,
                                    COALESCE(f.is_main, 0) DESC,
                                    c.n DESC
                       ) AS rk
                FROM counts c
                LEFT JOIN best_stream bs ON bs.channel_id = c.channel_id
                LEFT JOIN feeds f ON f.channel_id = c.channel_id AND f.id = c.feed_id
            )
            SELECT channel_id, feed_id FROM ranked WHERE rk = 1
        """)
        conn.execute("CREATE UNIQUE INDEX idx_cgf ON channel_guide_feed(channel_id)")
        db.set_meta(conn, "epg_indexed_at", str(now))


def ensure_guide_feed_table(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS channel_guide_feed (channel_id TEXT PRIMARY KEY, feed_id TEXT)")


def add_source(conn: sqlite3.Connection, location: str, label: str | None = None) -> int:
    conn.execute(
        "INSERT INTO epg_sources(location, label) VALUES (?, ?) ON CONFLICT(location) DO UPDATE"
        " SET label = COALESCE(excluded.label, epg_sources.label), enabled = 1",
        (location, label),
    )
    return conn.execute("SELECT id FROM epg_sources WHERE location = ?", (location,)).fetchone()[0]


def refresh_source(conn: sqlite3.Connection, source_id: int, now: int | None = None) -> dict:
    row = conn.execute("SELECT * FROM epg_sources WHERE id = ?", (source_id,)).fetchone()
    if not row:
        raise KeyError(source_id)
    try:
        if row["location"] == demo.DEMO_LOCATION:
            data = demo.generate(conn, now=now)
        else:
            data = fetch(row["location"])
        result = ingest_bytes(conn, source_id, data, now)
        return {"id": source_id, "status": "ok", **result}
    except Exception as exc:  # report per-source failures, keep old programmes
        log.warning("EPG source %s failed: %s", row["location"], exc)
        conn.execute("UPDATE epg_sources SET last_status='error', last_error=? WHERE id=?",
                     (str(exc)[:500], source_id))
        return {"id": source_id, "status": "error", "error": str(exc)}


def refresh_all(conn: sqlite3.Connection, now: int | None = None) -> list[dict]:
    ids = [r[0] for r in conn.execute("SELECT id FROM epg_sources WHERE enabled = 1 ORDER BY id")]
    results = [refresh_source(conn, i, now) for i in ids]
    rebuild_indexes(conn, now)
    return results
