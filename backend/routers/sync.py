from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
from typing import Optional

import httpx
from PIL import Image
from pillow_heif import register_heif_opener
from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Body

register_heif_opener()

from routers.replay import _get_frames  # reads from R2

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sync"])

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
VISION_MODEL = "google/gemini-2.0-flash-001"

EXTRACT_PROMPT = """You are analyzing a photo of an F1 TV broadcast leaderboard/timing tower.

Extract the following data from the image:

1. **Lap number**  - the current lap shown (e.g., "LAP 23/58" means lap 23)
2. **Gap mode** - check what is shown next to the P1 driver. The broadcast shows either "LEADER" (gaps are cumulative from P1) or "INTERVAL" (gaps are to the car directly ahead). This determines how to interpret the gap values.
3. **Driver entries**  - for each visible driver, extract:
   - Position (1, 2, 3, etc.)
   - Driver abbreviation (3 letters, e.g., VER, NOR, LEC)
   - Gap value exactly as shown on screen
   - Tyre compound if visible (SOFT, MEDIUM, HARD, INTERMEDIATE, WET)

You MUST always return gap to leader (cumulative gap from P1), regardless of what the broadcast shows. If the broadcast shows "INTERVAL" mode, convert to gap to leader by summing the intervals down the order. For example, if P2 shows +1.2 and P3 shows +0.8 in interval mode, return P2 gap as "+1.2" and P3 gap as "+2.0".

Respond with ONLY valid JSON in this exact format, no markdown:
{
  "lap": 23,
  "drivers": [
    {"position": 1, "abbr": "VER", "gap": null, "tyre": "HARD"},
    {"position": 2, "abbr": "NOR", "gap": "+1.234", "tyre": "MEDIUM"},
    {"position": 3, "abbr": "LEC", "gap": "+3.456", "tyre": "HARD"}
  ]
}

Rules:
- For the leader (P1), set gap to null
- Always return gap to leader (cumulative), not interval - convert if needed
- Keep gap as a string (e.g., "+1.234", "+12.456")
- If a driver is lapped, use format "1 LAP" or "2 LAPS"
- If tyre is not visible, set to null
- Only include drivers you can clearly read
- Do NOT guess - only extract what is clearly visible"""


def _convert_to_jpeg(image_bytes: bytes, max_dim: int = 1200, quality: int = 80) -> bytes:
    """Convert any image format to compressed JPEG."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    # Resize if needed
    if max(img.size) > max_dim:
        ratio = max_dim / max(img.size)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


async def _extract_leaderboard(image_bytes: bytes) -> dict:
    """Send image to Gemini via OpenRouter and extract leaderboard data."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not configured")

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "model": VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": EXTRACT_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    },
                ],
            }
        ],
        "max_tokens": 1000,
        "temperature": 0,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            OPENROUTER_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code != 200:
        logger.error(f"OpenRouter error {resp.status_code}: {resp.text}")
        raise HTTPException(status_code=502, detail="Vision API request failed")

    data = resp.json()
    content = data["choices"][0]["message"]["content"]

    # Strip markdown code fences if present
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        logger.error(f"Failed to parse vision response: {content}")
        raise HTTPException(status_code=502, detail="Could not parse leaderboard from image")


def _parse_gap_float(gap_str: str | None) -> float | None:
    """Convert gap string to float for comparison."""
    if gap_str is None:
        return None
    # Lapped: "1 LAP", "2 LAPS"
    m = re.match(r"^(\d+)\s*LAPS?$", gap_str, re.IGNORECASE)
    if m:
        return 9000.0 + int(m.group(1))
    # Standard gap: "+1.234"
    try:
        return float(gap_str.lstrip("+"))
    except ValueError:
        return None


