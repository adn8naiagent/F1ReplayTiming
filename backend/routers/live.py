"""Live timing WebSocket endpoint.

Streams real-time F1 timing data to connected clients.
Uses the test replayer for development (when test data exists locally)
and the real SignalR client for production (live sessions).
"""

import asyncio
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])

# Shared live session state
_live_sessions: dict[str, "LiveSession"] = {}


class LiveSession:
    """Manages a single live timing session with fan-out to multiple clients."""

    def __init__(self, key: str, session_type: str):
        self.key = key
        self.session_type = session_type
        self.clients: list[WebSocket] = []
        self._state_manager = None
        self._replayer = None
        self._signalr_client = None
        self._task: asyncio.Task | None = None
        self._started = False
        self._mode = "none"  # "replayer" or "signalr"
        self._msg_logged = False
        self._radio_tasks: set[asyncio.Task] = set()
        self._recorded_positions = False
        self._year: int | None = None  # picks the team radio caption vocabulary

    async def start(
        self,
        year: int = 0,
        round_num: int = 0,
        data_dir: str | None = None,
        speed: float = 10.0,
        use_signalr: bool = False,
    ):
        """Start the live session.

        If data_dir is provided, uses the test replayer.
        If use_signalr is True, connects to the real F1 SignalR stream.
        """
        if self._started:
            return
        self._year = year or None

        from services.live_state import LiveStateManager
        from services.storage import get_json

        # Initialize state manager with pit loss data
        pit_loss_green = 0.0
        pit_loss_sc = 0.0
        pit_loss_vsc = 0.0
        is_race = self.session_type in ("R", "S")

        if is_race:
            pit_data = get_json("pit_loss.json")
            if pit_data:
                ga = pit_data.get("global_averages", {})
                pit_loss_green = ga.get("green", 22.0)
                pit_loss_sc = ga.get("sc", 10.0)
                pit_loss_vsc = ga.get("vsc", 14.5)

        # Load track normalization params and outline for position mapping
        track_norm = None
        track_points = None
        if year and round_num:
            track_data = _find_track_data(year, round_num, self.session_type)
            if track_data:
                track_norm = track_data.get("norm")
                track_points = track_data.get("track_points")
                if track_norm and track_points:
                    logger.info(f"Loaded track data for live session {year}/{round_num}/{self.session_type}: "
                                f"{len(track_points)} points, norm={track_norm}")

        self._state_manager = LiveStateManager(
            session_type=self.session_type,
            pit_loss_green=pit_loss_green,
            pit_loss_sc=pit_loss_sc,
            pit_loss_vsc=pit_loss_vsc,
            track_norm=track_norm,
            track_points=track_points,
            # The test replayer runs at `speed`; positions play out at the same rate
            clock_rate=speed if data_dir else 1.0,
        )

        if data_dir:
            # Recordings made while signed in include car positions
            self._recorded_positions = os.path.exists(os.path.join(data_dir, "Position.z.jsonStream"))
            from services.live_test_replayer import LiveTestReplayer
            self._replayer = LiveTestReplayer(data_dir, speed_multiplier=speed)
            self._replayer.load()
            self._task = asyncio.create_task(self._run_replayer())
            self._mode = "replayer"
        elif use_signalr:
            from services.live_signalr import LiveSignalRClient
            self._signalr_client = LiveSignalRClient()
            self._task = asyncio.create_task(self._run_signalr())
            self._mode = "signalr"

        self._started = True
        logger.info(f"Live session started: {self.key} (mode={self._mode})")

        # Team radio needs an F1 TV sign-in; load Whisper now rather than on
        # the first clip.
        from services import f1_account, team_radio
        if f1_account.ready():
            asyncio.create_task(asyncio.to_thread(team_radio.warm_up, True))

    async def _run_replayer(self):
        """Run the test replayer, feeding messages into the state manager."""
        try:
            await self._replayer.replay(self._on_message)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Replayer error: {e}")

    def laps_key(self) -> tuple | None:
        """Changes whenever the lap history does."""
        sm = self._state_manager
        if sm is None:
            return None
        return (sm.laps.version, len(sm._quali_parts), sm._session_start)

    def laps_message(self) -> dict | None:
        return self._state_manager.laps_message() if self._state_manager else None

    def signed_in(self) -> bool:
        """Whether this session gets car positions and telemetry (an F1 TV
        sign-in, or a recording that has them)."""
        if self._signalr_client is not None:
            return self._signalr_client.signed_in
        return self._recorded_positions

    def feed_error(self) -> str | None:
        """Why the connection to F1 is failing, if it is."""
        return self._signalr_client.last_error if self._signalr_client else None

    async def _run_signalr(self):
        """Run the real SignalR client, feeding messages into the state manager."""
        try:
            await self._signalr_client.connect(self._on_message)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"SignalR error: {e}")

    async def _on_message(self, topic: str, data: dict, timestamp: float):
        """Handle a message from the replayer or SignalR client."""
        if not self._msg_logged:
            logger.info(f"First SignalR message received: topic={topic}")
            self._msg_logged = True
        self._state_manager.process_message(topic, data, timestamp)
        if topic in ("TeamRadio", "SessionInfo"):
            self._caption_new_radio()

    def _caption_new_radio(self):
        """Caption new team radio clips in the background. A clip only goes
        out to clients once captioned (a second or two each)."""
        for clip in self._state_manager.take_new_radio():
            task = asyncio.create_task(self._caption(clip))
            self._radio_tasks.add(task)
            task.add_done_callback(self._radio_tasks.discard)

    async def _caption(self, clip: dict):
        from services import team_radio

        transcript = None
        if team_radio.captions_enabled():
            audio = await asyncio.to_thread(team_radio.fetch_audio, clip["url"])
            if audio:
                context = self._state_manager.radio_context(clip["racing_number"]) if self._state_manager else {}
                transcript = await asyncio.to_thread(
                    team_radio.caption, audio, clip.get("first_name"), self._year, context, True,
                )
        if self._state_manager is not None:
            self._state_manager.set_radio_caption(clip["id"], transcript)

    def get_frame(self) -> dict | None:
        """Get the current frame from the state manager."""
        if self._state_manager is None:
            return None
        return self._state_manager.get_frame()

    def skip_forward(self, seconds: float):
        """Skip forward in the replayer, processing all skipped messages instantly."""
        if self._mode != "replayer" or not self._replayer:
            return
        replayer = self._replayer
        current_ts = replayer.current_timestamp
        target_ts = current_ts + seconds
        # Process all messages between current and target through state manager
        idx = replayer._current_index
        while idx < len(replayer._messages) and replayer._messages[idx].timestamp < target_ts:
            msg = replayer._messages[idx]
            self._state_manager.process_message(msg.topic, msg.data, msg.timestamp)
            idx += 1
        replayer._current_index = idx
        self._state_manager.skip_new_radio()
        logger.info(f"Skipped forward {seconds}s: {current_ts:.1f}s -> {target_ts:.1f}s (idx {idx})")

    def add_client(self, ws: WebSocket):
        self.clients.append(ws)

    def remove_client(self, ws: WebSocket):
        if ws in self.clients:
            self.clients.remove(ws)

    @property
    def client_count(self) -> int:
        return len(self.clients)

    async def stop(self):
        if self._replayer:
            self._replayer.stop()
        for task in list(self._radio_tasks):
            task.cancel()
        # Free the Whisper model once no live session needs it
        if not any(s is not self and s._started for s in _live_sessions.values()):
            from services import team_radio
            team_radio.release_model()
        if self._signalr_client:
            await self._signalr_client.disconnect()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._started = False
        logger.info(f"Live session stopped: {self.key}")


