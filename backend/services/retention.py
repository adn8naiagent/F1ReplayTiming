"""Storage retention: delete stored sessions older than a user-set age.

The setting is stored alongside the data (so it works for both the local and R2
backends) and is enforced by a background sweep. Saving a setting runs the sweep
immediately, so applying a policy also cleans up everything already too old.

The sweep deliberately does not live in auto_precompute_loop: that loop only
runs Fri-Mon, and isn't started at all when AUTO_PRECOMPUTE=off — which is
exactly the setup most likely to want retention.
"""

from __future__ import annotations

import asyncio
import calendar
import logging
import traceback
from datetime import datetime, timedelta, timezone

from services import storage

logger = logging.getLogger("retention")

CONFIG_PATH = "config/retention.json"

# How often the sweep runs once the app is up. Retention is measured in weeks
# and months, so checking more often than daily would delete the same files
# on the same day, just sooner in the day.
SWEEP_INTERVAL = 24 * 60 * 60
STARTUP_DELAY = 60

UNITS = ("weeks", "months")

# Floor on the threshold. Without it a mistyped "1 week" -> "1" could turn into
# a rolling wipe of everything the moment it is saved.
MIN_WEEKS = 1

DEFAULTS = {"enabled": False, "amount": 6, "unit": "months"}


class RetentionError(ValueError):
    """Invalid retention settings."""


def cutoff_for(amount: int, unit: str, now: datetime | None = None) -> datetime:
    """The date before which sessions are considered expired."""
    now = now or datetime.now(timezone.utc)
    if unit not in UNITS:
        raise RetentionError(f"unit must be one of {UNITS}")
    if amount < 1:
        raise RetentionError("amount must be at least 1")
    if unit == "weeks":
        if amount < MIN_WEEKS:
            raise RetentionError(f"retention must be at least {MIN_WEEKS} week(s)")
        return now - timedelta(weeks=amount)
    month, year = now.month - amount, now.year
    while month <= 0:
        month += 12
        year -= 1
    return now.replace(
        year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1])
    )


def parse_utc(value: str | None) -> datetime | None:
    """Parse a stored session date into an aware UTC datetime, or None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def session_index() -> tuple[list[dict], int]:
    """Every fully-stored session with its size and date. Returns (sessions, total)."""
    from services.f1_data import SESSION_NAME_TO_TYPE

    try:
        sizes = storage.list_sizes("sessions")
    except Exception:
        sizes = {}

    totals: dict[tuple[int, int, str], int] = {}
    complete: set[tuple[int, int, str]] = set()
    for key, size in sizes.items():
        parts = key.split("/")
        # sessions/{year}/{round}/{type}/{file...}
        if len(parts) < 5 or parts[0] != "sessions":
            continue
        try:
            ident = (int(parts[1]), int(parts[2]), parts[3])
        except ValueError:
            continue
        totals[ident] = totals.get(ident, 0) + size
        if parts[4] == "replay.json":
            complete.add(ident)

    schedules: dict[int, dict] = {}
    sessions: list[dict] = []
    for ident in sorted(complete):
        year, rnd, code = ident
        if year not in schedules:
            schedules[year] = storage.get_json(f"seasons/{year}/schedule.json") or {}
        event = next(
            (e for e in schedules[year].get("events", []) if e.get("round_number") == rnd),
            None,
        )
        date_utc = None
        if event:
            for sess in event.get("sessions", []):
                if SESSION_NAME_TO_TYPE.get(sess.get("name", "")) == code:
                    date_utc = sess.get("date_utc")
                    break
        sessions.append({
            "year": year,
            "round": rnd,
            "type": code,
            "event_name": (event or {}).get("event_name", f"Round {rnd}"),
            "date_utc": date_utc,
            "size_bytes": totals.get(ident, 0),
        })

    sessions.sort(key=lambda s: (s["date_utc"] or "", s["year"], s["round"]), reverse=True)
    return sessions, sum(s["size_bytes"] for s in sessions)


def get_retention() -> dict:
    stored = storage.get_json(CONFIG_PATH)
    config = dict(DEFAULTS)
    if isinstance(stored, dict):
        config.update({k: stored[k] for k in DEFAULTS if k in stored})
        config["last_run"] = stored.get("last_run")
        config["last_freed_bytes"] = stored.get("last_freed_bytes")
        config["last_deleted"] = stored.get("last_deleted")
    return config


def save_retention(enabled: bool, amount: int, unit: str) -> dict:
    """Validate and persist the retention setting."""
    cutoff_for(amount, unit)  # raises RetentionError on bad input
    config = get_retention()
    config.update({"enabled": bool(enabled), "amount": int(amount), "unit": unit})
    storage.put_json(CONFIG_PATH, config)
    return config


def expired_sessions(amount: int, unit: str) -> list[dict]:
    """Stored sessions older than the given age, oldest first."""
    cutoff = cutoff_for(amount, unit)
    sessions, _ = session_index()
    stale = []
    for s in sessions:
        dt = parse_utc(s["date_utc"])
        if dt is not None and dt < cutoff:
            stale.append(s)
    stale.sort(key=lambda s: s["date_utc"] or "")
    return stale


def sweep(amount: int, unit: str, dry_run: bool = False) -> dict:
    """Delete every stored session older than the given age."""
    from services.process import delete_session

    stale = expired_sessions(amount, unit)
    if dry_run:
        return {
            "dry_run": True,
            "count": len(stale),
            "freed_bytes": sum(s["size_bytes"] for s in stale),
            "sessions": stale,
        }

    freed = 0
    deleted = 0
    for s in stale:
        try:
            freed += delete_session(s["year"], s["round"], s["type"])
            deleted += 1
        except Exception as e:
            logger.warning(
                f"Retention: failed to delete {s['year']}/{s['round']}/{s['type']}: {e}"
            )

    if deleted:
        logger.info(f"Retention: deleted {deleted} session(s), freed {freed} bytes")

    config = get_retention()
    config.update({
        "last_run": datetime.now(timezone.utc).isoformat(),
        "last_freed_bytes": freed,
        "last_deleted": deleted,
    })
    storage.put_json(CONFIG_PATH, config)

    return {"dry_run": False, "count": deleted, "freed_bytes": freed, "sessions": stale}


async def retention_loop():
    """Apply the retention policy shortly after startup, then once a day."""
    logger.info("Retention sweep task started")
    await asyncio.sleep(STARTUP_DELAY)

    while True:
        try:
            config = get_retention()
            if config.get("enabled"):
                await asyncio.to_thread(sweep, config["amount"], config["unit"])
            else:
                logger.debug("Retention disabled, skipping sweep")
        except Exception as e:
            logger.error(f"Retention sweep failed: {e}")
            traceback.print_exc()

        await asyncio.sleep(SWEEP_INTERVAL)
