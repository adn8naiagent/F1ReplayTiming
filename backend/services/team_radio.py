"""Team radio clips with captions, for replays and live timing.

F1 publishes the team radio messages it picks for the world feed (about
20–40 per race) in the live timing feed: driver number, time and an MP3
link. The list needs an F1 TV sign-in; the MP3 files themselves are public,
so the browser plays them straight from F1 and we never store the audio.

F1 sends no text, so captions come from Whisper running locally
(faster-whisper). The model downloads on first use to DATA_DIR/whisper.
Optionally, an AI model then improves each caption (services/caption_ai.py).

- TEAM_RADIO_CAPTIONS=false turns captions off (clips still play).
- The Whisper models (replays and live) and the AI step are set in the app
  or .env; see
  services/caption_settings.py.
"""

from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import requests

from services import caption_ai, caption_settings, whisper_models

logger = logging.getLogger(__name__)

STATIC_URL = "https://livetiming.formula1.com/static/"
# Whisper captions at least this long are kept when the AI step says no one speaks
MIN_WORDS_OVER_AI = 4
# Stored clips' file names, e.g. VER_3_20261024_155650.mp3
AUDIO_NAME = re.compile(r"[A-Za-z0-9_.-]+\.mp3")

_models: dict[str, Any] = {}  # model name -> loaded WhisperModel
_model_lock = threading.Lock()
# One clip at a time: Whisper already uses every CPU core.
_transcribe_lock = threading.Lock()
_unavailable_logged = False


def captions_enabled() -> bool:
    """Whether clips get captions: from Whisper, the AI step, or both."""
    if os.environ.get("TEAM_RADIO_CAPTIONS", "true").strip().lower() in ("false", "0", "off", "no"):
        return False
    return whisper_available() or caption_settings.ai_enabled()


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        global _unavailable_logged
        if not _unavailable_logged:
            logger.warning("faster-whisper isn't installed, so team radio has no captions")
            _unavailable_logged = True
        return False
    return True


def _get_model(live: bool = False):
    # Read each time, so a model chosen in the app is used from the next clip
    name = caption_settings.whisper_model(live)
    if not whisper_models.is_downloaded(name):
        # Keep captioning with a model that's already here while the chosen
        # one downloads in the background; with none here, load (and
        # download) it now, as on first use.
        here = next(iter(_models), None) or next(
            (m["id"] for m in caption_settings.WHISPER_MODELS if whisper_models.is_downloaded(m["id"])), None,
        )
        if here:
            whisper_models.ensure(name)
            name = here
    with _model_lock:
        if name not in _models:
            from faster_whisper import WhisperModel

            logger.info(f"Loading Whisper model {name} (downloads on first use)")
            _models[name] = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(whisper_models.model_dir()))
        return _models[name]


def warm_up(live: bool = False) -> None:
    """Load the model ahead of the first clip (it downloads on first use)."""
    if captions_enabled() and whisper_available():
        try:
            _get_model(live)
        except Exception as e:
            logger.warning(f"Couldn't load the Whisper model: {e}")


def release_model() -> None:
    """Free the model's memory (a few hundred MB to 1.5 GB) when nothing needs it."""
    with _model_lock, _transcribe_lock:
        names = list(_models)
        _models.clear()
    if names:
        import gc
        gc.collect()
        logger.info(f"Released the Whisper model {', '.join(names)} from memory")


def audio_url(session_path: str, clip_path: str) -> str:
    """Public MP3 link. session_path is like '2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/'."""
    return STATIC_URL + session_path.strip("/") + "/" + clip_path.lstrip("/")


def fetch_audio(url: str) -> bytes | None:
    from services import f1_account

    token = f1_account.get_token()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        r = requests.get(url, headers=headers, timeout=(10, 30))
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
    lenient: bool = False,
) -> str | None:
    """Whisper's caption for one clip. None if Whisper isn't available or
    nothing was said. year picks the season's vocabulary; live picks the
    live timing model. lenient turns off the silence filters, which can
    drop quiet or noisy speech, but then Whisper also makes things up on
    silence: only for a draft the AI step checks against the audio."""
    if not whisper_available():
        return None
    prompt = _prompt(first_name, year)
    try:
        model = _get_model(live)
        with _transcribe_lock:
            # The VAD filter skips silence, where Whisper otherwise makes
            # things up (often repeating the prompt).
            segments, _info = model.transcribe(
                io.BytesIO(audio), language="en", beam_size=5, initial_prompt=prompt, vad_filter=not lenient,
            )
            text = " ".join(s.text.strip() for s in segments if lenient or s.no_speech_prob < 0.6).strip()
    except Exception as e:
        logger.warning(f"Team radio transcription failed: {e}")
        return None
    if _is_prompt_echo(text, prompt):
        return None
    # F1 spelling; the multilingual models write "tires" whatever the prompt says
    text = _TIRE_RE.sub(lambda m: m.group(0).replace("ire", "yre").replace("IRE", "YRE"), text)
    return text or None