def _find_track_data(year: int, round_num: int, session_type: str) -> dict | None:
    """Find track data for a session, with fallback to other sessions/years.

    Tries in order:
    1. Exact match: this year/round/session
    2. Other session types at this year/round (R, Q, S, FP1, etc.)
    3. Same round in previous years (circuits sometimes keep same round number)
    """
    from services.storage import get_json

    # 1. Exact match
    data = get_json(f"sessions/{year}/{round_num}/{session_type}/track.json")
    if data:
        return data

    # 2. Other session types at the same year/round
    for alt_type in ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3"):
        if alt_type == session_type:
            continue
        data = get_json(f"sessions/{year}/{round_num}/{alt_type}/track.json")
        if data:
            logger.info(f"Track data fallback: using {year}/{round_num}/{alt_type} for {session_type}")
            return data

    # 3. Previous years, same round number (track outlines rarely change)
    for prev_year in range(year - 1, year - 4, -1):
        for alt_type in ("R", "Q"):
            data = get_json(f"sessions/{prev_year}/{round_num}/{alt_type}/track.json")
            if data:
                logger.info(f"Track data fallback: using {prev_year}/{round_num}/{alt_type} for {year}/{round_num}/{session_type}")
                return data

    return None


def _get_test_data_dir(year: int, round_num: int, session_type: str) -> str | None:
    """Find test data directory for a given session."""
    base = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "live_test")
    path = os.path.join(base, f"{year}_{round_num}_{session_type}")
    if os.path.isdir(path):
        return path
    return None


