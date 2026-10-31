"""Unit tests for Phase 4 & Phase 5 features:
AI discovery, voice intent parsing, personalized recommendations,
world explorer, multiview presets, device pairing & remote commands, backup/restore.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_ai_status(client: TestClient):
    res = client.get("/api/ai/status")
    assert res.status_code == 200
    data = res.json()
    assert "gemini_enabled" in data
    assert "models" in data


def test_voice_command_controls(client: TestClient, adult: dict[str, str]):
    # Navigation command
    res = client.post("/api/ai/voice", json={"text": "show tv guide"}, headers=adult)
    assert res.status_code == 200
    data = res.json()
    assert data["action"] == "navigate"
    assert data["route"] == "/guide"

    # Playback command
    res = client.post("/api/ai/voice", json={"text": "mute"}, headers=adult)
    assert res.status_code == 200
    assert res.json()["action"] == "mute"

    # Channel switch command
    res = client.post("/api/ai/voice", json={"text": "next channel"}, headers=adult)
    assert res.status_code == 200
    assert res.json()["action"] == "next_channel"


def test_ai_discovery(client: TestClient, adult: dict[str, str]):
    res = client.post("/api/ai/discover", json={"prompt": "science documentaries"}, headers=adult)
    assert res.status_code == 200
    data = res.json()
    assert "reply" in data
    assert "channels" in data
    assert "programmes" in data
    assert isinstance(data["channels"], list)


def test_recommendations(client: TestClient, adult: dict[str, str]):
    res = client.get("/api/me/recommendations", headers=adult)
    assert res.status_code == 200
    data = res.json()
    assert "recommended" in data
    assert "live_now" in data
    assert "popular_in_country" in data
    assert isinstance(data["recommended"], list)


def test_world_countries(client: TestClient, adult: dict[str, str]):
    res = client.get("/api/world/countries", headers=adult)
    assert res.status_code == 200
    countries = res.json()
    assert isinstance(countries, list)
    if countries:
        c = countries[0]
        assert "code" in c
        assert "name" in c
        assert "region" in c
        assert "channels" in c

        # Detail endpoint
        det = client.get(f"/api/world/country/{c['code']}", headers=adult)
        assert det.status_code == 200
        det_data = det.json()
        assert det_data["country"]["code"] == c["code"]
        assert "channels" in det_data
        assert "categories" in det_data


def test_multiview_presets(client: TestClient, adult: dict[str, str]):
    # Create preset
    create_res = client.post(
        "/api/me/multiview",
        json={"name": "Test News Wall", "layout": "quad", "channel_ids": ["WorldNews.uk", "CartoonTime.us"]},
        headers=adult,
    )
    assert create_res.status_code == 201
    preset = create_res.json()
    assert preset["name"] == "Test News Wall"
    preset_id = preset["id"]

    # List presets
    list_res = client.get("/api/me/multiview", headers=adult)
    assert list_res.status_code == 200
    items = list_res.json()
    assert any(p["id"] == preset_id for p in items)

    # Delete preset
    del_res = client.delete(f"/api/me/multiview/{preset_id}", headers=adult)
    assert del_res.status_code == 204


def test_device_pairing_and_remote_commands(client: TestClient, adult: dict[str, str]):
    # 1. TV generates pairing code
    code_res = client.post("/api/sync/code?name=Test%20TV", headers=adult)
    assert code_res.status_code == 200
    code_data = code_res.json()
    pair_code = code_data["code"]
    assert pair_code.startswith("TV-")

    # 2. Companion device pairs with code
    pair_res = client.post("/api/sync/pair", json={"code": pair_code, "device_name": "Mobile Tester"})
    assert pair_res.status_code == 200
    assert pair_res.json()["paired"] is True
    assert pair_res.json()["token"] is not None

    # 3. Companion device sends a remote command
    cmd_res = client.post(
        "/api/sync/command",
        json={"code": pair_code, "command": "tune_channel", "payload": {"channel_id": "WorldNews.uk"}},
    )
    assert cmd_res.status_code == 200
    cmd_id = cmd_res.json()["command_id"]

    # 4. TV polls for commands
    poll_res = client.get(f"/api/sync/poll?code={pair_code}&since=0")
    assert poll_res.status_code == 200
    cmds = poll_res.json()
    assert len(cmds) >= 1
    assert any(c["id"] == cmd_id and c["command"] == "tune_channel" for c in cmds)


def test_backup_and_restore(client: TestClient, adult: dict[str, str]):
    # Export backup
    b_res = client.get("/api/sync/backup", headers=adult)
    assert b_res.status_code == 200
    backup = b_res.json()
    assert backup["version"] == 1
    assert "profiles" in backup
    assert "favorites" in backup

    # Restore backup
    r_res = client.post("/api/sync/restore", json=backup, headers=adult)
    assert r_res.status_code == 200
    assert r_res.json()["restored"] is True
