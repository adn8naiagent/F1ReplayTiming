<h1><img src="https://github.com/user-attachments/assets/158de3d0-8bd5-41a5-a34d-a3a92471cf96" width="50" align="absmiddle" /> F1 Replay Timing</h1>




https://github.com/user-attachments/assets/952b8634-2470-46d9-96e2-67a820459a49



A web app for watching Formula 1 sessions with real timing data, car positions on track, driver telemetry, and more - both live during race weekends and as replays of past sessions. Built with Next.js and FastAPI.

## Features

- **Live timing** (Beta) - connect to live F1 sessions during race weekends with real-time data from the F1 SignalR stream, including a broadcast delay slider and automatic detection of post-session replays
- **Track map** with real-time car positions from GPS telemetry, updating every 0.5 seconds with smooth interpolation, marshal sector flags, and toggleable corner numbers
- **Driver leaderboard** showing position, gap to leader, interval, last lap time, sector indicators (qualifying/practice), tyre compound and age, tyre history, pit stop count and live pit timer, grid position changes, fastest lap indicator, investigation/penalty status, and sub-1-second interval highlighting
- **Race control messages** - steward decisions, investigations, penalties, track limits, and flag changes displayed in a draggable overlay on the track map with optional sound notifications
- **Pit position prediction** estimates where a driver would rejoin if they pitted now, with predicted gap ahead and behind, using precomputed pit loss times per circuit with Safety Car and Virtual Safety Car adjustments
- **Telemetry** for unlimited drivers showing speed, throttle, brake, gear, and DRS (2025 and earlier) plotted against track distance, with a moveable side panel for 3+ driver comparisons
- **Lap Analysis** (Beta) compare lap times for up to two drivers with a line chart and lap-by-lap history, with pit stop and safety car periods highlighted. Race replay only
- **Picture-in-Picture** mode for a compact floating window with track map, race control, leaderboard, and telemetry
- **Broadcast sync** - match the replay to a recording of a session, either by uploading a screenshot of the timing tower (using AI vision) or by manually entering gap times
- **Weather data** including air and track temperature, humidity, wind, and rainfall status
- **Track status flags** for green, yellow, Safety Car, Virtual Safety Car, and red flag conditions
- **Playback controls** with 0.5x to 20x speed, skip buttons (5s, 30s, 1m, 5m), lap jumping, a progress bar, and red flag countdown with skip-to-restart
- **Session support** for races, qualifying, sprint qualifying, and practice sessions from 2024 onwards
- **Full screen mode** hides the session banner and enters browser fullscreen for a distraction-free view
- **Imperial units** toggle for °F and mph in settings
- **Passphrase authentication** to optionally restrict access when publicly hosted

## Architecture

