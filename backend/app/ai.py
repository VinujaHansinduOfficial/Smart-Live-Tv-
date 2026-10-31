"""AI Discovery & Voice Intent Services for Smart IPTV.

Integrates the Gemini API with controlled search tools over SQLite,
providing grounded, hallucination-free channel and programme discovery,
with multi-model fallback and local intent parsing.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from typing import Any

import httpx

from . import config, db
from .services import attach_now_next, channel_dict, channel_select, fts_query, programme_dict, restriction_sql

log = logging.getLogger("smart_iptv.ai")

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

TOOLS_DECLARATION = [
    {
        "function_declarations": [
            {
                "name": "search_channels",
                "description": "Search TV channels by keywords, country code, language, or category.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Search text for channel name or network"},
                        "category": {"type": "STRING", "description": "Category slug, e.g. news, sports, documentary, movies, kids, music"},
                        "country": {"type": "STRING", "description": "ISO 2-letter country code, e.g. US, UK, FR, JP, LK"},
                        "language": {"type": "STRING", "description": "ISO 3-letter language code, e.g. eng, fra, jpn, spa"},
                    },
                },
            },
            {
                "name": "search_programmes",
                "description": "Search TV show listings and currently airing or upcoming programmes.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Topic, show title, team, actor or genre keyword"},
                        "when": {"type": "STRING", "enum": ["now", "upcoming", "any"], "description": "Time filter"},
                        "category": {"type": "STRING", "description": "Programme or channel category filter"},
                    },
                },
            },
            {
                "name": "get_now_playing",
                "description": "Find channels that have live programmes playing right now in a specific category, country or language.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "category": {"type": "STRING", "description": "e.g. news, documentary, sports, movies, animation"},
                        "country": {"type": "STRING", "description": "ISO 2-letter country code"},
                        "language": {"type": "STRING", "description": "ISO 3-letter language code"},
                    },
                },
            },
        ]
    }
]


# ----------------------------------------------------------------- DB Tools Implementation

def search_channels_db(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    query: str | None = None,
    category: str | None = None,
    country: str | None = None,
    language: str | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    now = int(time.time())
    base, params = channel_select(profile["id"] if profile else None)
    cond, rparams = restriction_sql(profile)
    where, wparams = [cond], list(rparams)

    match = fts_query(query) if query else None
    if query and not match:
        return []
    if match:
        base += " JOIN channels_fts f ON f.id = c.id"
        where.append("channels_fts MATCH ?")
        wparams.append(match)
    if country:
        where.append("c.country = ?")
        wparams.append(country.upper())
    if category:
        where.append("EXISTS (SELECT 1 FROM channel_categories x WHERE x.channel_id = c.id AND x.category = ?)")
        wparams.append(category.lower())
    if language:
        where.append("EXISTS (SELECT 1 FROM channel_languages x WHERE x.channel_id = c.id AND x.language = ?)")
        wparams.append(language.lower())

    sql_where = " WHERE " + " AND ".join(where)
    order = "has_guide DESC, MIN(c.stream_count, 3) DESC, c.guide_sites DESC, c.name COLLATE NOCASE"
    rows = conn.execute(f"{base}{sql_where} ORDER BY {order} LIMIT ?", [*params, *wparams, limit]).fetchall()
    return attach_now_next(conn, [channel_dict(r) for r in rows], now)


def search_programmes_db(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    query: str | None = None,
    when: str = "any",
    category: str | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    now = int(time.time())
    cond, rparams = restriction_sql(profile)
    where, wparams = [cond], list(rparams)

    match = fts_query(query) if query else None
    if query and not match:
        return []

    base = (
        "SELECT p.*, c.name AS channel_name, c.logo AS channel_logo, c.country AS channel_country"
        " FROM programmes p"
        " JOIN channels c ON c.id = p.channel_id"
    )
    if match:
        base += " JOIN programmes_fts f ON f.rowid = p.id"
        where.append("programmes_fts MATCH ?")
        wparams.append(match)

    if when == "now":
        where += ["p.start <= ?", "p.stop > ?"]
        wparams += [now, now]
    elif when == "upcoming":
        where += ["p.start > ?", "p.start <= ?"]
        wparams += [now, now + 86400]
    else:
        where += ["p.stop > ?", "p.start <= ?"]
        wparams += [now, now + 86400]

    if category:
        where.append("EXISTS (SELECT 1 FROM channel_categories cc WHERE cc.channel_id = c.id AND cc.category = ?)")
        wparams.append(category.lower())

    sql = f"{base} WHERE {' AND '.join(where)} ORDER BY p.start ASC LIMIT ?"
    rows = conn.execute(sql, [*wparams, limit]).fetchall()

    results = []
    for r in rows:
        d = programme_dict(r)
        d["channel"] = {
            "id": r["channel_id"],
            "name": r["channel_name"],
            "logo": r["channel_logo"],
            "country": r["channel_country"],
        }
        results.append(d)
    return results


def get_now_playing_db(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    category: str | None = None,
    country: str | None = None,
    language: str | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    now = int(time.time())
    base, params = channel_select(profile["id"] if profile else None)
    cond, rparams = restriction_sql(profile)
    where, wparams = [cond], list(rparams)

    # Must have a programme running right now
    base += (
        " JOIN channel_guide_feed gf_live ON gf_live.channel_id = c.id"
        " JOIN programmes p_live ON p_live.channel_id = c.id AND p_live.feed_id IS gf_live.feed_id"
    )
    where += ["p_live.start <= ?", "p_live.stop > ?"]
    wparams += [now, now]

    if category:
        where.append(
            "(EXISTS (SELECT 1 FROM channel_categories x WHERE x.channel_id = c.id AND x.category = ?)"
            " OR p_live.categories LIKE ?)"
        )
        wparams += [category.lower(), f'%"{category.lower()}"%']
    if country:
        where.append("c.country = ?")
        wparams.append(country.upper())
    if language:
        where.append("EXISTS (SELECT 1 FROM channel_languages x WHERE x.channel_id = c.id AND x.language = ?)")
        wparams.append(language.lower())

    sql_where = " WHERE " + " AND ".join(where)
    order = "c.guide_sites DESC, c.stream_count DESC, c.name COLLATE NOCASE"
    rows = conn.execute(f"{base}{sql_where} ORDER BY {order} LIMIT ?", [*params, *wparams, limit]).fetchall()
    return attach_now_next(conn, [channel_dict(r) for r in rows], now)


# ----------------------------------------------------------------- Local Fallback Discovery

CATEGORY_SYNONYMS = {
    "documentary": ["documentary", "documentaries", "doc", "docs"],
    "movies": ["movie", "movies", "cinema", "films", "film"],
    "news": ["news", "headline", "headlines"],
    "sports": ["sport", "sports"],
    "kids": ["kids", "children", "child", "cartoon", "cartoons"],
    "animation": ["animation", "animated", "anime"],
    "music": ["music", "songs", "song"],
    "comedy": ["comedy", "comedies"],
    "business": ["business", "finance", "economy"],
    "education": ["education", "educational", "learn"],
    "science": ["science", "tech", "technology"],
}


def local_fallback_discovery(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    prompt: str,
) -> dict[str, Any]:
    """Provides high-quality heuristic discovery if Gemini API is unreachable or rate-limited."""
    text = prompt.lower()
    cat = None
    for target_cat, syns in CATEGORY_SYNONYMS.items():
        if any(re.search(rf"\b{re.escape(s)}\b", text) for s in syns):
            cat = target_cat
            break

    # Detect countries
    country = None
    if "british" in text or "uk" in text:
        country = "UK"
    elif "american" in text or "us" in text or "usa" in text:
        country = "US"
    elif "japanese" in text or "japan" in text:
        country = "JP"
    elif "french" in text or "france" in text:
        country = "FR"
    elif "german" in text or "germany" in text:
        country = "DE"
    elif "spanish" in text or "spain" in text:
        country = "ES"
    elif "italian" in text or "italy" in text:
        country = "IT"
    elif "canadian" in text or "canada" in text:
        country = "CA"
    elif "australian" in text or "australia" in text:
        country = "AU"
    elif "indian" in text or "india" in text:
        country = "IN"

    # Detect language
    language = None
    if "english" in text:
        language = "eng"
    elif "spanish" in text:
        language = "spa"
    elif "french" in text:
        language = "fra"
    elif "japanese" in text:
        language = "jpn"
    elif "german" in text:
        language = "deu"

    is_now = any(w in text for w in ["now", "currently", "airing", "live", "on right now"])

    channels: list[dict[str, Any]] = []
    programmes: list[dict[str, Any]] = []

    if is_now and cat:
        channels = get_now_playing_db(conn, profile, category=cat, country=country, language=language, limit=8)
    if not channels:
        # Search channels with extracted keywords
        clean_kw = re.sub(r"\b(find|search|show|what|is|are|on|now|watch|me|the|in|channels|tv|channel|live)\b", "", text).strip()
        if cat:
            clean_kw = re.sub(rf"\b({cat}|{cat}s|{cat}es|documentaries|movies|kids)\b", "", clean_kw, flags=re.IGNORECASE).strip()
        channels = search_channels_db(conn, profile, query=clean_kw if clean_kw else None, category=cat, country=country, language=language, limit=8)
        if not channels and clean_kw:
            channels = search_channels_db(conn, profile, query=clean_kw, country=country, language=language, limit=8)
        if not channels and cat:
            channels = search_channels_db(conn, profile, category=cat, country=country, language=language, limit=8)

    # Also search programmes
    clean_prog_kw = re.sub(r"\b(find|show|what|tv|channels|channel|programmes|programme|shows|show)\b", "", text).strip()
    if clean_prog_kw:
        programmes = search_programmes_db(conn, profile, query=clean_prog_kw, when="now" if is_now else "any", category=cat, limit=6)
    if not programmes and clean_kw:
        programmes = search_programmes_db(conn, profile, query=clean_kw, when="now" if is_now else "any", category=cat, limit=6)

    # Compose response
    cat_label = f"{cat} " if cat else ""
    country_label = f"from {country} " if country else ""
    lang_label = f"in {language} " if language else ""
    total = len(channels) + len(programmes)

    if total == 0:
        reply = f"I searched the global channel catalog and schedule for '{prompt}', but didn't find exact matches. Try searching by country, genre (e.g. 'News', 'Sports'), or show title."
    else:
        parts = []
        if channels:
            parts.append(f"found {len(channels)} {cat_label}{country_label}{lang_label}channel{'s' if len(channels) > 1 else ''} available to stream")
        if programmes:
            parts.append(f"{len(programmes)} matching programme{'s' if len(programmes) > 1 else ''} on the schedule")
        reply = f"Here is what I found for your request: {' and '.join(parts)}. You can tune in directly with one click below."

    return {
        "reply": reply,
        "channels": channels,
        "programmes": programmes,
        "source": "database_search",
    }


# ----------------------------------------------------------------- Gemini AI Assistant

async def execute_tool_call(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    name: str,
    args: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Executes a function call made by Gemini against SQLite."""
    channels: list[dict[str, Any]] = []
    programmes: list[dict[str, Any]] = []

    if name == "search_channels":
        res = search_channels_db(
            conn, profile,
            query=args.get("query"),
            category=args.get("category"),
            country=args.get("country"),
            language=args.get("language"),
            limit=8,
        )
        channels = res
        summary = [{"id": c["id"], "name": c["name"], "country": c["country"], "categories": c["categories"], "playing_now": c.get("now", {}).get("title") if c.get("now") else None} for c in res]
        return {"channels_found": summary, "count": len(res)}, channels, programmes

    elif name == "search_programmes":
        res = search_programmes_db(
            conn, profile,
            query=args.get("query"),
            when=args.get("when", "any"),
            category=args.get("category"),
            limit=8,
        )
        programmes = res
        summary = [{"title": p["title"], "channel": p["channel"]["name"], "start": p["start"], "stop": p["stop"], "description": (p.get("description") or "")[:120]} for p in res]
        return {"programmes_found": summary, "count": len(res)}, channels, programmes

    elif name == "get_now_playing":
        res = get_now_playing_db(
            conn, profile,
            category=args.get("category"),
            country=args.get("country"),
            language=args.get("language"),
            limit=8,
        )
        channels = res
        summary = [{"id": c["id"], "name": c["name"], "country": c["country"], "playing_now": c.get("now", {}).get("title") if c.get("now") else None} for c in res]
        return {"live_now_channels": summary, "count": len(res)}, channels, programmes

    return {"error": f"Unknown tool: {name}"}, channels, programmes


