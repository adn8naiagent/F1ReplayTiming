"""Team radio caption settings: the Whisper model, and the optional AI step.

Each can be set in .env or from the app (Settings > Team Radio). A value in
.env wins, and the app shows it as locked. App choices are saved on this
server (DATA_DIR/config/captions.json), not in shared storage, because the
right model depends on the machine: two servers sharing an R2 bucket can use
different ones.

- TEAM_RADIO_MODEL: the Whisper model for replays (WHISPER_MODELS)
- TEAM_RADIO_LIVE_MODEL: the Whisper model for live timing, where a caption
  must be ready within the broadcast delay; unset, the same as replays
- TEAM_RADIO_AI: true/false, improve captions with an AI model via OpenRouter
  (needs OPENROUTER_API_KEY)
- TEAM_RADIO_AI_MODEL: the OpenRouter model; it must accept audio input
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Whisper models offered in the app. Sizes are the download; speeds are per
# clip on a Raspberry Pi 5 (CPU, int8), from a benchmark on 2026 US GP clips.
WHISPER_MODELS: list[dict[str, str]] = [
    {"id": "tiny.en", "label": "Tiny", "size": "75 MB",
     "note": "Fastest, least accurate. For low-powered servers."},
    {"id": "base.en", "label": "Base", "size": "145 MB",
     "note": "Fast, less accurate than Small."},
    {"id": "small.en", "label": "Small", "size": "480 MB",
     "note": "The default. About 12 seconds per clip on a Raspberry Pi 5."},
    {"id": "medium.en", "label": "Medium", "size": "1.5 GB",
     "note": "Slower than Large v3 Turbo and less accurate in testing."},
    {"id": "large-v3-turbo", "label": "Large v3 Turbo", "size": "1.6 GB",
     "note": "Most accurate. About 24 seconds per clip on a Raspberry Pi 5, "
             "so live captions can fall behind on slower machines."},
]
DEFAULT_WHISPER_MODEL = "small.en"

# OpenRouter models that accept audio. Any audio model id works in .env.
AI_MODELS: list[dict[str, str]] = [
    {"id": "google/gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash Lite",
     "note": "The default. Fast and cheapest: a few cents a race weekend."},
    {"id": "google/gemini-3.5-flash", "label": "Gemini 3.5 Flash",
     "note": "More capable, about 10 times the cost of Flash Lite."},
    {"id": "google/gemini-2.5-flash", "label": "Gemini 2.5 Flash",
     "note": "Older and slightly cheaper than Gemini 3.5 Flash."},
    {"id": "openai/gpt-audio-mini", "label": "GPT Audio Mini",
     "note": "OpenAI's audio model, about twice the cost of Flash Lite."},
]
DEFAULT_AI_MODEL = "google/gemini-3.5-flash-lite"

_lock = threading.Lock()


class CaptionSettingsError(ValueError):
    """An invalid setting from the app."""


def _path() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))
    return data_dir / "config" / "captions.json"


def _saved() -> dict[str, Any]:
    try:
        return json.loads(_path().read_text())
    except FileNotFoundError:
        return {}
    except Exception as e:
        logger.warning(f"Couldn't read caption settings: {e}")
        return {}


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _env_bool(name: str) -> bool | None:
    value = _env(name)
    if value is None:
        return None
    return value.lower() not in ("false", "0", "off", "no")


def openrouter_key() -> str | None:
    return _env("OPENROUTER_API_KEY")


def whisper_model(live: bool = False) -> str:
    """The Whisper model for replays, or for live timing."""
    replay = _env("TEAM_RADIO_MODEL") or _saved().get("whisper_model") or DEFAULT_WHISPER_MODEL
    if not live:
        return replay
    return _env("TEAM_RADIO_LIVE_MODEL") or _saved().get("live_whisper_model") or replay


def ai_enabled() -> bool:
    """Whether to improve captions with an AI model (and a key is set)."""
    if not openrouter_key():
        return False
    env = _env_bool("TEAM_RADIO_AI")
    return env if env is not None else bool(_saved().get("ai_enabled", False))


def ai_model() -> str:
    return _env("TEAM_RADIO_AI_MODEL") or _saved().get("ai_model") or DEFAULT_AI_MODEL


def describe() -> dict[str, Any]:
    """Settings for the app, with which ones .env has locked."""
    return {
        "whisper_model": whisper_model(),
        "whisper_model_locked": _env("TEAM_RADIO_MODEL") is not None,
        "whisper_models": WHISPER_MODELS,
        # null: the same as replays
        "live_whisper_model": _env("TEAM_RADIO_LIVE_MODEL") or _saved().get("live_whisper_model"),
        "live_whisper_model_locked": _env("TEAM_RADIO_LIVE_MODEL") is not None,
        "ai_available": openrouter_key() is not None,
        "ai_enabled": ai_enabled(),
        "ai_enabled_locked": _env_bool("TEAM_RADIO_AI") is not None,
        "ai_model": ai_model(),
        "ai_model_locked": _env("TEAM_RADIO_AI_MODEL") is not None,
        "ai_models": AI_MODELS,
        # Whether each Whisper model is on this server, and download progress
        "model_status": {m["id"]: _model_status(m["id"]) for m in WHISPER_MODELS},
    }


def _model_status(name: str) -> dict[str, Any]:
    from services import whisper_models

    try:
        return whisper_models.status(name)
    except ImportError:  # faster-whisper not installed
        return {"state": "unavailable"}


def download_selected() -> None:
    """Download the replay and live models now if they aren't here, so
    they're ready before the next clip."""
    from services import whisper_models

    try:
        for live in (False, True):
            whisper_models.ensure(whisper_model(live))
    except ImportError:
        pass


_UNSET = object()


def save(
    whisper: str | None = None,
    live_whisper: Any = _UNSET,
    ai_on: bool | None = None,
    ai: str | None = None,
) -> dict[str, Any]:
    """Save settings from the app. Ones locked by .env are refused.
    live_whisper None means "the same as replays"."""
    with _lock:
        data = _saved()
        if live_whisper is not _UNSET:
            if _env("TEAM_RADIO_LIVE_MODEL"):
                raise CaptionSettingsError("The live caption model is set by TEAM_RADIO_LIVE_MODEL in .env.")
            if live_whisper is not None and live_whisper not in {m["id"] for m in WHISPER_MODELS}:
                raise CaptionSettingsError(f"Unknown caption model: {live_whisper}")
            data["live_whisper_model"] = live_whisper
        if whisper is not None:
            if _env("TEAM_RADIO_MODEL"):
                raise CaptionSettingsError("The caption model is set by TEAM_RADIO_MODEL in .env.")
            if whisper not in {m["id"] for m in WHISPER_MODELS}:
                raise CaptionSettingsError(f"Unknown caption model: {whisper}")
            data["whisper_model"] = whisper
        if ai_on is not None:
            if _env_bool("TEAM_RADIO_AI") is not None:
                raise CaptionSettingsError("AI captions are set by TEAM_RADIO_AI in .env.")
            data["ai_enabled"] = ai_on
        if ai is not None:
            if _env("TEAM_RADIO_AI_MODEL"):
                raise CaptionSettingsError("The AI model is set by TEAM_RADIO_AI_MODEL in .env.")
            if ai not in {m["id"] for m in AI_MODELS}:
                raise CaptionSettingsError(f"Unknown AI model: {ai}")
            data["ai_model"] = ai
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
    return describe()
