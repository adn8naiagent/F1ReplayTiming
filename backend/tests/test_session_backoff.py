"""Backoff, single-flight and status mapping for sessions with no upstream data."""
import asyncio
import threading
import time
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastf1._api import SessionNotAvailableError
from fastf1.exceptions import RateLimitExceededError

from services import f1_data
from services.f1_data import SessionUnavailable


@pytest.fixture(autouse=True)
def clean_state():
    f1_data._negative_cache.clear()
    f1_data._session_cache.clear()
    yield
    f1_data._negative_cache.clear()
    f1_data._session_cache.clear()


def _failing_session(exc, calls, delay=0.0):
    def get_session(*a, **k):
        s = mock.Mock()

        def load(**kw):
            calls.append(1)
            time.sleep(delay)
            raise exc

        s.load = load
        return s

    return get_session


def test_not_available_is_recorded_and_short_circuits():
    calls = []
    with mock.patch.object(f1_data.fastf1, "get_session", _failing_session(SessionNotAvailableError("x"), calls)):
        with pytest.raises(SessionUnavailable) as first:
            f1_data._load_session(2026, 17, "R")
        assert first.value.reason == "not_available"
        assert 600 <= first.value.retry_after_seconds <= 900
        for _ in range(5):
            with pytest.raises(SessionUnavailable):
                f1_data._load_session(2026, 17, "R")
    assert len(calls) == 1


def test_rate_limit_backoff():
    calls = []
    with mock.patch.object(f1_data.fastf1, "get_session", _failing_session(RateLimitExceededError("500/h"), calls)):
        with pytest.raises(SessionUnavailable) as e:
            f1_data._load_session(2026, 16, "R")
        assert e.value.reason == "rate_limited"
        with pytest.raises(SessionUnavailable):
            f1_data._load_session(2026, 16, "R")
    assert len(calls) == 1


def test_backoff_expires_and_retries():
    calls = []
    with mock.patch.object(f1_data.fastf1, "get_session", _failing_session(SessionNotAvailableError("x"), calls)):
        with pytest.raises(SessionUnavailable):
            f1_data._load_session(2026, 17, "R")
        key = f1_data._cache_key(2026, 17, "R")
        _, reason, msg = f1_data._negative_cache[key]
        f1_data._negative_cache[key] = (time.time() - 1, reason, msg)
        with pytest.raises(SessionUnavailable):
            f1_data._load_session(2026, 17, "R")
    assert len(calls) == 2


def test_concurrent_callers_single_flight():
    calls = []
    results = []
    with mock.patch.object(f1_data.fastf1, "get_session",
                           _failing_session(SessionNotAvailableError("x"), calls, delay=0.2)):
        def run():
            try:
                f1_data._load_session(2026, 17, "R")
            except SessionUnavailable as e:
                results.append(e.reason)

        threads = [threading.Thread(target=run) for _ in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
    assert len(calls) == 1
    assert results == ["not_available"] * 8


def test_laps_never_loaded_is_unavailable_not_attribute_error():
    session = mock.Mock(spec=["load"])  # no _laps attribute
    with mock.patch.object(f1_data.fastf1, "get_session", lambda *a, **k: session):
        with pytest.raises(SessionUnavailable):
            f1_data._load_session(2026, 17, "R")


def test_is_backed_off_and_clear():
    f1_data._record_backoff(f1_data._cache_key(2026, 17, "R"), "not_available", 60, "m")
    assert f1_data.is_backed_off(2026, 17, "R")
    f1_data.clear_session_backoff(2026, 17, "R")
    assert not f1_data.is_backed_off(2026, 17, "R")


def _app():
    import main  # exception handler lives on the real app
    return main.session_unavailable_handler


def test_handler_returns_503_with_retry_after():
    handler = _app()
    exc = SessionUnavailable("rate_limited", time.time() + 120, "limited")
    resp = asyncio.run(handler(None, exc))
    assert resp.status_code == 503
    assert resp.headers["retry-after"].isdigit()
    import json
    body = json.loads(resp.body)
    assert body["state"] == "rate_limited" and body["retry_after"] > 0 and body["detail"] == "limited"


def test_replay_manifest_maps_unavailable_to_503():
    from routers import replay_data
    app = FastAPI()
    app.include_router(replay_data.router)
    status = {"state": "unavailable", "message": "nope", "reason": "not_available", "retry_after": 600}
    with mock.patch.object(replay_data, "validate_session", lambda *a: None), \
         mock.patch.object(replay_data.replay_chunks, "get_manifest", lambda *a: None), \
         mock.patch.object(replay_data, "get_prepare_status", lambda *a: status), \
         mock.patch.object(replay_data, "clear_prepare_status", lambda *a: None):
        r = TestClient(app).get("/api/sessions/2026/17/replay?type=R")
    assert r.status_code == 503
    assert r.json()["retry_after"] == 600 and r.json()["state"] == "unavailable"
    assert r.headers["retry-after"] == "600"


def test_prepare_surfaces_unavailable_state():
    from services import process
    exc = SessionUnavailable("not_available", time.time() + 300, "none yet")

    async def go():
        with mock.patch.object(process.replay_chunks, "get_manifest", lambda *a: None), \
             mock.patch.object(process.storage, "exists", lambda *a: False), \
             mock.patch.object(process, "is_public_mode", lambda: False), \
             mock.patch.object(process, "process_session_sync", mock.Mock(side_effect=exc)):
            process._prepare_status.clear()
            process.start_prepare(2026, 17, "R")
            for _ in range(50):
                await asyncio.sleep(0.05)
                st = process.get_prepare_status(2026, 17, "R")
                if st["state"] != "running":
                    return st

    st = asyncio.run(go())
    assert st["state"] == "unavailable" and st["retry_after"] > 0
