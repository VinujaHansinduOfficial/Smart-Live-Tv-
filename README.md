# Smart TV — Original IPTV Software with 14-Day Catch-Up

Modern television & video-on-demand platform featuring **14-Day Catch-Up TV (Replay)**, **Movies & TV Series (VOD)**, **Local DVR & Scheduled Recordings**, **IPTVnator-grade Video Player Controls**, **Universal Smart Search**, **Command Palette**, **EPG Electronic Program Guide**, **Gemini AI Discovery Assistant**, **Voice Control**, and **Multi-View Television**.

Built with a high-performance **FastAPI (Python 3.12) + SQLite (FTS5 & WAL)** backend and a responsive **React 19 + TypeScript + Tailwind CSS** frontend.

---

## 🌟 Key Features

| Category | Route / Shortcut | Description |
| --- | --- | --- |
| **14-Day Catch-Up TV (Replay)** | `/catchup` | Rolling 14-day date strip (Today, Yesterday, ..., 14 days ago) with 4 availability states (`Provider Archive`, `Local DVR`, `Unavailable`, `Outside 14-Day Window`), automated timeshift URL resolver, and 1-click replay player. |
| **VOD: Movies & TV Series** | `/vod` | On-demand catalog with hero showcase, "Continue Watching" row with progress resumption, genre filters, and TV series season/episode selectors. |
| **Local DVR & Recordings** | `/recordings` | Instant live stream capture (15–180 min), scheduled future EPG broadcast recordings, disk storage meter, and 14-day retention cleanup manager. |
| **Advanced Video Player** | Player controls | IPTVnator-grade player with time-scrubbing seek bar, quality renditions (1080p, 720p, etc.), audio & subtitle tracks, playback speed (0.5x–2x), live DVR record button, stream diagnostics HUD, and external launchers (`vlc://`, `mpv://`). |
| **Command Palette** | `Ctrl+K` / `Cmd+K` | Quick keyboard command launcher to jump to any channel, page, or playback action (Mute, Fullscreen, Record, AI Assistant). |
| **IPTV Sources Management** | `/settings` | Ingest and parse extended M3U/M3U8 playlists (URL or pasted text), Xtream Codes accounts, and Stalker/Ministra portals with catch-up configurations. |
| **Universal Smart Search** | `/search` | 4-tab unified search across Live Channels, Program Guide (Now & Next 24h), 14-Day Catch-Up Archives, and VOD Movies & Series. |
| **Voice-Controlled TV** | Header mic / `V` | Natural speech recognition with instant local commands ("Play BBC News", "TV Guide", "Mute", "Volume up") and AI intent parsing. |
| **AI TV Discovery Assistant** | `AI Find` / `A` | Grounded Google Gemini AI assistant with controlled search tools over the live catalog & schedules; hallucination-free discovery. |
| **Multi-View Television** | `/multiview` | Watch 2 to 4 channels simultaneously in Dual, Triple, Quad, or Focus layouts with audio switching and custom presets. |
| **World TV Explorer** | `/world` | Geographic discovery across Europe, Americas, Asia, Middle East, Africa, and Oceania with country flags, channel counts, and live broadcasts. |
| **TV Guide Grid & Schedule** | `/guide` | Channels × time grid, now-line, 2-hour paging, category & favourites filters. |
| **Cross-Device Sync & Remote** | `/remote` or Pair | Pair mobile phones to TV screen with 6-digit code (`TV-XXXX`); turn phone into a live Smart TV Remote with D-pad, channel/volume controls, and voice mic. |
| **Household Profiles** | Profile picker | Separate watch history, favorites, kids profiles, category blocklists, and 4-digit PIN security. |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 20+

### 1. Backend Setup
```bash
cd backend
pip install -r requirements.txt

# Initial catalog sync and optional demo guide
python -m app.sync                 # sync public iptv-org catalog
python -m app.epg demo             # load demo EPG listings

# Run FastAPI server
uvicorn app.main:app --port 8000
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev                        # Launches at http://localhost:5173 (proxies API to :8000)
```

