import asyncio
import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from auth import is_auth_enabled, verify_token
from routers import sessions, track, laps, results, replay, telemetry, sync, live, live_status
from routers import auth_routes
from services.auto_precompute import auto_precompute_loop, get_allowed_session_types
from services.retention import retention_loop

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    allowed = get_allowed_session_types()
    task: asyncio.Task | None = None
    if allowed:
        task = asyncio.create_task(auto_precompute_loop())
        logger.info(f"Auto-precompute scheduled for session types: {sorted(allowed)}")
    else:
        logger.info("Auto-precompute disabled (AUTO_PRECOMPUTE=off)")
    # Runs regardless of AUTO_PRECOMPUTE: someone who turned auto-download off
    # is exactly who is most likely to be managing disk space.
    retention_task = asyncio.create_task(retention_loop())

    yield

    for t in (task, retention_task):
        if t is not None:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="F1 Replay Timing API",
    description="Formula 1 race replay and telemetry data API",
    version="1.0.0",
    lifespan=lifespan,
)

# Auth middleware (skip auth endpoints, health, and WebSocket upgrades)
AUTH_SKIP_PATHS = {"/api/auth/status", "/api/auth/login", "/api/health"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not is_auth_enabled():
        return await call_next(request)
    # Only enforce auth on API paths — static frontend files are public
    if not request.url.path.startswith("/api/"):
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
app.include_router(live.router)
app.include_router(live_status.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Redirect old URL format (/replay/2026/5?type=R -> /replay?year=2026&round=5&type=R)
@app.get("/replay/{year}/{round}")
async def redirect_replay(year: int, round: int, type: str = "R"):
    return RedirectResponse(f"/replay?year={year}&round={round}&type={type}")


@app.get("/live/{year}/{round}")
async def redirect_live(year: int, round: int, type: str = "R"):
    return RedirectResponse(f"/live?year={year}&round={round}&type={type}")


@app.get("/results/{year}/{round}")
async def redirect_results(year: int, round: int, type: str = "R"):
    return RedirectResponse(f"/results?year={year}&round={round}&type={type}")


# Serve static frontend files (unified container mode)
STATIC_DIR = Path(os.environ.get("STATIC_DIR", "/app/static"))

if STATIC_DIR.exists():
    # Mount Next.js static assets
    next_static = STATIC_DIR / "_next"
    if next_static.exists():
        app.mount("/_next", StaticFiles(directory=str(next_static)), name="next-static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve frontend static files with SPA fallback."""
        # Try exact file match
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        # Try with .html extension (Next.js static export produces replay.html, etc.)
        html_path = STATIC_DIR / f"{full_path}.html"
        if html_path.is_file():
            return FileResponse(str(html_path))
        # Try directory with index.html
        index_path = STATIC_DIR / full_path / "index.html"
        if index_path.is_file():
            return FileResponse(str(index_path))
        # SPA fallback — serve root index.html
        root_index = STATIC_DIR / "index.html"
        if root_index.is_file():
            return FileResponse(str(root_index))
        return JSONResponse(status_code=404, content={"detail": "Not found"})
