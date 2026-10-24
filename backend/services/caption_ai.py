"""Improve a team radio caption with an AI model, via OpenRouter.

Optional (Settings > Team Radio, or TEAM_RADIO_AI). The model gets the clip's
audio, Whisper's caption as a draft, and F1 context: who's speaking, the
other drivers, the session and the season's vocabulary. It listens to the
audio itself, so it can fix what Whisper misheard ("The clerk" -> "Leclerc")
and caption clips Whisper couldn't.

If the request fails, the caption stays as Whisper made it.
"""

from __future__ import annotations

import base64
import json
import logging
import re

import httpx

from services import caption_settings

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_S = 30.0

INSTRUCTIONS = """You caption Formula 1 team radio: short messages between a driver and their race engineer, often with engine noise and a poor signal.

Write what is said in the audio, in English, as one caption.
- The audio decides. The draft below was made by a speech-to-text model and may have misheard words; use it only as a hint.
- Spell driver, team and F1 terms correctly, using the context below. Use British spelling ("tyres").
- Don't add, explain or tidy up anything that wasn't said. Keep the speaker's words, including "copy", "box, box" and swearing.
- If part is unintelligible, caption the parts you can hear.
- If nobody speaks, the caption is null.

Reply with JSON only: {"caption": "..."} or {"caption": null}."""


def _glossary(year: int | None) -> str:
    era = ("boost, overtake mode, energy, harvesting, deploy" if year is None or year >= 2026
           else "DRS, ERS, harvesting, deploy")
    return (f"box, box this lap, stay out, push, delta, gap, undercut, overcut, safety car, VSC, "
            f"tyres, softs, mediums, hards, inters, deg, graining, blue flag, track limits, {era}")


def _context_text(context: dict) -> str:
    lines = []
    if context.get("session"):
        lines.append(f"Session: {context['session']}")
    if context.get("speaker"):
        lines.append(f"Driver on this radio: {context['speaker']}")
    if context.get("drivers"):
        lines.append("Drivers in the session: " + "; ".join(context["drivers"]))
    lines.append("Common terms: " + _glossary(context.get("year")))
    return "\n".join(lines)


def _audio_format(audio: bytes) -> str:
    # F1's clips are MP3; WAV for anything else we might pass
    return "wav" if audio[:4] == b"RIFF" else "mp3"


def refine(audio: bytes, draft: str | None, context: dict) -> tuple[bool, str | None]:
    """(True, caption) from the AI model, with caption None when nobody speaks;
    (False, None) if it couldn't run, so the caller keeps Whisper's caption."""
    key = caption_settings.openrouter_key()
    if not key:
        return False, None
    model = caption_settings.ai_model()
    prompt = (f"{INSTRUCTIONS}\n\n{_context_text(context)}\n\n"
              f"Draft from speech-to-text: {draft if draft else '(nothing recognised)'}")
    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "input_audio", "input_audio": {
                    "data": base64.b64encode(audio).decode("ascii"),
                    "format": _audio_format(audio),
                }},
            ],
        }],
        "temperature": 0,
        "max_tokens": 300,
    }
    try:
        resp = httpx.post(
            OPENROUTER_URL,
            json=payload,
            headers={"Authorization": f"Bearer {key}"},
            timeout=TIMEOUT_S,
        )
        if resp.status_code != 200:
            logger.warning(f"AI caption request failed ({model}): HTTP {resp.status_code} {resp.text[:200]}")
            return False, None
        content = resp.json()["choices"][0]["message"]["content"] or ""
    except Exception as e:
        logger.warning(f"AI caption request failed ({model}): {e}")
        return False, None

    # Models sometimes wrap JSON in a code fence
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    try:
        caption = json.loads(content).get("caption")
    except (json.JSONDecodeError, AttributeError):
        logger.warning(f"AI caption reply wasn't JSON ({model}): {content[:200]}")
        return False, None
    if caption is not None and not isinstance(caption, str):
        return False, None
    caption = (caption or "").strip().strip('"').strip()
    return True, caption or None
