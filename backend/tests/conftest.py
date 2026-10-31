from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

NOW = int(time.time())
HALF = NOW // 1800 * 1800  # current half-hour boundary


def fixture_sources() -> dict:
    return {
        "channels": [
            {"id": "WorldNews.uk", "name": "World News", "alt_names": ["WN 24"], "network": None, "country": "UK",
             "categories": ["news"], "is_nsfw": False, "website": "https://wn.example"},
            {"id": "CartoonTime.us", "name": "Cartoon Time", "alt_names": [], "network": None, "country": "US",
             "categories": ["kids", "animation"], "is_nsfw": False},
            {"id": "NatureDocs.fr", "name": "Nature Docs", "alt_names": ["Docs Nature"], "network": None,
             "country": "FR", "categories": ["documentary"], "is_nsfw": False},
            {"id": "Blocked.us", "name": "Blocked Channel", "alt_names": [], "country": "US",
             "categories": ["movies"], "is_nsfw": False},
            {"id": "Adult.us", "name": "Adult", "alt_names": [], "country": "US", "categories": ["xxx"], "is_nsfw": True},
            {"id": "NoStream.lk", "name": "No Stream", "alt_names": [], "country": "LK", "categories": ["general"],
             "is_nsfw": False},
            {"id": "LankaTV.lk", "name": "Lanka TV", "alt_names": [], "country": "LK", "categories": ["general"],
             "is_nsfw": False},
        ],
        "feeds": [
            {"channel": "WorldNews.uk", "id": "Intl", "name": "International", "is_main": False,
             "languages": ["eng"], "timezones": [], "format": "1080i"},
            {"channel": "WorldNews.uk", "id": "UK", "name": "UK", "is_main": True,
             "languages": ["eng"], "timezones": [], "format": "1080i"},
            {"channel": "CartoonTime.us", "id": "SD", "name": "SD", "is_main": True, "languages": ["eng"]},
            {"channel": "NatureDocs.fr", "id": "SD", "name": "SD", "is_main": True, "languages": ["fra", "eng"]},
            {"channel": "LankaTV.lk", "id": "SD", "name": "SD", "is_main": True, "languages": ["sin"]},
        ],
        "streams": [
            {"channel": "WorldNews.uk", "feed": "UK", "url": "http://a.example/wn.m3u8", "quality": "1080p",
             "labels": ["Geo-blocked"]},
            {"channel": "WorldNews.uk", "feed": "Intl", "url": "https://b.example/wn.m3u8", "quality": "720p",
             "labels": []},
            {"channel": "CartoonTime.us", "feed": "SD", "url": "https://c.example/ct.m3u8", "labels": []},
            {"channel": "NatureDocs.fr", "feed": "SD", "url": "https://d.example/nd.m3u8", "labels": [],
             "referrer": "https://nd.example/"},
            {"channel": "Blocked.us", "feed": None, "url": "https://e.example/b.m3u8", "labels": []},
            {"channel": "Adult.us", "feed": None, "url": "https://f.example/a.m3u8", "labels": []},
            {"channel": "LankaTV.lk", "feed": "SD", "url": "https://g.example/l.m3u8", "labels": []},
            {"channel": None, "feed": None, "url": "https://h.example/unknown.m3u8", "labels": []},
        ],
        "logos": [
            {"channel": "WorldNews.uk", "feed": None, "in_use": True, "tags": ["white"], "width": 512,
             "format": "PNG", "url": "https://logo.example/wn-white.png"},
            {"channel": "WorldNews.uk", "feed": None, "in_use": True, "tags": [], "width": 512,
             "format": "PNG", "url": "https://logo.example/wn.png"},
        ],
        "guides": [
            {"channel": "WorldNews.uk", "feed": "Intl", "site": "tvsite.example", "site_id": "wn-intl",
             "site_name": "World News Intl", "lang": "en", "sources": []},
            {"channel": "WorldNews.uk", "feed": "UK", "site": "ruguide.example", "site_id": "wn",
             "site_name": "World News", "lang": "ru", "sources": []},
            {"channel": "CartoonTime.us", "feed": "SD", "site": "tvsite.example", "site_id": "ct",
             "site_name": "Cartoon Time", "lang": "en", "sources": []},
        ],
        "blocklist": [{"channel": "Blocked.us", "reason": "dmca", "ref": "x"}],
        "categories": [{"id": k, "name": k.title()} for k in
                       ["news", "kids", "animation", "documentary", "movies", "general", "xxx"]],
        "languages": [{"code": "eng", "name": "English"}, {"code": "fra", "name": "French"},
                      {"code": "sin", "name": "Sinhala"}],
        "countries": [{"code": "UK", "name": "United Kingdom", "flag": "🇬🇧"},
                      {"code": "US", "name": "United States", "flag": "🇺🇸"},
                      {"code": "FR", "name": "France", "flag": "🇫🇷"},
                      {"code": "LK", "name": "Sri Lanka", "flag": "🇱🇰"}],
    }


