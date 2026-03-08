import asyncio
import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth import is_auth_enabled, verify_token
from routers import sessions, track, laps, results, replay, telemetry, sync
from routers import auth_routes
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
extra_origins = [o.strip() for o in os.environ.get("EXTRA_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000"] + extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth middleware (skip auth endpoints, health, and WebSocket upgrades)
AUTH_SKIP_PATHS = {"/api/auth/status", "/api/auth/login", "/api/health"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not is_auth_enabled():
        return await call_next(request)
    if request.url.path in AUTH_SKIP_PATHS:
        return await call_next(request)
    # Let CORS preflight through — CORSMiddleware handles these
    if request.method == "OPTIONS":
        return await call_next(request)
    # WebSocket upgrades are handled separately in the replay router
    if request.headers.get("upgrade", "").lower() == "websocket":
        return await call_next(request)
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not verify_token(token):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


# Routers
app.include_router(auth_routes.router)
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
