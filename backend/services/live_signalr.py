"""
SignalR client for the F1 live timing stream.

Connects to the official F1 SignalR Core endpoint at
wss://livetiming.formula1.com/signalrcore, negotiates a connection token,
subscribes to all relevant timing topics, and forwards each incoming
message to a user-supplied async callback.

The connection auto-reconnects with exponential backoff on unexpected
disconnects and responds to server pings to keep the connection alive.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
import time
import urllib.request
import urllib.error
import zlib
from http.cookiejar import CookieJar
from typing import Any, Awaitable, Callable

import websockets
import websockets.exceptions

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_URL = "https://livetiming.formula1.com/signalrcore"
_WS_URL = "wss://livetiming.formula1.com/signalrcore"
_NEGOTIATE_URL = f"{_BASE_URL}/negotiate?negotiateVersion=1"

_RECORD_SEPARATOR = "\x1e"

_TOPICS = [
    "TimingData",
    "TimingAppData",
    "TimingStats",
    "DriverList",
    "RaceControlMessages",
    "TrackStatus",
    "WeatherData",
    "LapCount",
    "ExtrapolatedClock",
    "SessionInfo",
    "SessionStatus",
    "SessionData",
    "Position.z",
]

# Only sent when the user has signed in with F1 TV (self-hosted). Without a
# token F1 doesn't send these during a live session.
_AUTH_TOPICS = [
    "CarData.z",
    "ChampionshipPrediction",
    "PitStopSeries",
    "DriverRaceInfo",
    "TeamRadio",
]

# Reconnect parameters
_INITIAL_BACKOFF = 1.0  # seconds
_MAX_BACKOFF = 30.0  # seconds
_BACKOFF_FACTOR = 2.0


# ---------------------------------------------------------------------------
# SignalR message types
# ---------------------------------------------------------------------------

_MSG_INVOCATION = 1
_MSG_PING = 6
_MSG_CLOSE = 7


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class LiveSignalRClient:
    """Async client that connects to the F1 live timing SignalR stream.

    Usage::

        client = LiveSignalRClient()

        async def on_message(topic: str, data: dict, timestamp: float):
            print(topic, data)

        # Blocks until disconnect() is called or the session ends.
        await client.connect(on_message)
    """

    def __init__(self) -> None:
        self._ws: Any | None = None
        self._connected = False
        self._stop_event: asyncio.Event = asyncio.Event()
        self._ping_task: asyncio.Task[None] | None = None
        self._seen_targets: set[str] = set()
        # Set when F1 rejects the token, so we fall back to the free feed
        # instead of retrying with it on every reconnect.
        self._auth_rejected = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def connect(
        self,
        callback: Callable[[str, dict, float], Awaitable[None]],
    ) -> None:
        """Connect to the F1 live timing stream and start receiving messages.

        Calls ``callback(topic, data, timestamp)`` for each data message
        received from the server.  Blocks until :meth:`disconnect` is called
        or the server closes the connection after exhausting reconnect
        attempts.

        Parameters
        ----------
        callback:
            Async function invoked for every timing message.  ``topic`` is the
            SignalR target name (e.g. ``"TimingData"``), ``data`` is the
            decoded JSON payload, and ``timestamp`` is ``time.time()`` at the
            moment the message was received.
        """
        self._stop_event.clear()
        backoff = _INITIAL_BACKOFF

        while not self._stop_event.is_set():
            try:
                await self._run_session(callback)
                # _run_session returns cleanly when stop_event is set or
                # the server sends a close frame.  If stop was requested
                # we break; otherwise we reconnect.
                if self._stop_event.is_set():
                    break
                logger.info("Session ended, reconnecting in %.1fs", backoff)
            except Exception:
                logger.exception(
                    "SignalR session error, reconnecting in %.1fs", backoff
                )

            self._set_disconnected()

            # Wait with backoff, but allow early exit via stop_event.
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=backoff
                )
                # stop_event was set during the wait — exit the loop.
                break
            except asyncio.TimeoutError:
                pass

            backoff = min(backoff * _BACKOFF_FACTOR, _MAX_BACKOFF)

        self._set_disconnected()
        logger.info("SignalR client stopped")

    async def disconnect(self) -> None:
        """Request a graceful shutdown of the connection."""
        logger.info("Disconnect requested")
        self._stop_event.set()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass

    @property
    def is_connected(self) -> bool:
        """Whether the client currently has an active WebSocket connection."""
        return self._connected

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _set_disconnected(self) -> None:
        if self._connected:
            self._connected = False
            logger.info("Disconnected from F1 live timing")
        if self._ping_task is not None:
            self._ping_task.cancel()
            self._ping_task = None
        self._ws = None

    # ------------------------------------------------------------------
    # Negotiate
    # ------------------------------------------------------------------

    def _auth_token(self) -> str | None:
        if self._auth_rejected:
            return None
        from services.f1tv_auth import get_token
        return get_token()

    @staticmethod
    def _negotiate(token: str | None = None) -> tuple[str, str]:
        """Perform the SignalR negotiate handshake over HTTP.

        Returns
        -------
        tuple[str, str]
            ``(connection_token, awsalbcors_cookie)``
        """
        cookie_jar = CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cookie_jar)
        )

        # Some servers require an OPTIONS pre-flight; send it but ignore the
        # response body.
        options_req = urllib.request.Request(
            _NEGOTIATE_URL, method="OPTIONS"
        )
        options_req.add_header("Accept", "*/*")
        try:
            opener.open(options_req, timeout=10)
        except urllib.error.URLError:
            # OPTIONS may fail or not be required — continue anyway.
            pass

        # POST negotiate
        post_req = urllib.request.Request(
            _NEGOTIATE_URL,
            data=b"",
            method="POST",
        )
        post_req.add_header("Content-Type", "application/json")
        post_req.add_header("Accept", "application/json")
        if token:
            post_req.add_header("Authorization", f"Bearer {token}")

        resp = opener.open(post_req, timeout=10)
        body = json.loads(resp.read().decode())

        connection_token: str = body["connectionToken"]
        connection_id: str = body.get("connectionId", "")
        logger.info(
            "Negotiated connectionId=%s token=%s…",
            connection_id,
            connection_token[:12],
        )

        # Extract the AWSALBCORS cookie (used by the load-balancer to pin
        # the WebSocket to the same backend).
        awsalbcors = ""
        for cookie in cookie_jar:
            if cookie.name == "AWSALBCORS":
                awsalbcors = f"AWSALBCORS={cookie.value}"
                break

        return connection_token, awsalbcors

    # ------------------------------------------------------------------
    # Session loop
    # ------------------------------------------------------------------

    async def _run_session(
        self,
        callback: Callable[[str, dict, float], Awaitable[None]],
    ) -> None:
        """Run a single SignalR session (negotiate, connect, subscribe, recv).

        Returns when the connection is cleanly closed or the stop event is
        set.  Raises on unexpected errors so the caller can decide whether to
        reconnect.
        """
        # Negotiate happens on a regular HTTP request — run in a thread so
        # we don't block the event loop.
        token = self._auth_token()
        try:
            connection_token, cookie = await asyncio.get_event_loop().run_in_executor(
                None, self._negotiate, token
            )
        except urllib.error.HTTPError as e:
            if not token or e.code not in (401, 403):
                raise
            logger.warning("F1 rejected the F1 TV token (HTTP %s), using the free feed", e.code)
            self._auth_rejected = True
            token = None
            connection_token, cookie = await asyncio.get_event_loop().run_in_executor(
                None, self._negotiate, None
            )
        topics = _TOPICS + _AUTH_TOPICS if token else _TOPICS

        ws_url = f"{_WS_URL}?id={connection_token}"

        extra_headers: dict[str, str] = {}
        if cookie:
            extra_headers["Cookie"] = cookie
        if token:
            extra_headers["Authorization"] = f"Bearer {token}"

        ssl_context = ssl.create_default_context()

        async with websockets.connect(
            ws_url,
            additional_headers=extra_headers,
            ssl=ssl_context,
            max_size=2**22,  # 4 MiB — timing payloads can be large
            ping_interval=None,  # we handle pings at the SignalR level
        ) as ws:
            self._ws = ws
            logger.info("WebSocket connected to %s", _WS_URL)

            # --- Handshake ---
            await self._send(ws, {"protocol": "json", "version": 1})
            handshake_raw = await ws.recv()
            logger.debug("Handshake response: %r", handshake_raw)

            # The handshake response is `{}\x1e` on success.  If there is an
            # error field we should bail out.
            for part in str(handshake_raw).split(_RECORD_SEPARATOR):
                part = part.strip()
                if not part:
                    continue
                hs = json.loads(part)
                if "error" in hs:
                    raise RuntimeError(
                        f"SignalR handshake error: {hs['error']}"
                    )

            self._connected = True
            logger.info("SignalR handshake complete")

            # --- Subscribe ---
            subscribe_msg = {
                "type": _MSG_INVOCATION,
                "invocationId": "1",
                "target": "Subscribe",
                "arguments": [topics],
            }
            await self._send(ws, subscribe_msg)
            logger.info(
                "Subscribed to %d topics (%s)",
                len(topics),
                "F1 TV authenticated" if token else "unauthenticated",
            )

            # --- Receive loop ---
            buffer = ""
            while not self._stop_event.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=60.0)
                except asyncio.TimeoutError:
                    # No data for 60s — send our own ping to keep the
                    # connection alive and verify it is still open.
                    await self._send(ws, {"type": _MSG_PING})
                    continue
                except websockets.exceptions.ConnectionClosed:
                    logger.warning("WebSocket connection closed by server")
                    return

                recv_ts = time.time()
                buffer += str(raw)

                # Messages are delimited by \x1e.  There may be multiple
                # messages in a single frame, or a message may span frames.
                while _RECORD_SEPARATOR in buffer:
                    msg_str, buffer = buffer.split(
                        _RECORD_SEPARATOR, 1
                    )
                    msg_str = msg_str.strip()
                    if not msg_str:
                        continue

                    try:
                        msg = json.loads(msg_str)
                    except json.JSONDecodeError:
                        logger.warning(
                            "Failed to parse SignalR message: %r",
                            msg_str[:200],
                        )
                        continue

                    await self._handle_message(
                        ws, msg, recv_ts, callback
                    )

    # ------------------------------------------------------------------
    # Message handling
    # ------------------------------------------------------------------

    _raw_msg_count = 0

    async def _handle_message(
        self,
        ws: Any,
        msg: dict[str, Any],
        recv_ts: float,
        callback: Callable[[str, dict, float], Awaitable[None]],
    ) -> None:
        """Dispatch a single parsed SignalR message."""
        msg_type = msg.get("type")

        # Log first 50 raw messages to understand full message flow
        self._raw_msg_count += 1
        if self._raw_msg_count <= 50:
            logger.info("RAW MSG #%d: type=%s keys=%s preview=%r",
                        self._raw_msg_count, msg_type,
                        list(msg.keys()),
                        str(msg)[:300])

        if msg_type == _MSG_PING:
            # Respond to server pings immediately.
            await self._send(ws, {"type": _MSG_PING})
            return

        if msg_type == _MSG_CLOSE:
            error = msg.get("error", "")
            logger.info("Server sent close frame: %s", error or "(clean)")
            # Returning from _run_session will trigger reconnect logic.
            return

        if msg_type == _MSG_INVOCATION:
            target = msg.get("target", "")
            arguments = msg.get("arguments", [])
            if target not in self._seen_targets:
                self._seen_targets.add(target)
                logger.info("New invocation target: %s", target)
            if not target:
                return

            # Arguments is typically a list with a single dict element.
            data: dict[str, Any] = arguments[0] if arguments else {}

            # Decompress .z topics (base64 + zlib deflate)
            if target.endswith(".z") and isinstance(data, str):
                try:
                    raw_bytes = base64.b64decode(data)
                    decompressed = zlib.decompress(raw_bytes, -zlib.MAX_WBITS)
                    data = json.loads(decompressed)
                    # Strip .z suffix for downstream handlers
                    target = target[:-2]
                except Exception:
                    logger.warning("Failed to decompress %s payload", target)
                    return

            # "feed" is a multiplexed payload containing updates for
            # multiple topics in a single message.
            if target == "feed":
                # Only log non-TimingData feed topics in detail to reduce noise
                topic_preview = str(arguments[0])[:80] if arguments else "EMPTY"
                if topic_preview != "TimingData":
                    logger.info(
                        "Feed msg: %d args, types=%s, topics=%r",
                        len(arguments),
                        [type(a).__name__ for a in arguments[:4]],
                        topic_preview,
                    )
                    if len(arguments) >= 3:
                        logger.info("Feed arg2: type=%s, preview=%r",
                                    type(arguments[2]).__name__,
                                    str(arguments[2])[:200])

                # Format A: arguments = [topic_name, data]
                if len(arguments) >= 2 and isinstance(arguments[0], str):
                    feed_topic = arguments[0]
                    feed_data = arguments[1]

                    # Decompress .z topics
                    if feed_topic.endswith(".z") and isinstance(feed_data, str):
                        try:
                            raw_bytes = base64.b64decode(feed_data)
                            feed_data = json.loads(
                                zlib.decompress(raw_bytes, -zlib.MAX_WBITS)
                            )
                            feed_topic = feed_topic[:-2]
                        except Exception:
                            logger.warning("Failed to decompress feed %s", feed_topic)
                            return

                    if isinstance(feed_data, dict):
                        try:
                            await callback(feed_topic, feed_data, recv_ts)
                        except Exception:
                            logger.exception(
                                "Error in callback for feed topic %s", feed_topic
                            )
                    return

                # Format B: arguments = [dict_with_topic_keys]
                if len(arguments) >= 1 and isinstance(arguments[0], dict):
                    for feed_topic, feed_data in arguments[0].items():
                        if isinstance(feed_topic, str) and feed_topic.endswith(".z") and isinstance(feed_data, str):
                            try:
                                raw_bytes = base64.b64decode(feed_data)
                                feed_data = json.loads(
                                    zlib.decompress(raw_bytes, -zlib.MAX_WBITS)
                                )
                                feed_topic = feed_topic[:-2]
                            except Exception:
                                continue
                        if isinstance(feed_data, dict):
                            try:
                                await callback(feed_topic, feed_data, recv_ts)
                            except Exception:
                                logger.exception(
                                    "Error in callback for feed topic %s", feed_topic
                                )
                    return

                # Unknown format — log and skip
                logger.warning("Unrecognized feed format: %d args", len(arguments))
                return

            try:
                await callback(target, data, recv_ts)
            except Exception:
                logger.exception(
                    "Error in callback for topic %s", target
                )
            return

        # Completion message (type 3) — contains initial state from Subscribe
        if msg_type == 3:
            result = msg.get("result")
            if result and isinstance(result, dict):
                logger.info("Received Subscribe completion with %d topics", len(result))
                for topic_name, topic_data in result.items():
                    effective_name = topic_name
                    # Decompress .z topics (base64 + zlib) before type check
                    if topic_name.endswith(".z") and isinstance(topic_data, str):
                        try:
                            raw_bytes = base64.b64decode(topic_data)
                            topic_data = json.loads(zlib.decompress(raw_bytes, -zlib.MAX_WBITS))
                            effective_name = topic_name[:-2]
                        except Exception:
                            continue
                    if not isinstance(topic_data, dict):
                        continue
                    try:
                        await callback(effective_name, topic_data, recv_ts)
                    except Exception:
                        logger.exception("Error in callback for initial %s", effective_name)
            return

        # Stream item (type 2) — may contain Position.z data
        if msg_type == 2:
            item = msg.get("item")
            invocation_id = msg.get("invocationId", "")
            logger.info(
                "StreamItem: invocationId=%s, item type=%s, preview=%r",
                invocation_id,
                type(item).__name__ if item is not None else "None",
                str(item)[:200] if item else "EMPTY",
            )
            if isinstance(item, dict):
                try:
                    await callback("Position", item, recv_ts)
                except Exception:
                    logger.exception("Error in callback for StreamItem")
            elif isinstance(item, str):
                # Might be compressed
                try:
                    raw_bytes = base64.b64decode(item)
                    decompressed = json.loads(
                        zlib.decompress(raw_bytes, -zlib.MAX_WBITS)
                    )
                    if isinstance(decompressed, dict):
                        await callback("Position", decompressed, recv_ts)
                except Exception:
                    pass
            return

        # Other message types — log and ignore.
        if msg_type is not None:
            logger.info("Unknown SignalR message type %s: %r", msg_type, str(msg)[:300])

    # ------------------------------------------------------------------
    # Send helper
    # ------------------------------------------------------------------

    @staticmethod
    async def _send(ws: Any, payload: dict[str, Any]) -> None:
        """Serialize *payload* as JSON + record separator and send."""
        raw = json.dumps(payload, separators=(",", ":")) + _RECORD_SEPARATOR
        await ws.send(raw)
