"""Catalog sync from the iptv-org API.

Usage:
    python -m app.sync                 # download from iptv-org
    python -m app.sync --from-dir DIR  # use previously downloaded *.json files
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any

import httpx

from . import config, db

log = logging.getLogger("smart_iptv.sync")

FILES = [
    "channels", "feeds", "streams", "logos", "guides",
    "blocklist", "categories", "languages", "countries",
]


def download(name: str, client: httpx.Client) -> Any:
    errors = []
    for base in config.API_BASES:
        url = f"{base.rstrip('/')}/{name}.json"
        try:
            r = client.get(url, timeout=120)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as exc:  # try the next mirror
            errors.append(f"{url}: {exc}")
    raise RuntimeError(f"Could not download {name}.json:\n  " + "\n  ".join(errors))


def load_sources(from_dir: Path | None = None) -> dict[str, Any]:
    if from_dir:
        return {n: json.loads((from_dir / f"{n}.json").read_text("utf-8")) for n in FILES}
    with httpx.Client(follow_redirects=True) as client:
        return {n: download(n, client) for n in FILES}


def _logo_score(logo: dict) -> tuple:
    tags = logo.get("tags") or []
    return (
        1 if logo.get("in_use", True) else 0,
        1 if not logo.get("feed") else 0,           # channel-level logo first
        0 if "white" in tags else 1,                # white logos vanish on light cards
        1 if (logo.get("format") or "").upper() in ("PNG", "SVG", "WEBP") else 0,
        min(logo.get("width") or 0, 1024),
    )


QUALITY_ORDER = {"2160p": 6, "1440p": 5, "1080p": 4, "720p": 3, "576p": 2, "480p": 1}


def stream_rank(stream: dict) -> tuple:
    """Order streams so the most likely to work comes first."""
    labels = stream.get("labels") or []
    url = stream.get("url") or ""
    return (
        0 if "Geo-blocked" in labels else 1,
        0 if "Not 24/7" in labels else 1,
        1 if url.startswith("https://") else 0,     # works from HTTPS pages
        0 if (stream.get("referrer") or stream.get("user_agent")) else 1,
        QUALITY_ORDER.get(stream.get("quality") or "", 0),
    )


def build_catalog(src: dict[str, Any]) -> dict[str, list]:
    blocked = {b["channel"] for b in src["blocklist"]}
    streams_by_channel: dict[str, list[dict]] = {}
    for s in src["streams"]:
        ch = s.get("channel")
        if ch and ch not in blocked and s.get("url"):
            streams_by_channel.setdefault(ch, []).append(s)

    keep: dict[str, dict] = {}
    for c in src["channels"]:
        cid = c["id"]
        if cid in blocked or c.get("is_nsfw") or cid not in streams_by_channel:
            continue
        keep[cid] = c

    feed_langs: dict[str, set] = {}
    feeds = []
    for f in src["feeds"]:
        if f["channel"] in keep:
            feeds.append(f)
            feed_langs.setdefault(f["channel"], set()).update(f.get("languages") or [])

    logos: dict[str, dict] = {}
    for logo in src["logos"]:
        cid = logo.get("channel")
        if cid in keep and (cid not in logos or _logo_score(logo) > _logo_score(logos[cid])):
            logos[cid] = logo

    guide_sites = [g for g in src["guides"] if g.get("channel") in keep]
    guide_count: dict[str, int] = {}
    for g in guide_sites:
        guide_count[g["channel"]] = guide_count.get(g["channel"], 0) + 1

    channels = []
    for cid, c in keep.items():
        channels.append({
            **c,
            "languages": sorted(feed_langs.get(cid, ())),
            "logo": logos.get(cid, {}).get("url"),
            "stream_count": len(streams_by_channel[cid]),
            "guide_sites": guide_count.get(cid, 0),
        })

    streams = []
    for cid in keep:
        streams.extend(sorted(streams_by_channel[cid], key=stream_rank, reverse=True))

    return {
        "channels": channels, "feeds": feeds, "streams": streams,
        "guide_sites": guide_sites, "blocked": sorted(blocked),
        "categories": src["categories"], "languages": src["languages"],
        "countries": src["countries"],
    }


def write_catalog(conn: sqlite3.Connection, cat: dict[str, list]) -> dict[str, int]:
    J = db.jdump
    with db.transaction(conn):
        for t in ("streams", "feeds", "channel_categories", "channel_languages",
                  "guide_sites", "channels", "categories", "languages", "countries"):
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM channels_fts")

        conn.executemany(
            "INSERT INTO channels(id, name, alt_names, network, country, categories, languages,"
            " website, logo, stream_count, guide_sites) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [(c["id"], c["name"], J(c.get("alt_names") or []), c.get("network"), c.get("country"),
              J(c.get("categories") or []), J(c["languages"]), c.get("website"), c.get("logo"),
              c["stream_count"], c["guide_sites"]) for c in cat["channels"]],
        )
        conn.executemany(
            "INSERT OR IGNORE INTO channel_categories(channel_id, category) VALUES (?,?)",
            [(c["id"], k) for c in cat["channels"] for k in (c.get("categories") or [])],
        )
        conn.executemany(
            "INSERT OR IGNORE INTO channel_languages(channel_id, language) VALUES (?,?)",
            [(c["id"], lang) for c in cat["channels"] for lang in c["languages"]],
        )
        conn.executemany(
            "INSERT INTO channels_fts(id, name, alt_names, network) VALUES (?,?,?,?)",
            [(c["id"], c["name"], " ".join(c.get("alt_names") or []), c.get("network") or "")
             for c in cat["channels"]],
        )
        conn.executemany(
            "INSERT OR IGNORE INTO feeds(channel_id, id, name, is_main, languages, timezones, format)"
            " VALUES (?,?,?,?,?,?,?)",
            [(f["channel"], f["id"], f.get("name"), int(bool(f.get("is_main"))),
              J(f.get("languages") or []), J(f.get("timezones") or []), f.get("format"))
             for f in cat["feeds"]],
        )
        conn.executemany(
            "INSERT INTO streams(channel_id, feed_id, title, url, referrer, user_agent, quality, labels)"
            " VALUES (?,?,?,?,?,?,?,?)",
            [(s["channel"], s.get("feed"), s.get("title"), s["url"], s.get("referrer"),
              s.get("user_agent"), s.get("quality"), J(s.get("labels") or []))
             for s in cat["streams"]],
        )
        conn.executemany(
            "INSERT INTO guide_sites(channel_id, feed_id, site, site_id, site_name, lang)"
            " VALUES (?,?,?,?,?,?)",
            [(g["channel"], g.get("feed"), g["site"], g["site_id"], g.get("site_name"), g.get("lang"))
             for g in cat["guide_sites"]],
        )
        conn.executemany("INSERT INTO categories(id, name) VALUES (?,?)",
                         [(c["id"], c["name"]) for c in cat["categories"]])
        conn.executemany("INSERT OR IGNORE INTO languages(code, name) VALUES (?,?)",
                         [(lang["code"], lang["name"]) for lang in cat["languages"]])
        conn.executemany("INSERT OR IGNORE INTO countries(code, name, flag) VALUES (?,?,?)",
                         [(c["code"], c["name"], c.get("flag")) for c in cat["countries"]])
        db.set_meta(conn, "catalog_synced_at", str(int(time.time())))
        db.set_meta(conn, "blocked_channels", str(len(cat["blocked"])))

    return {
        "channels": len(cat["channels"]), "streams": len(cat["streams"]),
        "feeds": len(cat["feeds"]), "guide_sites": len(cat["guide_sites"]),
    }


def sync(conn: sqlite3.Connection, from_dir: Path | None = None) -> dict[str, int]:
    src = load_sources(from_dir)
    stats = write_catalog(conn, build_catalog(src))
    log.info("catalog synced: %s", stats)
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--from-dir", type=Path, help="directory with downloaded iptv-org *.json files")
    ap.add_argument("--db", type=Path, default=config.DB_PATH)
    args = ap.parse_args()
    conn = db.connect(args.db)
    db.init(conn)
    print(json.dumps(sync(conn, args.from_dir), indent=2))


if __name__ == "__main__":
    main()
