# F1 Timing Web App  - Full Implementation Plan

## Overview

A modern web app for replaying F1 race sessions with real timing data, car positions, and telemetry. Built using the FastF1 Python library as the data source, with a fresh web frontend. Everything is hosted on Railway (two services).

## Architecture

```
Railway Service 1: f1-backend (FastAPI + Python)
├── FastF1 data fetching & caching
├── REST API for sessions, tracks, laps, results
├── WebSocket for replay frame streaming
└── Railway persistent volume at /data/fastf1-cache

Railway Service 2: f1-frontend (Next.js + React)
├── Dark-themed F1 dashboard UI
├── HTML Canvas track rendering with animated driver markers
├── Real-time replay via WebSocket
├── Tailwind CSS styling
└── Deployed as Node server on Railway
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend framework | FastAPI + Uvicorn |
| Data source | FastF1 (Python F1 telemetry library) |
| Frontend framework | Next.js 14 (App Router) + React 18 |
| Track rendering | HTML Canvas (2D) |
| Charts | Recharts |
| Styling | Tailwind CSS |
| Real-time | WebSocket (native browser API + FastAPI) |
| Deployment | Railway (2 services + 1 persistent volume) |

## Backend API

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/seasons` | List available seasons (2018-current) |
| GET | `/api/seasons/{year}/events` | All rounds in a season |
| GET | `/api/sessions/{year}/{round}?type=R` | Session metadata + driver list |
| GET | `/api/sessions/{year}/{round}/track?type=R` | Track x/y coordinates (normalized 0-1) |
| GET | `/api/sessions/{year}/{round}/laps?type=R` | Lap-by-lap data (times, tyres, positions) |
| GET | `/api/sessions/{year}/{round}/results?type=R` | Final classification |

### WebSocket

| Path | Description |
|------|-------------|
| `WS /ws/replay/{year}/{round}?type=R` | Streams replay frames. Client sends `play`, `pause`, `speed:2`, `seek:45.0`. Server sends `ReplayFrame` JSON every interval. |

### Key Design Decisions  - Backend

- FastF1 sessions are cached in-memory after first load (dict keyed by year_round_type)
- FastF1 disk cache on Railway persistent volume (sessions are 50-100MB each)
- Position data sampled every 0.5s for smooth replay (~7000 frames for a 1h race)
- Track coordinates normalized to 0-1 range  - frontend scales to canvas size
- All heavy FastF1 loading runs in a thread pool to avoid blocking the event loop

## Frontend Pages

### 1. Home / Session Picker (`/`)

- Season selector (dropdown or horizontal scroll of years)
- Grid of event cards for the selected season
- Each card shows: country flag, event name, location, date
- Click a card → shows session type options (Race, Qualifying, Sprint, etc.)
- Selecting a session navigates to `/replay/{year}/{round}?type=R`

### 2. Replay View (`/replay/[year]/[round]`)

Layout:
```
┌──────────────────────────────────────────────────────────────┐
│  Session Banner: "2024 Bahrain Grand Prix  - Race"            │
├────────────────────────────────────┬─────────────────────────┤
│                                    │    LEADERBOARD          │
│         TRACK CANVAS               │  P1  VER  +0.000  (S)  │
│   (circuit outline with colored    │  P2  NOR  +3.456  (M)  │
│    driver dots animated along it)  │  P3  LEC  +5.678  (H)  │
│                                    │  ...                    │
│                                    │  P20 SAR  +1 LAP  (M)  │
├────────────────────────────────────┴─────────────────────────┤
│  ▶  1x  2x  5x  10x    ████████████░░░░░░░░    Lap 23/57   │
│  [play] [speed btns]    [progress bar]          [lap count]  │
├──────────────────────────────────────────────────────────────┤
│  TELEMETRY (expandable)                                      │
│  [Driver 1 selector] vs [Driver 2 selector]                  │
│  Speed trace chart  - Recharts line chart                     │
└──────────────────────────────────────────────────────────────┘
```

**Track Canvas details:**
- Circuit drawn as a smooth path from normalized coordinates
- Driver markers: filled circles with team color, 3-letter abbreviation label
- DRS zones highlighted in green (if data available)
- Start/finish line marker
- Smooth animation via requestAnimationFrame

