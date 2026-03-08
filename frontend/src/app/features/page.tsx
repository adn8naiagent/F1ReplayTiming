export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-f1-dark">
      <div className="bg-f1-card border-b border-f1-border">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center gap-4">
          <a href="/" className="text-f1-muted hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <h1 className="text-2xl font-bold text-white">Features</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 space-y-10">

        {/* Track Map & Car Positions */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Track Map</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed">
            A live track map shows car positions derived from GPS telemetry, updating every 0.5 seconds
            with smooth interpolation. Click any driver on the leaderboard or map to highlight them.
            The track orientation matches the conventional broadcast view for each circuit.
          </p>
        </section>

        {/* Driver Leaderboard */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Driver Leaderboard</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed mb-4">
            The leaderboard displays all drivers sorted by position, with data sourced directly from
            the official F1 live timing feed. Each row can show a range of information, all toggleable
            from the settings menu:
          </p>
          <div className="space-y-4">
            {/* Position */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Position</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="w-6 h-6 flex items-center justify-center rounded bg-f1-red text-white text-sm font-extrabold">1</span>
                <span className="w-6 text-sm font-extrabold text-white text-right">2</span>
              </span>
              <span className="text-sm text-f1-text">Current race or session position. The leader is highlighted with a red badge.</span>
            </div>

            {/* Team colour */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Team colour</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="w-1 h-6 rounded-sm" style={{ backgroundColor: "#FF8000" }} />
                <span className="w-1 h-6 rounded-sm" style={{ backgroundColor: "#E80020" }} />
              </span>
              <span className="text-sm text-f1-text">A colour bar next to each driver matching their constructor.</span>
            </div>

            {/* Team abbr */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Team abbr.</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] font-bold text-f1-muted">MCL</span>
                <span className="text-[10px] font-bold text-f1-muted">FER</span>
              </span>
              <span className="text-sm text-f1-text">Three-letter constructor abbreviation. Off by default.</span>
            </div>

            {/* Gap */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Gap</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-bold text-f1-muted">+3.200</span>
                <span className="text-xs font-bold text-yellow-400">PIT</span>
              </span>
              <span className="text-sm text-f1-text">Gap to the leader (races) or best lap time (practice/qualifying). Shows &quot;PIT&quot; when in the pit lane.</span>
            </div>

            {/* Grid delta */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Grid delta</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] font-bold text-green-400">&#9650;3</span>
                <span className="text-[10px] font-bold text-red-400">&#9660;2</span>
              </span>
              <span className="text-sm text-f1-text">Positions gained or lost compared to the starting grid. Race only.</span>
            </div>

            {/* Pit stops */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Pit stops</span>
              <span className="w-5 h-5 border border-f1-muted rounded-sm flex items-center justify-center text-[10px] font-extrabold text-white flex-shrink-0">
                2
              </span>
              <span className="text-sm text-f1-text">Number of pit stops completed so far. Race only.</span>
            </div>

            {/* Pit prediction */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Pit prediction</span>
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <img src="/pit-return.png" alt="" className="w-3 h-3 opacity-50 invert" />
                <span className="text-[10px] font-bold text-f1-muted">P5</span>
              </span>
              <span className="text-sm text-f1-text">Predicted return position if the driver pitted now. Race only.</span>
            </div>

            {/* Tyre compound */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Tyre compound</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2" style={{ borderColor: "#E80020", color: "#E80020" }}>S</span>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2" style={{ borderColor: "#FFC800", color: "#FFC800" }}>M</span>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2" style={{ borderColor: "#FFFFFF", color: "#FFFFFF" }}>H</span>
              </span>
              <span className="text-sm text-f1-text">The current tyre compound shown as a colour-coded circle.</span>
            </div>

            {/* Tyre age */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Tyre age</span>
              <span className="text-xs font-extrabold text-white flex-shrink-0">12</span>
              <span className="text-sm text-f1-text">Number of laps on the current set of tyres.</span>
            </div>

            {/* Tyre history */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Tyre history</span>
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-extrabold leading-none border opacity-50" style={{ borderColor: "#E80020", color: "#E80020" }}>S</span>
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-extrabold leading-none border opacity-50" style={{ borderColor: "#FFC800", color: "#FFC800" }}>M</span>
              </span>
              <span className="text-sm text-f1-text">The last two tyre compounds used, shown as smaller icons. Race only.</span>
            </div>

            {/* Flags */}
            <div className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-sm font-bold text-f1-muted">Fastest lap</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
                  <path d="M12 6v7l4.5 2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className="text-sm text-f1-text">Purple clock icon shown next to the driver with the fastest lap.</span>
            </div>
          </div>
        </section>

        {/* Pit Position Prediction */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-white">Pit Position Prediction</h2>
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-f1-red/20 text-f1-red leading-none">Beta</span>
          </div>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">Race only</p>
          <p className="text-f1-text leading-relaxed mb-3">
            Shows the predicted position a driver would return to if they pitted right now. The prediction
            uses precomputed pit loss times for each circuit, calculated from all 2025 race data.
          </p>
          <p className="text-f1-text leading-relaxed mb-3">
            Pit loss is the total time lost by pitting, measured as the combined in-lap and out-lap time
            minus two clean lap times. The prediction adds this loss to the driver&apos;s current gap and finds
            where they&apos;d slot back into the order.
          </p>
          <p className="text-f1-text leading-relaxed">
            Under Safety Car or Virtual Safety Car conditions, reduced pit loss values are used
            (approximately 45% and 65% of the green flag loss respectively), reflecting the lower time
            cost of pitting under caution. Predictions appear from lap 15 onwards.
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
              <span className="text-sm text-f1-text">Vehicle speed in km/h, plotted against track distance.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Throttle</span>
              <span className="text-sm text-f1-text">Throttle application from 0-100%.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Brake</span>
              <span className="text-sm text-f1-text">Brake pressure, shown as on/off.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">Gear</span>
              <span className="text-sm text-f1-text">Current gear selection from 1-8.</span>
            </div>
            <div className="flex gap-3">
              <span className="w-20 flex-shrink-0 text-sm font-bold text-f1-muted">DRS</span>
              <span className="text-sm text-f1-text">DRS activation status. Available for 2025 and earlier sessions. DRS was removed from cars in 2026.</span>
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
          <h2 className="text-lg font-bold text-white mb-1">Track Status</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed">
            The current track status is shown as a flag indicator: green flag, yellow flag, Safety Car,
            Virtual Safety Car, or red flag. The track map border colour also changes to reflect the
            current status.
          </p>
        </section>

        {/* Playback */}
        <section className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Playback Controls</h2>
          <p className="text-xs font-bold text-f1-red uppercase tracking-wider mb-3">All sessions</p>
          <p className="text-f1-text leading-relaxed">
            Control replay speed from 0.5x to 20x, skip forward and backward by 5 seconds, 30 seconds,
            1 minute, or 5 minutes, or jump directly to any lap. A progress bar shows the current position
            within the session. For qualifying and practice, elapsed and remaining session time are displayed.
          </p>
        </section>

        <div className="text-center pt-4">
          <a href="/" className="text-f1-muted hover:text-white transition-colors text-sm">
            Back to session picker
          </a>
        </div>
      </div>
    </div>
  );
}