def _match_frame(frames: list[dict], extracted: dict) -> dict:
    """Find the frame that best matches the extracted leaderboard data."""
    target_lap = extracted.get("lap", 1)
    extracted_drivers = extracted.get("drivers", [])

    if not extracted_drivers:
        raise HTTPException(status_code=400, detail="No drivers extracted from image")

    # Build lookup: abbr -> gap float
    target_gaps: dict[str, float] = {}
    for d in extracted_drivers:
        if d["position"] == 1:
            target_gaps[d["abbr"]] = 0.0
        else:
            g = _parse_gap_float(d.get("gap"))
            if g is not None:
                target_gaps[d["abbr"]] = g

    target_order = [d["abbr"] for d in extracted_drivers]

    # Filter to frames on or near the target lap
    candidate_frames = [
        (i, f) for i, f in enumerate(frames)
        if abs(f.get("lap", 0) - target_lap) <= 1
    ]

    if not candidate_frames:
        # Fall back to all frames
        candidate_frames = list(enumerate(frames))

    best_idx = 0
    best_score = float("inf")

    for idx, frame in candidate_frames:
        frame_drivers = {d["abbr"]: d for d in frame.get("drivers", [])}
        score = 0.0

        # Score gap differences
        gap_matches = 0
        for abbr, target_gap in target_gaps.items():
            fd = frame_drivers.get(abbr)
            if not fd or not fd.get("gap"):
                score += 50.0  # penalty for missing driver
                continue

            frame_gap_str = fd["gap"]
            # Leader
            if frame_gap_str.startswith("LAP"):
                frame_gap = 0.0
            else:
                fg = _parse_gap_float(frame_gap_str)
                if fg is None:
                    score += 20.0
                    continue
                frame_gap = fg

            diff = abs(frame_gap - target_gap)
            score += diff
            gap_matches += 1

        # Bonus: check position order matches
        frame_sorted = sorted(
            frame.get("drivers", []),
            key=lambda d: d.get("position") or 999,
        )
        frame_order = [d["abbr"] for d in frame_sorted]

        order_penalty = 0
        for i, abbr in enumerate(target_order):
            if abbr in frame_order:
                fi = frame_order.index(abbr)
                order_penalty += abs(fi - i) * 2.0

        score += order_penalty

        # Slight preference for exact lap match
        if frame.get("lap") != target_lap:
            score += 10.0

        if score < best_score:
            best_score = score
            best_idx = idx

    matched_frame = frames[best_idx]
    return {
        "timestamp": matched_frame["timestamp"],
        "lap": matched_frame.get("lap", 0),
        "confidence": max(0, 100 - best_score),
        "extracted": extracted,
    }


@router.post("/sessions/{year}/{round_num}/sync-manual")
async def sync_manual(
    year: int,
    round_num: int,
    type: str = Query("R"),
    body: dict = Body(...),
):
    """Match manual leaderboard input against replay frames."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body required")

    lap = body.get("lap")
    drivers = body.get("drivers", [])
    if not lap or not drivers:
        raise HTTPException(status_code=400, detail="Lap and at least one driver required")

    extracted = {"lap": int(lap), "drivers": drivers}

    frames = await _get_frames(year, round_num, type)
    if not frames:
        raise HTTPException(status_code=404, detail="No replay data available")

    result = _match_frame(frames, extracted)
    logger.info(f"Manual sync matched to timestamp={result['timestamp']:.1f}s, lap={result['lap']}")
    return result


@router.post("/sessions/{year}/{round_num}/sync-photo")
async def sync_from_photo(
    year: int,
    round_num: int,
    type: str = Query("R"),
    photo: UploadFile = File(...),
):
    # Read image
    image_bytes = await photo.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    # Convert to JPEG (handles HEIC, PNG, etc.)
    try:
        image_bytes = _convert_to_jpeg(image_bytes)
    except Exception as e:
        logger.error(f"Image conversion failed: {e}")
        raise HTTPException(status_code=400, detail="Could not process image")

    # Extract leaderboard data from image
    extracted = await _extract_leaderboard(image_bytes)
    logger.info(f"Extracted leaderboard: {json.dumps(extracted)}")

    # Load replay frames
    frames = await _get_frames(year, round_num, type)
    if not frames:
        raise HTTPException(status_code=404, detail="No replay data available")

    # Match against frames
    result = _match_frame(frames, extracted)
    logger.info(f"Matched to timestamp={result['timestamp']:.1f}s, lap={result['lap']}, confidence={result['confidence']:.0f}")

    return result
