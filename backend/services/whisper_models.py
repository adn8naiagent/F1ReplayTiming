"""Whisper models on this server: which are downloaded, downloading them in
the background, and progress for the app (Settings > Team Radio).

Models download to DATA_DIR/whisper (faster-whisper's Hugging Face cache).
Saving a model in the app starts its download straight away, so it's ready
before the next clip; until then captions keep using a model that's already
here (team_radio._get_model).
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# The standard download writes the file into the cache as it arrives, so
# progress can be measured; Hugging Face's Xet download only moves it there
# at the end. Read when huggingface_hub is imported, so set it first.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# Download sizes in bytes, for progress (Hugging Face, Oct 2026)
SIZES = {
    "tiny.en": 78_090_594,
    "base.en": 147_769_510,
    "small.en": 486_101_605,
    "medium.en": 1_530_457_748,
    "large-v3-turbo": 1_617_000_000,
}

_lock = threading.Lock()
_downloading: set[str] = set()
_errors: dict[str, str] = {}
_ready: set[str] = set()  # confirmed downloaded


def model_dir() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))
    return data_dir / "whisper"


def _repo_dir(name: str) -> Path:
    from faster_whisper.utils import _MODELS

    repo = _MODELS.get(name, name)
    return model_dir() / f"models--{repo.replace('/', '--')}"


def is_downloaded(name: str) -> bool:
    """Whether the whole model is here (an interrupted download isn't)."""
    if name in _ready:
        return True
    try:
        from faster_whisper.utils import download_model

        path = download_model(name, local_files_only=True, cache_dir=str(model_dir()))
    except Exception:
        return False
    if not (Path(path) / "model.bin").exists():
        return False
    _ready.add(name)
    return True


def _downloaded_bytes(name: str) -> int:
    blobs = _repo_dir(name) / "blobs"
    try:
        return sum(f.stat().st_size for f in blobs.iterdir() if f.is_file())
    except OSError:
        return 0


def _download(name: str) -> None:
    try:
        from faster_whisper.utils import download_model

        logger.info(f"Downloading Whisper model {name}")
        download_model(name, cache_dir=str(model_dir()))
        _ready.discard(name)
        if not is_downloaded(name):
            raise RuntimeError("the download didn't complete")
        logger.info(f"Downloaded Whisper model {name}")
    except Exception as e:
        logger.warning(f"Couldn't download Whisper model {name}: {e}")
        _errors[name] = f"Download failed: {e}"
    finally:
        with _lock:
            _downloading.discard(name)


def ensure(name: str) -> None:
    """Start downloading a model in the background if it isn't here."""
    if is_downloaded(name):
        return
    with _lock:
        if name in _downloading:
            return
        _downloading.add(name)
        _errors.pop(name, None)
    threading.Thread(target=_download, args=(name,), daemon=True, name=f"whisper-{name}").start()


def status(name: str) -> dict[str, Any]:
    """"ready", "downloading" (with bytes so far), "error" or "missing"."""
    if name in _downloading:
        return {"state": "downloading", "downloaded_bytes": _downloaded_bytes(name), "total_bytes": SIZES.get(name)}
    if is_downloaded(name):
        return {"state": "ready"}
    if name in _errors:
        return {"state": "error", "error": _errors[name]}
    return {"state": "missing"}
