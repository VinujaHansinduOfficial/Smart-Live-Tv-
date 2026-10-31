"""AI Discovery and Voice Control Router."""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import ai, config
from ..deps import current_profile, get_conn

router = APIRouter(prefix="/api/ai", tags=["ai"])


class DiscoveryRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    history: list[dict[str, str]] | None = None


class VoiceRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class SummarizeRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    channel_name: str | None = None
    categories: list[str] | None = None


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    target_lang: str = Field(default="en", max_length=10)


@router.get("/status")
def ai_status():
    return {
        "gemini_enabled": bool(config.GEMINI_API_KEY),
        "models": config.GEMINI_MODELS,
    }


@router.post("/discover")
async def discover(
    body: DiscoveryRequest,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    return await ai.ask_gemini_discovery(conn, profile, body.prompt, body.history)


@router.post("/voice")
async def voice_command(
    body: VoiceRequest,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    parsed = ai.parse_voice_command(conn, profile, body.text)
    if parsed.get("action") == "ai_query":
        # Resolve query directly via AI Discovery so client has full response immediately
        ai_res = await ai.ask_gemini_discovery(conn, profile, body.text)
        parsed["ai_result"] = ai_res
    return parsed


@router.post("/summarize")
async def summarize_show(body: SummarizeRequest):
    return await ai.summarize_programme(
        title=body.title,
        description=body.description,
        channel_name=body.channel_name,
        categories=body.categories,
    )


@router.post("/translate")
async def translate_subtitle(body: TranslateRequest):
    translated = await ai.translate_text(body.text, body.target_lang)
    return {"text": body.text, "translated": translated, "target_lang": body.target_lang}