async def ask_gemini_discovery(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    prompt: str,
    conversation_history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Runs a multi-turn or tool-enabled query against Gemini models with fallback."""
    api_key = config.GEMINI_API_KEY
    if not api_key:
        return local_fallback_discovery(conn, profile, prompt)

    system_instruction = (
        "You are the Smart IPTV Assistant. Your job is to help users discover TV channels "
        "and scheduled programmes accurately without making up channels that don't exist. "
        "Always use the provided search tools (`search_channels`, `search_programmes`, `get_now_playing`) "
        "to check the real catalog and schedule before answering. "
        "Be friendly, concise, and highlight the best matching channels and show titles. "
        "If no results are returned by the tools, tell the user honestly and suggest related alternatives."
    )

    contents: list[dict[str, Any]] = []
    if conversation_history:
        for turn in conversation_history[-6:]:
            role = "user" if turn.get("role") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": turn.get("content", "")}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    collected_channels: dict[str, dict[str, Any]] = {}
    collected_programmes: dict[int, dict[str, Any]] = {}

    for model in config.GEMINI_MODELS:
        url = GEMINI_API_URL.format(model=model)
        payload: dict[str, Any] = {
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": contents,
            "tools": TOOLS_DECLARATION,
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024},
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    url,
                    headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                    json=payload,
                )

                if res.status_code != 200:
                    log.warning("Gemini model %s returned status %d: %s", model, res.status_code, res.text[:200])
                    continue

                data = res.json()
                candidate = data.get("candidates", [{}])[0]
                content = candidate.get("content", {})
                parts = content.get("parts", [])

                # Check if model wants to call tools
                tool_calls = [p["functionCall"] for p in parts if "functionCall" in p]

                if not tool_calls:
                    # Model gave a direct text response
                    reply_text = "".join(p.get("text", "") for p in parts)
                    # If model mentioned channels without tools, run heuristic search to back it up
                    fallback = local_fallback_discovery(conn, profile, prompt)
                    return {
                        "reply": reply_text or fallback["reply"],
                        "channels": fallback["channels"],
                        "programmes": fallback["programmes"],
                        "source": f"gemini:{model}",
                    }

                # Execute tool calls
                tool_response_parts: list[dict[str, Any]] = []
                for tc in tool_calls:
                    fn_name = tc.get("name")
                    fn_args = tc.get("args", {})
                    fn_res, chs, prgs = await execute_tool_call(conn, profile, fn_name, fn_args)
                    for c in chs:
                        collected_channels[c["id"]] = c
                    for p in prgs:
                        collected_programmes[p["id"]] = p

                    tool_response_parts.append({
                        "functionResponse": {
                            "name": fn_name,
                            "response": fn_res,
                        }
                    })

                # Send tool responses back to Gemini for final text synthesis
                followup_contents = list(contents)
                followup_contents.append({"role": "model", "parts": parts})
                followup_contents.append({"role": "user", "parts": tool_response_parts})

                followup_payload = {
                    "system_instruction": {"parts": [{"text": system_instruction}]},
                    "contents": followup_contents,
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024},
                }

                followup_res = await client.post(
                    url,
                    headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                    json=followup_payload,
                )

                if followup_res.status_code == 200:
                    final_data = followup_res.json()
                    final_candidate = final_data.get("candidates", [{}])[0]
                    final_parts = final_candidate.get("content", {}).get("parts", [])
                    final_text = "".join(p.get("text", "") for p in final_parts)

                    return {
                        "reply": final_text,
                        "channels": list(collected_channels.values()),
                        "programmes": list(collected_programmes.values()),
                        "source": f"gemini:{model}",
                    }

        except Exception as e:
            log.warning("Exception calling Gemini model %s: %s", model, e)
            continue

    # If all Gemini models failed or timed out, use local discovery
    log.info("Falling back to local SQLite discovery engine")
    return local_fallback_discovery(conn, profile, prompt)


# ----------------------------------------------------------------- Voice Intent Parser

def parse_voice_command(
    conn: sqlite3.Connection,
    profile: sqlite3.Row | dict | None,
    text: str,
) -> dict[str, Any]:
    """Fast, accurate voice command parser with intent detection.

    Supported intents:
      - play_channel: "play BBC News", "watch CNN", "tune to cartoon network"
      - next_channel: "next channel", "channel up"
      - prev_channel: "previous channel", "channel down"
      - toggle_playback: "pause", "play", "resume"
      - mute / unmute: "mute", "unmute"
      - volume_up / volume_down: "volume up", "volume down", "louder", "softer"
      - fullscreen: "fullscreen", "exit fullscreen"
      - navigate: "go to guide", "show favorites", "open history", "open multiview", "world explorer", "settings"
      - search: "search for football", "find comedy"
      - ai_query: complex queries deferred to AI discovery
    """
    s = text.strip().lower()

    # Exact fast controls
    if s in ("next", "next channel", "channel up", "skip channel"):
        return {"action": "next_channel", "feedback": "Switching to next channel"}
    if s in ("previous", "previous channel", "channel down", "last channel", "back channel"):
        return {"action": "prev_channel", "feedback": "Switching to previous channel"}
    if s in ("pause", "freeze", "stop playback"):
        return {"action": "pause", "feedback": "Paused"}
    if s in ("play", "resume", "continue playback"):
        return {"action": "play", "feedback": "Playing"}
    if s in ("mute", "silence", "be quiet"):
        return {"action": "mute", "feedback": "Muted"}
    if s in ("unmute", "sound on", "enable audio"):
        return {"action": "unmute", "feedback": "Unmuted"}
    if s in ("volume up", "louder", "increase volume", "turn it up"):
        return {"action": "volume_up", "feedback": "Volume up"}
    if s in ("volume down", "quieter", "lower volume", "turn it down", "softer"):
        return {"action": "volume_down", "feedback": "Volume down"}
    if s in ("fullscreen", "full screen", "maximize", "large screen"):
        return {"action": "fullscreen", "feedback": "Fullscreen toggled"}

    # Navigation
    if any(p in s for p in ["guide", "tv guide", "program guide", "schedule", "what's on"]):
        return {"action": "navigate", "route": "/guide", "feedback": "Opening TV Guide"}
    if any(p in s for p in ["favorite", "favourites", "my channels"]):
        return {"action": "navigate", "route": "/search?favorites=1", "feedback": "Opening Favourites"}
    if any(p in s for p in ["history", "recently watched", "watch history"]):
        return {"action": "navigate", "route": "/history", "feedback": "Opening Watch History"}
    if any(p in s for p in ["multi view", "multiview", "quad view", "split screen"]):
        return {"action": "navigate", "route": "/multiview", "feedback": "Opening Multi-View"}
    if any(p in s for p in ["world", "world tv", "countries", "map", "world explorer"]):
        return {"action": "navigate", "route": "/world", "feedback": "Opening World TV Explorer"}
    if any(p in s for p in ["reminders", "my reminders", "alerts"]):
        return {"action": "navigate", "route": "/reminders", "feedback": "Opening Reminders"}
    if any(p in s for p in ["setting", "settings", "configuration", "profiles"]):
        return {"action": "navigate", "route": "/settings", "feedback": "Opening Settings"}

    # Play/watch channel pattern
    m = re.match(r"^(?:play|watch|tune\s+to|switch\s+to|open\s+channel|put\s+on)\s+(.+)$", s)
    if m:
        target = m.group(1).strip()
        chs = search_channels_db(conn, profile, query=target, limit=3)
        if chs:
            best = chs[0]
            return {
                "action": "play_channel",
                "channel_id": best["id"],
                "channel_name": best["name"],
                "feedback": f"Tuning to {best['name']}",
            }
        else:
            return {
                "action": "search",
                "query": target,
                "feedback": f"Searching for '{target}'",
            }

    # Search pattern
    m_search = re.match(r"^(?:search\s+for|find|look\s+for|show\s+me)\s+(.+)$", s)
    if m_search:
        target = m_search.group(1).strip()
        # Check if it's an AI inquiry (what is on, recommendation, etc.)
        if any(w in target for w in ["what", "currently", "documentar", "recommend", "best", "news in"]):
            return {
                "action": "ai_query",
                "query": text,
                "feedback": "Consulting AI Assistant...",
            }
        return {
            "action": "search",
            "query": target,
            "feedback": f"Searching for '{target}'",
        }

    # If it asks a question or has more than 3 words, treat as AI Discovery query
    if "?" in text or any(w in s for w in ["what", "who", "which", "recommend", "how", "tell me"]):
        return {
            "action": "ai_query",
            "query": text,
            "feedback": "Consulting AI Assistant...",
        }

    # Default fallback: search catalog for text
    return {
        "action": "search",
        "query": text,
        "feedback": f"Searching for '{text}'",
    }


async def summarize_programme(
    title: str,
    description: str | None = None,
    channel_name: str | None = None,
    categories: list[str] | None = None,
) -> dict[str, Any]:
    """Generates an AI summary and key highlights for a television broadcast."""
    desc = description or "Broadcast television program"
    ch = f" on {channel_name}" if channel_name else ""
    cats = f" [{', '.join(categories)}]" if categories else ""

    prompt = (
        f"You are an expert TV critic and entertainment analyst. "
        f"Analyze this broadcast{ch}{cats}: '{title}'. Overview: '{desc}'.\n"
        f"Provide:\n"
        f"1. A concise 2-sentence executive summary.\n"
        f"2. Three bullet point key highlights or topics covered.\n"
        f"3. Recommendation of who would enjoy watching it."
    )

    if config.GEMINI_API_KEY:
        for model in config.GEMINI_MODELS:
            url = f"{GEMINI_API_URL.format(model=model)}?key={config.GEMINI_API_KEY}"
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.4, "maxOutputTokens": 600},
            }
            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    resp = await client.post(url, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            text_out = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                            if text_out:
                                return {
                                    "title": title,
                                    "summary": text_out.strip(),
                                    "source": f"gemini ({model})",
                                }
            except Exception as e:
                log.warning("Gemini summary error on %s: %s", model, e)

    # Local fallback summary
    return {
        "title": title,
        "summary": (
            f"'{title}' is a {categories[0] if categories else 'featured'} program{ch}. "
            f"{desc} Recommended for viewers interested in {', '.join(categories) if categories else 'television broadcasting'}."
        ),
        "source": "local",
    }


async def translate_text(text: str, target_lang: str) -> str:
    """Translates a live subtitle string or prompt to target language."""
    if not text.strip():
        return text

    if config.GEMINI_API_KEY:
        for model in config.GEMINI_MODELS:
            url = f"{GEMINI_API_URL.format(model=model)}?key={config.GEMINI_API_KEY}"
            prompt = f"Translate the following subtitle into language code '{target_lang}'. Output ONLY the translated text without notes:\n{text}"
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 100},
            }
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.post(url, json=payload)
                    if resp.status_code == 200:
                        candidates = resp.json().get("candidates", [])
                        if candidates:
                            t = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                            if t:
                                return t
            except Exception:
                pass

    return text