async def _get_or_create_session(
    year: int, round_num: int, session_type: str, speed: float, source: str
) -> LiveSession | None:
    """Get existing live session or create a new one.

    source: "auto" (test data if available, else SignalR), "test", or "signalr"
    """
    key = f"{year}_{round_num}_{session_type}"

    if key not in _live_sessions:
        data_dir = _get_test_data_dir(year, round_num, session_type)

        if source == "signalr":
            # Force real SignalR connection
            session = LiveSession(key, session_type)
            _live_sessions[key] = session
            await session.start(year=year, round_num=round_num, use_signalr=True)
        elif source == "test" and data_dir:
            # Force test replayer
            session = LiveSession(key, session_type)
            _live_sessions[key] = session
            await session.start(year=year, round_num=round_num, data_dir=data_dir, speed=speed)
        elif source == "auto":
            # Auto: use test data if available, otherwise try SignalR
            if data_dir:
                session = LiveSession(key, session_type)
                _live_sessions[key] = session
                await session.start(year=year, round_num=round_num, data_dir=data_dir, speed=speed)
            else:
                session = LiveSession(key, session_type)
                _live_sessions[key] = session
                await session.start(year=year, round_num=round_num, use_signalr=True)
        else:
            return None

    return _live_sessions[key]


@router.websocket("/ws/live/{year}/{round_num}")
async def live_websocket(
    websocket: WebSocket,
    year: int,
    round_num: int,
    type: str = Query("R"),
    speed: float = Query(10.0),
    source: str = Query("auto"),
    token: str = Query(""),
):
    from auth import is_auth_enabled, verify_token
    from app_config import is_public_mode, is_valid_session

    # Check before accepting, so a refused client never gets an open socket
    # (and never causes an upstream connection to F1's live timing).
    if is_auth_enabled() and not verify_token(token):
        await websocket.close(code=4401, reason="Unauthorized")
        return
    if is_public_mode():
        await websocket.close(code=4403, reason="Live timing is not available here")
        return
    if not is_valid_session(year, round_num, type) or source not in ("auto", "test", "signalr"):
        await websocket.close(code=4400, reason="Invalid session")
        return

    await websocket.accept()

    session = None
    try:
        session = await _get_or_create_session(year, round_num, type, speed, source)

        if session is None:
            await websocket.send_json({
                "type": "error",
                "message": f"No live timing data available for {year}/{round_num}/{type}. "
                           "Download test data with: python backend/scripts/download_test_session.py "
                           f"--year {year} --round {round_num} --session {type}",
            })
            await websocket.close()
            return

        session.add_client(websocket)

        await websocket.send_json({
            "type": "ready",
            "mode": "live",
            "total_frames": 0,
            "total_time": 0,
            "total_laps": 0,
            "quali_phases": None,
        })

        # Broadcast loop: push frames to this client at ~2Hz
        frame_interval = 0.5

        async def handle_commands():
            """Listen for client commands."""
            try:
                while True:
                    raw = await websocket.receive_text()
                    logger.debug(f"Live WS command: {raw}")
                    try:
                        cmd = __import__("json").loads(raw)
                        if cmd.get("command") == "skip" and session:
                            skip_seconds = float(cmd.get("seconds", 300))
                            session.skip_forward(skip_seconds)
                    except Exception:
                        pass
            except WebSocketDisconnect:
                pass

        command_task = asyncio.create_task(handle_commands())

        sent_error: str | None = None
        sent_laps_key = None
        try:
            while True:
                # Lap history: the whole list when it changes (a lap completes
                # every few seconds at most), for Lap Analysis
                laps_key = session.laps_key()
                if laps_key is not None and laps_key != sent_laps_key:
                    message = session.laps_message()
                    if message is not None:
                        await websocket.send_json({"type": "laps", **message})
                    sent_laps_key = laps_key

                # Tell the page when F1 refuses the connection, and when it recovers
                error = session.feed_error()
                if error != sent_error:
                    await websocket.send_json({"type": "feed_error", "message": error})
                    sent_error = error

                frame = session.get_frame()
                if frame:
                    await websocket.send_json({"type": "frame", **frame, "signed_in": session.signed_in()})

                    # Check if session has finished (only after it was actually started)
                    if (session._state_manager
                        and session._state_manager._session_was_started
                        and session._state_manager.session_status in ("Finalised", "Finished")):
                        await websocket.send_json({
                            "type": "finished",
                            "message": "Session ended. Full replay with track positions and telemetry will be available shortly.",
                        })
                        break

                await asyncio.sleep(frame_interval)
        finally:
            command_task.cancel()

    except WebSocketDisconnect:
        logger.info(f"Live WS disconnected: {year}/{round_num}")
    except Exception as e:
        logger.error(f"Live WS error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
    finally:
        if session:
            session.remove_client(websocket)
            # Clean up session if no more clients (delay slightly to allow
            # React Strict Mode remounts to reuse the session)
            if session.client_count == 0:
                await asyncio.sleep(2)
                if session.client_count == 0:
                    key = f"{year}_{round_num}_{type}"
                    if key in _live_sessions:
                        await session.stop()
                        del _live_sessions[key]
