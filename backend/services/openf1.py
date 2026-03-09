"""OpenF1 API client for live timing data.

Uses the free tier of api.openf1.org to fetch near-real-time F1 session data.
Free tier: data available ~30 minutes after session ends, or during session
with a small delay. No authentication required.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.openf1.org/v1"

# Reusable HTTP client
_client: httpx.Client | None = None


def _get_client() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(base_url=BASE_URL, timeout=15.0)
    return _client


def get_live_session() -> dict | None:
    """Get the current or most recent session."""
    try:
        client = _get_client()
        resp = client.get("/sessions", params={"session_key": "latest"})
        resp.raise_for_status()
        data = resp.json()
        if data and len(data) > 0:
            return data[0]
    except Exception as e:
        logger.warning(f"OpenF1 get_live_session error: {e}")
    return None


def get_session_drivers(session_key: int) -> list[dict]:
    """Get drivers for a session."""
    try:
        client = _get_client()
        resp = client.get("/drivers", params={"session_key": session_key})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_drivers error: {e}")
        return []


def get_positions(session_key: int, date_gt: str | None = None) -> list[dict]:
    """Get position data (driver standings)."""
    try:
        client = _get_client()
        params: dict = {"session_key": session_key}
        if date_gt:
            params["date>"] = date_gt
        resp = client.get("/position", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_positions error: {e}")
        return []


def get_intervals(session_key: int, date_gt: str | None = None) -> list[dict]:
    """Get interval/gap data (race only)."""
    try:
        client = _get_client()
        params: dict = {"session_key": session_key}
        if date_gt:
            params["date>"] = date_gt
        resp = client.get("/intervals", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_intervals error: {e}")
        return []


def get_car_locations(session_key: int, date_gt: str | None = None, driver_number: int | None = None) -> list[dict]:
    """Get car GPS positions on track."""
    try:
        client = _get_client()
        params: dict = {"session_key": session_key}
        if date_gt:
            params["date>"] = date_gt
        if driver_number is not None:
            params["driver_number"] = driver_number
        resp = client.get("/location", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_car_locations error: {e}")
        return []


def get_laps(session_key: int, date_gt: str | None = None) -> list[dict]:
    """Get lap data."""
    try:
        client = _get_client()
        params: dict = {"session_key": session_key}
        if date_gt:
            params["date>"] = date_gt
        resp = client.get("/laps", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_laps error: {e}")
        return []


def get_stints(session_key: int) -> list[dict]:
    """Get stint/tyre data."""
    try:
        client = _get_client()
        resp = client.get("/stints", params={"session_key": session_key})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_stints error: {e}")
        return []


def get_pit_stops(session_key: int) -> list[dict]:
    """Get pit stop data."""
    try:
        client = _get_client()
        resp = client.get("/pit", params={"session_key": session_key})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_pit_stops error: {e}")
        return []


def get_weather(session_key: int) -> list[dict]:
    """Get weather data."""
    try:
        client = _get_client()
        resp = client.get("/weather", params={"session_key": session_key})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_weather error: {e}")
        return []


def get_race_control(session_key: int, date_gt: str | None = None) -> list[dict]:
    """Get race control messages (flags, SC, penalties)."""
    try:
        client = _get_client()
        params: dict = {"session_key": session_key}
        if date_gt:
            params["date>"] = date_gt
        resp = client.get("/race_control", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_race_control error: {e}")
        return []


def get_car_data(session_key: int, driver_number: int, date_gt: str | None = None) -> list[dict]:
    """Get telemetry data for a specific driver."""
    try:
        client = _get_client()
        params: dict = {"session_key": session_key, "driver_number": driver_number}
        if date_gt:
            params["date>"] = date_gt
        resp = client.get("/car_data", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"OpenF1 get_car_data error: {e}")
        return []
