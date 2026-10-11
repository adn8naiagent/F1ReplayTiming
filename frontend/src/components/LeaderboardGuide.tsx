// A mock race leaderboard with a numbered callout above each column and a key
// underneath, so someone new can see what each column means at a glance.

const TYRE = { S: "#E80020", M: "#FFC800", H: "#FFFFFF" } as const;

interface MockDriver {
  pos: number;
  abbr: string;
  color: string;
  grid: number; // + gained, - lost
  fastest?: boolean;
  gap: string;
  lastLap: string;
  lastLapClass: string;
  stops: number;
  pitPred?: { pos: number; ahead: number; behind: number; marginClass: string };
  history: (keyof typeof TYRE)[];
  tyre: keyof typeof TYRE;
  age: number;
}

const ROWS: MockDriver[] = [
  { pos: 1, abbr: "VER", color: "#3671C6", grid: 2, fastest: true, gap: "Leader", lastLap: "1:21.432", lastLapClass: "text-purple-400", stops: 1, history: ["M"], tyre: "H", age: 18 },
  { pos: 2, abbr: "NOR", color: "#FF8000", grid: -1, gap: "+2.418", lastLap: "1:21.880", lastLapClass: "text-green-400", stops: 1, pitPred: { pos: 5, ahead: 3.2, behind: 1.4, marginClass: "text-yellow-400" }, history: ["S"], tyre: "M", age: 12 },
  { pos: 3, abbr: "LEC", color: "#E80020", grid: 4, gap: "+5.102", lastLap: "1:22.315", lastLapClass: "text-f1-muted", stops: 2, pitPred: { pos: 7, ahead: 0.8, behind: 4.6, marginClass: "text-f1-muted" }, history: ["M", "S"], tyre: "H", age: 5 },
];

const COLUMNS: { width: string; name: string; description: string }[] = [
  { width: "1.75rem", name: "Position", description: "Current position. The leader has a red badge." },
  { width: "0.75rem", name: "Team colour", description: "Bar in the constructor's colour." },
  { width: "2.25rem", name: "Driver", description: "Three-letter driver code. Click a row to show their telemetry." },
  { width: "1.75rem", name: "Grid change", description: "Places gained (green) or lost (red) since the start." },
  { width: "1.25rem", name: "Fastest lap", description: "Purple clock on the driver with the fastest lap." },
  { width: "3.75rem", name: "Gap", description: "Gap to the leader, or interval to the car ahead (tap the leader's pill to switch). Shows PIT in the pit lane." },
  { width: "4rem", name: "Last lap", description: "Most recent lap time. Purple is the fastest overall, green a personal best." },
  { width: "1.5rem", name: "Pit stops", description: "Stops made so far. A chequered flag once finished." },
  { width: "2.5rem", name: "Pit prediction", description: "Where the driver would rejoin if they pitted now." },
  { width: "2.5rem", name: "Pit gaps", description: "Gap to the car ahead (↑) and behind (↓) after that stop. Yellow or red means it's close." },
  { width: "2.25rem", name: "Tyre history", description: "The previous compounds used." },
  { width: "1.5rem", name: "Tyre", description: "Current tyre compound." },
  { width: "1.5rem", name: "Tyre age", description: "Laps on the current set." },
];

const GRID = COLUMNS.map((c) => c.width).join(" ");

function Callout({ n }: { n: number }) {
  return (
    <span className="w-4 h-4 rounded-full bg-f1-red text-white text-[9px] font-extrabold flex items-center justify-center">
      {n}
    </span>
  );
}

function TyreBadge({ c, small }: { c: keyof typeof TYRE; small?: boolean }) {
  return (
    <span
      className={`rounded-full flex items-center justify-center font-extrabold leading-none ${
        small ? "w-3.5 h-3.5 text-[7px] border opacity-50" : "w-5 h-5 text-[10px] border-2"
      }`}
      style={{ borderColor: TYRE[c], color: TYRE[c] }}
    >
      {c}
    </span>
  );
}

