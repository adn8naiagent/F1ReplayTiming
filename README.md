<h1><img src="https://github.com/user-attachments/assets/158de3d0-8bd5-41a5-a34d-a3a92471cf96" width="50" align="absmiddle" /> F1 Replay Timing</h1>

> **Disclaimer:** This project is intended for **personal, non-commercial use only**. This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

A web app that lets you replay past Formula 1 sessions with real timing data, car positions on track, driver telemetry, and more. Built with Next.js and FastAPI.

## Features

- **Track map** with real-time car positions from GPS telemetry, updating every 0.5 seconds with smooth interpolation
- **Driver leaderboard** sourced from the official F1 live timing feed, showing position, gap to leader, tyre compound and age, tyre history, pit stop count, grid position changes, and fastest lap indicator
- **Pit position prediction** (Beta) estimates where a driver would rejoin if they pitted now, using precomputed pit loss times per circuit with Safety Car and Virtual Safety Car adjustments
- **Telemetry** for any driver showing speed, throttle, brake, gear, and DRS (2025 and earlier) plotted against track distance
- **Broadcast sync** lets you match the replay to a live broadcast or recording, either by uploading a screenshot of the timing tower (using AI vision) or by manually entering gap times
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

### Prerequisites

- Python 3.10+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai/) API key (optional, for the photo sync feature)

### 1. Clone the repository

```bash
git clone <repo-url>
cd F1timing
```

### 2. Configure environment variables

**Backend** (`backend/.env`):
```
FRONTEND_URL=http://localhost:3000
PORT=8000
DATA_DIR=./data

# Optional - enables the photo sync feature
# Get a key from https://openrouter.ai/
OPENROUTER_API_KEY=

# Optional - restrict access with a passphrase
AUTH_ENABLED=false
AUTH_PASSPHRASE=
```

**Frontend** (`frontend/.env`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```


### 3. Install dependencies and start

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

### 4. Getting session data

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

### Photo Sync Feature

The app includes a feature that lets you take a photo of your F1 TV broadcast's timing tower and sync the replay to that point. This requires an API key from [OpenRouter](https://openrouter.ai/) set as `OPENROUTER_API_KEY`. It uses a vision model (Gemini Flash) to read the leaderboard from the photo. Any OpenRouter-compatible API key will work.

## Acknowledgements

This project is powered by [FastF1](https://github.com/theOehrly/Fast-F1), an open-source Python library for accessing Formula 1 timing and telemetry data. FastF1 is the original inspiration and data source for this project - without it, none of this would be possible.

## License

MIT
