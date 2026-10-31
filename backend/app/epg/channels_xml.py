"""Generate a custom channels.xml for the iptv-org/epg grabber.

The grabber (https://github.com/iptv-org/epg) downloads schedules from TV
listing sites. It takes a channels file such as:

    <channel site="tvpassport.com" lang="en" xmltv_id="ABC.us@East" site_id="abc--eastern/1224">ABC - Eastern</channel>

and writes guide.xml with matching xmltv ids, which ingest.py maps straight
back onto catalog channels and feeds.
"""
from __future__ import annotations

import sqlite3
from xml.sax.saxutils import escape, quoteattr

from .. import db

# ISO 639-3 (catalog) -> ISO 639-1 (guides.json) for common languages.
ISO3_TO_1 = {
    "eng": "en", "fra": "fr", "spa": "es", "deu": "de", "ara": "ar", "rus": "ru", "por": "pt",
    "ita": "it", "hin": "hi", "tam": "ta", "sin": "si", "zho": "zh", "jpn": "ja", "kor": "ko",
    "tur": "tr", "nld": "nl", "pol": "pl", "ukr": "uk", "ell": "el", "swe": "sv", "nor": "no",
    "dan": "da", "fin": "fi", "ces": "cs", "ron": "ro", "hun": "hu", "heb": "he", "fas": "fa",
    "urd": "ur", "ben": "bn", "tel": "te", "mal": "ml", "kan": "kn", "mar": "mr", "tha": "th",
    "vie": "vi", "ind": "id", "msa": "ms", "fil": "tl", "hrv": "hr", "srp": "sr", "bul": "bg",
}


def select_entries(conn: sqlite3.Connection, channel_ids: list[str] | None = None,
                   country: str | None = None, category: str | None = None,
                   limit: int = 500) -> list[dict]:
    """Pick one guide site per channel.

    Preference: guide language matches the channel, guide feed matches the
    channel's best stream, main feed, then the site with the widest coverage
    (bigger sites tend to be maintained).
    """
    where, params = ["1=1"], []
    if channel_ids:
        where.append(f"g.channel_id IN ({','.join('?' * len(channel_ids))})")
        params += channel_ids
    if country:
        where.append("c.country = ?")
        params.append(country.upper())
    if category:
        where.append("EXISTS (SELECT 1 FROM channel_categories cc WHERE cc.channel_id = c.id AND cc.category = ?)")
        params.append(category)
    rows = conn.execute(f"""
        WITH best_stream AS (
            SELECT channel_id, feed_id FROM streams s
            WHERE s.id = (SELECT MIN(id) FROM streams s2 WHERE s2.channel_id = s.channel_id)
        ),
        site_size AS (SELECT site, COUNT(*) AS n FROM guide_sites GROUP BY site)
        SELECT g.*, c.name AS channel_name, c.languages AS channel_languages,
               (g.feed_id IS bs.feed_id) AS stream_feed, COALESCE(f.is_main, 0) AS is_main,
               ss.n AS site_size
        FROM guide_sites g
        JOIN channels c ON c.id = g.channel_id
        LEFT JOIN best_stream bs ON bs.channel_id = g.channel_id
        LEFT JOIN feeds f ON f.channel_id = g.channel_id AND f.id = g.feed_id
        JOIN site_size ss ON ss.site = g.site
        WHERE {' AND '.join(where)}
    """, params).fetchall()

    best: dict[str, tuple[tuple, dict]] = {}
    for r in rows:
        langs = {ISO3_TO_1.get(code, code) for code in db.jload(r["channel_languages"], [])}
        score = (1 if r["lang"] in langs else 0, r["stream_feed"], r["is_main"], r["site_size"])
        if r["channel_id"] not in best or score > best[r["channel_id"]][0]:
            best[r["channel_id"]] = (score, dict(r))
    entries = [e for _, e in best.values()]
    entries.sort(key=lambda e: (e["site"], e["channel_id"]))
    return entries[:limit]


def render(entries: list[dict]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<channels>"]
    for e in entries:
        xmltv_id = f"{e['channel_id']}@{e['feed_id']}" if e["feed_id"] else e["channel_id"]
        lines.append(
            f"  <channel site={quoteattr(e['site'])} lang={quoteattr(e['lang'] or 'en')}"
            f" xmltv_id={quoteattr(xmltv_id)} site_id={quoteattr(e['site_id'])}>"
            f"{escape(e['site_name'] or e['channel_name'])}</channel>"
        )
    lines.append("</channels>")
    return "\n".join(lines) + "\n"
