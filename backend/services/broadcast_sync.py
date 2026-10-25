"""Lining F1 TV's replay video up with the timing, from the engine sound.

An onboard camera's audio is mostly its car's engine, whose pitch follows
the RPM in the timing data. So for a stretch where a driver is on a flying
lap, the video time where the onboard's sound best matches their RPM gives
the offset: video time = replay time + offset. Every feed of a session
(broadcast, onboards, tracker) shares one timeline, so this syncs them all.

F1 TV's replay manifests don't carry real times reliably, which is why
this doesn't use them. The result is stored next to the session, so it's
worked out once.
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
import time
import urllib.parse
from typing import Any

import httpx
import numpy as np

from services import f1tv_video
from services.storage import aget_json, put_json

logger = logging.getLogger(__name__)

_HOP_S = 0.1
_WIN = 2048
_SR = 12000  # decoded at this rate: the harmonics used are below 3kHz
_LOG_STEP = 0.005  # frequency resolution of the comparison, in log units
_WINDOW_S = 120.0  # how much of a flying lap to compare
_MIN_RPM = 9000
# Laps repeat, so a lap later can match nearly as well. A match counts when
# it clearly beats every other offset, and two drivers agree this closely
# (if they don't, more drivers are tried); the result is their middle value.
_MARGIN = 5.0
_AGREE_S = 0.3

_running: dict[str, asyncio.Task] = {}
# Failed attempts: (reason, when). Tried again after a while, as F1 TV can
# make a replay available later
_failed: dict[str, tuple[str, float]] = {}
_RETRY_AFTER_S = 30 * 60


def _path(year: int, round_num: int, session_type: str) -> str:
    return f"sessions/{year}/{round_num}/{session_type}/broadcast_sync.json"


async def _rpm_traces(year: int, round_num: int, session_type: str) -> tuple[dict[str, tuple[np.ndarray, np.ndarray]], float]:
    """Each driver's RPM through the replay (abbr -> (replay times, rpm)),
    and the replay's length."""
    base = f"sessions/{year}/{round_num}/{session_type}/replay"
    manifest = await aget_json(base + "/manifest.json")
    if not manifest:
        raise RuntimeError("This session hasn't been processed")
    traces: dict[str, tuple[list, list]] = {}
    sem = asyncio.Semaphore(8)

    async def chunk(index: int):
        async with sem:
            return await aget_json(f"{base}/{manifest['version']}/chunk-{index:04d}.json") or []

    for frames in await asyncio.gather(*[chunk(c["index"]) for c in manifest["chunks"]]):
        for frame in frames:
            for d in frame.get("drivers", []):
                t, r = traces.setdefault(d["abbr"], ([], []))
                t.append(frame["timestamp"])
                r.append(d.get("rpm") or 0.0)
    out = {}
    for abbr, (t, r) in traces.items():
        order = np.argsort(t)
        out[abbr] = (np.asarray(t, float)[order], np.asarray(r, float)[order])
    return out, float(manifest.get("total_time") or 0.0)


def _flying_windows(ts: np.ndarray, rpm: np.ndarray, count: int = 3) -> list[float]:
    """Starts of stretches with the engine working hard throughout (spread
    through the session)."""
    n = int(_WINDOW_S / 0.5)
    hard = rpm > _MIN_RPM
    starts: list[float] = []
    i = 0
    while i < len(ts) - n:
        if hard[i:i + n].mean() > 0.9 and ts[i + n - 1] - ts[i] < _WINDOW_S + 5:
            starts.append(float(ts[i]))
            i += n * 4
        else:
            i += 10
    if len(starts) > count:
        starts = [starts[int(k)] for k in np.linspace(0, len(starts) - 1, count)]
    return starts


