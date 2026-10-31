"""Personalized Recommendations Router for Smart IPTV.

Computes multi-dimensional recommendations based on watch history,
favorites, preferred genres/countries/languages, and currently airing programmes.
"""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends

from .. import db
from ..deps import current_profile, get_conn
from ..services import attach_now_next, channel_dict, channel_select, restriction_sql

router = APIRouter(prefix="/api/me/recommendations", tags=["recommendations"])


@router.get("")
def get_recommendations(
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    now = int(time.time())
    cond, rparams = restriction_sql(profile)
    base, bparams = channel_select(profile["id"])

    pref_countries = db.jload(profile["preferred_countries"], [])
    pref_langs = db.jload(profile["preferred_languages"], [])

    # 1. Analyze watch history to find user's top categories and last watched channel
    history_rows = conn.execute(
        """
        SELECT h.channel_id, h.duration_s, c.name, c.country, c.categories
        FROM watch_history h
        JOIN channels c ON c.id = h.channel_id
        WHERE h.profile_id = ?
        ORDER BY h.last_seen_at DESC
        LIMIT 30
        """,
        (profile["id"],),
    ).fetchall()

    cat_counts: dict[str, int] = {}
    last_channel: dict[str, Any] | None = None
    for idx, row in enumerate(history_rows):
        if idx == 0:
            last_channel = {
                "id": row["channel_id"],
                "name": row["name"],
                "country": row["country"],
                "categories": db.jload(row["categories"], []),
            }
        cats = db.jload(row["categories"], [])
        weight = max(1, row["duration_s"] // 60)
        for cat in cats:
            cat_counts[cat] = cat_counts.get(cat, 0) + weight

    # If no watch history, look at favorites
    if not cat_counts:
        fav_rows = conn.execute(
            """
            SELECT c.categories, c.country FROM favorites f
            JOIN channels c ON c.id = f.channel_id
            WHERE f.profile_id = ?
            """,
            (profile["id"],),
        ).fetchall()
        for row in fav_rows:
            for cat in db.jload(row["categories"], []):
                cat_counts[cat] = cat_counts.get(cat, 0) + 5
            if not pref_countries and row["country"]:
                pref_countries.append(row["country"])

    top_cats = [c for c, _ in sorted(cat_counts.items(), key=lambda x: x[1], reverse=True)[:3]]

    # 2. Section: Recommended for You
    rec_where = [cond]
    rec_params = list(rparams)
    rec_order = ["has_guide DESC"]

    if top_cats:
        rec_order.append(f"(EXISTS (SELECT 1 FROM channel_categories cc WHERE cc.channel_id = c.id AND cc.category IN ({','.join('?' * len(top_cats))}))) DESC")
        rec_params += top_cats

    if pref_countries:
        rec_order.append(f"(c.country IN ({','.join('?' * len(pref_countries))})) DESC")
        rec_params += pref_countries

    if pref_langs:
        rec_order.append(f"(EXISTS (SELECT 1 FROM channel_languages cl WHERE cl.channel_id = c.id AND cl.language IN ({','.join('?' * len(pref_langs))}))) DESC")
        rec_params += pref_langs

    rec_order += ["MIN(c.stream_count, 3) DESC", "c.guide_sites DESC", "c.name COLLATE NOCASE"]

    rec_sql = f"{base} WHERE {' AND '.join(rec_where)} ORDER BY {', '.join(rec_order)} LIMIT 16"
    recommended_rows = conn.execute(rec_sql, [*bparams, *rec_params]).fetchall()
    recommended = attach_now_next(conn, [channel_dict(r) for r in recommended_rows], now)

    # 3. Section: Because You Watched [Last Channel]
    because_you_watched: dict[str, Any] | None = None
    if last_channel and last_channel.get("categories"):
        lc_cats = last_channel["categories"]
        byw_where = [cond, "c.id != ?"]
        byw_params = list(rparams) + [last_channel["id"]]
        byw_where.append(f"EXISTS (SELECT 1 FROM channel_categories cc WHERE cc.channel_id = c.id AND cc.category IN ({','.join('?' * len(lc_cats))}))")
        byw_params += lc_cats

        byw_order = ["has_guide DESC"]
        if last_channel.get("country"):
            byw_order.append(f"(c.country = ?) DESC")
            byw_params.append(last_channel["country"])
        byw_order += ["c.guide_sites DESC", "c.stream_count DESC", "c.name COLLATE NOCASE"]

        byw_sql = f"{base} WHERE {' AND '.join(byw_where)} ORDER BY {', '.join(byw_order)} LIMIT 10"
        byw_rows = conn.execute(byw_sql, [*bparams, *byw_params]).fetchall()
        if byw_rows:
            because_you_watched = {
                "channel": last_channel,
                "items": attach_now_next(conn, [channel_dict(r) for r in byw_rows], now),
            }

    # 4. Section: Live Now in Your Genres (channels currently running a programme)
    live_genres_items: list[dict[str, Any]] = []
    live_cats = top_cats or ["news", "sports", "documentary", "movies", "kids"]
    live_where = [
        cond,
        "gf.channel_id IS NOT NULL",
        "EXISTS (SELECT 1 FROM programmes p WHERE p.channel_id = c.id AND p.feed_id IS gf.feed_id AND p.start <= ? AND p.stop > ?)",
    ]
    live_params = list(rparams) + [now, now]

    if live_cats:
        live_where.append(f"EXISTS (SELECT 1 FROM channel_categories cc WHERE cc.channel_id = c.id AND cc.category IN ({','.join('?' * len(live_cats))}))")
        live_params += live_cats

    live_order = ["c.guide_sites DESC", "c.stream_count DESC", "c.name COLLATE NOCASE"]
    live_sql = f"{base} WHERE {' AND '.join(live_where)} ORDER BY {', '.join(live_order)} LIMIT 12"
    live_rows = conn.execute(live_sql, [*bparams, *live_params]).fetchall()
    live_genres_items = attach_now_next(conn, [channel_dict(r) for r in live_rows], now)

    # 5. Section: Popular in Country (or global top)
    focus_country = pref_countries[0] if pref_countries else (last_channel.get("country") if last_channel else "US")
    pop_where = [cond]
    pop_params = list(rparams)
    if focus_country:
        pop_where.append("c.country = ?")
        pop_params.append(focus_country)

    pop_order = ["has_guide DESC", "c.guide_sites DESC", "c.stream_count DESC", "c.name COLLATE NOCASE"]
    pop_sql = f"{base} WHERE {' AND '.join(pop_where)} ORDER BY {', '.join(pop_order)} LIMIT 12"
    pop_rows = conn.execute(pop_sql, [*bparams, *pop_params]).fetchall()
    popular_in_country = {
        "country": focus_country,
        "items": attach_now_next(conn, [channel_dict(r) for r in pop_rows], now),
    }

    return {
        "recommended": recommended,
        "because_you_watched": because_you_watched,
        "live_now": live_genres_items,
        "popular_in_country": popular_in_country,
        "top_categories": top_cats,
    }

