"""Team radio clips with captions, for replays and live timing.

F1 publishes the team radio messages it picks for the world feed (about
20–40 per race) in the live timing feed: driver number, time and an MP3
link. The list needs an F1 TV sign-in; the MP3 files themselves are public,
so the browser plays them straight from F1 and we never store the audio.

F1 sends no text, so captions come from Whisper running locally
(faster-whisper). The model downloads on first use to DATA_DIR/whisper.

- TEAM_RADIO_CAPTIONS=false turns captions off (clips still play).
- TEAM_RADIO_MODEL picks the Whisper model (default small.en, about 480 MB).
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

STATIC_URL = "https://livetiming.formula1.com/static/"

_model = None
_model_lock = threading.Lock()
# One clip at a time: Whisper already uses every CPU core.
_transcribe_lock = threading.Lock()
_unavailable_logged = False


def captions_enabled() -> bool:
    if os.environ.get("TEAM_RADIO_CAPTIONS", "true").strip().lower() in ("false", "0", "off", "no"):
        return False
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        global _unavailable_logged
        if not _unavailable_logged:
            logger.warning("faster-whisper isn't installed, so team radio has no captions")
            _unavailable_logged = True
        return False
    return True


def _model_dir() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))
    return data_dir / "whisper"


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            name = os.environ.get("TEAM_RADIO_MODEL", "small.en").strip() or "small.en"
            logger.info(f"Loading Whisper model {name} (downloads on first use)")
            _model = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(_model_dir()))
        return _model


def warm_up() -> None:
    """Load the model ahead of the first clip (it downloads on first use)."""
    if captions_enabled():
        try:
            _get_model()
        except Exception as e:
            logger.warning(f"Couldn't load the Whisper model: {e}")


def release_model() -> None:
    """Free the model's memory (a few hundred MB) when nothing needs it."""
    global _model
    with _model_lock, _transcribe_lock:
        if _model is not None:
            _model = None
            import gc
            gc.collect()
            logger.info("Released the Whisper model from memory")


def audio_url(session_path: str, clip_path: str) -> str:
    """Public MP3 link. session_path is like '2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/'."""
    return STATIC_URL + session_path.strip("/") + "/" + clip_path.lstrip("/")


def fetch_audio(url: str) -> bytes | None:
    try:
        r = requests.get(url, timeout=(10, 30))
    except requests.RequestException as e:
        logger.warning(f"Team radio download failed: {e}")
        return None
    if r.status_code != 200:
        logger.warning(f"Team radio download refused: HTTP {r.status_code} for {url}")
        return None
    return r.content


def transcribe(audio: bytes, first_name: str | None = None) -> str | None:
    """Caption one clip. None if captions are off or nothing was said."""
    if not captions_enabled():
        return None
    # Naming only this clip's driver helps with their name without making
    # Whisper hear other drivers' names that weren't said.
    prompt = "Formula 1 team radio" + (f" with {first_name}." if first_name else ".") + \
        " Box, undercut, Plan B, DRS, safety car, softs, mediums, hards, copy."
    try:
        model = _get_model()
        with _transcribe_lock:
            # The VAD filter skips silence, where Whisper otherwise makes
            # things up (often repeating the prompt).
            segments, _info = model.transcribe(
                io.BytesIO(audio), language="en", beam_size=5, initial_prompt=prompt, vad_filter=True,
            )
            text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.6).strip()
    except Exception as e:
        logger.warning(f"Team radio transcription failed: {e}")
        return None
    if "team radio" in text.lower() or "undercut, plan b" in text.lower():
        return None  # the prompt echoed back, not speech
    return text or None


def parse_utc(value: str) -> datetime | None:
    """F1's Utc field, e.g. '2026-10-11T11:56:17.5106502Z', as naive UTC
    (FastF1's Date columns are naive UTC too)."""
    try:
        value = value.rstrip("Z")
        if "." in value:
            head, frac = value.split(".", 1)
            value = f"{head}.{frac[:6]}"
        dt = datetime.fromisoformat(value)
    except (ValueError, AttributeError):
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def captures_from(data: Any) -> list[dict]:
    """Captures from a TeamRadio message: a list in the first message, a
    dict keyed by index in later ones."""
    caps = data.get("Captures") if isinstance(data, dict) else None
    if isinstance(caps, list):
        return [c for c in caps if isinstance(c, dict)]
    if isinstance(caps, dict):
        return [c for c in caps.values() if isinstance(c, dict)]
    return []


def build_clips(
    captures: list[dict],
    session_path: str,
    start_date: datetime,
    drivers: dict[str, dict],
    on_progress=None,
) -> list[dict]:
    """Replay clips with captions, timed in replay seconds from start_date.

    drivers maps racing number -> {"abbr", "first_name"}.
    """
    seen: set[str] = set()
    clips: list[dict] = []
    ordered = sorted(captures, key=lambda c: c.get("Utc", ""))
    for i, cap in enumerate(ordered):
        path, utc = cap.get("Path"), parse_utc(cap.get("Utc", ""))
        if not path or utc is None or path in seen:
            continue
        seen.add(path)
        number = str(cap.get("RacingNumber", ""))
        drv = drivers.get(number, {})
        url = audio_url(session_path, path)
        transcript = None
        if captions_enabled():
            if on_progress:
                on_progress(i + 1, len(ordered))
            audio = fetch_audio(url)
            if audio:
                transcript = transcribe(audio, drv.get("first_name"))
            time.sleep(0.2)  # be gentle with F1's servers
        clips.append({
            "t": round((utc - start_date).total_seconds(), 1),
            "utc": utc.isoformat() + "Z",
            "racing_number": number,
            "driver": drv.get("abbr", ""),
            "url": url,
            "transcript": transcript,
        })
    return clips
