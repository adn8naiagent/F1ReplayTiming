"""API endpoint for checking live session status.

Determines if any F1 session is currently live or imminent based on
the session schedule and known session durations.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter
from services.storage import get_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["live"])

# Typical session durations (generous — better to show LIVE too long than miss it)
SESSION_DURATIONS: dict[str, int] = {
    "Race": 7200,           # 2 hours
    "Qualifying": 4200,     # 70 minutes
    "Sprint": 3600,         # 1 hour
    "Sprint Qualifying": 3000,  # 50 minutes
    "Sprint Shootout": 3000,
    "Practice 1": 3600,     # 1 hour
    "Practice 2": 3600,
    "Practice 3": 3600,
}

SESSION_NAME_TO_TYPE = {
    "Race": "R",
    "Qualifying": "Q",
    "Sprint": "S",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
}

# How early before session start to show as "live" (pre-session build-up)
PRE_SESSION_MINUTES = 15


@router.get("/live/status")
async def live_status():
    """Check if any session is currently live or imminent.

    Returns the live session details if found, or null.
    """
    from app_config import is_public_mode
    if is_public_mode():
        return {"live": None}

    now = datetime.now(timezone.utc)
    year = now.year

    schedule = await asyncio.to_thread(get_json, f"seasons/{year}/schedule.json")
    if not schedule:
        return {"live": None}

    events = schedule.get("events", [])

    for evt in events:
        for session in evt.get("sessions", []):
            date_str = session.get("date_utc")
            if not date_str:
                continue

            try:
                session_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if session_dt.tzinfo is None:
                    session_dt = session_dt.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue

            session_name = session.get("name", "")
            duration = SESSION_DURATIONS.get(session_name, 3600)
            session_type = SESSION_NAME_TO_TYPE.get(session_name)

            if not session_type:
                continue

            # Session window: PRE_SESSION_MINUTES before start → duration after start
            window_start = session_dt - timedelta(minutes=PRE_SESSION_MINUTES)
            window_end = session_dt + timedelta(seconds=duration)

            if window_start <= now <= window_end:
                return {
                    "live": {
                        "year": year,
                        "round_number": evt.get("round_number"),
                        "event_name": evt.get("event_name", ""),
                        "country": evt.get("country", ""),
                        "session_name": session_name,
                        "session_type": session_type,
                        "session_start": date_str,
                        "pre_session": now < session_dt,
                    }
                }

    return {"live": None}
