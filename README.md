<h1><img src="https://github.com/user-attachments/assets/158de3d0-8bd5-41a5-a34d-a3a92471cf96" width="50" align="absmiddle" /> F1 Replay Timing</h1>




https://github.com/user-attachments/assets/952b8634-2470-46d9-96e2-67a820459a49



> **Disclaimer:** This project is intended for **personal, non-commercial use only**. This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

A web app for watching Formula 1 sessions with real timing data, car positions on track, driver telemetry, and more - both live during race weekends and as replays of past sessions. Built with Next.js and FastAPI.

## Features

- **Live timing** (Beta) - connect to live F1 sessions during race weekends with real-time data from the F1 SignalR stream, including a broadcast delay slider and automatic detection of post-session replays
- **Track map** with real-time car positions from GPS telemetry, updating every 0.5 seconds with smooth interpolation
- **Driver leaderboard** showing position, gap to leader, interval, tyre compound and age, tyre history, pit stop count, grid position changes, fastest lap indicator, and investigation/penalty status
- **Race control messages** - steward decisions, investigations, penalties, track limits, and flag changes displayed in a resizable overlay on the track map
- **Pit position prediction** (Beta) estimates where a driver would rejoin if they pitted now, with predicted gap ahead and behind, using precomputed pit loss times per circuit with Safety Car and Virtual Safety Car adjustments
- **Telemetry** for any driver showing speed, throttle, brake, gear, and DRS (2025 and earlier) plotted against track distance
- **Picture-in-Picture** mode for a compact floating window with track map, race control, leaderboard, and telemetry
- **Broadcast sync** - match the replay to a recording of a session by uploading a screenshot, entering gap times manually, or auto-syncing live from OpenWebIF
- **Weather data** including air and track temperature, humidity, wind, and rainfall status
- **Track status flags** for green, yellow, Safety Car, Virtual Safety Car, and red flag conditions
- **Playback controls** with 0.5x to 20x speed, skip buttons (5s, 30s, 1m, 5m), lap jumping, and a progress bar
- **Session support** for races, qualifying, sprint qualifying, and practice sessions from 2024 onwards
- **Passphrase authentication** to optionally restrict access when publicly hosted

## Architecture

