"""World TV Explorer Router for Smart IPTV.

Provides geographic discovery, country-level channel statistics,
regional groupings, and live broadcasts across the world.
"""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..deps import current_profile, get_conn
from ..services import attach_now_next, channel_dict, channel_select, restriction_sql

router = APIRouter(prefix="/api/world", tags=["world"])

# Geographic mapping for country codes to regions/continents
COUNTRY_REGIONS: dict[str, str] = {
    # Europe
    "UK": "Europe", "GB": "Europe", "FR": "Europe", "DE": "Europe", "IT": "Europe",
    "ES": "Europe", "PT": "Europe", "NL": "Europe", "BE": "Europe", "CH": "Europe",
    "AT": "Europe", "SE": "Europe", "NO": "Europe", "FI": "Europe", "DK": "Europe",
    "PL": "Europe", "CZ": "Europe", "GR": "Europe", "IE": "Europe", "RO": "Europe",
    "HU": "Europe", "BG": "Europe", "HR": "Europe", "SK": "Europe", "UA": "Europe",
    "RS": "Europe", "BA": "Europe", "SI": "Europe", "AL": "Europe", "IS": "Europe",
    "EE": "Europe", "LV": "Europe", "LT": "Europe", "LU": "Europe", "MT": "Europe",
    "CY": "Europe", "RU": "Europe",
    # Americas
    "US": "Americas", "CA": "Americas", "MX": "Americas", "BR": "Americas",
    "AR": "Americas", "CL": "Americas", "CO": "Americas", "PE": "Americas",
    "VE": "Americas", "EC": "Americas", "UY": "Americas", "PY": "Americas",
    "BO": "Americas", "CR": "Americas", "PA": "Americas", "CU": "Americas",
    "DO": "Americas", "JM": "Americas", "PR": "Americas", "GT": "Americas",
    # Asia
    "JP": "Asia", "CN": "Asia", "KR": "Asia", "IN": "Asia", "LK": "Asia",
    "PK": "Asia", "BD": "Asia", "TH": "Asia", "VN": "Asia", "ID": "Asia",
    "MY": "Asia", "PH": "Asia", "SG": "Asia", "TW": "Asia", "HK": "Asia",
    "NP": "Asia", "MM": "Asia", "KH": "Asia", "MN": "Asia", "KZ": "Asia",
    "UZ": "Asia", "AF": "Asia",
    # Middle East
    "AE": "Middle East", "SA": "Middle East", "QA": "Middle East", "IL": "Middle East",
    "TR": "Middle East", "IR": "Middle East", "IQ": "Middle East", "JO": "Middle East",
    "LB": "Middle East", "KW": "Middle East", "OM": "Middle East", "BH": "Middle East",
    "YE": "Middle East", "SY": "Middle East",
    # Africa
    "ZA": "Africa", "NG": "Africa", "EG": "Africa", "MA": "Africa", "KE": "Africa",
    "GH": "Africa", "TZ": "Africa", "UG": "Africa", "ET": "Africa", "DZ": "Africa",
    "TN": "Africa", "SN": "Africa", "CI": "Africa", "CM": "Africa", "ZW": "Africa",
    "AO": "Africa", "MZ": "Africa", "RW": "Africa",
    # Oceania
    "AU": "Oceania", "NZ": "Oceania", "FJ": "Oceania", "PG": "Oceania", "NC": "Oceania",
}


@router.get("/countries")
def list_world_countries(
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    cond, rparams = restriction_sql(profile)

    sql = f"""
        SELECT n.code, n.name, n.flag,
               COUNT(c.id) AS channels,
               COUNT(gf.channel_id) AS with_guide,
               SUM(c.stream_count) AS total_streams
        FROM countries n
        JOIN channels c ON c.country = n.code
        LEFT JOIN channel_guide_feed gf ON gf.channel_id = c.id
        WHERE {cond}
        GROUP BY n.code
        HAVING channels > 0
        ORDER BY channels DESC
    """
    rows = conn.execute(sql, rparams).fetchall()

    result = []
    for r in rows:
        code = r["code"]
        region = COUNTRY_REGIONS.get(code, "Other")
        result.append({
            "code": code,
            "name": r["name"],
            "flag": r["flag"],
            "channels": r["channels"],
            "with_guide": r["with_guide"],
            "total_streams": r["total_streams"] or 0,
            "region": region,
        })
    return result


@router.get("/country/{code}")
def get_country_detail(
    code: str,
    category: str | None = None,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    code = code.upper()
    now = int(time.time())
    cond, rparams = restriction_sql(profile)

    c_row = conn.execute("SELECT code, name, flag FROM countries WHERE code = ?", (code,)).fetchone()
    if not c_row:
        raise HTTPException(404, "Country not found")

    base, bparams = channel_select(profile["id"])
    where = [cond, "c.country = ?"]
    wparams = list(rparams) + [code]

    if category:
        where.append("EXISTS (SELECT 1 FROM channel_categories cc WHERE cc.channel_id = c.id AND cc.category = ?)")
        wparams.append(category.lower())

    order = "has_guide DESC, MIN(c.stream_count, 3) DESC, c.guide_sites DESC, c.name COLLATE NOCASE"
    sql = f"{base} WHERE {' AND '.join(where)} ORDER BY {order} LIMIT 60"
    rows = conn.execute(sql, [*bparams, *wparams]).fetchall()
    channels = attach_now_next(conn, [channel_dict(r) for r in rows], now)

    # Categories in this country
    cats = conn.execute(f"""
        SELECT k.id, k.name, COUNT(c.id) AS channels
        FROM categories k
        JOIN channel_categories cc ON cc.category = k.id
        JOIN channels c ON c.id = cc.channel_id
        WHERE {cond} AND c.country = ?
        GROUP BY k.id
        ORDER BY channels DESC
    """, [*rparams, code]).fetchall()

    # Live programmes on right now in this country
    live_sql = f"""
        SELECT p.*, c.name AS channel_name, c.logo AS channel_logo
        FROM programmes p
        JOIN channel_guide_feed gf ON gf.channel_id = p.channel_id AND p.feed_id IS gf.feed_id
        JOIN channels c ON c.id = p.channel_id
        WHERE {cond} AND c.country = ? AND p.start <= ? AND p.stop > ?
        ORDER BY p.start ASC
        LIMIT 10
    """
    live_rows = conn.execute(live_sql, [*rparams, code, now, now]).fetchall()
    live_programmes = []
    for lr in live_rows:
        live_programmes.append({
            "id": lr["id"],
            "channel_id": lr["channel_id"],
            "channel_name": lr["channel_name"],
            "channel_logo": lr["channel_logo"],
            "title": lr["title"],
            "start": lr["start"],
            "stop": lr["stop"],
            "categories": db.jload(lr["categories"], []),
        })

    return {
        "country": {
            "code": c_row["code"],
            "name": c_row["name"],
            "flag": c_row["flag"],
            "region": COUNTRY_REGIONS.get(code, "Other"),
        },
        "total_channels": len(channels),
        "categories": [dict(r) for r in cats],
        "live_now": live_programmes,
        "channels": channels,
    }

