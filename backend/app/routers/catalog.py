"""Channel catalog, metadata, and channel details."""
from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db
from ..deps import current_profile, get_conn
from ..services import (attach_now_next, channel_dict, channel_select, fts_query, restriction_sql,
                        stream_dict)

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/meta")
def meta(profile: sqlite3.Row = Depends(current_profile), conn: sqlite3.Connection = Depends(get_conn)):
    cond, params = restriction_sql(profile)
    categories = conn.execute(f"""
        SELECT k.id, k.name, COUNT(c.id) AS channels FROM categories k
        JOIN channel_categories cc ON cc.category = k.id
        JOIN channels c ON c.id = cc.channel_id
        WHERE {cond} GROUP BY k.id ORDER BY channels DESC
    """, params).fetchall()
    countries = conn.execute(f"""
        SELECT n.code, n.name, n.flag, COUNT(c.id) AS channels FROM countries n
        JOIN channels c ON c.country = n.code WHERE {cond}
        GROUP BY n.code ORDER BY n.name
    """, params).fetchall()
    languages = conn.execute(f"""
        SELECT l.code, l.name, COUNT(c.id) AS channels FROM languages l
        JOIN channel_languages cl ON cl.language = l.code
        JOIN channels c ON c.id = cl.channel_id
        WHERE {cond} GROUP BY l.code HAVING channels >= 3 ORDER BY channels DESC
    """, params).fetchall()
    epg = conn.execute("""
        SELECT COUNT(*) AS sources,
               (SELECT COUNT(*) FROM programmes) AS programmes,
               (SELECT COUNT(*) FROM channel_guide_feed) AS channels
        FROM epg_sources WHERE enabled = 1
    """).fetchone()
    return {
        "categories": [dict(r) for r in categories],
        "countries": [dict(r) for r in countries],
        "languages": [dict(r) for r in languages],
        "stats": {
            "channels": conn.execute("SELECT COUNT(*) FROM channels").fetchone()[0],
            "catalog_synced_at": int(db.get_meta(conn, "catalog_synced_at") or 0) or None,
        },
        "epg": {**dict(epg), "indexed_at": int(db.get_meta(conn, "epg_indexed_at") or 0) or None},
        "now": int(time.time()),
    }


@router.get("/channels")
def list_channels(
    q: str | None = None,
    country: str | None = None,
    category: str | None = None,
    language: str | None = None,
    has_guide: bool = False,
    favorites: bool = False,
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    now = int(time.time())
    base, params = channel_select(profile["id"])
    cond, rparams = restriction_sql(profile)
    where, wparams = [cond], list(rparams)
    order = []
    match = fts_query(q) if q else None
    if q and not match:
        return {"items": [], "total": 0}
    if match:
        base += " JOIN channels_fts f ON f.id = c.id"
        where.append("channels_fts MATCH ?")
        wparams.append(match)
    if country:
        where.append("c.country = ?")
        wparams.append(country.upper())
    if category:
        where.append("EXISTS (SELECT 1 FROM channel_categories x WHERE x.channel_id = c.id AND x.category = ?)")
        wparams.append(category)
    if language:
        where.append("EXISTS (SELECT 1 FROM channel_languages x WHERE x.channel_id = c.id AND x.language = ?)")
        wparams.append(language)
    if has_guide:
        where.append("gf.channel_id IS NOT NULL")
    if favorites:
        where.append("EXISTS (SELECT 1 FROM favorites fv2 WHERE fv2.profile_id = ? AND fv2.channel_id = c.id)")
        wparams.append(profile["id"])

    # Ranking: favourites, the profile's countries and languages, then relevance.
    pref_countries = db.jload(profile["preferred_countries"], [])
    pref_langs = db.jload(profile["preferred_languages"], [])
    order.append("is_favorite DESC")
    oparams: list = []
    if match:
        order.append("(lower(c.name) = lower(?)) DESC")
        oparams.append(q.strip())
    if pref_countries:
        order.append(f"(c.country IN ({','.join('?' * len(pref_countries))})) DESC")
        oparams += pref_countries
    if pref_langs:
        order.append(
            f"EXISTS (SELECT 1 FROM channel_languages pl WHERE pl.channel_id = c.id"
            f" AND pl.language IN ({','.join('?' * len(pref_langs))})) DESC")
        oparams += pref_langs
    if match:
        order.append("bm25(channels_fts, 0, 10.0, 4.0, 1.0)")
    # Channels with guide data first; then a capped source count (some channels list
    # 100+ regional streams, which says nothing about popularity) and guide-site
    # coverage, a better proxy for widely carried channels.
    order += ["has_guide DESC", "MIN(c.stream_count, 3) DESC", "c.guide_sites DESC", "c.name COLLATE NOCASE"]

    sql_where = " WHERE " + " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM ({base}{sql_where})", [*params, *wparams]).fetchone()[0]
    rows = conn.execute(
        f"{base}{sql_where} ORDER BY {', '.join(order)} LIMIT ? OFFSET ?",
        [*params, *wparams, *oparams, limit, offset],
    ).fetchall()
    items = attach_now_next(conn, [channel_dict(r) for r in rows], now)
    return {"items": items, "total": total}


@router.get("/channels/{channel_id}")
def channel_detail(channel_id: str, profile: sqlite3.Row = Depends(current_profile),
                   conn: sqlite3.Connection = Depends(get_conn)):
    base, params = channel_select(profile["id"])
    cond, rparams = restriction_sql(profile)
    row = conn.execute(f"{base} WHERE c.id = ? AND {cond}", [*params, channel_id, *rparams]).fetchone()
    if not row:
        raise HTTPException(404, "Channel not found or not available for this profile")
    ch = attach_now_next(conn, [channel_dict(row)], int(time.time()))[0]
    full = conn.execute("SELECT website, alt_names FROM channels WHERE id = ?", (channel_id,)).fetchone()
    ch["website"] = full["website"]
    ch["alt_names"] = db.jload(full["alt_names"], [])
    ch["streams"] = [stream_dict(s) for s in conn.execute(
        "SELECT * FROM streams WHERE channel_id = ? ORDER BY id", (channel_id,))]
    return ch
