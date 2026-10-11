"use client";

import SiteFooter from "@/components/SiteFooter";
import LeaderboardGuide from "@/components/LeaderboardGuide";

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-f1-dark">
      <div className="bg-f1-card border-b border-f1-border">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center gap-4">
          <button
            onClick={() => {
              if (window.opener || window.history.length <= 1) {
                window.close();
              } else {
                window.location.href = "/";
              }
            }}
            className="text-f1-muted hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-white">Features</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 space-y-10">

        {/* Reading the leaderboard */}
        <section className="bg-f1-card border border-f1-red/40 rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Reading the Leaderboard</h2>
          <p className="text-f1-text leading-relaxed mb-4">
            What each column on the leaderboard means. More detail in{" "}
            <a href="#driver-leaderboard" className="text-f1-red hover:underline font-semibold">Driver Leaderboard</a> below.
          </p>
          <LeaderboardGuide />
        </section>

        {/* Session Picker */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Session Picker</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">Home page</p>
          <p className="text-f1-text leading-relaxed">
            A green dot
            <span className="inline-block align-middle w-1.5 h-1.5 rounded-full bg-green-400 mx-1.5" />
            next to a session means it has already been downloaded and will play instantly. Hover over
            a session to see its stored size. Sessions without a dot are processed on demand the first
            time you open them.
          </p>
        </section>

        {/* Track Map & Car Positions */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Track Map</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed">
            A track map shows car positions derived from GPS telemetry data processed via FastF1,
            updating every 0.5 seconds with smooth interpolation. Click any driver on the leaderboard
            or map to highlight them. The track orientation matches the conventional broadcast view
            for each circuit. Available in replay mode only.
          </p>
        </section>

        {/* Track Elevation */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Track Elevation</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-4">
            The track line can be coloured by elevation, derived from the same GPS telemetry as the map.
            The lowest point of the lap is dark and the highest is bright:
          </p>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-f1-muted">Low</span>
            <div
              className="h-3 flex-1 max-w-xs rounded-sm border border-black/30"
              style={{ background: "linear-gradient(to right, #33384a, #6fb7d6, #ffffff)" }}
            />
            <span className="text-xs text-f1-muted">High</span>
          </div>
          <p className="text-f1-text leading-relaxed">
            Colours use a fixed scale across every circuit rather than each track&apos;s own range, so a flat
            circuit stays uniformly dark while a hilly one shows a strong gradient. A legend on the map shows
            the total elevation change. Toggle it in Settings &gt; Track Map.
          </p>
        </section>

        {/* Driver Leaderboard */}
        <section id="driver-leaderboard" className="bg-f1-card border border-f1-border rounded-xl p-6 scroll-mt-6">
          <h2 className="text-lg font-bold text-white mb-1">Driver Leaderboard</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-4">
            The leaderboard displays all drivers sorted by position, with data sourced directly from
            the official F1 live timing feed. Each row can show a range of information, all toggleable
            from the settings menu:
          </p>
          <div className="space-y-4">
            {/* Position */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Position</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="w-6 h-6 flex items-center justify-center rounded bg-f1-red text-white text-sm font-extrabold">1</span>
                <span className="w-6 text-sm font-extrabold text-white text-right">2</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Current race or session position. The leader is highlighted with a red badge.</span>
            </div>

            {/* Team colour */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Team colour</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="w-1 h-6 rounded-sm" style={{ backgroundColor: "#FF8000" }} />
                <span className="w-1 h-6 rounded-sm" style={{ backgroundColor: "#E80020" }} />
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">A colour bar next to each driver matching their constructor.</span>
            </div>

            {/* Team abbr */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Team abbr.</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] font-bold text-f1-muted">MCL</span>
                <span className="text-[10px] font-bold text-f1-muted">FER</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Three-letter constructor abbreviation. Off by default.</span>
            </div>

            {/* Gap */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Gap</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-bold text-f1-muted">+3.200</span>
                <span className="text-xs font-bold text-yellow-400">PIT</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Gap to the leader (races) or best lap time (practice/qualifying). Shows &quot;PIT&quot; when in the pit lane.</span>
            </div>

            {/* Last lap time */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Last lap</span>
              <span className="text-xs tabular-nums text-f1-muted flex-shrink-0">1:32.456</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">The driver&apos;s most recently completed lap time. Race replay only.</span>
            </div>

            {/* Grid delta */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Grid delta</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] font-bold text-green-400">&#9650;3</span>
                <span className="text-[10px] font-bold text-red-400">&#9660;2</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Positions gained or lost compared to the starting grid. Race only.</span>
            </div>

            {/* Pit stops */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Pit stops</span>
              <span className="w-5 h-5 border border-f1-muted rounded-sm flex items-center justify-center text-[10px] font-extrabold text-white flex-shrink-0">
                2
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Number of pit stops completed so far. Race only.</span>
            </div>

            {/* Pit prediction */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Pit prediction</span>
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <img src="/pit-return.png" alt="" className="w-3 h-3 opacity-50 invert" />
                <span className="text-[10px] font-bold text-f1-muted">P5</span>
              </span>
              <span className="flex flex-col items-end flex-shrink-0 leading-tight">
                <span className="text-[8px] font-bold text-f1-muted">↑3.2s</span>
                <span className="text-[8px] font-bold text-f1-muted">↓8.4s</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Predicted return position with gap ahead (top) and gap behind (bottom). Race only.</span>
            </div>

            {/* Tyre compound */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Tyre compound</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2" style={{ borderColor: "#E80020", color: "#E80020" }}>S</span>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2" style={{ borderColor: "#FFC800", color: "#FFC800" }}>M</span>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2" style={{ borderColor: "#FFFFFF", color: "#FFFFFF" }}>H</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">The current tyre compound shown as a colour-coded circle.</span>
            </div>

            {/* Tyre age */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Tyre age</span>
              <span className="text-xs font-extrabold text-white flex-shrink-0">12</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Number of laps on the current set of tyres.</span>
            </div>

            {/* Tyre history */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Tyre history</span>
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-extrabold leading-none border opacity-50" style={{ borderColor: "#E80020", color: "#E80020" }}>S</span>
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-extrabold leading-none border opacity-50" style={{ borderColor: "#FFC800", color: "#FFC800" }}>M</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">The last two tyre compounds used, shown as smaller icons. Race only.</span>
            </div>

            {/* Flags */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Fastest lap</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
                  <path d="M12 6v7l4.5 2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Purple clock icon shown next to the driver with the fastest lap.</span>
            </div>
          </div>
        </section>

        {/* Lap Analysis */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-white">Lap Analysis</h2>
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-f1-red/20 text-f1-red leading-none">Beta</span>
          </div>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">Race replay only</p>
          <p className="text-f1-text leading-relaxed mb-3">
            A dedicated panel for analysing driver pace across the race. On desktop, open it via the
            &quot;Laps&quot; button on the track map &mdash; the panel slides out to the left. On mobile,
            it appears as a collapsible section.
          </p>
          <p className="text-f1-text leading-relaxed mb-3">
            Select up to two drivers using the dropdown menus at the top of the panel to compare their
            lap times side by side.
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Lap chart</span>
              <span className="flex items-center gap-1 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Line chart of lap times over the race. Each driver is coloured by their team. Pit laps are excluded from the line and marked with dots.</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Lap list</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] tabular-nums text-white">1:32.456</span>
                <span className="text-[8px] font-bold text-yellow-400">PIT</span>
                <span className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-extrabold leading-none border" style={{ borderColor: "#FF3333", color: "#FF3333" }}>S</span>
              </span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Full lap-by-lap breakdown showing lap time, tyre compound, and pit stop indicators for each selected driver.</span>
            </div>
          </div>
        </section>

        {/* Starting Grid */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Starting Grid</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">Race only</p>
          <p className="text-f1-text leading-relaxed mb-3">
            For the first 10 seconds of the race, the leaderboard displays the starting grid order
            before live timing data takes over.
          </p>
          <p className="text-f1-text leading-relaxed">
            Where official starting grid data is unavailable, qualifying positions are used as a
            fallback. This may not reflect grid penalties or other post-qualifying changes to the
            starting order.
          </p>
        </section>

        {/* Data Availability */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Data Availability</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed">
            Occasionally, timing data may be temporarily unavailable for a driver &mdash; for example,
            during pit stops or if the F1 timing system has a brief gap. When this happens, the
            affected driver is shown greyed out at the bottom of the leaderboard. They return to
            their correct position as soon as data is available again.
          </p>
        </section>

        {/* Pit Position Prediction */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-white">Pit Position Prediction</h2>
          </div>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">Race only</p>
          <p className="text-f1-text leading-relaxed mb-3">
            Shows the predicted position a driver would return to if they pitted right now. The prediction
            uses precise pit lane times for each circuit, calculated from the actual pit entry and exit
            timestamps across all 2025 race data.
          </p>
          <p className="text-f1-text leading-relaxed mb-3">
            Pit loss is measured using the exact time each driver spends in the pit lane
            (PitOutTime &minus; PitInTime), giving a precise per-circuit baseline unaffected by
            driving pace on the rest of the lap. The prediction adds this loss to the driver&apos;s
            current gap and finds where they&apos;d slot back into the order.
          </p>
          <p className="text-f1-text leading-relaxed mb-3">
            Under Safety Car or Virtual Safety Car conditions, a reduced pit loss value is used
            (73% of the green flag loss), reflecting the lower relative time cost of pitting
            under caution. Predictions appear from lap 5 onwards.
          </p>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
            Confidence indicator
          </h3>
          <p className="text-f1-text leading-relaxed mb-3">
            Since predictions use average pit loss times, the actual result may vary. The confidence
            indicator (togglable via settings) colour-codes each prediction based on the margin to the
            next position behind:
          </p>
          <ul className="text-f1-text leading-relaxed space-y-1 ml-4 list-disc">
            <li><span className="text-f1-muted font-bold">Default</span> — more than 2.5s margin, high confidence</li>
            <li><span className="text-yellow-400 font-bold">Yellow</span> — 1s to 2.5s margin, a slower pit stop could cost a position</li>
            <li><span className="text-red-400 font-bold">Red</span> — less than 1s margin, very tight</li>
          </ul>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mt-4 mb-2">
            Pit gaps
          </h3>
          <p className="text-f1-text leading-relaxed">
            Alongside the predicted position, two gap values are stacked showing the predicted
            gap to the car ahead (top) and the gap to the car behind (bottom) after the pit stop.
            This helps assess whether the driver would rejoin in clean air or in traffic, and how
            secure their predicted position would be.
          </p>
        </section>

        {/* Race Control Messages */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Race Control Messages</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-3">
            A live feed of all race control messages is accessible via the RC button on the track map.
            Messages include steward investigations, penalties, track limit deletions, DRS activations,
            safety car deployments, and other official communications.
          </p>
          <p className="text-f1-text leading-relaxed mb-3">
            Each message is colour-coded for quick scanning:
          </p>
          <ul className="text-f1-text leading-relaxed space-y-1 ml-4 list-disc mb-3">
            <li><span className="text-orange-400 font-bold">Orange</span> — incident noted or under investigation</li>
            <li><span className="text-red-400 font-bold">Red</span> — penalty issued</li>
            <li><span className="text-green-400 font-bold">Green</span> — cleared / no further action</li>
            <li><span className="text-f1-muted font-bold">Grey</span> — other messages (DRS, flags, etc.)</li>
          </ul>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
            Driver indicators
          </h3>
          <p className="text-f1-text leading-relaxed">
            When a driver is under investigation or has received a penalty, an indicator appears next to
            their name on the leaderboard: a warning triangle
            (<svg className="w-3.5 h-3.5 text-orange-400 inline -mt-0.5" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2zm0 6v7m0 2v2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>)
            for investigations and a circled exclamation
            (<svg className="w-3.5 h-3.5 text-red-500 inline -mt-0.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 8v5m0 3v.01" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>)
            for penalties. These clear automatically when the stewards issue a decision.
          </p>
        </section>

        {/* Broadcast Sync */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Broadcast Sync</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-3">
            Sync the replay to a live broadcast or recording so the timing data matches what&apos;s on screen.
            There are two sync methods:
          </p>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Photo Sync</h3>
              <p className="text-sm text-f1-text leading-relaxed">
                Take a screenshot of the broadcast showing the leaderboard, then upload it. A vision model
                reads the driver positions and gap times from the image and finds the matching point in the
                replay data, automatically jumping to the correct moment.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Manual Sync</h3>
              <p className="text-sm text-f1-text leading-relaxed">
                Enter the gap times for the top two drivers as shown on the broadcast. The replay searches
                for the closest matching frame based on those gaps and syncs to it.
              </p>
            </div>
          </div>
        </section>

        {/* Telemetry */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Telemetry</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-3">
            Click any driver to open a detailed telemetry view showing real-time data for their current lap:
          </p>
          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Speed</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Vehicle speed in km/h, plotted against track distance.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Throttle</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Throttle application from 0-100%.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Brake</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Brake pressure, shown as on/off.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Gear</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">Current gear selection from 1-8.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">DRS</span>
              <span className="w-full sm:w-auto text-sm text-f1-text">DRS activation status. Available for 2025 and earlier sessions. DRS was removed from cars in 2026.</span>
            </div>
          </div>
        </section>

        {/* Weather */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Weather</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed">
            Real-time weather conditions are displayed in the session header, including air temperature,
            track temperature, humidity, wind speed and direction, and rainfall status. Each weather
            metric can be individually toggled from the settings menu.
          </p>
        </section>

        {/* Track Status */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Track Status &amp; Flags</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">Replay</p>
          <p className="text-f1-text leading-relaxed mb-3">
            Flag conditions are shown on the track map at marshal sector level, giving you a precise
            view of where incidents are occurring rather than just a global status.
          </p>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
            Marshal sector flags
          </h3>
          <p className="text-f1-text leading-relaxed mb-3">
            When a yellow or double yellow flag is waved, a coloured indicator appears at the exact
            marshal sector position on the track map. If a specific driver is involved, their
            three-letter abbreviation is shown next to the indicator.
          </p>
          <ul className="text-f1-text leading-relaxed space-y-1 ml-4 list-disc mb-3">
            <li><span className="text-yellow-400 font-bold">Yellow circle</span> &mdash; single yellow flag in that marshal sector</li>
            <li><span className="text-yellow-400 font-bold">Yellow circle with outer ring</span> &mdash; double yellow flag (more serious, drivers must slow significantly)</li>
            <li><span className="text-red-400 font-bold">Red circle</span> &mdash; red flag at that location</li>
          </ul>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
            Full track colouring
          </h3>
          <p className="text-f1-text leading-relaxed mb-3">
            For track-wide conditions, the entire track outline changes colour:
          </p>
          <ul className="text-f1-text leading-relaxed space-y-1 ml-4 list-disc mb-3">
            <li><span className="text-yellow-400 font-bold">Yellow</span> &mdash; Safety Car or Virtual Safety Car deployed</li>
            <li><span className="text-red-400 font-bold">Red</span> &mdash; session red flagged</li>
          </ul>
          <p className="text-f1-text leading-relaxed">
            Localised yellow flags (affecting one or two marshal sectors) do not colour the full track,
            keeping the view clear so you can see exactly where the incident is.
          </p>
        </section>

        {/* Live Timing */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Live Timing</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-3">
            During active F1 sessions, live timing connects directly to the F1 SignalR stream to
            provide real-time leaderboard data, tyre information, race control messages, and weather.
          </p>
          <p className="text-f1-text leading-relaxed mb-3">
            Driver positions on the track map and telemetry data (speed, throttle, brake, gear) are
            not available in live mode, as track position data requires an authenticated F1 TV
            subscription. These become available in replay mode once the session is processed via
            FastF1, typically 1&ndash;2 hours after the chequered flag.
          </p>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
            Broadcast delay
          </h3>
          <p className="text-f1-text leading-relaxed">
            The broadcast delay slider pauses the live data feed until it aligns with your streaming
            service or TV broadcast. Set the delay to match how far behind your broadcast is, and the
            leaderboard will update in sync with what you see on screen. Your delay setting is saved
            automatically. You can also enter an exact delay value manually.
          </p>
        </section>

        {/* Playback */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Playback Controls</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-3">
            Control replay speed from 0.5x to 20x, skip forward and backward by 5 seconds, 30 seconds,
            1 minute, or 5 minutes, or jump directly to any lap. A progress bar shows the current position
            within the session. For qualifying and practice, elapsed and remaining session time are displayed.
          </p>
          <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
            Session time
          </h3>
          <p className="text-f1-text leading-relaxed">
            Total session time is hidden by default to avoid spoilers &mdash; a longer-than-expected
            session can reveal red flags and stoppages. You can enable it in the settings menu.
          </p>
        </section>

        <div className="text-center pt-4">
          <button
            onClick={() => {
              if (window.opener || window.history.length <= 1) {
                window.close();
              } else {
                window.location.href = "/";
              }
            }}
            className="text-f1-muted hover:text-white transition-colors text-sm"
          >
            Back to session picker
          </button>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
