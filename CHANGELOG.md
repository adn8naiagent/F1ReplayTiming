# Changelog

All notable changes to F1 Replay Timing will be documented in this file.

## 2.5.1

### Features

- **F1 TV broadcast in live timing** — with F1 TV Pro or Premium, switch the live track map to **Broadcast** to watch the session live, with the same views, onboards, track map, race control and team radio as in replays. The app finds the stream once F1 TV marks the session as live, and checks again every 30 seconds until it's streaming. The timing is held back to match the video, and the delay button shows the broadcast's delay while it's on. The sync uses the video's time stamp; where F1 TV doesn't encrypt the onboards' sound, it's checked against the engine sound. **Fine-tune video sync** adds to it.

- **More multi-view layouts** — **Main + 2**, **Main + 4**, **Side by side**, **2×2** and **Grid** (three across and two down, with the track map bottom right), picked from box icons in the hover controls. **⇄** on a view swaps it into the main view, and **Main view** picks what the main view shows: the broadcast or any driver's onboard. Swapping doesn't reload the videos.

- **Sound per view** — the sound follows the main view; a view's speaker button plays its sound instead.

- **Leader crossed the line** — in races and sprints, press it under **Fine-tune video sync** as the leader crosses the line on screen (when the lap count changes) to line the timing up with that moment. Works in live timing and replays, within 30 seconds of a lap change.

### Improvements

- **Live timing goes back to the broadcast's moment** — the server keeps the last two minutes of live timing and sends them when the page opens, so turning the broadcast on, or making the delay longer, jumps the timing back instead of freezing it. If the server has only just connected and has less timing than the delay, a notice over the timing tower and track map says how far the timing is held back and counts down until it shows.

- **Live timing looks like replays** — the lap count, broadcast mute and volume, and the fullscreen button are in the bottom bar, where replays have them.

- **Sync status shows fine-tuning** — when the sync has been fine-tuned, the status says by how much.

- **Lap notifications and team radio show over the videos**, and view menus open above the other views and the track map, upwards when there's no room below.

- **Single view shows the track map over an onboard** in the main view too, following the Track map setting.

### Fixes

- **Live timing no longer asks you to sign in to F1 TV** — the notice is gone, as you're always signed in.

- **A refused live connection no longer signs F1 TV out** — when F1 refused live timing (for example on a VPN), the app treated the F1 TV sign-in as rejected and stopped using it.

## 2.5.0

### Features

- **F1 TV broadcast in replays** — replays only for now; not yet in live timing. With F1 TV Pro or Premium, switch the track map to **Broadcast** (top right of the track map) to watch the session's F1 TV replay in sync with the timing. The replay is found automatically, and the video follows the replay's play, pause, speed and skips.