**Leaderboard details:**
- Position number (with change indicator if gained/lost)
- Driver abbreviation
- Gap to leader
- Current tyre compound (colored dot: red=Soft, yellow=Medium, white=Hard)
- Tyre age (laps)
- Pit stop count
- Click a driver to highlight on track

**Playback controls:**
- Play/pause button
- Speed buttons: 1x, 2x, 5x, 10x, 20x
- Progress bar (clickable to seek)
- Current lap / total laps display
- Flag/SC/VSC indicators on progress bar

### 3. Results View (`/results/[year]/[round]`)

- Final classification table
- Grid position vs finish position
- Tyre strategy visualization (horizontal colored bars per driver)
- Fastest lap highlighted

## File Structure

```
F1timing/
├── PLAN.md                          ← this file
├── backend/
│   ├── main.py                      # FastAPI app, CORS, lifespan
│   ├── requirements.txt             # Python dependencies
│   ├── Dockerfile                   # Python 3.11 + uvicorn
│   ├── railway.toml                 # Railway build config
│   ├── .env.example                 # Environment variable template
│   ├── models/
│   │   └── schemas.py               # Pydantic response models
│   ├── routers/
│   │   ├── sessions.py              # Season/event/session endpoints
│   │   ├── track.py                 # Track geometry endpoint
│   │   ├── laps.py                  # Lap data endpoint
│   │   ├── results.py               # Race results endpoint
│   │   └── replay.py                # WebSocket replay endpoint
│   └── services/
│       └── f1_data.py               # FastF1 integration layer
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── railway.toml
│   ├── .env.example
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx           # Root layout (dark theme, fonts)
│   │   │   ├── page.tsx             # Home  - session picker
│   │   │   ├── replay/
│   │   │   │   └── [year]/
│   │   │   │       └── [round]/
│   │   │   │           └── page.tsx # Replay view
│   │   │   └── results/
│   │   │       └── [year]/
│   │   │           └── [round]/
│   │   │               └── page.tsx # Results view
│   │   ├── components/
│   │   │   ├── SessionPicker.tsx    # Year + event grid
│   │   │   ├── TrackCanvas.tsx      # Canvas circuit + driver dots
│   │   │   ├── Leaderboard.tsx      # Position table sidebar
│   │   │   ├── PlaybackControls.tsx # Play/pause/speed/seek bar
│   │   │   ├── TelemetryChart.tsx   # Speed/throttle comparison
│   │   │   ├── TyreIndicator.tsx    # Colored tyre compound dot
│   │   │   └── SessionBanner.tsx    # Top bar with session info
│   │   ├── hooks/
│   │   │   ├── useReplaySocket.ts   # WebSocket connection + state
│   │   │   └── useApi.ts           # REST API fetch helpers
│   │   └── lib/
│   │       ├── api.ts               # API base URL + fetch wrapper
│   │       ├── constants.ts         # Team colors, tyre colors, etc.
│   │       └── trackRenderer.ts     # Canvas drawing utilities
│   └── ...
└── ...
```

## Build Order

| Step | Status | Description |
|------|--------|-------------|
| 1 | DONE | Backend scaffold  - FastAPI app, Dockerfile, railway.toml |
| 2 | DONE | Data service  - FastF1 integration (f1_data.py) |
| 3 | DONE | Pydantic models (schemas.py) |
| 4 | DONE | REST routers  - sessions, track, laps, results |
| 5 | DONE | WebSocket replay router |
| 6 | DONE | Backend main.py  - wire everything together |
| 7 | DONE | Backend Dockerfile + railway.toml |
| 8 | DONE | Frontend scaffold  - Next.js + Tailwind + dark theme |
| 9 | DONE | API client + constants |
| 10 | DONE | Session picker page (home) |
| 11 | DONE | Track canvas component |
| 12 | DONE | Replay WebSocket hook |
| 13 | DONE | Replay page  - track + leaderboard + controls |
| 14 | DONE | Playback controls component |
| 15 | DONE | Leaderboard component |
| 16 | DONE | Telemetry chart component (placeholder) |
| 17 | DONE | Results page |
| 18 | DONE | Frontend Dockerfile + railway.toml |
| 19 | TODO | Railway deployment  - create services, volumes, env vars |
| 20 | TODO | Polish  - loading states, error handling, responsive |

## Railway Deployment

### Backend Service
- **Name:** f1-backend
- **Build:** Dockerfile
- **Port:** 8000
- **Volume:** /data/fastf1-cache (persistent, 1GB+)
- **Env vars:** `PORT=8000`, `FASTF1_CACHE_DIR=/data/fastf1-cache`, `FRONTEND_URL=https://f1-frontend-*.up.railway.app`

