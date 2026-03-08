import asyncio
import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import sessions, track, laps, results, replay, telemetry, sync
from services.auto_precompute import auto_precompute_loop

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background auto-precompute task
    task = asyncio.create_task(auto_precompute_loop())
    logger.info("Auto-precompute background task scheduled")
    yield
    # Cancel on shutdown
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="F1 Replay Timing API",
    description="Formula 1 race replay and telemetry data API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(sessions.router)
app.include_router(track.router)
app.include_router(laps.router)
app.include_router(results.router)
app.include_router(replay.router)
app.include_router(telemetry.router)
app.include_router(sync.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