- **Automatic broadcast sync** — the server lines the video up with the timing by matching the onboard cameras' engine sound to each driver's RPM, checked with a second driver. It runs when a session is processed (F1 TV protects some replays' audio later on), or, if that doesn't work, the first time the broadcast is opened, and is then saved. Adjust it by ±0.5s or ±5s from the hover controls; the adjustment shows as a chip whose × goes back to the automatic sync. Where F1 TV's audio is encrypted, the video's own time stamp is used instead.

- **Multi-view** — the broadcast with up to two onboard cameras and the track map beside it. Pick each onboard from a driver menu in the panel; your choices are remembered. Each onboard can show the driver's speed, gear, throttle and brake, and in qualifying and practice their mini-sectors as a coloured strip along the bottom edge, each switched on or off per onboard.

- **Single view** — the broadcast full width with the track map's lines over it.

- **Broadcast settings and controls** — **Settings > Broadcast** sets the view to open in, onboard telemetry and the track map. The hover controls switch the view, track map, race control, team radio and radio audio, and your choices are remembered; on touch screens, tap the video to show them. **Sync manually** lines the video up yourself; its controls only appear when you ask for them, or if the automatic sync fails. Race control shows as one line along the bottom of the broadcast when a message arrives, then fades, and team radio pops up at the top, as on the track map. Other F1 TV feeds (F1 Live, International, Driver Tracker and Data Channel, depending on the session and your account) can be picked from the hover controls, and a mute button sits at the left of the playback controls while the broadcast shows.

### Improvements

- **Team radio audio kept on your server** — processing a session now stores each radio clip's audio, and replays play it from your server instead of F1's. F1's timing server refuses some networks (VPNs and cloud hosts), which left radio silent even when signed in. For sessions processed before this version, add the audio with `python precompute.py 2026 --radio-audio-only`, or `docker compose exec f1timing python precompute.py 2026 --radio-audio-only` with Docker (needs a network F1 accepts); until then they play from F1 as before.

- **Exit in the replay header** — back to the home page, as in live timing.

- **Fewer missing team radio captions** — with **Improve captions with AI** on, a clip where Whisper heard several words keeps Whisper's caption if the AI model decides no one speaks, and a clip where Whisper heard nothing (its silence filters can drop noisy radio) gets a second, unfiltered Whisper attempt for the AI model to check against the audio. Applies to live timing and to sessions processed from now on; reprocess a session to redo its captions.

### Fixes

- **Clearer message when F1 blocks a VPN or cloud server** — when F1 refuses a download or live timing (HTTP 403), the message now says F1 blocks most VPNs and cloud servers and what to do: turn the VPN off, or process the session on another computer. The README has a new [VPNs and cloud servers](README.md#vpns-and-cloud-servers) section.

- **Failed downloads shown on the home page** — when a background download (`AUTO_PRECOMPUTE`) or a reprocess fails, the home page shows a warning with the session, when it happened and why, with a **Retry** button for each. The session also gets a warning icon in the list; hover over it for the reason. Before, background failures only showed in the server's logs, and a reprocess failure was lost if you closed its pop-up. The warning clears when the session next downloads; **Dismiss** hides it until another session fails. Self-hosted only.

> **What sessions and features need reprocessing?** The broadcast doesn't: it works on sessions you've already downloaded. A few things only apply to sessions processed from 2.5.0 on:
> - **Team radio audio on your server** — add it to downloaded sessions with `python precompute.py 2026 --radio-audio-only` (Docker: `docker compose exec f1timing python precompute.py 2026 --radio-audio-only`; no full reprocess needed), on a network F1 accepts.
> - **Improved team radio captions** — reprocess a session to redo its captions.
> - **Broadcast sync at processing time** — new sessions are synced while F1 TV's audio can still be read. Older sessions are synced the first time you open their broadcast, if F1 TV's audio can still be read then; otherwise the video's time stamp is used.
> - **Onboard sector strips** need mini-sectors, which sessions have if processed from 2.4.0 on (or after `--lap-extras-only`).

## 2.4.1

### Improvements

- **Mini-sectors in live timing** — in live qualifying and practice, the leaderboard's sector markers fill in mini-sector by mini-sector, as in replays. Desktop only; uses the same Mini-sectors setting. Nothing to reprocess: they come straight from F1's live timing.

- **Live telemetry** — when signed in to F1 TV, selected drivers show speed, throttle, brake, gear and RPM in live timing, as in replays. Cars parked in their pit box are left off the live map instead of piling up on the start/finish straight. ([@kungfoochef](https://github.com/kungfoochef))

- **Out-lap indicator** — in practice and qualifying, the leaderboard shows OUT in place of the sector markers (or mini-sectors) while a driver is on an out-lap, from pit exit until the lap is completed. Works in live timing and in replays. Replays of sessions processed before this version need a full reprocess to show it; `--lap-extras-only` doesn't add it. ([@kungfoochef](https://github.com/kungfoochef))

- **Team radio captions: separate live model, better prompt** — `TEAM_RADIO_LIVE_MODEL` sets a different Whisper model for live timing, so replays can use a larger, more accurate model (e.g. `large-v3-turbo`) while live captions stay fast enough for the broadcast delay. The caption prompt is shorter and follows the season (DRS up to 2025, boost and overtake mode from 2026), captions that are Whisper reading the prompt back on near-silent clips are dropped, and "tires" is spelled "tyres". ([@kungfoochef](https://github.com/kungfoochef))

- **AI team radio captions and choosing caption models in the app** — with `OPENROUTER_API_KEY` set, turn on **Improve captions with AI** in Settings > Team Radio: each clip's audio and Whisper's caption go to an AI model (default `google/gemini-3.5-flash-lite`, a few cents a race weekend) with the session's drivers and F1 terms, which listens and fixes misheard words, such as "our course" → "our cause". If a request fails, Whisper's caption is kept. The same tab sets the Whisper models for replays and live timing, with each model's size and speed. Settings in `.env` (`TEAM_RADIO_MODEL`, `TEAM_RADIO_LIVE_MODEL`, `TEAM_RADIO_AI`, `TEAM_RADIO_AI_MODEL`) win and show as locked. Choices are saved on each server, so servers sharing storage can use different models. Changes are applied with **Save**: a newly chosen model downloads in the background, with its progress shown, and captions keep using the current model until it's ready.

- **More of the replay track map and leaderboard in live timing** — live timing now shows the last lap time (purple for the session's fastest, green for a personal best, as F1 colours them), yellow and red flags at their marshal sector on the track map, and track elevation. In qualifying and practice, **Show Sectors** colours the track map by a selected driver's sectors, as in replays.

- **Lap Analysis, lap notifications and mini-sectors on the map in live timing** — live timing now records each lap as it's completed, with its sectors, tyre and pit stops, so the **Laps** panel works live: the lap chart and list in races, and the Sectors tab in qualifying and practice, with Q1/Q2/Q3 filtering. Laps deleted by the stewards are struck through, from race control's messages. Qualifying lap notifications, with sector times, work live too. With **Show Sectors** on, **Mini-sectors** colours the live track map once each mini-sector's position has been worked out from the cars, usually within a lap or two. In qualifying and practice, the **Compare** tab and **Track dominance** work live too: each lap's telemetry is recorded as it's driven. Laps completed before live timing connected aren't shown.

- **Show Sectors always shows a driver** — with one driver selected, the track map shows their sectors straight away; with two, switch between them beside the button; with none, it shows the leader's. Before, you had to select a driver and then pick them again. In replays and live timing.

### Fixes

- **Live timing stuck on "Waiting for session" when F1 refused the connection** — if F1 refuses the server's live timing connection (for example HTTP 403 from a blocked network such as a cloud host or VPN), the live page now says so instead of waiting, and keeps retrying. If it happens mid-session, a banner shows over the track map.

- **No cars in the live Picture-in-Picture map** — the pop-out track map in live timing now shows the cars. ([@kungfoochef](https://github.com/kungfoochef))

- **Parked cars showing 104% throttle with the brake on** — F1 sends 104 when it has no reading; live telemetry now shows these as zero. ([@kungfoochef](https://github.com/kungfoochef))

## 2.4.0

### Improvements

- **Lap Analysis for qualifying and practice** — the Laps panel now opens in every session. In qualifying and practice it has two tabs, both following the replay time:
  - **Sectors** — the session's best sectors and theoretical best lap, each driver's ideal lap, and a driver's laps with sector times coloured purple (session best) or green (personal best). Filter qualifying by Q1, Q2 and Q3; practice adds a chart of flying laps. Out and in laps are marked.
  - **Compare** — two drivers' best laps side by side, sector by sector. On desktop, traces along the lap (gap, speed, throttle, brake, gear, with corner numbers) and **Track dominance**, which colours the track map by who was faster through each part of the lap.

- **Mini-sectors** — in qualifying and practice, the leaderboard's sector markers fill in mini-sector by mini-sector, coloured as F1 shows them, and the focused driver's mini-sectors are drawn on the track map. On by default; switch between Sectors and Mini-sectors next to the Show/Hide Sectors button on the track map. Desktop only.

- **Deleted laps** — laps deleted by the stewards are struck through in Lap Analysis, with the reason on hover, and don't count towards bests.

- **Sector times in lap pop-ups** — the pop-up when a driver completes a lap shows each sector's time. Turn it off under Lap notifications in Settings.

Mini-sectors, deleted laps and sector end times need sessions reprocessed. Without that, sessions work as before, with normal sectors. Add just this data to processed sessions with `python precompute.py <years> --lap-extras-only` (downloads timing data but not telemetry, so it needs an F1 TV sign-in and the same network as other downloads).

## 2.3.1

> **Action needed:** since 15 October 2026 F1 requires an F1 TV subscription (Access or higher) to download timing data. After updating, run `pip install -r requirements.txt` (or rebuild the Docker image), set `F1TV_SECRET_KEY` in `.env` (`openssl rand -hex 32`), then sign in from **F1 TV** on the home page — or set `F1_USERNAME` and `F1_PASSWORD` in `.env` instead of signing in through the app. Sessions you've already downloaded keep working without it. See the README's [F1 TV account](README.md#f1-tv-account) section.

> **Cloud hosting:** F1 blocks requests from cloud providers with HTTP 403, even when signed in. On a cloud host, these don't work:
> - downloading new sessions: opening an unprocessed session, reprocessing, and `precompute.py`
> - race-weekend background downloads (`AUTO_PRECOMPUTE`)
> - team radio and captions for new sessions, which are downloaded with them
> - live timing, which uses the same F1 servers (expected, not yet confirmed)
>
> Replays of sessions already in storage keep working. To keep a cloud copy up to date, run a copy at home that downloads into the same R2 bucket. See the README's [Cloud hosting](README.md#cloud-hosting) section.

### Improvements

- **Team radio** — the radio messages F1 picks for the world feed pop up over the track map with the driver, a caption and the audio, in replays and live timing. Needs an F1 TV sign-in. Captions are made locally on your server by [Whisper](https://github.com/SYSTRAN/faster-whisper) (`small.en`, about 480 MB, downloaded on first use). Accuracy varies depending on quality and clarity. Set `TEAM_RADIO_CAPTIONS=false` to turn them off. Turn team radio or its audio off in Settings. Sessions downloaded before this update get team radio when reprocessed.

- **Live track positions** — when signed in to F1 TV, live timing receives car positions, so the live track map shows every car on track. F1 sends positions about once a second; the map plays them about 1.5 seconds behind so cars move smoothly instead of jumping.

- **F1 TV sign-in** — since 15 October 2026 F1 requires an F1 TV subscription (Access or higher) to download timing data. Sign in from **F1 TV** on the home page or the F1 TV tab in a replay's Settings. With **Keep me signed in**, the password is stored encrypted and you stay signed in, including for race-weekend background downloads. **Alternatively**, set `F1_USERNAME` and `F1_PASSWORD` as environment variables instead of signing in through the app. From the command line, `python precompute.py --sign-in` also works. Sessions already downloaded keep working. Requires FastF1 3.9 (`pip install -r requirements.txt`). See the README's F1 TV account section. (issue raised, and F1 TV sign-in contributed, by [@kungfoochef](https://github.com/kungfoochef))

- **Download throttling** — downloads pause between sessions (60 seconds) in the background and in `precompute.py` (`--gap` to change), to stay within F1's limits. Downloads also time out and retry once instead of hanging if F1's servers stop responding.

- **Features overview** — the Features page now opens with a sample leaderboard, each column numbered and explained.

- **Session list loads instantly** — the home page reads a small per-season index of processed sessions and their sizes, instead of listing every stored file. The index is built automatically the first time a season is opened and kept up to date as sessions are processed or deleted.

### Fixes

- **Unclear error when F1 refused a download** — a refused download ended in a generic "Failed to load session data". F1's response is now logged, and the error says why: a sign-in or subscription problem (HTTP 401), or F1 blocking the server's network (HTTP 403).

- **Security updates** — updated frontend dependencies with security fixes.

- **Crash or stale page after an update** — browsers could keep an older page that pointed at files a newer version had replaced, showing "Application error: a client-side exception". Pages are now checked for a newer version on every visit.

- **Endless spinner when a season failed to load** — the session list now shows an error with a Retry button.

- **Stuck on "Loading session…" after opening a session in a new tab** — Ctrl/Cmd-click or middle-click on a session opened it in a new tab but left the home page covered by the loading screen. The home page now stays usable.

## 2.2.0

### Improvements

- **Faster, lighter replays** — replays now load as small compressed files and play in the browser instead of being streamed frame by frame from the server reducing to ~11 MB per race instead of ~200 MB. Sessions processed before 2.2 are converted the first time they're opened, or all at once with `python precompute.py <years> --chunks-only`. If you have problems, set `REPLAY_PLAYER=websocket` to go back to the previous player.

- **Manual sync runs in the browser** — matching a typed-in lap and gaps no longer loads the whole session on the server.

- **Race calendar refreshes daily** — moved or cancelled rounds are picked up within a day instead of at the next restart.

- **`RETENTION_SWEEP_ENABLED`** — set to `false` to stop an instance running the daily retention sweep, for setups where several instances share one storage bucket.

- **Report a bug** — a new Report a bug tab in a replay's Settings opens a GitHub issue with the session and replay time filled in. The home, About and Features pages link to GitHub and Discussions.

### Fixes

- **Server memory grew with each viewer** — every new replay connection reloaded the whole session, and earlier viewers kept their own copy in memory.

- **Processed sessions never released from memory** — FastF1 session data stayed loaded for the life of the server after processing.

- **Outdated 2026 calendar on new installs** — an early-season calendar with the old round order could be used until a session was processed. It's now replaced with a fresh one on first load.

- **Stricter request checks** — session types, years, rounds and driver codes are validated before they're used in storage paths, and live timing refuses invalid or unauthorised connections before opening them.

- **Unavailable sessions looked clickable** — greyed-out session buttons on the home page showed bright text.

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
