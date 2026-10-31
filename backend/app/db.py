"""SQLite access and schema."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from . import config

SCHEMA = """
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- catalog
CREATE TABLE IF NOT EXISTS channels (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    alt_names     TEXT NOT NULL DEFAULT '[]',
    network       TEXT,
    country       TEXT,
    categories    TEXT NOT NULL DEFAULT '[]',
    languages     TEXT NOT NULL DEFAULT '[]',
    website       TEXT,
    logo          TEXT,
    stream_count  INTEGER NOT NULL DEFAULT 0,
    guide_sites   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_channels_country ON channels(country);

-- channel_id -> category, for fast filtering
CREATE TABLE IF NOT EXISTS channel_categories (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    category   TEXT NOT NULL,
    PRIMARY KEY (channel_id, category)
);
CREATE INDEX IF NOT EXISTS idx_chcat_category ON channel_categories(category);

CREATE TABLE IF NOT EXISTS channel_languages (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    language   TEXT NOT NULL,
    PRIMARY KEY (channel_id, language)
);
CREATE INDEX IF NOT EXISTS idx_chlang_language ON channel_languages(language);

CREATE TABLE IF NOT EXISTS feeds (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    name       TEXT,
    is_main    INTEGER NOT NULL DEFAULT 0,
    languages  TEXT NOT NULL DEFAULT '[]',
    timezones  TEXT NOT NULL DEFAULT '[]',
    format     TEXT,
    PRIMARY KEY (channel_id, id)
);

CREATE TABLE IF NOT EXISTS streams (
    id          INTEGER PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    feed_id     TEXT,
    title       TEXT,
    url         TEXT NOT NULL,
    referrer    TEXT,
    user_agent  TEXT,
    quality     TEXT,
    labels      TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_streams_channel ON streams(channel_id);

-- Guide sites known to iptv-org/epg for each channel/feed (from guides.json).
CREATE TABLE IF NOT EXISTS guide_sites (
    channel_id TEXT NOT NULL,
    feed_id    TEXT,
    site       TEXT NOT NULL,
    site_id    TEXT NOT NULL,
    site_name  TEXT,
    lang       TEXT
);
CREATE INDEX IF NOT EXISTS idx_guide_sites_channel ON guide_sites(channel_id);

CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS languages  (code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS countries  (code TEXT PRIMARY KEY, name TEXT NOT NULL, flag TEXT);

CREATE VIRTUAL TABLE IF NOT EXISTS channels_fts USING fts5(
    id UNINDEXED, name, alt_names, network,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- -------------------------------------------------------------------- EPG
CREATE TABLE IF NOT EXISTS epg_sources (
    id              INTEGER PRIMARY KEY,
    location        TEXT NOT NULL UNIQUE,   -- URL or file path
    label           TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_loaded_at  INTEGER,
    last_status     TEXT,
    last_error      TEXT,
    programme_count INTEGER NOT NULL DEFAULT 0,
    mapped_channels INTEGER NOT NULL DEFAULT 0,
    unmapped_channels INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS programmes (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER REFERENCES epg_sources(id) ON DELETE CASCADE,
    channel_id  TEXT NOT NULL,
    feed_id     TEXT,
    start       INTEGER NOT NULL,   -- unix seconds, UTC
    stop        INTEGER NOT NULL,
    title       TEXT NOT NULL,
    sub_title   TEXT,
    description TEXT,
    categories  TEXT NOT NULL DEFAULT '[]',
    episode     TEXT,
    rating      TEXT,
    icon        TEXT,
    UNIQUE (channel_id, start, title)
);
CREATE INDEX IF NOT EXISTS idx_prog_channel_start ON programmes(channel_id, start);
CREATE INDEX IF NOT EXISTS idx_prog_start ON programmes(start);
CREATE INDEX IF NOT EXISTS idx_prog_stop ON programmes(stop);

CREATE VIRTUAL TABLE IF NOT EXISTS programmes_fts USING fts5(
    title, sub_title, description, categories,
    content = 'programmes', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

-- --------------------------------------------------------------- profiles
CREATE TABLE IF NOT EXISTS profiles (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT NOT NULL,
    color                TEXT NOT NULL DEFAULT '#3b82f6',
    is_kids              INTEGER NOT NULL DEFAULT 0,
    pin_hash             TEXT,
    allowed_categories   TEXT,            -- JSON list; NULL = everything
    blocked_categories   TEXT NOT NULL DEFAULT '[]',
    preferred_countries  TEXT NOT NULL DEFAULT '[]',
    preferred_languages  TEXT NOT NULL DEFAULT '[]',
    last_channel_id      TEXT,
    created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_sessions (
    token      TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    added_at   INTEGER NOT NULL,
    PRIMARY KEY (profile_id, channel_id)
);

CREATE TABLE IF NOT EXISTS watch_history (
    id               INTEGER PRIMARY KEY,
    profile_id       INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id       TEXT NOT NULL,
    stream_url       TEXT,
    programme_title  TEXT,
    started_at       INTEGER NOT NULL,
    last_seen_at     INTEGER NOT NULL,
    duration_s       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_history_profile ON watch_history(profile_id, last_seen_at DESC);

-- Reminders keep a snapshot of the programme because programmes are pruned.
CREATE TABLE IF NOT EXISTS reminders (
    id           INTEGER PRIMARY KEY,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    programme_id INTEGER,
    channel_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    start        INTEGER NOT NULL,
    stop         INTEGER NOT NULL,
    notify_before_s INTEGER NOT NULL DEFAULT 300,
    dismissed    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    UNIQUE (profile_id, channel_id, start)
);
CREATE INDEX IF NOT EXISTS idx_reminders_profile ON reminders(profile_id, start);

-- ----------------------------------------------------------------- phase 4 & 5
CREATE TABLE IF NOT EXISTS multiview_presets (
    id           INTEGER PRIMARY KEY,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    layout       TEXT NOT NULL DEFAULT 'quad',
    channel_ids  TEXT NOT NULL DEFAULT '[]',
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_multiview_profile ON multiview_presets(profile_id);

CREATE TABLE IF NOT EXISTS device_pairs (
    code         TEXT PRIMARY KEY,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token        TEXT NOT NULL,
    name         TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_commands (
    id           INTEGER PRIMARY KEY,
    pair_code    TEXT NOT NULL,
    command      TEXT NOT NULL,
    payload      TEXT NOT NULL DEFAULT '{}',
    created_at   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_commands_code ON device_commands(pair_code, id);

-- ----------------------------------------------------------------- IPTV Sources
CREATE TABLE IF NOT EXISTS iptv_sources (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL, -- 'm3u', 'xtream', 'stalker'
    url             TEXT NOT NULL,
    username        TEXT,
    password        TEXT,
    mac_address     TEXT,
    headers         TEXT NOT NULL DEFAULT '{}',
    epg_url         TEXT,
    auto_refresh    INTEGER NOT NULL DEFAULT 1,
    last_synced_at  INTEGER,
    channel_count   INTEGER NOT NULL DEFAULT 0,
    vod_count       INTEGER NOT NULL DEFAULT 0,
    series_count    INTEGER NOT NULL DEFAULT 0,
    catchup_days    INTEGER NOT NULL DEFAULT 14,
    catchup_type    TEXT NOT NULL DEFAULT 'append',
    catchup_source  TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
);

-- ------------------------------------------------------------ VOD: Movies & Series
CREATE TABLE IF NOT EXISTS vod_items (
    id                  TEXT PRIMARY KEY,
    source_id           INTEGER REFERENCES iptv_sources(id) ON DELETE CASCADE,
    type                TEXT NOT NULL, -- 'movie', 'series'
    title               TEXT NOT NULL,
    original_title      TEXT,
    overview            TEXT,
    poster              TEXT,
    backdrop            TEXT,
    release_date        TEXT,
    genre               TEXT NOT NULL DEFAULT '[]',
    rating              REAL,
    duration_min        INTEGER,
    trailer_url         TEXT,
    stream_url          TEXT,
    container_extension TEXT,
    tmdb_id             INTEGER,
    created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vod_type ON vod_items(type);
CREATE INDEX IF NOT EXISTS idx_vod_rating ON vod_items(rating DESC);

CREATE TABLE IF NOT EXISTS vod_series_episodes (
    id                  TEXT PRIMARY KEY,
    series_id           TEXT NOT NULL REFERENCES vod_items(id) ON DELETE CASCADE,
    season_num          INTEGER NOT NULL,
    episode_num         INTEGER NOT NULL,
    title               TEXT NOT NULL,
    overview            TEXT,
    still_path          TEXT,
    duration_min        INTEGER,
    stream_url          TEXT NOT NULL,
    container_extension TEXT,
    rating              REAL,
    air_date            TEXT
);
CREATE INDEX IF NOT EXISTS idx_vod_episodes_series ON vod_series_episodes(series_id, season_num, episode_num);

CREATE TABLE IF NOT EXISTS vod_progress (
    profile_id          INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id             TEXT NOT NULL,
    series_id           TEXT,
    watched_s           INTEGER NOT NULL DEFAULT 0,
    total_s             INTEGER NOT NULL DEFAULT 0,
    completed           INTEGER NOT NULL DEFAULT 0,
    last_seen_at        INTEGER NOT NULL,
    PRIMARY KEY (profile_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_vod_progress_profile ON vod_progress(profile_id, last_seen_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS vod_fts USING fts5(
    id UNINDEXED, title, original_title, overview, genre,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- ------------------------------------------------------------- DVR & Recordings
CREATE TABLE IF NOT EXISTS recordings (
    id              INTEGER PRIMARY KEY,
    profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id      TEXT NOT NULL,
    programme_id    INTEGER,
    title           TEXT NOT NULL,
    description     TEXT,
    start           INTEGER NOT NULL,
    stop            INTEGER NOT NULL,
    duration_s      INTEGER NOT NULL DEFAULT 0,
    file_path       TEXT,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'completed', -- 'scheduled', 'recording', 'completed', 'failed'
    error           TEXT,
    expires_at      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_profile ON recordings(profile_id, start DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_channel ON recordings(channel_id, start);

CREATE TABLE IF NOT EXISTS recording_schedules (
    id              INTEGER PRIMARY KEY,
    profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id      TEXT NOT NULL,
    programme_title TEXT NOT NULL,
    match_mode      TEXT NOT NULL DEFAULT 'exact', -- 'exact', 'series'
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_schedules_profile ON recording_schedules(profile_id);

-- ------------------------------------------------------------- Downloads & Offline Library
CREATE TABLE IF NOT EXISTS downloads (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id          INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    programme_id        INTEGER,
    channel_id          TEXT NOT NULL,
    channel_name        TEXT,
    title               TEXT NOT NULL,
    description         TEXT,
    start               INTEGER NOT NULL,
    stop                INTEGER NOT NULL,
    duration_s          INTEGER NOT NULL DEFAULT 0,
    source_url          TEXT NOT NULL,
    file_path           TEXT,
    file_size_bytes     INTEGER NOT NULL DEFAULT 0,
    bytes_downloaded    INTEGER NOT NULL DEFAULT 0,
    progress            REAL NOT NULL DEFAULT 0.0,
    status              TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled'
    resumable           INTEGER NOT NULL DEFAULT 0,
    error               TEXT,
    playback_position_s REAL NOT NULL DEFAULT 0.0,
    created_at          INTEGER NOT NULL,
    completed_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_downloads_profile ON downloads(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

-- --------------------------------------------------------------- watchlists (Feature 40)
CREATE TABLE IF NOT EXISTS watchlists (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_type       TEXT NOT NULL CHECK(item_type IN ('channel', 'programme', 'vod')),
    item_id         TEXT NOT NULL,
    title           TEXT NOT NULL,
    metadata        TEXT DEFAULT '{}',
    created_at      INTEGER NOT NULL,
    UNIQUE(profile_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_profile ON watchlists(profile_id, created_at DESC);

-- --------------------------------------------------------------- recording rules (Features 4 & 5)
CREATE TABLE IF NOT EXISTS recording_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rule_type       TEXT NOT NULL CHECK(rule_type IN ('series', 'keyword')),
    query           TEXT NOT NULL,
    channel_id      TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_rules_profile ON recording_rules(profile_id);

-- --------------------------------------------------------------- watch parties (Feature 44)
CREATE TABLE IF NOT EXISTS watch_parties (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    host_profile_id INTEGER NOT NULL,
    channel_id      TEXT,
    stream_url      TEXT,
    playback_time   REAL DEFAULT 0,
    is_playing      INTEGER DEFAULT 1,
    last_updated_at INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_party_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id        TEXT NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
    user_name       TEXT NOT NULL,
    user_color      TEXT,
    message         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_party_messages ON watch_party_messages(party_id, created_at);

-- --------------------------------------------------------------- custom collections (Features 33 & 39)
CREATE TABLE IF NOT EXISTS custom_collections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    icon            TEXT,
    channel_ids     TEXT DEFAULT '[]',
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_profile ON custom_collections(profile_id);
"""


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(path or config.DB_PATH)
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    # isolation_level=None: autocommit, with explicit BEGIN/COMMIT in transaction().
    conn = sqlite3.connect(
        str(path), check_same_thread=False, timeout=30, isolation_level=None
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    # Safe column migrations for existing databases
    for col, col_type in [
        ("radio", "INTEGER DEFAULT 0"),
        ("channel_number", "INTEGER"),
        ("source_id", "INTEGER"),
        ("catchup_days", "INTEGER DEFAULT 14"),
        ("catchup_type", "TEXT DEFAULT 'append'"),
        ("catchup_source", "TEXT"),
    ]:
        try:
            conn.execute(f"ALTER TABLE channels ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    for col, col_type in [
        ("catchup", "TEXT"),
        ("catchup_days", "INTEGER DEFAULT 14"),
        ("catchup_source", "TEXT"),
    ]:
        try:
            conn.execute(f"ALTER TABLE streams ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass

    conn.commit()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        conn.execute("BEGIN")
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def jload(value: str | None, default: Any = None) -> Any:
    if value is None:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def jdump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
