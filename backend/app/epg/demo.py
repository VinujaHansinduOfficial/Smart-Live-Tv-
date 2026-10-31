"""Generated placeholder guide for development and UI testing.

Produces XMLTV with made-up programme names for a sample of channels so the
guide, search, and reminder features can be exercised without running the
grabber. Registered as the source ``demo://generated``; remove that source
once a real guide is loaded.
"""
from __future__ import annotations

import random
import sqlite3
import time
from datetime import datetime, timezone
from xml.sax.saxutils import escape, quoteattr

DEMO_LOCATION = "demo://generated"

TITLES = {
    "news": [("World News Update", 30), ("Business Today", 30), ("The Briefing", 60),
             ("Global Markets", 30), ("Weather Watch", 15), ("Headlines Tonight", 30),
             ("Inside Politics", 60), ("Tech Now", 30), ("Asia Business Report", 30)],
    "sports": [("Football Highlights", 60), ("Live: Cricket Coverage", 180), ("Tennis Weekly", 30),
               ("Motorsport Review", 60), ("Sports Desk", 30), ("Rugby Classics", 90)],
    "documentary": [("Wild Planet", 60), ("Science of the Deep", 60), ("Ancient Engineering", 60),
                    ("Space Frontiers", 60), ("Cities of Tomorrow", 30), ("Hidden Rivers", 60)],
    "kids": [("Cartoon Club", 30), ("Little Explorers", 30), ("Puzzle Pals", 15),
             ("Story Time", 15), ("Science Lab Jr.", 30)],
    "animation": [("Cartoon Club", 30), ("Robot Rangers", 30), ("Sky Pirates", 30)],
    "movies": [("Feature Film: The Long Road", 120), ("Classic Cinema", 120), ("Movie Night", 150)],
    "music": [("Top 20 Countdown", 60), ("Live Sessions", 60), ("Non-Stop Hits", 120)],
    "general": [("Morning Show", 120), ("Evening News", 30), ("Drama Hour", 60),
                ("Talk of the Town", 60), ("Cooking Together", 30), ("Late Night Live", 60)],
}
DESCRIPTIONS = {
    "news": "Latest headlines and analysis from around the world.",
    "sports": "Coverage, highlights and expert analysis.",
    "documentary": "An in-depth look at the natural and scientific world.",
    "kids": "Fun and learning for young viewers.",
    "animation": "Animated adventures for the whole family.",
    "movies": "A feature presentation.",
    "music": "The best music videos and live performances.",
    "general": "Entertainment for the whole family.",
}


def _fmt(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y%m%d%H%M%S +0000")


def generate(conn: sqlite3.Connection, per_category: int = 25, hours_back: int = 6,
             hours_ahead: int = 30, now: int | None = None, seed: int = 7) -> bytes:
    now = now or int(time.time())
    rng = random.Random(seed)
    chosen: list[tuple[str, str]] = []
    seen: set[str] = set()
    for cat in TITLES:
        rows = conn.execute(
            "SELECT c.id FROM channels c JOIN channel_categories cc ON cc.channel_id = c.id"
            " WHERE cc.category = ? AND c.guide_sites > 0 ORDER BY c.stream_count DESC, c.id LIMIT ?",
            (cat, per_category),
        ).fetchall()
        for r in rows:
            if r["id"] not in seen:
                seen.add(r["id"])
                chosen.append((r["id"], cat))

    start0 = (now - hours_back * 3600) // 900 * 900
    end = now + hours_ahead * 3600
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="smart-iptv demo">']
    for cid, _ in chosen:
        out.append(f"  <channel id={quoteattr(cid)}><display-name>{escape(cid)}</display-name></channel>")
    for cid, cat in chosen:
        t = start0 - rng.randrange(0, 4) * 900
        while t < end:
            title, minutes = rng.choice(TITLES[cat])
            stop = t + minutes * 60
            out.append(
                f"  <programme start={quoteattr(_fmt(t))} stop={quoteattr(_fmt(stop))} channel={quoteattr(cid)}>"
                f"<title lang=\"en\">{escape(title)}</title>"
                f"<desc lang=\"en\">{escape(DESCRIPTIONS[cat])} (Demo listing)</desc>"
                f"<category lang=\"en\">{escape(cat.title())}</category></programme>"
            )
            t = stop
    out.append("</tv>")
    return "\n".join(out).encode("utf-8")
