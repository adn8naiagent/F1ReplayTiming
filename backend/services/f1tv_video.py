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
import re
import secrets
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

import httpx

from services import f1_account

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
    token = f1_account.get_token()
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


# Our session types and the names on the season calendar
_SESSION_NAMES = {
    "R": ("Race",),
    "Q": ("Qualifying",),
    "S": ("Sprint",),
    "SQ": ("Sprint Qualifying", "Sprint Shootout"),
    "FP1": ("Practice 1",),
    "FP2": ("Practice 2",),
    "FP3": ("Practice 3",),
}


def _session_start(year: int, round_num: int, session_type: str) -> float | None:
    """The session's scheduled start (epoch seconds), from the stored calendar."""
    from services.schedule import schedule_path
    from services.storage import get_json

    names = _SESSION_NAMES.get(session_type, ())
    for event in (get_json(schedule_path(year)) or {}).get("events", []):
        if event.get("round_number") != round_num:
            continue
        for sess in event.get("sessions", []):
            if sess.get("name") in names and sess.get("date_utc"):
                from datetime import datetime
                return datetime.fromisoformat(sess["date_utc"].replace("Z", "+00:00")).timestamp()
    return None


async def find_replay(year: int, round_num: int, session_type: str) -> dict[str, Any] | None:
    """The F1 TV replay of a session: F1 TV's replays for that round, the
    Formula 1 one (with onboards) whose start time is closest to the
    session's. None if there isn't one (yet)."""
    start = _session_start(year, round_num, session_type)
    if start is None:
        return None
    body = await _get("PAGE/SEARCH/VOD/F1_TV_Pro_Annual/14", _token(), params={
        "filter_objectSubtype": "Replay",
        "filter_season": str(year),
        "filter_Meeting_Number": str(round_num),
    })
    best: tuple[tuple[bool, float], dict] | None = None
    for c in (body.get("resultObj") or {}).get("containers") or []:
        meta = c.get("metadata") or {}
        emf = meta.get("emfAttributes") or {}
        if emf.get("Series") != "FORMULA 1" or not emf.get("sessionStartDate"):
            continue
        gap = abs(float(emf["sessionStartDate"]) / 1000 - start)
        if gap > 3 * 3600:
            continue
        # The session itself has onboards; the shows around it don't
        rank = (not emf.get("OBC"), gap)
        if best is None or rank < best[0]:
            best = (rank, {"content_id": str(meta.get("contentId")), "title": meta.get("title")})
    return best[1] if best else None


async def find_live(year: int, round_num: int, session_type: str) -> dict[str, Any] | None:
    """The F1 TV live stream of a session: the live events on F1 TV's home
    page for that round, the Formula 1 one whose start time is closest to the
    session's (not the shows before and after it). None if there isn't one.
    F1 TV only has the stream's details once it's live."""
    start = _session_start(year, round_num, session_type)
    if start is None:
        return None
    body = await _get("PAGE/395/F1_TV_Pro_Annual/14", _token())
    best: tuple[float, dict] | None = None

    def walk(o: Any) -> None:
        nonlocal best
        if isinstance(o, dict):
            meta = o.get("metadata")
            # LIVE_EVENT before it starts, LIVE once it's on
            if isinstance(meta, dict) and (meta.get("contentSubtype") or "").upper() in ("LIVE_EVENT", "LIVE"):
                emf = meta.get("emfAttributes") or {}
                if (emf.get("Series") == "FORMULA 1" and str(emf.get("Meeting_Number")) == str(round_num)
                        and emf.get("sessionStartDate")):
                    gap = abs(float(emf["sessionStartDate"]) / 1000 - start)
                    if gap <= 3 * 3600 and (best is None or gap < best[0]):
                        best = (gap, {"content_id": str(meta.get("contentId")), "title": meta.get("title")})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(body)
    return best[1] if best else None


def _register(manifest_url: str, license_url: str | None) -> str:
    now = time.time()
    for pid in [p for p, pb in _playbacks.items() if now - pb.created > _PLAYBACK_TTL]:
        del _playbacks[pid]
    pid = secrets.token_urlsafe(12)
    host = urllib.parse.urlparse(manifest_url).hostname or ""
    _playbacks[pid] = Playback(manifest_url=manifest_url, license_url=license_url, hosts={host})
    return pid