async def _audio(manifest_url: str, start_s: float, end_s: float) -> tuple[np.ndarray, float]:
    """Mono audio between two video times, and the video time it starts at."""
    import av

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        xml = (await client.get(manifest_url)).text
        audio_set = re.search(r'<AdaptationSet[^>]*audio.*?</AdaptationSet>', xml, re.S)
        if audio_set and "ContentProtection" in audio_set.group(0):
            raise RuntimeError("This feed's audio is encrypted")
        m = re.search(r'timescale="(\d+)" media="([^"]*index_audio_\d+_0_)\$Number\$\.mp4" initialization="([^"]*)"', xml)
        if not m:
            raise RuntimeError("No audio in this feed")
        scale = int(m.group(1))
        seg = re.search(r'<S t="0" d="(\d+)"', xml[xml.index(m.group(2)):])
        seg_s = int(seg.group(1)) / scale if seg else 6.0
        url = lambda u: urllib.parse.urljoin(manifest_url, u)
        first, last = max(0, int(start_s // seg_s)), int(end_s // seg_s) + 1
        sem = asyncio.Semaphore(6)

        async def get(n: int) -> bytes:
            async with sem:
                for attempt in range(3):
                    try:
                        r = await client.get(url(f"{m.group(2)}{n + 1}.mp4"))
                        return r.content if r.status_code == 200 else b""
                    except httpx.TransportError:
                        await asyncio.sleep(1 + attempt)
                return b""

        init = (await client.get(url(m.group(3)))).content
        segments = await asyncio.gather(*[get(n) for n in range(first, last)])

    def decode() -> np.ndarray:
        container = av.open(io.BytesIO(init + b"".join(segments)))
        resampler = av.AudioResampler(format="flt", layout="mono", rate=_SR)
        out = []
        for frame in container.decode(audio=0):
            out.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
        return np.concatenate(out)

    return await asyncio.to_thread(decode), first * seg_s


def _match(pcm: np.ndarray, audio_start: float, ts: np.ndarray, rpm: np.ndarray,
           t0: float, lo: float, hi: float, window_s: float = _WINDOW_S) -> tuple[float, float]:
    """The offset (lo..hi) where the audio's energy along the engine's
    harmonics is strongest, and how clearly it beats any other offset."""
    hop = int(_HOP_S * _SR)
    frames = np.lib.stride_tricks.sliding_window_view(pcm, _WIN)[::hop]
    freqs = np.fft.rfftfreq(_WIN, 1 / _SR)
    frame_t = audio_start + (np.arange(len(frames)) * hop + _WIN / 2) / _SR
    # Spectrum on a log frequency scale (in batches, to keep memory down)
    lf = np.exp(np.arange(np.log(60), np.log(3000), _LOG_STEP))
    idx = np.searchsorted(freqs, lf)
    window = np.hanning(_WIN).astype(np.float32)
    spec = np.empty((len(frames), len(lf)), dtype=np.float32)
    for i in range(0, len(frames), 500):
        spec[i:i + 500] = np.log1p(np.abs(np.fft.rfft(frames[i:i + 500] * window, axis=1)))[:, idx]
    # Steady tones (hum, wind) out; each frame normalised; each bin takes the
    # loudest within ±2% to allow for the data's coarser RPM
    spec -= spec.mean(axis=0)
    spec = (spec - spec.mean(axis=1, keepdims=True)) / (spec.std(axis=1, keepdims=True) + 1e-9)
    widened = spec.copy()
    for k in range(1, 5):
        np.maximum(widened, np.roll(spec, k, axis=1), out=widened)
        np.maximum(widened, np.roll(spec, -k, axis=1), out=widened)
    spec = widened

    tt = np.arange(t0, t0 + window_s, _HOP_S)
    rr = np.interp(tt, ts, rpm)
    # A V6 four-stroke's harmonics are multiples of rpm/120. Scored against
    # the energy halfway between them, so audio full of other tones (music,
    # crowds, other cars) doesn't match any RPM.
    def bin_of(n: float) -> np.ndarray:
        return np.clip(np.round(np.log(np.maximum(rr * n / 120, 60) / 60) / _LOG_STEP).astype(int), 0, spec.shape[1] - 1)

    on = np.stack([bin_of(n) for n in range(3, 15)])
    off = np.stack([bin_of(n + 0.5) for n in range(3, 15)])

    def score(offset: float) -> float:
        fi = np.clip(np.searchsorted(frame_t, tt + offset), 0, len(frame_t) - 1)
        return float(spec[fi, on].mean() - spec[fi, off].mean())

    # Coarse, then fine around the best
    coarse = np.arange(lo, hi, 0.5)
    cs = np.array([score(o) for o in coarse])
    best = coarse[cs.argmax()]
    fine = np.arange(best - 1, best + 1, _HOP_S)
    fs = np.array([score(o) for o in fine])
    offset = float(fine[fs.argmax()])
    others = cs[np.abs(coarse - offset) > 2]
    margin = float((fs.max() - others.max()) / (cs.std() + 1e-9)) if len(others) else 0.0
    return offset, margin


async def _compute(year: int, round_num: int, session_type: str) -> dict[str, Any]:
    found = await f1tv_video.find_replay(year, round_num, session_type)
    if not found:
        raise RuntimeError("Couldn't find this session on F1 TV")
    content = await f1tv_video.content(found["content_id"])
    traces, replay_len = await _rpm_traces(year, round_num, session_type)
    onboards = {str(c.get("driver_number")): c["channel_id"] for c in content.get("channels", [])
                if c.get("channel_id") and c.get("driver_number")}
    duration = float(content.get("duration") or 0.0)
    # The video holds the whole session, after some lead-in
    lo, hi = -60.0, max(60.0, duration - replay_len + 60.0)

    # Drivers with flying laps and an onboard, most running first
    info = await aget_json(f"sessions/{year}/{round_num}/{session_type}/info.json") or {}
    numbers = {d["abbreviation"]: str(d["driver_number"]) for d in info.get("drivers") or []
               if d.get("abbreviation") and d.get("driver_number")}
    candidates = []
    for abbr, (ts, rpm) in traces.items():
        number = numbers.get(abbr)
        if number in onboards:
            windows = _flying_windows(ts, rpm)
            if windows:
                candidates.append((len(windows), abbr, number, windows))
    candidates.sort(reverse=True)

    results: list[tuple[float, float, str]] = []
    for _, abbr, number, windows in candidates[:5]:
        ts, rpm = traces[abbr]
        # A race's start never repeats; otherwise a flying lap mid-session
        t0 = float(ts[0]) if session_type in ("R", "S") else windows[len(windows) // 2]
        play = await f1tv_video.play(found["content_id"], onboards[number])
        try:
            pcm, start = await _audio(play["manifest_url"], max(0.0, t0 + lo), t0 + _WINDOW_S + hi)
        except Exception as e:
            logger.info("Broadcast sync: no audio for %s: %s", abbr, e)
            continue
        offset, margin = await asyncio.to_thread(_match, pcm, start, ts, rpm, t0, lo, hi)
        logger.info("Broadcast sync %s: %s at %.0fs -> %.1fs (margin %.1f)", found["content_id"], abbr, t0, offset, margin)
        if margin < _MARGIN:
            continue
        results.append((offset, margin, abbr))
        # Two clear results that agree
        agreeing = [r for r in results if abs(r[0] - offset) <= _AGREE_S]
        if len(agreeing) >= 2:
            value = float(np.median([r[0] for r in agreeing]))
            return {
                "content_id": found["content_id"],
                "duration": duration,
                "offset": round(value, 2),
                "drivers": [r[2] for r in agreeing],
            }
    raise RuntimeError("Couldn't match the onboard sound to the timing")


def refresh_sync(year: int, round_num: int, session_type: str) -> dict[str, Any] | None:
    """Work out and save the offset now (when a session is processed), so it
    doesn't wait for the first view, by which time F1 TV may have protected
    the audio. Keeps a saved result if this one fails. Never raises: the
    session is processed either way."""
    path = _path(year, round_num, session_type)
    try:
        result = asyncio.run(_compute(year, round_num, session_type))
    except Exception as e:
        logger.info("Broadcast sync for %s %s %s not worked out now: %s", year, round_num, session_type, e)
        return None
    try:
        put_json(path, result)
    except Exception as e:
        logger.warning("Couldn't save the broadcast sync for %s %s %s: %s", year, round_num, session_type, e)
        return None
    _failed.pop(path, None)
    logger.info("Broadcast sync for %s %s %s: %.2fs (%s)", year, round_num, session_type, result["offset"], ", ".join(result["drivers"]))
    return result


async def offset(year: int, round_num: int, session_type: str) -> dict[str, Any]:
    """{"offset": video time at replay 0:00, ...}, worked out once per
    session (concurrent requests share the work)."""
    path = _path(year, round_num, session_type)
    saved = await aget_json(path)
    if saved and saved.get("offset") is not None:
        return saved
    key = path
    failed = _failed.get(key)
    if failed and time.time() - failed[1] < _RETRY_AFTER_S:
        raise RuntimeError(failed[0])
    task = _running.get(key)
    if task is None:
        task = asyncio.create_task(_compute(year, round_num, session_type))
        _running[key] = task
    try:
        result = await task
    except Exception as e:
        _failed[key] = (str(e), time.time())
        raise
    finally:
        _running.pop(key, None)
    await asyncio.to_thread(put_json, path, result)
    return result


# --- Live -------------------------------------------------------------------
#
# F1 TV's live video is stamped with the real time each piece was sent out,
# a few seconds after it happened (7.7s on replays). The live version of the
# match measures that gap for this stream: an onboard's recent engine sound,
# placed by its stamps, against the driver's revs from live timing, placed by
# their real times. The broadcast then delays the timing by exactly that.

_LIVE_WINDOW_S = 75.0  # of recent driving to compare
_LIVE_LO, _LIVE_HI = -5.0, 40.0  # how far the stamps may run after the moment
_live_results: dict[str, dict[str, Any]] = {}


def _iso_seconds(value: str | None) -> float:
    """An ISO 8601 date-time as epoch seconds (0 if missing)."""
    if not value:
        return 0.0
    from datetime import datetime
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _duration_seconds(value: str | None) -> float:
    """An ISO 8601 duration such as PT1H2M3.5S as seconds (0 if missing)."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?", value or "")
    if not m:
        return 0.0
    d, h, mi, sec = (float(x) if x else 0.0 for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + sec


def live_audio_segments(xml: str, manifest_url: str) -> tuple[str, list[tuple[float, float, str]]]:
    """A live manifest's audio: the init segment's URL, and each media
    segment as (real start time, duration, URL). Real time follows DASH (and
    the browser's player): availabilityStartTime + period start +
    (segment time - presentationTimeOffset) / timescale."""
    mpd = re.search(r"<MPD[^>]*>", xml)
    period = re.search(r"<Period[^>]*>", xml)
    ast = _iso_seconds(re.search(r'availabilityStartTime="([^"]+)"', mpd.group(0)).group(1)) if mpd and "availabilityStartTime" in mpd.group(0) else 0.0
    pstart = _duration_seconds((re.search(r'start="([^"]+)"', period.group(0)) or [None, None])[1]) if period else 0.0
    sets = re.findall(r"<AdaptationSet[^>]*>.*?</AdaptationSet>", xml, re.S)
    audio = next((a for a in sets if re.search(r'(contentType|mimeType)="audio', a)), None)
    if audio is None:
        raise RuntimeError("No audio in this feed")
    if "ContentProtection" in audio:
        raise RuntimeError("This feed's audio is encrypted")
    tpl_tag = re.search(r"<SegmentTemplate[^>]*>", audio)
    rep = re.search(r'<Representation[^>]*id="([^"]+)"[^>]*?(?:bandwidth="(\d+)")?', audio)
    if not tpl_tag or not rep:
        raise RuntimeError("Couldn't read this feed's audio")
    tpl = tpl_tag.group(0)
    attr = lambda name, default=None: (re.search(rf'{name}="([^"]*)"', tpl) or [None, default])[1]
    scale = int(attr("timescale", "1"))
    pto = int(attr("presentationTimeOffset", "0"))
    number = int(attr("startNumber", "1"))
    fill = lambda u, t, n: urllib.parse.urljoin(
        manifest_url,
        u.replace("$RepresentationID$", rep.group(1)).replace("$Bandwidth$", rep.group(2) or "")
         .replace("$Number$", str(n)).replace("$Time$", str(t)),
    )
    segments: list[tuple[float, float, str]] = []
    t = 0
    for s_tag in re.findall(r"<S [^>]*/?>", audio):
        get = lambda name: (re.search(rf'\b{name}="(-?\d+)"', s_tag) or [None, None])[1]
        if get("t") is not None:
            t = int(get("t"))
        d = int(get("d"))
        for _ in range(int(get("r") or 0) + 1):
            segments.append((ast + pstart + (t - pto) / scale, d / scale, fill(attr("media"), t, number)))
            t += d
            number += 1
    return fill(attr("initialization"), 0, 0), segments


async def _live_audio(manifest_url: str, start: float, end: float) -> tuple[np.ndarray, float]:
    """Mono audio from a live feed between two real (stamp) times, and the
    real time it starts at."""
    import av

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        xml = (await client.get(manifest_url)).text
        init_url, segments = live_audio_segments(xml, manifest_url)
        wanted = [seg for seg in segments if seg[0] + seg[1] > start and seg[0] < end]
        if not wanted or wanted[-1][0] + wanted[-1][1] < end - 1:
            raise RuntimeError("The live stream doesn't reach that far yet")
        sem = asyncio.Semaphore(6)

        async def get(url: str) -> bytes:
            async with sem:
                for attempt in range(3):
                    try:
                        r = await client.get(url)
                        return r.content if r.status_code == 200 else b""
                    except httpx.TransportError:
                        await asyncio.sleep(1 + attempt)
                return b""

        init = (await client.get(init_url)).content
        data = await asyncio.gather(*[get(seg[2]) for seg in wanted])

    def decode() -> np.ndarray:
        if not all(data):
            raise RuntimeError("A piece of the live audio didn't download")
        container = av.open(io.BytesIO(init + b"".join(data)))
        resampler = av.AudioResampler(format="flt", layout="mono", rate=_SR)
        out = []
        for frame in container.decode(audio=0):
            out.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
        return np.concatenate(out)

    return await asyncio.to_thread(decode), wanted[0][0]


async def _compute_live(year: int, round_num: int, session_type: str) -> dict[str, Any]:
    from routers.live import _live_sessions

    session = _live_sessions.get(f"{year}_{round_num}_{session_type}")
    state = getattr(session, "_state_manager", None)
    revs: dict[str, Any] = getattr(state, "rpm", None) or {}
    if not revs:
        raise RuntimeError("No live engine data yet")
    found = await f1tv_video.find_live(year, round_num, session_type)
    if not found:
        raise RuntimeError("F1 TV isn't streaming this session")
    content = await f1tv_video.content(found["content_id"])
    onboards = {str(c.get("driver_number")): c["channel_id"] for c in content.get("channels", [])
                if c.get("channel_id") and c.get("driver_number")}

    # Drivers with an onboard who've been working the engine hard lately
    n = int(_LIVE_WINDOW_S * 4)
    candidates = []
    for number, buf in revs.items():
        if number not in onboards or len(buf) < n:
            continue
        a = np.array(buf, dtype=np.float64)
        candidates.append(((a[-n:, 1] > _MIN_RPM).mean(), number, a))
    candidates.sort(key=lambda c: c[0], reverse=True)

    results: list[tuple[float, float, str]] = []
    for share, number, a in candidates[:4]:
        if share < 0.6:
            break
        play = await f1tv_video.play(found["content_id"], onboards[number])
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                xml = (await client.get(play["manifest_url"])).text
            _, segments = live_audio_segments(xml, play["manifest_url"])
            newest = segments[-1][0] + segments[-1][1] if segments else 0.0
            # The newest stretch whose sound (up to _LIVE_HI later) is out
            t1 = min(float(a[-1, 0]), newest - _LIVE_HI - 1)
            t0 = t1 - _LIVE_WINDOW_S
            if t0 < a[0, 0]:
                continue
            pcm, start = await _live_audio(play["manifest_url"], t0 + _LIVE_LO, t1 + _LIVE_HI)
        except Exception as e:
            logger.info("Live broadcast sync: no audio for car %s: %s", number, e)
            continue
        delay, margin = await asyncio.to_thread(
            _match, pcm, start, a[:, 0], a[:, 1], t0, _LIVE_LO, _LIVE_HI, _LIVE_WINDOW_S,
        )
        logger.info("Live broadcast sync: car %s -> stamps %.1fs after the moment (margin %.1f)", number, delay, margin)
        if margin < _MARGIN:
            continue
        results.append((delay, margin, number))
        agreeing = [r for r in results if abs(r[0] - delay) <= _AGREE_S]
        if len(agreeing) >= 2:
            return {"stamp_delay": round(float(np.median([r[0] for r in agreeing])), 2),
                    "drivers": [r[2] for r in agreeing]}
    raise RuntimeError("Couldn't match the onboard sound to the live timing yet")


async def live_stamp_delay(year: int, round_num: int, session_type: str) -> dict[str, Any]:
    """How long after the moment on screen F1 TV stamps its live video, for
    this session, by engine sound. Kept once found (it doesn't change during
    a stream)."""
    key = f"{year}_{round_num}_{session_type}"
    if key in _live_results:
        return _live_results[key]
    result = await _compute_live(year, round_num, session_type)
    _live_results[key] = result
    return result