- **Frontend**: Next.js (React) with Tailwind CSS
- **Backend**: FastAPI (Python) - serves pre-computed data from local storage or Cloudflare R2
- **Data Source**: [FastF1](https://github.com/theOehrly/Fast-F1) (used during data processing only)

Session data is processed once and stored locally (or in R2 for remote access). You can either pre-compute data in bulk ahead of time, or let the app process sessions on demand when you select them.

## Self-Hosting Guide

### Option A: Docker with pre-built images (easiest)

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

Create a `docker-compose.yml` file:

```yaml
x-openwebif-url: &openwebif_url ""  # Optional default OpenWebIF box URL, for example http://192.168.1.50

services:
  backend:
    image: ghcr.io/adn8naiagent/f1replaytiming-backend:latest
    ports:
      - "8000:8000"
    environment:
      FRONTEND_URL: http://localhost:3000
      DATA_DIR: /data
      OPENWEBIF_URL: *openwebif_url
    volumes:
      - f1data:/data
      - f1cache:/data/fastf1-cache

  frontend:
    image: ghcr.io/adn8naiagent/f1replaytiming-frontend:latest
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000  # Change to your backend URL if not using localhost
      NEXT_PUBLIC_OPENWEBIF_URL: *openwebif_url
    depends_on:
      - backend

volumes:
  f1data:
  f1cache:
```

Then run:

```bash
docker compose up
```

Open http://localhost:3000. Select any past session and it will be processed on demand.

### Option B: Docker from source

If you prefer to build the images yourself, or want to make changes to the code:

```bash
git clone <repo-url>
cd F1timing
docker compose up
```

Open http://localhost:3000. Select any past session and it will be processed on demand.

### Docker configuration

#### Network & URL configuration

Two required environment variables control how the frontend and backend find each other:

| Variable | Set on | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | The URL your **browser** uses to reach the backend |
| `FRONTEND_URL` | backend | The URL your browser uses to reach the frontend (needed for CORS) |

The defaults (`http://localhost:8000` and `http://localhost:3000`) work when accessing the app on the same machine running Docker. If you access from another device, use a reverse proxy, or change ports, update both variables to match.

**Example — accessing from other devices on your network:**
```yaml
backend:
  environment:
    - FRONTEND_URL=http://192.168.1.50:3000

frontend:
  environment:
    - NEXT_PUBLIC_API_URL=http://192.168.1.50:8000
```

**Example — behind a reverse proxy (e.g. Cloudflare Tunnel, nginx):**
```yaml
backend:
  environment:
    - FRONTEND_URL=https://f1.example.com

frontend:
  environment:
    - NEXT_PUBLIC_API_URL=https://api.f1.example.com
```

In this setup your reverse proxy routes `f1.example.com` to the frontend container (port 3000) and `api.f1.example.com` to the backend container (port 8000).

#### OpenWebIF auto-sync configuration

If you want the Auto Sync tab to start with your OpenWebIF box URL already filled in, and to let the backend fall back to that same URL, set these optional variables:

| Variable | Set on | Purpose |
|---|---|---|
| `NEXT_PUBLIC_OPENWEBIF_URL` | frontend | Prefills the Auto Sync form with your default OpenWebIF URL |
| `OPENWEBIF_URL` | backend | Default OpenWebIF URL used when the request body omits it |

If you use the `x-openwebif-url` anchor from the example `docker-compose.yml`, you only need to edit that one line.

#### Optional features

- `OPENWEBIF_URL` / `NEXT_PUBLIC_OPENWEBIF_URL` - optional default OpenWebIF URL for the Auto Sync feature
- `OPENROUTER_API_KEY` - enables the photo sync feature ([get a key](https://openrouter.ai/))
- `AUTH_ENABLED` / `AUTH_PASSPHRASE` - restricts access with a passphrase

#### Data

Session data is persisted in a Docker volume, so it survives restarts.

To pre-process session data in bulk (instead of on demand), use the precompute script:

```bash
# Process a specific race weekend
docker compose exec backend python precompute.py 2026 --round 1

# Process only the race session (skip practice/qualifying)
docker compose exec backend python precompute.py 2026 --round 1 --session R

# Process an entire season (will take several hours)
docker compose exec backend python precompute.py 2025 --skip-existing

# Process multiple years
docker compose exec backend python precompute.py 2024 2025 --skip-existing
```

### Option C: Manual setup

#### Prerequisites

- Python 3.10+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai/) API key (optional, enables photo/screenshot sync - manual entry sync works without this)

#### 1. Clone the repository

```bash
git clone <repo-url>
cd F1timing
```

#### 2. Configure environment variables

**Backend** (`backend/.env`):
```
FRONTEND_URL=http://localhost:3000
PORT=8000
DATA_DIR=./data

# Optional - default OpenWebIF URL for Auto Sync
OPENWEBIF_URL=http://192.168.1.50

# Optional - enables photo/screenshot sync (manual entry sync works without this)
# Get a key from https://openrouter.ai/
OPENROUTER_API_KEY=

# Optional - restrict access with a passphrase
AUTH_ENABLED=false
AUTH_PASSPHRASE=
```

**Frontend** (`frontend/.env`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000

# Optional - prefill the Auto Sync form with your OpenWebIF box URL
NEXT_PUBLIC_OPENWEBIF_URL=http://192.168.1.50
```


#### 3. Install dependencies and start

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

#### 4. Getting session data

There are two ways to get session data into the app:

#### Option A: On-demand processing (recommended for getting started)

Simply select any past session from the homepage. If the data hasn't been processed yet, the app will automatically fetch and process it using FastF1 and start the replay. The first load of a session takes **1-3 minutes**. After that, it's instant.

#### Option B: Bulk pre-compute (recommended for preparing a full season)

Use the CLI script to process sessions ahead of time. This is useful if you want all data ready before you start using the app.

```bash
cd backend
source venv/bin/activate

# Process a specific race weekend
python precompute.py 2026 --round 1

# Process only the race session (skip practice/qualifying)
python precompute.py 2026 --round 1 --session R

# Process an entire season (will take several hours)
python precompute.py 2025 --skip-existing

# Process multiple years
python precompute.py 2024 2025 --skip-existing
```

**Timing estimates:**
- A single session (e.g. one race) takes **1-3 minutes**
- A full race weekend (FP1, FP2, FP3, Qualifying, Race) takes **3-5 minutes**
- A complete season (~24 rounds, all sessions) takes **2-3 hours**

The app also includes a background task that automatically checks for and processes new session data on race weekends (Friday–Monday).

#### Broadcast Sync Features

The broadcast sync feature supports three modes:

- Manual entry, which works without any extra configuration
- Photo/screenshot sync, which requires an [OpenRouter](https://openrouter.ai/) API key as `OPENROUTER_API_KEY`
- OpenWebIF auto sync, which can be preconfigured with `OPENWEBIF_URL` and `NEXT_PUBLIC_OPENWEBIF_URL`

Photo/screenshot sync uses a vision model (Gemini Flash) to read the leaderboard from the image. Any OpenRouter-compatible API key will work.

## Acknowledgements

This project is powered by [FastF1](https://github.com/theOehrly/Fast-F1), an open-source Python library for accessing Formula 1 timing and telemetry data. FastF1 is the original inspiration and data source for this project - without it, none of this would be possible.

## License

MIT
