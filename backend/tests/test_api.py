"""API behaviour: profiles, parental controls, guide, search, history, reminders."""
from __future__ import annotations

from .conftest import HALF, NOW


# ------------------------------------------------------------------ profiles

def test_first_profile_then_auth_required(client):
    assert client.post("/api/profiles", json={"name": "Kid", "is_kids": True}).status_code == 400
    assert client.post("/api/profiles", json={"name": "A"}).status_code == 201
    # Second profile without a session is refused.
    assert client.post("/api/profiles", json={"name": "B"}).status_code == 401
    assert client.get("/api/channels").status_code == 401


def test_pin_and_lockout(client, adult):
    pid = client.get("/api/profiles").json()[0]["id"]
    assert client.post(f"/api/profiles/{pid}/session", json={"pin": "0000"}).status_code == 403
    for _ in range(4):
        client.post(f"/api/profiles/{pid}/session", json={"pin": "0000"})
    # Locked even with the right PIN.
    assert client.post(f"/api/profiles/{pid}/session", json={"pin": "1234"}).status_code == 429


def test_kids_profile_restrictions(client, kid):
    items = client.get("/api/channels", headers=kid).json()["items"]
    assert [c["id"] for c in items] == ["CartoonTime.us"]
    assert client.get("/api/channels/WorldNews.uk", headers=kid).status_code == 404
    assert client.put("/api/me/favorites/WorldNews.uk", headers=kid).status_code == 404
    found = client.get("/api/programmes/search", params={"q": "global"}, headers=kid).json()
    assert found["total"] == 0
    # Kids can't loosen their own restrictions or manage sources.
    me = client.get("/api/me", headers=kid).json()
    r = client.patch(f"/api/profiles/{me['id']}", json={"clear_allowed_categories": True}, headers=kid)
    assert r.status_code == 403
    assert client.get("/api/admin/epg/sources", headers=kid).status_code == 403


def test_parent_can_adjust_kid(client, adult, kid):
    kid_id = client.get("/api/me", headers=kid).json()["id"]
    r = client.patch(f"/api/profiles/{kid_id}", json={"allowed_categories": ["kids", "documentary"]}, headers=adult)
    assert r.status_code == 200
    ids = {c["id"] for c in client.get("/api/channels", headers=kid).json()["items"]}
    assert ids == {"CartoonTime.us", "NatureDocs.fr"}


# ---------------------------------------------------------------- catalog

def test_channel_search_and_ranking(client, adult):
    r = client.get("/api/channels", params={"q": "wn"}, headers=adult).json()      # alt name prefix
    assert [c["id"] for c in r["items"]] == ["WorldNews.uk"]
    r = client.get("/api/channels", params={"q": 'nat"ure'}, headers=adult)        # quotes are safe
    assert r.status_code == 200
    first = client.get("/api/channels", headers=adult).json()["items"][0]
    assert first["id"] == "LankaTV.lk"                                             # preferred country first


def test_now_next(client, adult):
    ch = client.get("/api/channels/WorldNews.uk", headers=adult).json()
    assert ch["now"]["title"] == "Global Headlines"                                # Intl feed, not Regional
    assert ch["next"]["title"] == "Business Report"
    assert ch["streams"][0]["url"].startswith("https://b.example")
    nd = client.get("/api/channels/NatureDocs.fr", headers=adult).json()
    assert nd["now"] is None and nd["next"]["title"] == "Ocean Giants"


# ------------------------------------------------------------------- guide

def test_guide_grid(client, adult):
    g = client.get("/api/guide/grid", params={"start": HALF, "hours": 2}, headers=adult).json()
    ids = [c["id"] for c in g["channels"]]
    assert "LankaTV.lk" not in ids                                # no guide data
    wn = next(c for c in g["channels"] if c["id"] == "WorldNews.uk")
    assert [p["title"] for p in wn["programmes"]] == ["Global Headlines", "Business Report", "Science Hour"]