export default function LeaderboardGuide() {
  return (
    <div>
      {/* Mock leaderboard */}
      <div className="overflow-x-auto -mx-2 px-2">
        <div className="inline-block min-w-max bg-f1-dark border border-f1-border rounded-lg px-2 pt-2 pb-1 sm:[zoom:1.3]">
          <div className="grid items-center gap-x-1 pb-1.5 border-b border-f1-border" style={{ gridTemplateColumns: GRID }}>
            {COLUMNS.map((c, i) => (
              <span key={c.name} className="flex justify-center" title={c.name}>
                <Callout n={i + 1} />
              </span>
            ))}
          </div>
          <div className="divide-y divide-f1-border/50">
            {ROWS.map((d) => (
              <div key={d.abbr} className="grid items-center gap-x-1 py-1" style={{ gridTemplateColumns: GRID }}>
                {d.pos === 1 ? (
                  <span className="w-6 h-6 flex items-center justify-center rounded bg-f1-red text-white text-sm font-extrabold">{d.pos}</span>
                ) : (
                  <span className="w-6 text-sm font-extrabold text-white text-right">{d.pos}</span>
                )}
                <span className="w-1 h-6 rounded-sm justify-self-center" style={{ backgroundColor: d.color }} />
                <span className="text-sm font-extrabold text-white">{d.abbr}</span>
                <span className={`text-[10px] font-bold text-center ${d.grid > 0 ? "text-green-400" : "text-red-400"}`}>
                  {d.grid > 0 ? `▲${d.grid}` : `▼${Math.abs(d.grid)}`}
                </span>
                <span className="flex justify-center">
                  {d.fastest && (
                    <svg className="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
                      <path d="M12 6v7l4.5 2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                {d.gap === "Leader" ? (
                  <span className="justify-self-start px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-white/10 text-white">Leader</span>
                ) : (
                  <span className="text-xs font-bold tabular-nums text-f1-muted">{d.gap}</span>
                )}
                <span className={`text-xs tabular-nums text-right ${d.lastLapClass}`}>{d.lastLap}</span>
                <span className="flex justify-center">
                  <span className="w-5 h-5 border border-f1-muted rounded-sm flex items-center justify-center text-[10px] font-extrabold text-white">
                    {d.stops}
                  </span>
                </span>
                <span className="flex items-center justify-end">
                  {d.pitPred && (
                    <span className={`flex items-center gap-0.5 text-[10px] font-bold ${d.pitPred.marginClass}`}>
                      <svg className="w-4 h-4 opacity-70 -scale-y-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 14l-4-4 4-4" />
                        <path d="M5 10h11a4 4 0 0 1 0 8h-1" />
                      </svg>
                      P{d.pitPred.pos}
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-end leading-tight">
                  {d.pitPred && (
                    <>
                      <span className="text-[8px] font-bold text-f1-muted">↑{d.pitPred.ahead.toFixed(1)}s</span>
                      <span className={`text-[8px] font-bold ${d.pitPred.marginClass}`}>↓{d.pitPred.behind.toFixed(1)}s</span>
                    </>
                  )}
                </span>
                <span className="flex items-center justify-end gap-0.5">
                  {d.history.map((c, i) => <TyreBadge key={i} c={c} small />)}
                </span>
                <span className="flex justify-center"><TyreBadge c={d.tyre} /></span>
                <span className="text-xs font-extrabold text-white text-right">{d.age}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key */}
      <ol className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {COLUMNS.map((c, i) => (
          <li key={c.name} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex-shrink-0"><Callout n={i + 1} /></span>
            <span className="text-sm text-f1-text leading-snug">
              <span className="font-bold text-white">{c.name}</span> — {c.description}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-f1-muted">
        Race replay shown. Qualifying and practice show best lap times and live sectors instead of the race-only
        columns. Every column can be turned on or off in Settings → Leaderboard.
      </p>
    </div>
  );
}