def caption(
    audio: bytes, first_name: str | None, year: int | None, context: dict | None = None, live: bool = False,
) -> str | None:
    """Caption one clip: Whisper, then the AI step if it's on. If the AI step
    fails, Whisper's caption is kept.

    context is for the AI step: "speaker", "drivers" and "session" (see
    caption_ai)."""
    if not captions_enabled():
        return None
    text = transcribe(audio, first_name, year, live)
    if caption_settings.ai_enabled():
        # Whisper's filters can drop real speech on noisy radio: give the AI
        # step an unfiltered draft to check against the audio instead
        draft = text or transcribe(audio, first_name, year, live, lenient=True)
        ok, refined = caption_ai.refine(audio, draft, {**(context or {}), "year": year})
        if ok:
            # The AI step sometimes hears no one where Whisper (with its
            # filters on) heard several words: keep Whisper's then
            if refined is None and text and len(text.split()) >= MIN_WORDS_OVER_AI:
                logger.info("AI step heard no speech; keeping Whisper's caption")
                return text
            return refined
    return text


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


def _driver_label(drv: dict) -> str:
    """e.g. "Charles Leclerc (LEC, Ferrari)", for the AI caption step."""
    name = drv.get("name") or drv.get("first_name") or ""
    extra = ", ".join(x for x in (drv.get("abbr"), drv.get("team")) if x)
    return f"{name} ({extra})" if name and extra else (name or extra)


def build_clips(
    captures: list[dict],
    session_path: str,
    start_date: datetime,
    drivers: dict[str, dict],
    on_progress=None,
    year: int | None = None,
    session: str | None = None,
    store_prefix: str | None = None,
) -> list[dict]:
    """Replay clips with captions, timed in replay seconds from start_date.

    drivers maps racing number -> {"abbr", "first_name"}, and optionally
    "name" and "team" for the AI caption step. session names the session,
    e.g. "2026 United States Grand Prix, Qualifying". With store_prefix,
    each clip's audio is kept in storage there and the clip names it as
    "audio", so replays play it from this server rather than F1's (which
    refuses some networks).
    """
    roster = [_driver_label(d) for d in drivers.values() if d.get("abbr")]
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
        stored = None
        if captions_enabled() or store_prefix:
            if on_progress:
                on_progress(i + 1, len(ordered))
            audio = fetch_audio(url)
            if audio and store_prefix:
                stored = store_audio(store_prefix, path, audio)
            if audio and captions_enabled():
                transcript = caption(audio, drv.get("first_name"), year, {
                    "speaker": _driver_label(drv) if drv else None,
                    "drivers": roster,
                    "session": session,
                })
            time.sleep(0.2)  # be gentle with F1's servers
        clips.append({
            "t": round((utc - start_date).total_seconds(), 1),
            "utc": utc.isoformat() + "Z",
            "racing_number": number,
            "driver": drv.get("abbr", ""),
            "url": url,
            **({"audio": stored} if stored else {}),
            "transcript": transcript,
        })
    return clips


def store_audio(prefix: str, clip_path: str, audio: bytes) -> str | None:
    """Keep a clip's MP3 in storage under prefix; its file name, or None."""
    from services.storage import put_bytes

    name = clip_path.rsplit("/", 1)[-1]
    if not AUDIO_NAME.fullmatch(name):
        return None
    try:
        put_bytes(f"{prefix}/{name}", audio, "audio/mpeg")
    except Exception as e:
        logger.warning(f"Couldn't store team radio audio {name}: {e}")
        return None
    return name


def backfill_audio(year: int, round_num: int, session_type: str) -> tuple[int, int]:
    """Store the audio of an already-processed session's clips (sessions
    processed before audio was kept). Returns (stored, clips)."""
    from services.storage import get_json, put_json

    base = f"sessions/{year}/{round_num}/{session_type}"
    data = get_json(f"{base}/team_radio.json")
    clips = (data or {}).get("clips") or []
    stored = 0
    for clip in clips:
        if clip.get("audio") or not clip.get("url"):
            stored += bool(clip.get("audio"))
            continue
        audio = fetch_audio(clip["url"])
        if audio:
            name = store_audio(f"{base}/team_radio", clip["url"], audio)
            if name:
                clip["audio"] = name
                stored += 1
        time.sleep(0.2)  # be gentle with F1's servers
    if clips:
        put_json(f"{base}/team_radio.json", data)
    return stored, len(clips)