def test_programme_search(client, adult):
    r = client.get("/api/programmes/search", params={"q": "space"}, headers=adult).json()
    titles = [i["title"] for i in r["items"]]
    # "Space Pups" matches by title, "Science Hour" by description ("Space telescope special").
    assert set(titles) == {"Space Pups", "Science Hour"}
    now = client.get("/api/programmes/search", params={"when": "now", "category": "news"}, headers=adult).json()
    assert [i["title"] for i in now["items"]] == ["Global Headlines"]
    up = client.get("/api/programmes/search", params={"q": "whale", "when": "upcoming"}, headers=adult).json()
    assert up["items"][0]["title"] == "Ocean Giants" and up["items"][0]["airing"] is False


# ------------------------------------------------- favorites/history/reminders

def test_favorites(client, adult):
    assert client.put("/api/me/favorites/NatureDocs.fr", headers=adult).status_code == 204
    favs = client.get("/api/me/favorites", headers=adult).json()
    assert [f["id"] for f in favs] == ["NatureDocs.fr"]
    first = client.get("/api/channels", headers=adult).json()["items"][0]
    assert first["id"] == "NatureDocs.fr" and first["is_favorite"]
    client.delete("/api/me/favorites/NatureDocs.fr", headers=adult)
    assert client.get("/api/me/favorites", headers=adult).json() == []


def test_history_and_continue(client, adult):
    a = client.post("/api/me/history", json={"channel_id": "WorldNews.uk"}, headers=adult).json()
    b = client.post("/api/me/history", json={"channel_id": "WorldNews.uk"}, headers=adult).json()
    assert b["id"] == a["id"] and b["resumed"]                     # re-open within 5 min resumes
    client.post("/api/me/history", json={"channel_id": "CartoonTime.us"}, headers=adult)
    hist = client.get("/api/me/history", headers=adult).json()
    titles = {h["channel_id"]: h["programme_title"] for h in hist}
    assert titles == {"WorldNews.uk": "Global Headlines", "CartoonTime.us": "Robot Rangers"}
    cont = client.get("/api/me/continue", headers=adult).json()
    assert [c["id"] for c in cont] == ["CartoonTime.us", "WorldNews.uk"]
    assert cont[0]["now"]["title"] == "Robot Rangers"
    assert client.get("/api/me", headers=adult).json()["last_channel_id"] == "CartoonTime.us"
    assert client.post(f"/api/me/history/{a['id']}/heartbeat", json={}, headers=adult).status_code == 204
    other = client.post(f"/api/me/history/{a['id'] + 999}/heartbeat", json={}, headers=adult)
    assert other.status_code == 404


def test_reminders(client, adult):
    up = client.get("/api/programmes/search", params={"q": "ocean"}, headers=adult).json()["items"][0]
    r = client.post("/api/me/reminders", json={"programme_id": up["id"], "notify_before_min": 5}, headers=adult)
    assert r.status_code == 201 and r.json()["status"] == "upcoming"
    assert len(client.get("/api/me/reminders", headers=adult).json()) == 1
    assert client.get("/api/me/reminders/due", headers=adult).json() == []          # starts in ~2h
    # Airing programmes can't get reminders.
    now_p = client.get("/api/programmes/search", params={"q": "global"}, headers=adult).json()["items"][0]
    assert client.post("/api/me/reminders", json={"programme_id": now_p["id"]}, headers=adult).status_code == 400
    # A 120-minute lead time makes it due now (programme starts within 2-2.5h).
    client.post("/api/me/reminders", json={"programme_id": up["id"], "notify_before_min": 120}, headers=adult)
    if up["start"] - 7200 <= NOW:
        due = client.get("/api/me/reminders/due", headers=adult).json()
        assert [d["title"] for d in due] == ["Ocean Giants"]
        client.post(f"/api/me/reminders/{due[0]['id']}/dismiss", headers=adult)
        assert client.get("/api/me/reminders/due", headers=adult).json() == []


def test_admin_channels_xml_and_source_paths(client, adult):
    r = client.get("/api/admin/epg/channels-xml", params={"country": "US"}, headers=adult)
    assert r.status_code == 200 and "CartoonTime.us@SD" in r.text
    bad = client.post("/api/admin/epg/sources", json={"location": "/etc/passwd"}, headers=adult)
    assert bad.status_code == 400