### Frontend Service
- **Name:** f1-frontend
- **Build:** Dockerfile
- **Port:** 3000
- **Env vars:** `NEXT_PUBLIC_API_URL=https://f1-backend-*.up.railway.app`

### Networking
- Frontend makes REST calls to backend public URL
- WebSocket connection from browser to backend public URL
- CORS configured on backend to allow frontend origin

## Data Flow

### Session Loading
1. User selects a season → frontend calls `GET /api/seasons/{year}/events`
2. User picks an event → frontend calls `GET /api/sessions/{year}/{round}`
3. Backend loads FastF1 session (slow on first load: 30-60s, cached after)
4. Frontend shows loading spinner during this time

### Replay Playback
1. Frontend loads track geometry: `GET /api/sessions/{year}/{round}/track`
2. Frontend opens WebSocket: `WS /ws/replay/{year}/{round}`
3. Backend pre-computes all position frames (or streams from cache)
4. Client sends `play` → server streams frames at selected speed
5. Client sends `speed:5` → server adjusts frame rate
6. Client sends `seek:120.5` → server jumps to that timestamp
7. Client sends `pause` → server stops sending frames

### Frame Format (WebSocket)
```json
{
  "timestamp": 123.5,
  "lap": 15,
  "total_laps": 57,
  "status": "green",
  "drivers": [
    {
      "abbr": "VER",
      "x": 0.456,
      "y": 0.789,
      "color": "#3671C6",
      "position": 1,
      "compound": "MEDIUM",
      "tyre_life": 12
    }
  ]
}
```

## Upcoming Work

### 1. Pit Position Prediction (Leaderboard Feature)

**Goal:** Show where a driver would rejoin the field if they pit now.

**Precompute pit loss times per track** from 2025 data:
- Average pit loss (green flag) = average pit lap time - average clean lap time
- Average pit loss under Safety Car
- Average pit loss under Virtual Safety Car
- Store as static JSON per circuit (e.g. `pit_loss/{circuit_key}.json`)

**Runtime calculation** (server-side, not baked per-frame):
- For each driver: take gap-to-leader + pit loss for current track status
- Find which position that projected gap falls into among other drivers' gaps
- Return predicted position in the replay frame data

**Frontend:**
- New toggleable column on leaderboard showing predicted re-entry position (e.g. "P7")
- Leaderboard width increases to accommodate the new column
- Add toggle in settings under Leaderboard section

**Prerequisite:** 2025 precompute must finish to have the pit stop data to analyze.

### 2. 2026 Data Support

**Problem:** FastF1 v3.7.0 crashes on 2026 data because F1 removed DRS from 2026 cars. The telemetry channel `'45'` (DRS) no longer exists in the live timing feed, causing a `KeyError` in FastF1's `_api.py` that silently kills all telemetry and position data loading.

**What still works for 2026:** Session info, lap data, results, weather.
**What's broken:** Telemetry, car positions on track, track map data.

**Fix steps:**
1. **Upgrade Python to 3.10+** — FastF1 v3.8.0+ requires Python 3.10 minimum. Current venv is Python 3.9.
2. **Recreate virtualenv** with Python 3.10+ and reinstall all dependencies.
3. **Upgrade FastF1 to v3.8.1** — contains the fix (uses `.get('45', 0)` instead of `['45']`).
4. **Guard DRS references in `backend/services/f1_data.py`:**
   - Line ~716: `drs = tel["DRS"].values[...]` — needs fallback when DRS column doesn't exist
   - Line ~361: `result["drs"] = tel_sampled["DRS"].astype(int).tolist()` — same
   - Line ~346 already has `has_drs = "DRS" in tel.columns` but not all code paths use it
5. **Update frontend** `ReplayDriver` interface — `drs` field should be `number | null` instead of required
6. **Re-precompute 2026 sessions** after the fix

## Notes

- FastF1 data is only available for seasons 2018+
- First load of any session takes 30-60s (downloading from F1 servers). After that it's cached on disk and loads in seconds.
- The replay engine samples driver positions every 0.5 seconds from telemetry data
- Track coordinates are normalized to 0-1 range so the frontend can scale to any canvas size
- The project is at github.com/YarraPark/F1timing (private repo)
