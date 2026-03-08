# F1 Replay Timing

A web app that lets you replay Formula 1 race sessions with real timing data, car positions on track, telemetry, and more. Built with Next.js and FastAPI. Intended for personal, non-commercial use.

## Architecture

- **Frontend**: Next.js (React) with Tailwind CSS
- **Backend**: FastAPI (Python) - serves pre-computed data from local storage or Cloudflare R2
- **Data Source**: [FastF1](https://github.com/theOehrly/Fast-F1) (used offline during pre-computation only)

Race data is pre-computed once and stored locally (or in R2 for remote access). The backend serves this static data with zero runtime computation.

## Self-Hosting Guide

### Prerequisites

- Python 3.9+
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

# Storage: "local" (default) or "r2"
STORAGE_MODE=local

# Local storage directory (only used when STORAGE_MODE=local)
DATA_DIR=./data

# Only needed for pre-compute script (not required at runtime)
FASTF1_CACHE_DIR=.fastf1-cache

# Optional - for photo sync feature
OPENROUTER_API_KEY=

# If using Cloudflare R2 storage, see the "Using Cloudflare R2" section
# below for additional required environment variables.
```

**Frontend** (`frontend/.env`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Pre-compute race data

This step downloads data from the F1 timing API via FastF1, processes it, and saves it locally. You only need to do this once per session — after that, the data is stored permanently.

**Timing estimates:**
- A single session (e.g. one race) takes **3–5 minutes**
- A full race weekend (FP1, FP2, FP3, Qualifying, Race) takes **15–25 minutes**
- A complete season (~24 rounds, all sessions) takes **6–10 hours**

We recommend starting with just the current season or specific rounds you're interested in, rather than processing everything upfront.

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Recommended: process the current season only
python precompute.py 2026 --skip-existing

# Process a specific race weekend
python precompute.py 2026 --round 1

# Process only the race session (skip practice/qualifying)
python precompute.py 2026 --round 1 --session R

# Process a full past season (will take several hours)
python precompute.py 2025 --skip-existing
```

Once processed, the backend never needs FastF1 again. The app also includes a background task that automatically checks for and processes new session data on race weekends (Friday–Monday), so you don't need to manually re-run the script after each race.

### 4. Start the backend

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

### Updating with new races

After a race weekend finishes, run the pre-compute script for that round:

```bash
python precompute.py 2025 --round 5 --skip-existing
```

### Using Cloudflare R2 (optional)

If you want to access your data remotely rather than from local files, you can use Cloudflare R2:

1. Create an R2 bucket in your Cloudflare dashboard
2. Create an API token with **Object Read & Write** permission
3. Add to your `backend/.env`:

```
STORAGE_MODE=r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=f1timingdata
```

4. Re-run the pre-compute script to upload data to R2

### Photo Sync Feature

The app includes a feature that lets you take a photo of your F1 TV broadcast's timing tower and sync the replay to that point. This requires an API key from [OpenRouter](https://openrouter.ai/) set as `OPENROUTER_API_KEY`. It uses a vision model (Gemini Flash) to read the leaderboard from the photo. Any OpenRouter-compatible API key will work.

## Acknowledgements

This project is powered by [FastF1](https://github.com/theOehrly/Fast-F1), an open-source Python library for accessing Formula 1 timing and telemetry data. FastF1 is the original inspiration and data source for this project - without it, none of this would be possible.

## Disclaimer

This project is intended for **personal, non-commercial use only**.

This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

## License

MIT
