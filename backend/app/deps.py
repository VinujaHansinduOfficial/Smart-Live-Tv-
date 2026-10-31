"""Request dependencies: DB connection and profile sessions."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import time
from typing import Iterator

from fastapi import Depends, Header, HTTPException

from . import config, db
from .epg import ingest

_initialized: set[str] = set()


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = db.connect(config.DB_PATH)
    key = str(config.DB_PATH)
    if key not in _initialized:
        db.init(conn)
        ingest.ensure_guide_feed_table(conn)
        _initialized.add(key)
    try:
        yield conn
    finally:
        conn.close()


# ----------------------------------------------------------------------- PINs

def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"{salt}${digest}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    test = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()
    return hmac.compare_digest(test, digest)


# Simple per-profile lockout against PIN guessing.
_failures: dict[int, tuple[int, float]] = {}
MAX_FAILURES = 5
LOCKOUT_S = 60


def check_lockout(profile_id: int) -> None:
    count, until = _failures.get(profile_id, (0, 0.0))
    if count >= MAX_FAILURES and time.time() < until:
        raise HTTPException(429, f"Too many wrong PINs. Try again in {int(until - time.time()) + 1}s.")


def record_failure(profile_id: int) -> None:
    count, _ = _failures.get(profile_id, (0, 0.0))
    count = count + 1 if count < MAX_FAILURES else 1
    _failures[profile_id] = (count, time.time() + LOCKOUT_S)


def clear_failures(profile_id: int) -> None:
    _failures.pop(profile_id, None)


# ------------------------------------------------------------------- sessions

def create_session(conn: sqlite3.Connection, profile_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO profile_sessions(token, profile_id, created_at) VALUES (?,?,?)",
                 (token, profile_id, int(time.time())))
    return token


def current_profile(
    x_profile_token: str | None = Header(default=None),
    conn: sqlite3.Connection = Depends(get_conn),
) -> sqlite3.Row:
    if not x_profile_token:
        raise HTTPException(401, "Choose a profile first.")
    row = conn.execute(
        "SELECT p.* FROM profile_sessions s JOIN profiles p ON p.id = s.profile_id WHERE s.token = ?",
        (x_profile_token,),
    ).fetchone()
    if not row:
        raise HTTPException(401, "Profile session expired. Choose a profile again.")
    return row


def adult_profile(profile: sqlite3.Row = Depends(current_profile)) -> sqlite3.Row:
    if profile["is_kids"]:
        raise HTTPException(403, "A grown-up profile is needed for this.")
    return profile
