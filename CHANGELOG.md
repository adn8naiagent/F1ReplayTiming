# Changelog

All notable changes to F1 Replay Timing will be documented in this file.

## 2.1.3

### Improvements

- **Storage management** — a **Storage** button in the header shows total disk use and sets a retention policy: sessions older than a chosen number of weeks or months are deleted, immediately and then daily. Individual sessions can be deleted by right-clicking them in the session picker. (requested by [@db-can](https://github.com/db-can))

### Fixes

- **Replay froze after a dropped connection** — an idle replay sent no data, so proxies could close the socket and the client never reconnected. The server now sends a keep-alive every 20s, and the client reconnects and resumes where it left off. ([#106](https://github.com/adn8naiagent/F1ReplayTiming/issues/106), reported by [@nbolland](https://github.com/nbolland))

- **App unreachable behind a reverse proxy when `PORT` was set** — 2.1.2 passed `PORT` into the container, moving the port proxies point at (Traefik, nginx and cloudflared all target 8000). The container now always listens on 8000; `PORT` sets the published host port only. (found while investigating [#106](https://github.com/adn8naiagent/F1ReplayTiming/issues/106), reported by [@nbolland](https://github.com/nbolland))

## 2.1.2

### Fixes

- **Jagged track map** — circuits drew as a coarse polygon when a session's position feed repeated coordinates instead of updating them (the 2026 Hungarian race gave 26 usable points a lap, against ~300 in qualifying). The outline lap is now chosen by position detail rather than lap time, falling back to another session from the same weekend. Requires re-compute for affected sessions. (reported by [@starscream10](https://github.com/starscream10))

- **`PORT` ignored in Docker** — setting `PORT` published one port but left the container listening on 8000, so the app was unreachable and only 8000 worked. Compose now maps the same port on both sides. (reported by [@guilleortas](https://github.com/guilleortas))

## 2.1.1

### Improvements

- **Reprocess a session from the picker** Right-click (or long-press on touch) a session on the home page for a menu to open it in a new tab or window, or reprocess its data. Reprocess rebuilds the stored session, which is required for some new features (eg track elevation). Alternative to using CLI.

## 2.1

### Improvements

- **Track elevation overlay** The track map can now colour the circuit by elevation, from dark (lowest point) to bright (highest), on a fixed scale so flat tracks look flat and hilly tracks stand out. Toggle in Settings>Track Map. Requires re-compute for existing sessions. (suggested by [@db-can](https://github.com/db-can))

- **Downloaded session marker** A green dot now appears next to sessions that are already processed and ready to play instantly. Hover over a session to see its stored size. (suggested by [@avergeichik](https://github.com/avergeichik))

### Fixes

- **Live leaderboard column overflow** — the live leaderboard column spacing fixed on 1080x1920 resolution where tyre age was overflowing. (reported by [@meekha3l](https://github.com/meekha3l))

## 2.0.2

### Improvements

- **Qualifying lap notifications** — as each driver crosses the line in qualifying, a bubble appears at the top of the track map showing their lap time and sector markers. Toggleable in Settings>Leaderboard.

- **Knocked-out drivers in qualifying** — drivers eliminated in Q1/Q2 are now greyed out once the next session begins, instead of continuing to display as active. Drivers keep their position and the lap time they posted. Applies to both replay and live timing. Requires re-compute for historical qualifying sessions.

### Fixes

- **Qualifying sector timing** — live sector markers (yellow, green purple) were delayed, now fixed. Requires re-compute for historical qualifying sessions.

## 2.0.1

### Improvements

- **Broadcast delay up to 5 minutes** — Live Timing Offset slider now extends to -5m (previously -60s) to accommodate longer streaming-service lag, with M:SS formatting and ±30s quick-adjust buttons
- **Configurable auto-precompute** — new `AUTO_PRECOMPUTE` env var controls which session types the background task fetches during race weekends. Accepts `off`, `race`, `race+qual` (default), or `all`. Self-hosters who don't watch practice can avoid downloading FP1/FP2/FP3 data; sessions outside the configured set are still available on-demand

---

## 2.0.0

### Migrating from v1.x

The Docker image has changed. The old `f1replaytiming-backend` and `f1replaytiming-frontend` images will no longer receive updates. The new image is `ghcr.io/adn8naiagent/f1replaytiming:latest` (single unified image).

To migrate:

1. Pull the new image: `docker pull ghcr.io/adn8naiagent/f1replaytiming:latest`
2. Copy `.env.example` to `.env` and configure (most defaults work out of the box)
3. Replace your `docker-compose.yml` with the one from the repo. It's now a single service on one port
4. `docker compose up`

You no longer need `NEXT_PUBLIC_API_URL`, `FRONTEND_URL`, or any CORS settings. Your session data volume carries over as-is, no reprocessing needed.

### Breaking Changes

- **Single container architecture** — frontend and backend are now merged into a single Docker container serving everything from one port. The separate frontend and backend containers have been removed
- **Simplified configuration** — all config is now in a single `.env` file. `NEXT_PUBLIC_API_URL`, `FRONTEND_URL`, and CORS configuration are no longer needed
- **Static frontend** — Next.js switched from `output: 'standalone'` to `output: 'export'`, producing static HTML/CSS/JS served by FastAPI. No Node.js runtime in the final image
- **URL format change** — dynamic routes (`/replay/2026/5`) replaced with query parameters (`/replay?year=2026&round=5&type=R`). Old URLs redirect automatically

### Improvements

- **No CORS** — frontend and API are the same origin, eliminating all cross-origin issues
- **Reverse proxy friendly** — single port means Traefik, nginx, and Cloudflare tunnels just work with no special configuration
- **WebSocket reliability** — same-origin WebSocket connections no longer break behind TLS termination or mixed protocol proxies
- **Screen wake lock** — prevents screen dimming and device sleep during replay playback and live sessions

---

## 1.3.2.2

### Fixes

- **Replay timing drift** — replaced fixed-duration sleeps with wall-clock-anchored playback to prevent timing drift during sessions (contributed by [@stephenwilley](https://github.com/stephenwilley))

---

## 1.3.2.1

### Fixes

- **Lap analysis lap number** — fixed showing incomplete current lap data; now only displays completed laps

---

## 1.3.2

### Improvements

- **Practice sector indicators** — live sector colours and track map sector overlay now available in practice sessions. Requires recompute
- **Last lap time for all sessions** — now available in practice and qualifying. Requires recompute
- **Last lap colour coding** — purple for fastest lap, green for personal best
- **Processing feedback** — real-time status messages during on-demand processing
- **Broadcast delay modal** — redesigned with quick adjust buttons and exact entry
- **Open all data panels** — toggle in Settings > Other to open telemetry, race control, and lap analysis (race only) in a single click. Closes automatically when any panel is hidden
- **Persistent panel layout** — panel states (telemetry, race control, lap analysis, sectors) are remembered per session type (race, qualifying, practice) across page loads
- **High contrast text** — toggle in Settings > Other for white text on muted elements

### Fixes

- **Practice session precompute** — fixed timestamp alignment for practice sessions causing leaderboard to show future data. Requires recompute
- **Practice session time** — countdown aligned to 60-minute session duration, not overall replay length
- **Mobile qualifying time** — now shows remaining time counting down, matching desktop
- **PiP leaderboard scroll** — leaderboard no longer cut off by playback controls
- **Minor UI layout fixes** — spacing and alignment across mobile, tablet, and desktop

---

## 1.3.1

### Fixes

- **Live session banner width** — live session card on the home page now matches the width of the round cards
- **Medium screen layout** — track map, lap analysis panel, and leaderboard no longer overflow on tablet-sized screens when lap analysis is open

---

## 1.3.0

### New Features

- **Lap Analysis panel** (Beta) — compare lap times for up to two drivers with a line chart and full lap-by-lap history. Accessible via the Laps button on the track map on desktop, or as a collapsible section on mobile. Race replay only
- **Last lap time column** — shows each driver's most recently completed lap time on the race leaderboard, toggleable in settings. Race replay only
- **Leaderboard tooltips** — hover over any column value to see what it is (e.g. "Interval to car ahead", "Tyre age", "Last lap time")

### Improvements

- **Info button on mobile** — the features/info link is now visible in the mobile header
- **Features page opens in new tab** — no longer interrupts an active replay session

### Fixes

- **Mobile qualifying sectors** — sector overlay toggle and driver selection buttons now available on mobile track map, previously desktop-only
- **Mobile leaderboard spacing** — improved UI layout for mobile Leaderboard

---

## 1.2.3 — Track detail, telemetry expansion, and race finish improvements

### New Features

- **Marshal sector flags** — localised yellow/double yellow flags on the track map at marshal sector positions. Requires recompute
- **Corner numbers** — turn numbers shown on the track map from FastF1 circuit data. Toggleable in settings. Requires recompute
- **Expanded telemetry** — unlimited driver selection. 3+ drivers open a moveable side panel with pinnable race control
- **Draggable race control** — RC panel can be repositioned anywhere on the track map
- **RC sound notification** — optional alert sound for new race control messages
- **Full screen mode** — hides session banner and enters browser fullscreen
- **Imperial units** — toggle for °F, mph in settings
- **Pit stop timer** — live count-up shown in gap column while driver is in pit lane. Requires recompute

### Improvements

- **Pit prediction accuracy** — recalculated using precise pit lane timestamps. Unified 73% SC/VSC factor
- **Qualifying sector selection** — sector overlay buttons for all selected drivers
- **Settings modal** — redesigned as tabbed sidebar (Leaderboard, Weather, Track Map, Race Control, Other)
- **Features page** — consolidated with info panel content

### Fixes

- **Race finish** — drivers stay on leaderboard at classified position with chequered flag icon. Requires recompute
- **Track map bounds** — drivers no longer fly off screen with invalid position data
- **iPad viewport** — layout accounts for browser address bar
- **PiP on iOS** — hidden on unsupported devices

---

## 1.2.2

### Improvements

- **Mobile race control** added collapsible race control messages section to mobile view for both live and replay
- **<1sec interval highlight** intervals under 1 second are highlighted in green during race sessions (toggleable in settings)
- **Live session styling** improved pulse animation on live indicators and cleaner live session button layout (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- **Broadcast delay** added manual input field for exact delay value
- **Minor UI/UX improvements** main page layout changed to expandable list, fixed minor UI bugs on navigation

### Fixes

- **Memory management** replay session data is now evicted from memory 5 minutes after the last client disconnects
- **Live race control messages** fixed race control messages not updating during live sessions when broadcast delay is set
- **Phantom tyre compounds** fixed incorrect tyre history in live sessions caused by interim/placeholder compound updates from the F1 feed
- **Live qualifying sectors** fixed sector indicators not clearing after lap completion (now clears after 5 seconds) and fixed multiple drivers showing purple in the same sector by computing colours from actual times
- **Session times** corrected session times to display local date with time

---

## 1.2.1 - 2026-03-14

### Fixes

- **Connection error screen** - when the frontend cannot reach the backend, a clear error message is now shown instead of the passphrase screen, with the attempted URL and troubleshooting tips
- **Runtime API URL for Docker** - `NEXT_PUBLIC_API_URL` can now be set as a runtime environment variable on the frontend container, so pre-built Docker images work with any backend URL without rebuilding. See the README for details
- Fixed loading overlay staying visible when navigating back to the session picker

### New Features

- **Red flag countdown and skip** - during red flag periods in replay mode, a countdown timer shows how long until the session resumes, with a button to skip ahead to the restart

---

## 1.2.0 - 2026-03-14

### New Features

- **Live Timing** - real-time timing data via F1 SignalR stream, with broadcast delay slider, post-session replay check, and PiP window support
- **Race Control Messages** - live feed of steward decisions, investigations, penalties, track limits, and flag changes accessible via the RC button on the track map (available in both live and replay modes)
- **Driver Indicators** - investigation (warning triangle) and penalty (circled exclamation) icons on the leaderboard, with automatic clearing when stewards resolve incidents

### Improvements

- **Broadcast delay slider now persists** - your delay setting is saved and restored across page loads, so you only need to set it once to match your streaming service or broadcast feed
- **Docker images published to GHCR** - pre-built images are now automatically published to GitHub Container Registry on each release, so users can deploy with just a `docker-compose.yml` without cloning the repo
- PiP window track map and driver positions now continue updating when switching windows (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- Session picker shows session start times in the user's local timezone (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- Improved Docker Compose configuration with clearer comments on port and URL customisation

### Known Limitations

- **Live timing: no track positions or telemetry** - Driver positions on the track map and telemetry data are not available during live sessions. Position data requires an authenticated F1 TV subscription. Full track positions and telemetry become available in replay mode once session data is processed (typically 1–2 hours after the session).

### Note

- Race control messages in replay mode require a re-run of precompute for each session to take effect.
- Best lap time and gap to leader columns for practice/qualifying require a re-run of precompute for existing sessions. Live sessions work immediately.

## 1.1.0 - 2026-03-10

### New Features

- Docker Compose support for self-hosting - run the full app with `docker compose up`
- Picture-in-Picture popup window with collapsible track map, telemetry, and leaderboard sections (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- Clipboard paste support for leaderboard sync - users can now paste a screenshot of the F1 TV broadcast leaderboard directly from clipboard (Ctrl+V) instead of uploading a file, with a visual Ctrl+V hint in the UI (contributed by [@Clav3rbot](https://github.com/Clav3rbot))

### Improvements

- Season schedule data is now fetched on demand from FastF1 when not already in storage, removing the need to run precompute before using the app
- Leaderboard interval/leader toggle replaced with a clickable pill on the P1 row
- Leaderboard no longer wastes horizontal space when scaled down to fit shorter viewports
- Pit prediction now appears from lap 5 onwards (previously lap 15)
- Session picker shows a LIVE banner and session badges when a session is active or starting soon
- Penalty indicator on leaderboard now clears when the penalty is served
- Sector overlay on track map for qualifying sessions

## 1.0.1 - 2026-03-07

### Improvements

- Improved mobile layout, including track map rendering and playback controls
- Starting grid positions now fall back to qualifying result data when grid position data is unavailable
- Retired drivers now remain on the leaderboard in their final position, marked as "Out"
- Overall improvements to interval timing, including handling of lapped drivers
- Minor UI consistency fixes

### Bug Fixes

- Drivers with unavailable position data are now temporarily hidden from the track map and restored automatically when data resumes

### Security

- Upgraded Next.js 14 to 15 and React 18 to 19

### Note

For the position data, starting grid position, retired driver, and interval timing fixes to take effect, you'll need to re-run precompute for any Race sessions.
