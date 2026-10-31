"""7-Day (168-Hour) Catch-Up TV Engine and Replay Resolver.

Implements a rolling 168-hour (7x24-hour) catch-up window with direct provider archive
streaming, on-demand downloading of permitted programs, and offline library playback.

Availability states:
1. 'downloaded': Stored locally in offline library, playable without internet
2. 'provider_archive': Streamed directly via provider timeshift/archive URL (no continuous recording needed)
3. 'local_dvr': Streamed from local DVR recorded segments
4. 'unavailable': In 168-hour window but provider has no archive
5. 'outside_window': Broadcast occurred >168 hours (7 days) ago
"""
from __future__ import annotations

import datetime
import re
import sqlite3
import time
from typing import Any

from . import config, db
from .services import programme_dict

WINDOW_SECONDS = config.CATCHUP_RETENTION_DAYS * 86400  # 7 days in seconds = 168 hours


def format_expiry(remaining_s: int) -> str:
    """Formats seconds until replay window expiration into a human-readable indicator."""
    if remaining_s <= 0:
        return "Expired"
    hours = remaining_s // 3600
    days = hours // 24
    if days >= 2:
        rem_hours = hours % 24
        return f"Expires in {days}d" if rem_hours == 0 else f"Expires in {days}d {rem_hours}h"
    elif hours >= 1:
        mins = (remaining_s % 3600) // 60
        return f"Expires in {hours}h" if mins == 0 else f"Expires in {hours}h {mins}m"
    else:
        mins = max(1, remaining_s // 60)
        return f"Expires in {mins}m"


def build_catchup_url(
    stream_url: str,
    start_ts: int,
    stop_ts: int,
    catchup_type: str = "append",
    catchup_source: str | None = None,
) -> str:
    """Builds a catchup playback URL substituting timestamp placeholders or appending query parameters."""
    duration_s = max(60, stop_ts - start_ts)
    duration_min = duration_s // 60
    now_ts = int(time.time())
    offset_s = max(0, now_ts - start_ts)

    dt = datetime.datetime.fromtimestamp(start_ts, tz=datetime.timezone.utc)
    ymd_hm = dt.strftime("%Y-%m-%d:%H-%M")
    iso = dt.strftime("%Y%m%dT%H%M%SZ")

    if catchup_source:
        # Template substitution
        url = catchup_source
        replacements = {
            "${start}": str(start_ts),
            "{start}": str(start_ts),
            "${timestamp}": str(start_ts),
            "{timestamp}": str(start_ts),
            "${end}": str(stop_ts),
            "{end}": str(stop_ts),
            "${duration}": str(duration_s),
            "{duration}": str(duration_s),
            "${duration_min}": str(duration_min),
            "{duration_min}": str(duration_min),
            "${offset}": str(offset_s),
            "{offset}": str(offset_s),
            "${lutc}": str(now_ts),
            "{lutc}": str(now_ts),
            "${utc}": str(start_ts),
            "{utc}": str(start_ts),
            "${iso}": iso,
            "{iso}": iso,
            "${ymd_hm}": ymd_hm,
            "{ymd_hm}": ymd_hm,
        }
        for k, v in replacements.items():
            url = url.replace(k, v)
        if url.startswith("http://") or url.startswith("https://"):
            return url
        # If catchup_source is relative path or query string, join with base
        if url.startswith("?"):
            sep = "&" if "?" in stream_url else "?"
            return f"{stream_url}{url}"
        base = stream_url.rsplit("/", 1)[0]
        return f"{base}/{url}"

    ctype = (catchup_type or "append").lower()
    sep = "&" if "?" in stream_url else "?"

    if ctype in ("shift", "flv"):
        return f"{stream_url}{sep}timeshift={start_ts}&duration={duration_s}"
    elif ctype == "default" or ctype == "append":
        # Standard append format used widely across IPTV
        return f"{stream_url}{sep}utc={start_ts}&lutc={now_ts}"
    elif ctype == "xc" or "timeshift.php" in stream_url:
        # Xtream Codes format
        return f"{stream_url}{sep}start={ymd_hm}&duration={duration_min}"

    return f"{stream_url}{sep}utc={start_ts}&lutc={now_ts}"


def resolve_catchup_state(
    conn: sqlite3.Connection,
    channel_id: str,
    start_ts: int,
    stop_ts: int,
    now: int | None = None,
) -> dict[str, Any]:
    """Resolves one of the four replay availability states for a broadcast slot."""
    now = now or int(time.time())

    # Check if broadcast is live right now or upcoming
    if start_ts <= now < stop_ts:
        return {"status": "live", "label": "On Now", "playback_url": None, "source_type": "live"}
    if start_ts > now:
        return {"status": "upcoming", "label": "Upcoming", "playback_url": None, "source_type": "future"}

    # Check if outside 168-hour (7-day) window
    age_s = now - start_ts
    if age_s > WINDOW_SECONDS:
        return {
            "status": "outside_window",
            "label": "Outside 7-Day (168h) Archive",
            "playback_url": None,
            "source_type": None,
            "can_download": False,
            "expiry_s": 0,
            "expiry_text": "Expired",
        }

    # 1. Check completed download first (Offline Library)
    try:
        dl = conn.execute(
            """
            SELECT id, file_path, status, file_size_bytes FROM downloads
            WHERE channel_id = ? AND start <= ? AND stop >= ? AND status = 'completed'
            ORDER BY id DESC LIMIT 1
            """,
            (channel_id, start_ts + 300, stop_ts - 300),
        ).fetchone()

        if dl:
            return {
                "status": "downloaded",
                "label": "Downloaded (Offline Playback)",
                "playback_url": f"/api/downloads/{dl['id']}/stream",
                "source_type": "download",
                "download_id": dl["id"],
                "can_download": False,
                "expiry_s": WINDOW_SECONDS,
                "expiry_text": "Saved locally",
            }
    except sqlite3.OperationalError:
        pass

    # 2. Check local DVR recording if any exists
    rec = conn.execute(
        """
        SELECT id, file_path, status, duration_s FROM recordings
        WHERE channel_id = ? AND start <= ? AND stop >= ? AND status = 'completed'
        ORDER BY duration_s DESC LIMIT 1
        """,
        (channel_id, start_ts + 300, stop_ts - 300),
    ).fetchone()

    if rec:
        return {
            "status": "local_dvr",
            "label": "Playable from Local DVR",
            "playback_url": f"/api/recordings/{rec['id']}/stream",
            "source_type": "dvr",
            "recording_id": rec["id"],
            "can_download": True,
            "expiry_s": WINDOW_SECONDS,
            "expiry_text": "Saved to DVR",
        }

    # 3. Check provider archive support on channel or streams
    ch = conn.execute("SELECT * FROM channels WHERE id = ?", (channel_id,)).fetchone()
    st = conn.execute("SELECT * FROM streams WHERE channel_id = ? ORDER BY id ASC LIMIT 1", (channel_id,)).fetchone()

    if st:
        st_url = st["url"]
        catchup_days = config.CATCHUP_RETENTION_DAYS
        catchup_type = "append"
        catchup_source = None

        if "catchup_days" in st.keys() and st["catchup_days"]:
            catchup_days = st["catchup_days"]
        elif ch and "catchup_days" in ch.keys() and ch["catchup_days"]:
            catchup_days = ch["catchup_days"]

        if "catchup" in st.keys() and st["catchup"]:
            catchup_type = st["catchup"]
        elif ch and "catchup_type" in ch.keys() and ch["catchup_type"]:
            catchup_type = ch["catchup_type"]

        if "catchup_source" in st.keys() and st["catchup_source"]:
            catchup_source = st["catchup_source"]
        elif ch and "catchup_source" in ch.keys() and ch["catchup_source"]:
            catchup_source = ch["catchup_source"]

        # If age in days is within provider catchup days, generate archive URL
        age_days = age_s / 86400.0
        if age_days <= catchup_days:
            replay_url = build_catchup_url(st_url, start_ts, stop_ts, catchup_type, catchup_source)
            upstream_window_s = catchup_days * 86400
            expiry_s = max(0, int((start_ts + upstream_window_s) - now))
            return {
                "status": "provider_archive",
                "label": "Playable from Provider Archive",
                "playback_url": replay_url,
                "source_type": "provider",
                "catchup_type": catchup_type,
                "can_download": True,
                "expiry_s": expiry_s,
                "expiry_text": format_expiry(expiry_s),
            }

    # 4. Not in DVR and not in provider archive
    return {
        "status": "unavailable",
        "label": "Archive Unavailable",
        "playback_url": None,
        "source_type": None,
        "can_download": False,
        "expiry_s": 0,
        "expiry_text": "Unavailable",
    }


def get_rolling_days(days_count: int | None = None, now: int | None = None) -> list[dict[str, Any]]:
    """Returns calendar days covering the rolling catch-up replay window (default: 7 days = 168 hours)."""
    now = now or int(time.time())
    count = days_count or config.CATCHUP_RETENTION_DAYS
    today_dt = datetime.datetime.fromtimestamp(now, tz=datetime.timezone.utc).date()

    days = []
    for offset in range(count):  # 0 to count - 1 (7 days total = 168 hours)
        d = today_dt - datetime.timedelta(days=offset)
        d_str = d.isoformat()
        start_ts = int(datetime.datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        end_ts = start_ts + 86400

        if offset == 0:
            label = "Today"
        elif offset == 1:
            label = "Yesterday"
        else:
            label = d.strftime("%d %b")  # e.g. "29 Oct"

        day_name = d.strftime("%A")

        days.append({
            "date": d_str,
            "label": label,
            "day_name": day_name,
            "start": start_ts,
            "end": end_ts,
            "is_today": offset == 0,
            "days_ago": offset,
        })
    return days


def get_rolling_14_days(now: int | None = None) -> list[dict[str, Any]]:
    return get_rolling_days(config.CATCHUP_RETENTION_DAYS, now)

