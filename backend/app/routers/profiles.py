"""Profiles, sessions and parental controls."""
from __future__ import annotations

import re
import sqlite3
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from .. import config, db
from ..deps import (adult_profile, check_lockout, clear_failures, create_session, current_profile,
                    get_conn, hash_pin, record_failure, verify_pin)

router = APIRouter(prefix="/api", tags=["profiles"])

_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def public_profile(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "color": row["color"],
        "is_kids": bool(row["is_kids"]), "has_pin": row["pin_hash"] is not None,
    }


def full_profile(row: sqlite3.Row) -> dict:
    return {
        **public_profile(row),
        "allowed_categories": db.jload(row["allowed_categories"], None),
        "blocked_categories": db.jload(row["blocked_categories"], []),
        "preferred_countries": db.jload(row["preferred_countries"], []),
        "preferred_languages": db.jload(row["preferred_languages"], []),
        "last_channel_id": row["last_channel_id"],
    }


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str = "#3b82f6"
    is_kids: bool = False
    pin: str | None = None
    allowed_categories: list[str] | None = None
    blocked_categories: list[str] = []
    preferred_countries: list[str] = []
    preferred_languages: list[str] = []

    @field_validator("pin")
    @classmethod
    def _pin(cls, v):
        if v is not None and not re.fullmatch(r"\d{4,8}", v):
            raise ValueError("PIN must be 4-8 digits")
        return v

    @field_validator("color")
    @classmethod
    def _color(cls, v):
        if not _COLOR.match(v):
            raise ValueError("color must be #rrggbb")
        return v


class ProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    color: str | None = None
    is_kids: bool | None = None
    pin: str | None = None            # "" removes the PIN
    allowed_categories: list[str] | None = None
    clear_allowed_categories: bool = False
    blocked_categories: list[str] | None = None
    preferred_countries: list[str] | None = None
    preferred_languages: list[str] | None = None

    @field_validator("pin")
    @classmethod
    def _pin(cls, v):
        if v not in (None, "") and not re.fullmatch(r"\d{4,8}", v):
            raise ValueError("PIN must be 4-8 digits")
        return v

    @field_validator("color")
    @classmethod
    def _color(cls, v):
        if v is not None and not _COLOR.match(v):
            raise ValueError("color must be #rrggbb")
        return v


class SessionIn(BaseModel):
    pin: str | None = None


@router.get("/profiles")
def list_profiles(conn: sqlite3.Connection = Depends(get_conn)):
    return [public_profile(r) for r in conn.execute("SELECT * FROM profiles ORDER BY id")]


@router.post("/profiles", status_code=201)
def create_profile(
    body: ProfileIn,
    x_profile_token: str | None = Header(default=None),
    conn: sqlite3.Connection = Depends(get_conn),
):
    first = conn.execute("SELECT COUNT(*) FROM profiles").fetchone()[0] == 0
    if not first:
        # Only a grown-up profile may add profiles once the household exists.
        adult_profile(current_profile(x_profile_token, conn))
    if first and body.is_kids:
        raise HTTPException(400, "The first profile must be a grown-up profile.")
    allowed = body.allowed_categories
    if body.is_kids and allowed is None:
        allowed = list(config.KIDS_DEFAULT_CATEGORIES)
    cur = conn.execute(
        "INSERT INTO profiles(name, color, is_kids, pin_hash, allowed_categories, blocked_categories,"
        " preferred_countries, preferred_languages, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (body.name.strip(), body.color, int(body.is_kids), hash_pin(body.pin) if body.pin else None,
         db.jdump(allowed) if allowed is not None else None, db.jdump(body.blocked_categories),
         db.jdump([c.upper() for c in body.preferred_countries]), db.jdump(body.preferred_languages),
         int(time.time())),
    )
    row = conn.execute("SELECT * FROM profiles WHERE id = ?", (cur.lastrowid,)).fetchone()
    return full_profile(row)


@router.post("/profiles/{profile_id}/session")
def open_session(profile_id: int, body: SessionIn, conn: sqlite3.Connection = Depends(get_conn)):
    row = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Profile not found")
    if row["pin_hash"]:
        check_lockout(profile_id)
        if not body.pin or not verify_pin(body.pin, row["pin_hash"]):
            record_failure(profile_id)
            raise HTTPException(403, "Wrong PIN")
        clear_failures(profile_id)
    return {"token": create_session(conn, profile_id), "profile": full_profile(row)}


@router.delete("/session", status_code=204)
def close_session(x_profile_token: str | None = Header(default=None),
                  conn: sqlite3.Connection = Depends(get_conn)):
    if x_profile_token:
        conn.execute("DELETE FROM profile_sessions WHERE token = ?", (x_profile_token,))


@router.get("/me")
def me(profile: sqlite3.Row = Depends(current_profile)):
    return full_profile(profile)


@router.patch("/profiles/{profile_id}")
def update_profile(
    profile_id: int,
    body: ProfilePatch,
    me: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    target = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not target:
        raise HTTPException(404, "Profile not found")
    restricted_change = any(v is not None for v in (
        body.is_kids, body.pin, body.allowed_categories, body.blocked_categories)) or body.clear_allowed_categories
    if me["is_kids"] and (restricted_change or me["id"] != profile_id):
        raise HTTPException(403, "A grown-up profile is needed for this.")
    if not me["is_kids"] and me["id"] != profile_id and target["is_kids"] == 0 and target["pin_hash"]:
        raise HTTPException(403, "Open that profile with its PIN to change it.")

    sets, params = [], []

    def put(col, val):
        sets.append(f"{col} = ?")
        params.append(val)

    if body.name is not None:
        put("name", body.name.strip())
    if body.color is not None:
        put("color", body.color)
    if body.is_kids is not None:
        if body.is_kids and target["id"] == me["id"]:
            raise HTTPException(400, "Switch to another grown-up profile to turn this one into a kids profile.")
        put("is_kids", int(body.is_kids))
        if body.allowed_categories is None and not body.clear_allowed_categories:
            if body.is_kids and target["allowed_categories"] is None:
                put("allowed_categories", db.jdump(config.KIDS_DEFAULT_CATEGORIES))
            elif not body.is_kids and target["is_kids"]:
                put("allowed_categories", None)   # grown-up again: lift the kids allow-list
    if body.pin is not None:
        put("pin_hash", hash_pin(body.pin) if body.pin else None)
    if body.clear_allowed_categories:
        put("allowed_categories", None)
    elif body.allowed_categories is not None:
        put("allowed_categories", db.jdump(body.allowed_categories))
    if body.blocked_categories is not None:
        put("blocked_categories", db.jdump(body.blocked_categories))
    if body.preferred_countries is not None:
        put("preferred_countries", db.jdump([c.upper() for c in body.preferred_countries]))
    if body.preferred_languages is not None:
        put("preferred_languages", db.jdump(body.preferred_languages))
    if sets:
        conn.execute(f"UPDATE profiles SET {', '.join(sets)} WHERE id = ?", [*params, profile_id])
    return full_profile(conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone())


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: int, me: sqlite3.Row = Depends(adult_profile),
                   conn: sqlite3.Connection = Depends(get_conn)):
    target = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not target:
        raise HTTPException(404, "Profile not found")
    if not target["is_kids"]:
        adults = conn.execute("SELECT COUNT(*) FROM profiles WHERE is_kids = 0").fetchone()[0]
        if adults <= 1:
            raise HTTPException(400, "Keep at least one grown-up profile.")
    conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
