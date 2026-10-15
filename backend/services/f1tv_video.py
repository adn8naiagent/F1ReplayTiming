"""F1 TV video lookups for the signed-in user (self-hosted only).

Everything here runs with the user's own subscription token and only asks
for content their subscription allows. Requests identify as this app: we
don't send F1's Origin/Referer or pretend to be F1's player. If F1 rejects
a request, the error goes back to the debug panel as-is.

F1 TV has no public API, so the paths below are configurable and the raw
responses are returned for debugging while this is a spike.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

import httpx

from services import f1tv_auth

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("F1TV_BASE_URL", "https://f1tv.formula1.com").rstrip("/")
API_PREFIX = os.environ.get("F1TV_API_PREFIX", "2.0/R/ENG/WEB_DASH/ALL").strip("/")
CONTENT_SUFFIX = os.environ.get("F1TV_CONTENT_SUFFIX", "F1_TV_Pro_Annual/14").strip("/")
USER_AGENT = "F1ReplayTiming (self-hosted)"

_PLAYBACK_TTL = 6 * 3600.0


class F1TVError(Exception):
    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass
class Playback:
    manifest_url: str
    license_url: str | None
    hosts: set[str] = field(default_factory=set)
    created: float = field(default_factory=time.time)


_playbacks: dict[str, Playback] = {}
_entitlement: tuple[str, str] | None = None  # (subscription token it came from, entitlement token)


def _token() -> str:
    token = f1tv_auth.get_token()
    if not token:
        raise F1TVError("Not signed in to F1 TV, or the token has expired", status=401)
    return token


def _headers(token: str, entitlement: str | None = None) -> dict[str, str]:
    headers = {"ascendontoken": token, "Accept": "application/json", "User-Agent": USER_AGENT}
    if entitlement:
        headers["entitlementtoken"] = entitlement
    return headers


async def _get(path: str, token: str, entitlement: str | None = None, params: dict | None = None) -> dict:
    url = f"{BASE_URL}/{API_PREFIX}/{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers(token, entitlement), params=params)
    try:
        body = resp.json()
    except ValueError:
        body = resp.text[:2000]
    if resp.status_code >= 400:
        raise F1TVError(f"F1 TV returned {resp.status_code} for {path}", status=resp.status_code, body=body)
    if not isinstance(body, dict):
        raise F1TVError(f"Unexpected response for {path}", status=resp.status_code, body=body)
    return body


async def _entitlement_token(token: str) -> str | None:
    global _entitlement
    if _entitlement and _entitlement[0] == token:
        return _entitlement[1]
    try:
        body = await _get("USER/ENTITLEMENT", token)
    except F1TVError as e:
        logger.warning("F1 TV entitlement lookup failed: %s", e)
        return None
    value = (body.get("resultObj") or {}).get("entitlementToken")
    if value:
        _entitlement = (token, value)
    return value


def parse_content_id(value: str) -> str:
    """Accept a content id or an F1 TV URL such as
    https://f1tv.formula1.com/detail/1000005512/2026-italian-grand-prix"""
    value = value.strip()
    if value.isdigit():
        return value
    for part in urllib.parse.urlparse(value).path.split("/"):
        if part.isdigit() and len(part) >= 6:
            return part
    raise F1TVError("Couldn't find a content id in that link", status=400)


def _channel_id(playback_url: str | None) -> str | None:
    if not playback_url:
        return None
    query = urllib.parse.urlparse(playback_url).query or playback_url.split("?", 1)[-1]
    return (urllib.parse.parse_qs(query).get("channelId") or [None])[0]


async def content(content_id: str) -> dict[str, Any]:
    """Title and available feeds (main + onboards) for a piece of content."""
    token = _token()
    body = await _get(f"CONTENT/VIDEO/{content_id}/{CONTENT_SUFFIX}", token)
    containers = (body.get("resultObj") or {}).get("containers") or []
    meta = (containers[0].get("metadata") if containers else None) or {}
    channels = []
    for s in meta.get("additionalStreams") or []:
        channels.append({
            "channel_id": _channel_id(s.get("playbackUrl")),
            "title": s.get("title") or s.get("reportingName"),
            "type": s.get("type"),
            "driver_number": s.get("racingNumber"),
            "driver_name": " ".join(p for p in (s.get("driverFirstName"), s.get("driverLastName")) if p) or None,
            "team": s.get("teamName"),
            "color": s.get("hex"),
        })
    emf = meta.get("emfAttributes") or {}
    return {
        "content_id": content_id,
        "title": meta.get("title") or meta.get("titleBrief"),
        "content_subtype": meta.get("contentSubtype"),
        "duration": meta.get("duration"),
        "channels": channels,
        "emf_attributes": {k: v for k, v in emf.items() if isinstance(v, (str, int, float)) and v != ""},
    }


def _register(manifest_url: str, license_url: str | None) -> str:
    now = time.time()
    for pid in [p for p, pb in _playbacks.items() if now - pb.created > _PLAYBACK_TTL]:
        del _playbacks[pid]
    pid = secrets.token_urlsafe(12)
    host = urllib.parse.urlparse(manifest_url).hostname or ""
    _playbacks[pid] = Playback(manifest_url=manifest_url, license_url=license_url, hosts={host})
    return pid


async def play(content_id: str, channel_id: str | None = None) -> dict[str, Any]:
    token = _token()
    entitlement = await _entitlement_token(token)
    params = {"contentId": content_id}
    if channel_id:
        params["channelId"] = channel_id
    body = await _get("CONTENT/PLAY", token, entitlement, params=params)
    result = body.get("resultObj") or {}
    manifest = result.get("url")
    if not manifest:
        raise F1TVError("F1 TV didn't return a stream URL", body=_redact(result))
    license_url = result.get("laURL")
    pid = _register(manifest, license_url)
    return {
        "playback_id": pid,
        "manifest_url": manifest,
        "license_url": license_url,
        "stream_type": result.get("streamType"),
        "drm_type": result.get("drmType"),
        "entitlement_token_used": entitlement is not None,
        "raw": _redact(result),
    }


def _redact(obj: Any) -> Any:
    """Drop token-like values before sending a response to the debug panel."""
    if isinstance(obj, dict):
        return {k: ("…" if "token" in k.lower() else _redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


def get_playback(pid: str) -> Playback:
    pb = _playbacks.get(pid)
    if pb is None:
        raise F1TVError("Unknown or expired playback", status=404)
    return pb


async def license(pid: str, challenge: bytes) -> tuple[int, bytes, str]:
    """Forward a Widevine licence challenge for the user's own playback."""
    pb = get_playback(pid)
    if not pb.license_url:
        raise F1TVError("This stream has no licence URL", status=400)
    token = _token()
    entitlement = await _entitlement_token(token)
    headers = _headers(token, entitlement)
    headers["Content-Type"] = "application/octet-stream"
    headers["Accept"] = "*/*"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(pb.license_url, content=challenge, headers=headers)
    return resp.status_code, resp.content, resp.headers.get("content-type", "application/octet-stream")


def relay_allowed(pb: Playback, host: str) -> bool:
    return host in pb.hosts
