"""Unit tests for 14-Day Catch-Up, VOD (Movies & Series), DVR Recordings, and IPTV Sources."""
from __future__ import annotations

import time
from fastapi.testclient import TestClient


def test_catchup_days(client: TestClient):
    res = client.get("/api/catchup/days")
    assert res.status_code == 200
    days = res.json()
    assert len(days) >= 7
    assert days[0]["label"] == "Today"
    assert days[1]["label"] == "Yesterday"


def test_catchup_schedule(client: TestClient, adult: dict[str, str]):
    # Get schedule for a channel
    res = client.get("/api/catchup/schedule/WorldNews.uk", headers=adult)
    assert res.status_code == 200
    data = res.json()
    assert "channel" in data
    assert "days" in data
    assert "programmes" in data
    assert len(data["programmes"]) > 0
    prog = data["programmes"][0]
    assert "catchup_status" in prog


def test_vod_movies_and_series(client: TestClient, adult: dict[str, str]):
    # Featured VOD
    feat_res = client.get("/api/vod/featured", headers=adult)
    assert feat_res.status_code == 200
    feat = feat_res.json()
    assert "movies" in feat
    assert "series" in feat
    assert len(feat["movies"]) > 0

    # List movies
    mov_res = client.get("/api/vod/movies", headers=adult)
    assert mov_res.status_code == 200
    movs = mov_res.json()["items"]
    assert len(movs) > 0

    # Detail of a movie
    m_id = movs[0]["id"]
    det_res = client.get(f"/api/vod/item/{m_id}", headers=adult)
    assert det_res.status_code == 200
    assert det_res.json()["id"] == m_id

    # List series
    ser_res = client.get("/api/vod/series", headers=adult)
    assert ser_res.status_code == 200
    sers = ser_res.json()["items"]
    assert len(sers) > 0

    # Detail of a series (seasons and episodes)
    s_id = sers[0]["id"]
    s_det = client.get(f"/api/vod/item/{s_id}", headers=adult)
    assert s_det.status_code == 200
    assert "seasons" in s_det.json()


def test_vod_progress(client: TestClient, adult: dict[str, str]):
    # Save watch progress
    prog_res = client.post(
        "/api/vod/progress",
        json={"item_id": "movie-tears-of-steel", "watched_s": 320, "total_s": 720, "completed": False},
        headers=adult,
    )
    assert prog_res.status_code == 204

    # Fetch continue watching
    cont_res = client.get("/api/vod/continue", headers=adult)
    assert cont_res.status_code == 200
    cont = cont_res.json()
    assert any(c["item_id"] == "movie-tears-of-steel" for c in cont)


def test_recordings_and_storage(client: TestClient, adult: dict[str, str]):
    # 1. Instant record
    rec_res = client.post(
        "/api/recordings/record",
        json={"channel_id": "WorldNews.uk", "duration_min": 30, "title": "Test World News"},
        headers=adult,
    )
    assert rec_res.status_code == 201
    rec_id = rec_res.json()["id"]

    # 2. List recordings
    list_res = client.get("/api/recordings", headers=adult)
    assert list_res.status_code == 200
    assert any(r["id"] == rec_id for r in list_res.json())

    # 3. Storage stats
    stor_res = client.get("/api/recordings/storage", headers=adult)
    assert stor_res.status_code == 200
    assert stor_res.json()["recordings_count"] >= 1

    # 4. Delete recording
    del_res = client.delete(f"/api/recordings/{rec_id}", headers=adult)
    assert del_res.status_code == 204


def test_sources_m3u(client: TestClient, adult: dict[str, str]):
    sample_m3u = """#EXTM3U
#EXTINF:-1 tvg-id="TestCh.1" tvg-name="Test One" tvg-logo="http://logo.png" group-title="TestGroup" catchup="append" catchup-days="14",Test One HD
https://stream.example/live.m3u8
"""
    res = client.post(
        "/api/sources",
        json={
            "name": "Custom Test M3U",
            "type": "m3u",
            "url": sample_m3u,
            "catchup_days": 14,
            "catchup_type": "append",
        },
        headers=adult,
    )
    assert res.status_code == 201
    s_id = res.json()["id"]
    assert res.json()["channel_count"] >= 1

    # List sources
    sources_res = client.get("/api/sources", headers=adult)
    assert sources_res.status_code == 200
    assert any(s["id"] == s_id for s in sources_res.json())

    # Delete source
    del_res = client.delete(f"/api/sources/{s_id}", headers=adult)
    assert del_res.status_code == 204