For production builds:
```bash
cd frontend
npm run build                      # Compiles to frontend/dist (served directly by FastAPI at http://localhost:8000)
```

### 3. Run Backend Test Suite
```bash
cd backend
python -m pytest                   # 31 unit & integration tests pass (100% passing)
```

---

## ⌨️ TV & Keyboard Navigation

| Key | Action |
| --- | --- |
| `Ctrl+K` / `Cmd+K` | Open Universal Command Palette |
| `Space` | Play / Pause active stream |
| `M` | Mute / Unmute audio |
| `F` | Toggle Fullscreen |
| `←` / `→` | Seek backward / forward 10 seconds |
| `↑` / `↓` | Volume up / down |
| `V` | Trigger Voice Command microphone |
| `A` | Open AI TV Discovery Assistant |
| `G` | Jump to TV Guide |
| `?` | Show 10-Foot Remote & Shortcut cheatsheet |

---

## 🏗️ Architecture

```
smart-iptv/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI application entrypoint & static mounting
│   │   ├── db.py                       # SQLite connection, WAL mode, schema migrations & FTS5
│   │   ├── config.py                   # 14-day retention (336h), paths & constants
│   │   ├── catchup.py                  # 14-day rolling window & replay availability resolver
│   │   ├── services.py                 # Channel filtering, permissions & serialization
│   │   ├── sync.py                     # iptv-org sync pipeline
│   │   ├── ai.py                       # Google Gemini API assistant with tool grounding
│   │   ├── routers/
│   │   │   ├── catchup.py              # /api/catchup (days, schedule, resolve)
│   │   │   ├── vod.py                  # /api/vod (featured, movies, series, continue, progress)
│   │   │   ├── recordings.py           # /api/recordings (instant record, schedule, storage, cleanup)
│   │   │   ├── sources.py              # /api/sources (M3U, Xtream Codes, Stalker portals)
│   │   │   ├── catalog.py              # /api/channels, /api/meta
│   │   │   ├── guide.py                # /api/guide/grid, /api/guide/channel
│   │   │   ├── multiview.py            # /api/me/multiview
│   │   │   ├── world.py                # /api/world
│   │   │   ├── sync.py                 # /api/sync (device pair & remote control)
│   │   │   └── ai.py                   # /api/ai (discover, voice)
│   │   └── epg/                        # XMLTV parser, grabber & demo listings
│   └── tests/                          # 31 pytest integration tests
└── frontend/
    ├── src/
    │   ├── App.tsx                     # Router, header, navigation & command palette
    │   ├── api.ts                      # Fully typed API client
    │   ├── types.ts                    # TypeScript domain interfaces
    │   ├── components/
    │   │   ├── Player.tsx              # IPTVnator-grade player (seek, HUD, quality, speed, audio/sub)
    │   │   ├── CommandPalette.tsx      # Ctrl+K global navigation palette
    │   │   ├── VoiceControl.tsx        # Voice command microphone
    │   │   ├── AiAssistant.tsx         # Gemini AI chat interface
    │   │   └── TvRemoteOverlay.tsx     # 10-foot TV mode overlay
    │   └── views/
    │       ├── Catchup.tsx             # 14-Day Catch-Up TV Replay interface
    │       ├── Vod.tsx                 # VOD Movies & TV Series with Continue Watching
    │       ├── Recordings.tsx          # Local DVR, storage meter & retention cleanup
    │       ├── Watch.tsx               # Primary live TV player & channel browsing
    │       ├── Guide.tsx               # Multi-channel EPG grid
    │       ├── Search.tsx              # 4-tab universal search
    │       ├── MultiView.tsx           # 2-4 channel multi-view
    │       ├── WorldExplorer.tsx       # Geographic country TV explorer
    │       └── Settings.tsx            # IPTV sources, profiles, and EPG configuration
```
