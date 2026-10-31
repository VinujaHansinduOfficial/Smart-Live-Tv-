"""Catalog sync, XMLTV parsing, and guide ingest."""
from __future__ import annotations

from app.epg import channels_xml
from app.epg.xmltv import iter_xmltv, parse_time

from .conftest import HALF, NOW


def test_parse_time_offsets():
    assert parse_time("20261031120000 +0000") == 1793448000
    assert parse_time("20261031173000 +0530") == 1793448000
    assert parse_time("20261031120000") == 1793448000            # no offset = UTC
    assert parse_time("20261031070000 -05:00") == 1793448000
    assert parse_time("garbage") is None


def test_episode_numbers_and_missing_stop():
    xml = (b'<tv><programme start="20261031120000 +0000" channel="x"><title>A</title>'
           b'<episode-num system="xmltv_ns">1.4.</episode-num></programme></tv>')
    (p,) = list(iter_xmltv(xml))
    assert p.episode == "S02E05"
    assert p.stop - p.start == 1800


def test_sync_filters_and_orders(loaded_db):
    conn, _ = loaded_db
    ids = {r[0] for r in conn.execute("SELECT id FROM channels")}
    assert ids == {"WorldNews.uk", "CartoonTime.us", "NatureDocs.fr", "LankaTV.lk"}  # blocked, NSFW, streamless out
    urls = [r[0] for r in conn.execute("SELECT url FROM streams WHERE channel_id='WorldNews.uk' ORDER BY id")]
    assert urls[0].startswith("https://b.example")                # non-geo-blocked https first
    logo = conn.execute("SELECT logo FROM channels WHERE id='WorldNews.uk'").fetchone()[0]
    assert logo.endswith("/wn.png")                               # non-white logo preferred


def test_ingest_maps_ids_and_names(loaded_db):
    conn, result = loaded_db
    assert result["unmapped_channels"] == 1                       # mystery.channel
    # 'cartoon-time-east' mapped through its display name "Cartoon Time HD".
    assert conn.execute("SELECT COUNT(*) FROM programmes WHERE channel_id='CartoonTime.us'").fetchone()[0] == 2
    # Old programme pruned.
    assert conn.execute("SELECT COUNT(*) FROM programmes WHERE title='Old Programme'").fetchone()[0] == 0
    # Guide follows the feed of the best stream (Intl), not the main feed.
    feed = conn.execute("SELECT feed_id FROM channel_guide_feed WHERE channel_id='WorldNews.uk'").fetchone()[0]
    assert feed == "Intl"


def test_channels_xml_prefers_language_match(loaded_db):
    conn, _ = loaded_db
    entries = channels_xml.select_entries(conn)
    by_ch = {e["channel_id"]: e for e in entries}
    assert by_ch["WorldNews.uk"]["site"] == "tvsite.example"      # 'en' guide beats 'ru'
    xml = channels_xml.render(entries)
    assert 'xmltv_id="WorldNews.uk@Intl"' in xml
    assert 'xmltv_id="CartoonTime.us@SD"' in xml
