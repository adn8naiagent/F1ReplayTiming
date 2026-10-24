import asyncio
import hmac
import os
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from app_config import (
    PAYWALL_SINCE,
    is_public_mode,
    public_archive_last,
    origin_secret,
    photo_sync_available,
    replay_player,
    retention_sweep_enabled,
)
from auth import is_auth_enabled, verify_token
from routers import sessions, track, laps, results, replay, replay_data, telemetry, sync, live, live_status
from routers import auth_routes
from routers import f1_account as f1_account_routes
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
    # is exactly who is most likely to be managing disk space. Instances that
    # share a bucket with another one can switch it off.
    retention_task: asyncio.Task | None = None
    if retention_sweep_enabled():
        retention_task = asyncio.create_task(retention_loop())
    else:
        logger.info("Retention sweep disabled (RETENTION_SWEEP_ENABLED=false)")
    if is_public_mode():
        logger.info("Public mode: admin, processing, photo sync and live timing are off")

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
AUTH_SKIP_PATHS = {"/api/auth/status", "/api/auth/login", "/api/health", "/api/config"}

# Admin and processing endpoints, switched off in public mode.
_SESSION = r"/api/sessions/\d+/\d+"
PUBLIC_MODE_BLOCKED = [
    ("POST", re.compile(_SESSION + r"/reprocess$")),
    ("GET", re.compile(_SESSION + r"/reprocess/status$")),
    ("DELETE", re.compile(_SESSION + r"$")),
    ("POST", re.compile(_SESSION + r"/sync-photo$")),
    (None, re.compile(r"/api/storage(/.*)?$")),
    (None, re.compile(r"/api/f1tv(/.*)?$")),
]


def _blocked_in_public_mode(method: str, path: str) -> bool:
    return any((m is None or m == method) and rx.match(path) for m, rx in PUBLIC_MODE_BLOCKED)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if is_public_mode() and _blocked_in_public_mode(request.method, request.url.path):
        return JSONResponse(status_code=403, content={"detail": "Not available on this site"})
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


class OriginSecretMiddleware:
    """Refuse requests that didn't come through the proxy holding the secret.

    When ORIGIN_SECRET is set, every HTTP request and WebSocket must carry a
    matching X-Origin-Secret header (added by a Cloudflare request header
    rule), so nobody can reach the server directly and skip the proxy.
    /api/health stays open for the platform's health check.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        secret = origin_secret()
        if not secret or scope["type"] not in ("http", "websocket") or scope.get("path") == "/api/health":
            return await self.app(scope, receive, send)

        sent = ""
        for name, value in scope.get("headers", []):
            if name == b"x-origin-secret":
                sent = value.decode("latin-1")
                break
        if hmac.compare_digest(sent.encode(), secret.encode()):
            return await self.app(scope, receive, send)

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4403})
            return
        await JSONResponse(status_code=403, content={"detail": "Forbidden"})(scope, receive, send)


# Outermost first: origin check, then compression (skips responses that are
# already gzipped, such as replay chunks passed through from R2).
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
app.add_middleware(OriginSecretMiddleware)


@app.middleware("http")
async def static_cache_headers(request: Request, call_next):
    response = await call_next(request)
    # Next.js build assets have content hashes in their names, so they never change.
    if request.url.path.startswith("/_next/static/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


# Routers
app.include_router(auth_routes.router)
app.include_router(sessions.router)
app.include_router(track.router)
app.include_router(laps.router)
app.include_router(results.router)
app.include_router(replay.router)
app.include_router(replay_data.router)
app.include_router(telemetry.router)
app.include_router(sync.router)
app.include_router(live.router)
app.include_router(live_status.router)
app.include_router(f1_account_routes.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/config")
async def app_config():
    """Settings the frontend needs at runtime (the frontend is a static build)."""
    public = is_public_mode()
    last = public_archive_last() if public else None
    return {
        "public_mode": public,
        "replay_player": replay_player(),
        "photo_sync": photo_sync_available(),
        "live": not public,
        # F1 TV sign-in for downloading session data (self-hosted only)
        "f1tv": not public,
        # Public sites only: the last round served, since F1 put timing data behind F1 TV.
        "public_archive": {
            "year": last[0],
            "round": last[1],
            "event_name": await sessions.event_name(last[0], last[1]),
            "paywall_since": PAYWALL_SINCE,
        } if last else None,
    }


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

    _html_cache: dict[Path, str] = {}

    def _page(path: Path) -> HTMLResponse:
        """An HTML page, revalidated on every visit so it never points at the
        build assets of an earlier deploy. Public sites without a passphrase get
        a flag so the page can skip the login check."""
        if path not in _html_cache:
            html = path.read_text()
            if is_public_mode() and not is_auth_enabled():
                html = html.replace("<head>", "<head><script>window.__PUBLIC_MODE__=true</script>", 1)
            _html_cache[path] = html
        return HTMLResponse(_html_cache[path], headers={"Cache-Control": "no-cache"})

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve frontend static files with SPA fallback."""
        # Try exact file match
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return _page(file_path) if file_path.suffix == ".html" else FileResponse(str(file_path))
        # Try with .html extension (Next.js static export produces replay.html, etc.)
        html_path = STATIC_DIR / f"{full_path}.html"
        if html_path.is_file():
            return _page(html_path)
        # Try directory with index.html
        index_path = STATIC_DIR / full_path / "index.html"
        if index_path.is_file():
            return _page(index_path)
        # SPA fallback — serve root index.html
        root_index = STATIC_DIR / "index.html"
        if root_index.is_file():
            return _page(root_index)
        return JSONResponse(status_code=404, content={"detail": "Not found"})