async def _video_start_utc(manifest_url: str) -> float | None:
    """The real time (epoch seconds) at the video's 0:00. F1 TV's replays
    are cut from the live stream, whose media timeline is epoch time: the
    manifest's presentationTimeOffset / timescale. Falls back to the URL's
    start parameter."""
    for _ in range(2):  # the CDN occasionally answers with something else
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                xml = (await client.get(manifest_url)).text
        except Exception as e:
            logger.warning("Couldn't read the F1 TV manifest's start time: %s", e)
            continue
        tag = re.search(r"<SegmentTemplate[^>]*>", xml)
        if tag:
            scale = re.search(r'timescale="(\d+)"', tag.group(0))
            offset = re.search(r'presentationTimeOffset="(\d+)"', tag.group(0))
            if scale and offset and int(scale.group(1)) > 0:
                t = int(offset.group(1)) / int(scale.group(1))
                if t > 1e9:  # an epoch time, not a programme-relative one
                    return t
    start = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(manifest_url).query)).get("start")
    return float(start) if start and start.isdigit() else None


async def play(content_id: str, channel_id: str | None = None) -> dict[str, Any]:
    token = _token()
    entitlement = await _entitlement_token(token)
    params = {"contentId": content_id}
    if channel_id:
        params["channelId"] = channel_id
    try:
        body = await _get("CONTENT/PLAY", token, entitlement, params=params)
    except F1TVError as e:
        if e.status in (401, 403, 404):
            logger.warning("F1 TV refused to play %s (channel %s): HTTP %s %s", content_id, channel_id, e.status, _redact(e.body))
            raise F1TVError(_play_refusal(e.body, e.status), status=e.status, body=_redact(e.body)) from e
        raise
    result = body.get("resultObj") or {}
    manifest = result.get("url")
    if not manifest:
        logger.warning("F1 TV gave no stream for %s (channel %s): %s", content_id, channel_id,
                       _redact({k: v for k, v in body.items() if k != "resultObj"}))
        raise F1TVError(_play_refusal(body, None), status=403, body=_redact(body))
    license_url = result.get("laURL")
    pid = _register(manifest, license_url)
    return {
        "playback_id": pid,
        "manifest_url": manifest,
        "license_url": license_url,
        "stream_type": result.get("streamType"),
        "drm_type": result.get("drmType"),
        "entitlement_token_used": entitlement is not None,
        "video_start_utc": await _video_start_utc(manifest),
        "raw": _redact(result),
    }


def _play_refusal(body: Any, status: int | None) -> str:
    """A plain message for F1 TV refusing to play a video, with F1 TV's own
    reason when it gives one."""
    reason, code = "", ""
    if isinstance(body, dict):
        reason = str(body.get("errorDescription") or body.get("message") or "").strip()
        code = str(body.get("resultCode") or "").strip()
        if reason.isdigit():  # "message" is sometimes just the HTTP status
            reason = ""
    said = f" F1 TV said: \"{reason}\"{f' ({code})' if code and code != 'OK' else ''}." if reason else ""
    text = f"{reason} {code}".lower()
    if status == 401:
        return "F1 TV's sign-in has expired. Sign in to F1 TV again." + said
    if any(w in text for w in ("geo", "country", "region", "location", "territor", "not available in")):
        return ("F1 TV won't stream this video where your connection appears to be. F1 TV decides by "
                "your internet address, so a VPN set to another country can cause this. Turn the VPN "
                "off or set it to your own country, then retry." + said)
    if any(w in text for w in ("entitle", "subscri", "upgrade", "tier", "package")):
        return ("Your F1 TV plan doesn't include this video. Video needs F1 TV Pro or Premium." + said)
    if any(w in text for w in ("concurren", "simultaneous", "device limit", "too many")):
        return ("F1 TV is already playing too many videos on this account. Close F1 TV on other "
                "devices, or show fewer onboards, then retry." + said)
    return ("F1 TV wouldn't stream this video." + (said or " It gave no reason.") +
            " The usual cause is where your connection appears to be: F1 TV only streams in some "
            "countries, and a VPN can make you appear elsewhere. If you're on a VPN, turn it off or "
            "set it to your own country, then retry.")


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