- **Frontend**: Next.js (React) with Tailwind CSS — built as static files, served by the backend
- **Backend**: FastAPI (Python) — serves the API, WebSocket endpoints, and the frontend from a single port
- **Data Source**: [FastF1](https://github.com/theOehrly/Fast-F1) (used during data processing only)

Everything runs as a **single container on one port**. The frontend and backend are the same service — no cross-origin configuration, no CORS, no separate URLs to manage.

Session data is processed once and stored locally (or in Cloudflare R2 for persistence). You can either pre-compute data in bulk ahead of time, or let the app process sessions on demand when you select them.

## Self-Hosting Guide

### Quick start (Docker)

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

**1. Clone the repository:**

```bash
git clone <repo-url>
cd F1timing
```

**2. Configure:**

```bash
cp .env.example .env
```

Edit `.env` — the defaults work out of the box. Change `PORT` if you want a different port.

**3. Run:**

```bash
docker compose up
```

Open http://localhost:8000. Select any past session and it will be processed on demand.

The app runs as a single container on one port — no URL configuration required.

### Configuration

All configuration is managed through the `.env` file. No need to edit `docker-compose.yml`

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | Port the app runs on |
| `DATA_DIR` | `/data` | Where session data is stored |
| `STORAGE_MODE` | `local` | `local` stores data on disk, `r2` reads from Cloudflare R2 |
| `R2_ACCOUNT_ID` | | Cloudflare R2 account ID (only for `r2` mode) |
| `R2_ACCESS_KEY_ID` | | Cloudflare R2 access key (only for `r2` mode) |
| `R2_SECRET_ACCESS_KEY` | | Cloudflare R2 secret key (only for `r2` mode) |
| `R2_BUCKET_NAME` | `f1timingdata` | R2 bucket name |
| `AUTH_ENABLED` | `false` | Enable passphrase authentication |
| `AUTH_PASSPHRASE` | | Required passphrase when auth is enabled |
| `OPENROUTER_API_KEY` | | Enables photo sync feature ([get a key](https://openrouter.ai/)) |

### Reverse Proxy / Remote Access

The app serves everything (frontend, API, WebSocket) from a single port. Point your reverse proxy at the container port.

**Traefik:**
```yaml
services:
  f1timing:
    image: ghcr.io/adn8naiagent/f1replaytiming:latest
    env_file: .env
    volumes:
      - f1data:/data
      - f1cache:/data/fastf1-cache
    labels:
      - traefik.enable=true
      - traefik.http.routers.f1timing.rule=Host(`f1.example.com`)
      - traefik.http.routers.f1timing.entrypoints=websecure
      - traefik.http.routers.f1timing.tls.certresolver=letsencrypt
      - traefik.http.services.f1timing.loadbalancer.server.port=8000
```

**nginx:**
```nginx
server {
    server_name f1.example.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Cloudflare Tunnel:**
```bash
cloudflared tunnel --url http://localhost:8000
```

**Key points:**
- Single service, single port. No separate backend URL to configure
- WebSocket and HTTP are on the same origin. TLS termination works automatically
- No CORS headers needed. The frontend and API are the same service
- No `NEXT_PUBLIC_API_URL` or `FRONTEND_URL` variables to set

### Accessing from other devices on your network

Set `PORT` in your `.env` if needed, then access via your machine's IP:

```
http://192.168.1.50:8000
```

No other configuration required. The app uses relative URLs, so it works on any address.

### Pre-built Docker images

You can also use pre-built images instead of building from source:

```bash
# Pull and run directly
docker run -d -p 8000:8000 --env-file .env -v f1data:/data -v f1cache:/data/fastf1-cache ghcr.io/adn8naiagent/f1replaytiming:latest

# On a different port, pass PORT and map the same port on both sides
docker run -d -e PORT=9000 -p 9000:9000 --env-file .env -v f1data:/data -v f1cache:/data/fastf1-cache ghcr.io/adn8naiagent/f1replaytiming:latest
```

Or with docker-compose:

```yaml
services:
  f1timing:
    image: ghcr.io/adn8naiagent/f1replaytiming:latest
    ports:
      - "${PORT:-8000}:${PORT:-8000}"
    env_file: .env
    environment:
      PORT: ${PORT:-8000}
    volumes:
      - f1data:/data
      - f1cache:/data/fastf1-cache

volumes:
  f1data:
  f1cache:
```

### Cloud hosting (Railway, Vercel, Render, Fly.io, etc.)

Deploy as a single service. Most platforms will detect the `Dockerfile` at the project root automatically.

Set your environment variables in the platform's dashboard. R2 credentials are recommended since most cloud platforms have ephemeral filesystems, so locally computed session data would be lost on redeploy.

### Session data

Session data is persisted in a Docker volume, so it survives restarts.

**On-demand processing:** Simply select any past session from the homepage. If the data hasn't been processed yet, the app will automatically fetch and process it. The first load of a session takes **1-3 minutes**. After that, it's instant.

**Bulk pre-compute:** Use the CLI script to process sessions ahead of time:

```bash
# Process a specific race weekend
docker compose exec f1timing python precompute.py 2026 --round 1

# Process only the race session (skip practice/qualifying)
docker compose exec f1timing python precompute.py 2026 --round 1 --session R

# Process an entire season (will take several hours)
docker compose exec f1timing python precompute.py 2025 --skip-existing

# Process multiple years
docker compose exec f1timing python precompute.py 2024 2025 --skip-existing
```

**Re-computing a session:** Some updates (noted in the changelog as "requires re-compute") add new data to existing sessions. Re-run the same command **without** `--skip-existing` and it overwrites the stored session — that is the re-compute:

```bash
docker compose exec f1timing python precompute.py 2026 --round 1 --session R
```

This reprocesses from FastF1's local cache where available, so it usually does not re-download. To force a fresh pull from FastF1 (e.g. to pick up data F1 has since corrected), clear that session from `FASTF1_CACHE_DIR` first.

**Timing estimates:**
- A single session (e.g. one race) takes **1-3 minutes**
- A full race weekend (FP1, FP2, FP3, Qualifying, Race) takes **3-5 minutes**
- A complete season (~24 rounds, all sessions) takes **2-3 hours**

**Background auto-precompute:** On race weekends (Fri–Mon), a background task checks every 30 minutes for new session data and processes it ahead of time so the first click is instant. Which session types it fetches is controlled by the `AUTO_PRECOMPUTE` env var:

| Value | What it fetches |
|---|---|
| `off` | Nothing — everything is fetched on-demand the first time you click it |
| `race` | Race + sprint |
| `race+qual` | Race, sprint, qualifying, sprint qualifying — **default** |
| `all` | Every session including practice |

Sessions outside the configured set are still available — they're just processed on demand (with the usual 1–3 minute first-load wait) rather than pre-fetched.

### Manual setup (without Docker)

#### Prerequisites

- Python 3.10+
- Node.js 18+

#### 1. Clone and configure

```bash
git clone <repo-url>
cd F1timing
cp .env.example .env
# Edit .env with your settings
```

#### 2. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

This produces static files in `frontend/out/`.

#### 3. Start the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
STATIC_DIR=../frontend/out uvicorn main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000.

### Photo Sync Feature

The broadcast sync feature lets you match the replay to a recording of a session. You can always sync manually by entering gap times directly. To also enable photo/screenshot sync (where the app reads the timing tower from an image), set an [OpenRouter](https://openrouter.ai/) API key as `OPENROUTER_API_KEY`. It uses a vision model (Gemini Flash) to read the leaderboard from the photo. Any OpenRouter-compatible API key will work.

## Acknowledgements

This project is powered by [FastF1](https://github.com/theOehrly/Fast-F1), an open-source Python library for accessing Formula 1 timing and telemetry data. FastF1 is the original inspiration and data source for this project - without it, none of this would be possible.

## License

MIT

> **Disclaimer:** This project is intended for **personal, non-commercial use only**. This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.
