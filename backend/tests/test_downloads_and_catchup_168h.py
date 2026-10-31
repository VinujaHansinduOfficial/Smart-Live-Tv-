"""Unit tests for 7-Day (168-Hour) Catch-Up, On-Demand Download Manager, Offline Playback,
Watchlists, and Watch Parties.
"""
from __future__ import annotations

import time
from fastapi.testclient import TestClient

from app import catchup


def test_format_expiry_indicators():
    assert catchup.format_expiry(0) == "Expired"
    assert catchup.format_expiry(-10) == "Expired"
    assert catchup.format_expiry(300) == "Expires in 5m"
    assert catchup.format_expiry(7200) == "Expires in 2h"
    assert catchup.format_expiry(7320) == "Expires in 2h 2m"
    assert catchup.format_expiry(172800) == "Expires in 2d"
    assert catchup.format_expiry(200000) == "Expires in 2d 7h"


def test_rolling_168h_catchup_schedule(client: TestClient, adult: dict[str, str]):
    # Get 7-day schedule
    res = client.get("/api/catchup/schedule/WorldNews.uk", headers=adult)
    assert res.status_code == 200
    data = res.json()
    assert len(data["days"]) == 7  # 7 days covering 168 hours
    assert "programmes" in data
    assert len(data["programmes"]) > 0

    prog = data["programmes"][0]
    assert "catchup_status" in prog
    assert "can_download" in prog
    assert "expiry_text" in prog


def test_download_manager_lifecycle(client: TestClient, adult: dict[str, str]):
    now = int(time.time())

    # 1. Queue a download for a past broadcast
    create_payload = {
        "channel_id": "WorldNews.uk",
        "title": "Evening News Special",
        "start": now - 7200,
        "stop": now - 3600,
        "description": "On-demand downloaded program test",
        "stream_url": "https://example.com/live/worldnews.m3u8",
    }
    res = client.post("/api/downloads", json=create_payload, headers=adult)
    assert res.status_code == 201
    data = res.json()
    assert "id" in data
    dl_id = data["id"]
    assert data["status"] in ("queued", "downloading", "completed")

    # 2. List downloads
    list_res = client.get("/api/downloads", headers=adult)
    assert list_res.status_code == 200
    items = list_res.json()
    assert any(i["id"] == dl_id for i in items)

    # 3. Update playback position (Continue Watching offline)
    prog_res = client.post(f"/api/downloads/{dl_id}/progress", json={"position_s": 145.5}, headers=adult)
    assert prog_res.status_code == 200
    assert prog_res.json()["playback_position_s"] == 145.5

    # 4. Storage info
    storage_res = client.get("/api/downloads/storage", headers=adult)
    assert storage_res.status_code == 200
    s_data = storage_res.json()
    assert "total_files" in s_data
    assert "max_storage_gb" in s_data
    assert s_data["catchup_window_hours"] == 168

    # 5. Update storage config
    up_res = client.post(
        "/api/downloads/storage",
        json={"max_storage_gb": 100, "auto_delete_enabled": True},
        headers=adult,
    )
    assert up_res.status_code == 200

    # 6. Delete download
    del_res = client.delete(f"/api/downloads/{dl_id}", headers=adult)
    assert del_res.status_code == 204


def test_universal_watchlist(client: TestClient, adult: dict[str, str]):
    # Check item not in watchlist
    check_res = client.get("/api/me/watchlist/check?item_type=channel&item_id=WorldNews.uk", headers=adult)
    assert check_res.status_code == 200
    assert check_res.json()["in_watchlist"] is False

    # Add channel to watchlist
    add_res = client.post(
        "/api/me/watchlist",
        json={
            "item_type": "channel",
            "item_id": "WorldNews.uk",
            "title": "World News UK",
            "metadata": {"country": "UK", "category": "news"},
        },
        headers=adult,
    )
    assert add_res.status_code == 201
    wl_item = add_res.json()
    wl_id = wl_item["id"]

    # Verify check is now True
    check_again = client.get("/api/me/watchlist/check?item_type=channel&item_id=WorldNews.uk", headers=adult)
    assert check_again.status_code == 200
    assert check_again.json()["in_watchlist"] is True
    assert check_again.json()["watchlist_id"] == wl_id

    # List watchlist
    list_res = client.get("/api/me/watchlist", headers=adult)
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    # Remove from watchlist
    del_res = client.delete(f"/api/me/watchlist/{wl_id}", headers=adult)
    assert del_res.status_code == 204


def test_virtual_watch_party(client: TestClient, adult: dict[str, str]):
    # Create watch party
    create_res = client.post(
        "/api/party/create",
        json={"name": "Premier Football Watch Party", "channel_id": "Sports1.uk"},
        headers=adult,
    )
    assert create_res.status_code == 201
    party_data = create_res.json()
    party_id = party_data["party_id"]

    # Get party room
    room_res = client.get(f"/api/party/{party_id}", headers=adult)
    assert room_res.status_code == 200
    assert room_res.json()["name"] == "Premier Football Watch Party"

    # Send message to room
    msg_res = client.post(f"/api/party/{party_id}/message", json={"message": "Hey everyone!"}, headers=adult)
    assert msg_res.status_code == 200
    assert msg_res.json()["sent"] is True

    # Sync playback state
    sync_res = client.post(f"/api/party/{party_id}/sync", json={"playback_time": 42.5, "is_playing": True}, headers=adult)
    assert sync_res.status_code == 200
    assert sync_res.json()["synced"] is True

