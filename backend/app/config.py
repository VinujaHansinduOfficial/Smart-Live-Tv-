"""Runtime configuration, read from environment variables."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.environ.get("SMART_IPTV_DATA", BASE_DIR / "data"))
DB_PATH = Path(os.environ.get("SMART_IPTV_DB", DATA_DIR / "smart_iptv.db"))

# The iptv-org API is served from GitHub Pages; the raw gh-pages branch is a
# fallback for networks where github.io is blocked.
API_BASES = [
    b.strip()
    for b in os.environ.get(
        "SMART_IPTV_API_BASES",
        "https://iptv-org.github.io/api,"
        "https://raw.githubusercontent.com/iptv-org/api/gh-pages",
    ).split(",")
    if b.strip()
]

# How long programmes are kept after they finish (hours) - 7 days = 168 hours.
EPG_KEEP_PAST_HOURS = int(os.environ.get("SMART_IPTV_EPG_KEEP_PAST_HOURS", "168"))
CATCHUP_RETENTION_DAYS = int(os.environ.get("SMART_IPTV_CATCHUP_RETENTION_DAYS", "7"))
CATCHUP_WINDOW_HOURS = CATCHUP_RETENTION_DAYS * 24  # 168 hours
RECORDINGS_DIR = Path(os.environ.get("SMART_IPTV_RECORDINGS", DATA_DIR / "recordings"))
DOWNLOADS_DIR = Path(os.environ.get("SMART_IPTV_DOWNLOADS", DATA_DIR / "downloads"))
MAX_DOWNLOAD_STORAGE_GB = int(os.environ.get("SMART_IPTV_MAX_DOWNLOAD_STORAGE_GB", "50"))
AUTO_DELETE_DOWNLOADS = os.environ.get("SMART_IPTV_AUTO_DELETE_DOWNLOADS", "false").lower() in ("true", "1")
AUTO_RECORDING_ENABLED = False  # Disabled by default: stream directly from provider archive

# Categories a kids profile may see unless the parent overrides them.
KIDS_DEFAULT_CATEGORIES = ["animation", "kids", "family", "education"]

# Gemini AI configuration
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GCP_API_KEY")
GEMINI_MODELS = [
    m.strip()
    for m in os.environ.get(
        "GEMINI_MODELS",
        "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.8-flash,gemini-flash-lite-latest",
    ).split(",")
    if m.strip()
]

# Allowed browser origins for the dev frontend.
CORS_ORIGINS = os.environ.get(
    "SMART_IPTV_CORS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
