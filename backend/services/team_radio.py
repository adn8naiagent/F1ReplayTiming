"""Team radio clips with captions, for replays and live timing.

F1 publishes the team radio messages it picks for the world feed (about
20–40 per race) in the live timing feed: driver number, time and an MP3
link. The list needs an F1 TV sign-in; the MP3 files themselves are public,
so the browser plays them straight from F1 and we never store the audio.

F1 sends no text, so captions come from Whisper running locally
(faster-whisper). The model downloads on first use to DATA_DIR/whisper.

- TEAM_RADIO_CAPTIONS=false turns captions off (clips still play).
- TEAM_RADIO_MODEL picks the Whisper model (default small.en, about 480 MB).
- TEAM_RADIO_LIVE_MODEL picks a different model for live timing, where a
  caption has to be ready within the broadcast delay. Unset, live uses
  TEAM_RADIO_MODEL. A larger model (e.g. large-v3-turbo) is noticeably more
  accurate but 2-3x slower, which suits replays but not live.
"""

from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

STATIC_URL = "https://livetiming.formula1.com/static/"

_models: dict[str, Any] = {}  # model name -> loaded WhisperModel
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


def model_name(live: bool = False) -> str:
    """The Whisper model for replays, or for live timing when live is set."""
    replay = os.environ.get("TEAM_RADIO_MODEL", "").strip() or "small.en"
    if live:
        return os.environ.get("TEAM_RADIO_LIVE_MODEL", "").strip() or replay
    return replay


def _get_model(live: bool = False):
    name = model_name(live)
    with _model_lock:
        if name not in _models:
            from faster_whisper import WhisperModel

            logger.info(f"Loading Whisper model {name} (downloads on first use)")
            _models[name] = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(_model_dir()))
        return _models[name]


def warm_up(live: bool = False) -> None:
    """Load the model ahead of the first clip (it downloads on first use)."""
    if captions_enabled():
        try:
            _get_model(live)
        except Exception as e:
            logger.warning(f"Couldn't load the Whisper model: {e}")


def release_model(live: bool = False) -> None:
    """Free the model's memory (a few hundred MB to 1.5 GB) when nothing needs it."""
    name = model_name(live)
    with _model_lock, _transcribe_lock:
        if _models.pop(name, None) is not None:
            import gc
            gc.collect()
            logger.info(f"Released the Whisper model {name} from memory")


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


def _prompt(first_name: str | None, year: int | None) -> str:
    """A short context sentence for Whisper. Naming only this clip's driver
    helps with their name without making Whisper hear other drivers' names
    that weren't said. Kept short and free of everyday radio words ("copy",
    "box"): Whisper inserts prompt words where they weren't said, and reads
    the start of the prompt back on near-silent clips."""
    who = f" with {first_name}" if first_name else ""
    # DRS was replaced by overtake mode and boost in 2026
    era = "boost, overtake mode" if year is None or year >= 2026 else "DRS"
    return f"Formula 1 team radio{who}. Tyres, safety car, {era}."


_WORD_RE = re.compile(r"[a-z0-9']+")
_TIRE_RE = re.compile(r"\b[Tt](?:ire|IRE)[sS]?\b")


def _is_prompt_echo(text: str, prompt: str) -> bool:
    """True when the caption is the prompt read back rather than speech.

    Real radio uses the prompt's words too ("Safety car, box"), so matching
    words isn't enough. A read-back repeats the prompt in order: the whole
    caption is a piece of the prompt, or runs of 4+ consecutive prompt words
    make up most of it.
    """
    if "team radio" in text.lower():
        return True
    words = _WORD_RE.findall(text.lower())
    prompt_words = _WORD_RE.findall(prompt.lower())
    if len(words) >= 2 and f" {' '.join(words)} " in f" {' '.join(prompt_words)} ":
        return True
    covered = [False] * len(words)
    for i in range(len(words)):
        for j in range(len(prompt_words)):
            n = 0
            while i + n < len(words) and j + n < len(prompt_words) and words[i + n] == prompt_words[j + n]:
                n += 1
            if n >= 4:
                covered[i:i + n] = [True] * n
    return bool(words) and sum(covered) >= len(words) / 2


def transcribe(
    audio: bytes, first_name: str | None = None, year: int | None = None, live: bool = False,
) -> str | None:
    """Caption one clip. None if captions are off or nothing was said.

    live picks TEAM_RADIO_LIVE_MODEL; year picks the season's vocabulary.
    """
    if not captions_enabled():
        return None
    prompt = _prompt(first_name, year)
    try:
        model = _get_model(live)
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
    if _is_prompt_echo(text, prompt):
        return None
    # F1 spelling; the multilingual models write "tires" whatever the prompt says
    text = _TIRE_RE.sub(lambda m: m.group(0).replace("ire", "yre").replace("IRE", "YRE"), text)
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
    year: int | None = None,
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
                transcript = transcribe(audio, drv.get("first_name"), year)
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
