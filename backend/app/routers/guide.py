"""TV guide: grid, per-channel schedule, and programme search."""
from __future__ import annotations

import sqlite3
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db
from ..deps import current_profile, get_conn
from ..services import (channel_dict, channel_select, fts_query, programme_dict, restriction_sql)

router = APIRouter(prefix="/api", tags=["guide"])

GUIDE_JOIN = ("JOIN channel_guide_feed g ON g.channel_id = p.channel_id AND p.feed_id IS g.feed_id")


@router.get("/guide/grid")
def guide_grid(
    start: int | None = None,
    hours: int = Query(4, ge=1, le=24),
    country: str | None = None,
    category: str | None = None,
    favorites: bool = False,
    q: str | None = None,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Channels that have guide data, each with programmes overlapping the window."""
    now = int(time.time())
    start = start if start is not None else now // 1800 * 1800
    end = start + hours * 3600
    base, params = channel_select(profile["id"])
    cond, rparams = restriction_sql(profile)
    where, wparams = ["gf.channel_id IS NOT NULL", cond], list(rparams)
    match = fts_query(q) if q else None
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
    if favorites:
        where.append("EXISTS (SELECT 1 FROM favorites fv2 WHERE fv2.profile_id = ? AND fv2.channel_id = c.id)")
        wparams.append(profile["id"])
    pref_countries = db.jload(profile["preferred_countries"], [])
    order, oparams = ["is_favorite DESC"], []
    if pref_countries:
        order.append(f"(c.country IN ({','.join('?' * len(pref_countries))})) DESC")
        oparams += pref_countries
    order += ["c.name COLLATE NOCASE"]

    sql_where = " WHERE " + " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM ({base}{sql_where})", [*params, *wparams]).fetchone()[0]
    rows = conn.execute(f"{base}{sql_where} ORDER BY {', '.join(order)} LIMIT ? OFFSET ?",
                        [*params, *wparams, *oparams, limit, offset]).fetchall()
    channels = [channel_dict(r) for r in rows]
    by_id = {c["id"]: c for c in channels}
    for c in channels:
        c["programmes"] = []
    if channels:
        ids = list(by_id)
        progs = conn.execute(f"""
            SELECT p.* FROM programmes p {GUIDE_JOIN}
            WHERE p.channel_id IN ({','.join('?' * len(ids))}) AND p.stop > ? AND p.start < ?
            ORDER BY p.channel_id, p.start
        """, [*ids, start, end]).fetchall()
        for p in progs:
            by_id[p["channel_id"]]["programmes"].append(programme_dict(p))
    return {"start": start, "end": end, "now": now, "total": total, "channels": channels}


@router.get("/guide/channel/{channel_id}")
def channel_schedule(
    channel_id: str,
    start: int | None = None,
    hours: int = Query(24, ge=1, le=72),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    now = int(time.time())
    start = start if start is not None else now - 3600
    cond, rparams = restriction_sql(profile)
    if not conn.execute(f"SELECT 1 FROM channels c WHERE c.id = ? AND {cond}", [channel_id, *rparams]).fetchone():
        raise HTTPException(404, "Channel not found or not available for this profile")
    progs = conn.execute(f"""
        SELECT p.* FROM programmes p {GUIDE_JOIN}
        WHERE p.channel_id = ? AND p.stop > ? AND p.start < ? ORDER BY p.start
    """, (channel_id, start, start + hours * 3600)).fetchall()
    return {"channel_id": channel_id, "now": now, "programmes": [programme_dict(p) for p in progs]}


@router.get("/programmes/search")
def search_programmes(
    q: str | None = None,
    when: Literal["now", "upcoming", "any"] = "any",
    hours: int = Query(24, ge=1, le=168),
    category: str | None = None,
    country: str | None = None,
    language: str | None = None,
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Find shows by title/description, across every channel the profile may watch.

    when=now       airing right now
    when=upcoming  starting within `hours`
    when=any       airing now or starting within `hours`
    """
    now = int(time.time())
    horizon = now + hours * 3600
    cond, rparams = restriction_sql(profile)
    joins = [GUIDE_JOIN, "JOIN channels c ON c.id = p.channel_id"]
    where, params = [cond], list(rparams)
    match = fts_query(q) if q else None
    if q and not match:
        return {"items": [], "total": 0, "now": now}
    if match:
        joins.insert(0, "JOIN programmes_fts ft ON ft.rowid = p.id")
        where.append("programmes_fts MATCH ?")
        params.append(match)
    if when == "now":
        where.append("p.start <= ? AND p.stop > ?")
        params += [now, now]
    elif when == "upcoming":
        where.append("p.start > ? AND p.start < ?")
        params += [now, horizon]
    else:
        where.append("p.stop > ? AND p.start < ?")
        params += [now, horizon]
    if category:
        # Match either the channel's category or the programme's own XMLTV category.
        where.append("(EXISTS (SELECT 1 FROM channel_categories x WHERE x.channel_id = c.id AND x.category = ?)"
                     " OR lower(p.categories) LIKE ?)")
        params += [category, f'%"{category.lower()}%']
    if country:
        where.append("c.country = ?")
        params.append(country.upper())
    if language:
        where.append("EXISTS (SELECT 1 FROM channel_languages x WHERE x.channel_id = c.id AND x.language = ?)")
        params.append(language)

    sql_from = f"FROM programmes p {' '.join(joins)} WHERE {' AND '.join(where)}"
    total = conn.execute(f"SELECT COUNT(*) {sql_from}", params).fetchone()[0]
    rank = ["bm25(programmes_fts, 10.0, 4.0, 1.0, 2.0)"] if match else []
    if when == "upcoming":
        order = ", ".join(["p.start", *rank])
    else:
        order = ", ".join([f"(p.start <= {now}) DESC", *rank, "p.start"])
    rows = conn.execute(
        f"SELECT p.*, c.name AS channel_name, c.logo AS channel_logo, c.country AS channel_country "
        f"{sql_from} ORDER BY {order} LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    items = []
    for r in rows:
        item = programme_dict(r)
        item["channel"] = {"id": r["channel_id"], "name": r["channel_name"],
                           "logo": r["channel_logo"], "country": r["channel_country"]}
        item["airing"] = r["start"] <= now < r["stop"]
        items.append(item)
    return {"items": items, "total": total, "now": now}


@router.get("/programmes/{programme_id}")
def programme_detail(programme_id: int, profile: sqlite3.Row = Depends(current_profile),
                     conn: sqlite3.Connection = Depends(get_conn)):
    cond, rparams = restriction_sql(profile)
    row = conn.execute(
        f"SELECT p.* FROM programmes p JOIN channels c ON c.id = p.channel_id WHERE p.id = ? AND {cond}",
        [programme_id, *rparams],
    ).fetchone()
    if not row:
        raise HTTPException(404, "Programme not found")
    base, params = channel_select(profile["id"])
    ch = conn.execute(f"{base} WHERE c.id = ?", [*params, row["channel_id"]]).fetchone()
    return {**programme_dict(row), "channel": channel_dict(ch)}