def ts(t: int) -> str:
    return time.strftime("%Y%m%d%H%M%S +0000", time.gmtime(t))


def fixture_xmltv() -> bytes:
    def prog(ch, start, stop, title, desc="", cat="", extra=""):
        return (f'<programme start="{ts(start)}" stop="{ts(stop)}" channel="{ch}">'
                f'<title lang="en">{title}</title><desc lang="en">{desc}</desc>'
                + (f'<category lang="en">{cat}</category>' if cat else "") + extra + "</programme>")
    h = HALF
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?><tv>',
        '<channel id="WorldNews.uk@Intl"><display-name>World News Intl</display-name></channel>',
        '<channel id="WorldNews.uk@UK"><display-name>World News UK</display-name></channel>',
        '<channel id="cartoon-time-east"><display-name>Cartoon Time HD</display-name></channel>',
        '<channel id="NatureDocs.fr"><display-name>Nature Docs</display-name></channel>',
        '<channel id="mystery.channel"><display-name>Mystery Channel</display-name></channel>',
        # Intl feed (best stream) and UK feed differ: guide must follow the Intl feed.
        prog("WorldNews.uk@Intl", h, h + 1800, "Global Headlines", "Top stories worldwide", "News"),
        prog("WorldNews.uk@Intl", h + 1800, h + 3600, "Business Report", "Markets and money", "News"),
        prog("WorldNews.uk@Intl", h + 3600, h + 7200, "Science Hour", "Space telescope special", "Science"),
        prog("WorldNews.uk@UK", h, h + 3600, "Regional Bulletin", "Local news"),
        prog("cartoon-time-east", h, h + 1800, "Robot Rangers", "Robots save the day", "Kids",
             '<episode-num system="xmltv_ns">1.4.</episode-num>'),
        prog("cartoon-time-east", h + 1800, h + 3600, "Space Pups", "Puppies in orbit", "Kids"),
        prog("NatureDocs.fr", h + 7200, h + 10800, "Ocean Giants", "Whales and the deep sea", "Documentary"),
        prog("mystery.channel", h, h + 3600, "Unmapped Show"),
        prog("NatureDocs.fr", h - (15 * 86400), h - (15 * 86400 - 3600), "Old Programme"),  # pruned (too old, > 14 days)
        "</tv>",
    ]
    return "\n".join(parts).encode()


@pytest.fixture()
def loaded_db(tmp_path: Path, monkeypatch):
    from app import config, db, sync
    from app.epg import ingest
    from app.routers import admin
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(admin, "EPG_DIR", tmp_path / "epg")
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    for name, data in fixture_sources().items():
        (src_dir / f"{name}.json").write_text(json.dumps(data), "utf-8")
    conn = db.connect(config.DB_PATH)
    db.init(conn)
    ingest.ensure_guide_feed_table(conn)
    sync.sync(conn, src_dir)
    (tmp_path / "epg").mkdir()
    guide = tmp_path / "epg" / "guide.xml"
    guide.write_bytes(fixture_xmltv())
    sid = ingest.add_source(conn, str(guide), "fixture")
    result = ingest.refresh_source(conn, sid, now=NOW)
    ingest.rebuild_indexes(conn, now=NOW)
    yield conn, result
    conn.close()


@pytest.fixture()
def client(loaded_db):
    from app import deps
    from app.main import app
    deps._failures.clear()   # PIN lockouts are in-memory; don't leak between tests
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def adult(client):
    r = client.post("/api/profiles", json={"name": "Parent", "pin": "1234", "preferred_countries": ["LK"]})
    assert r.status_code == 201, r.text
    s = client.post(f"/api/profiles/{r.json()['id']}/session", json={"pin": "1234"})
    assert s.status_code == 200
    return {"X-Profile-Token": s.json()["token"]}


@pytest.fixture()
def kid(client, adult):
    r = client.post("/api/profiles", json={"name": "Kid", "is_kids": True}, headers=adult)
    assert r.status_code == 201, r.text
    s = client.post(f"/api/profiles/{r.json()['id']}/session", json={})
    return {"X-Profile-Token": s.json()["token"]}
