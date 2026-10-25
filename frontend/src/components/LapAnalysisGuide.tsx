// A mock of the Lap Analysis panel's two tabs (qualifying and practice), with
// a numbered callout on each part and a key underneath, like LeaderboardGuide.

const NOR = "#FF8000";
const VER = "#3671C6";
const PIA = "#FFB86B";
const TYRE = { S: "#E80020", M: "#FFC800" } as const;

function Callout({ n }: { n: number }) {
  return (
    <span className="absolute -left-2.5 top-1 z-10 w-4 h-4 rounded-full bg-f1-red text-white text-[9px] font-extrabold flex items-center justify-center shadow">
      {n}
    </span>
  );
}

function Part({ n, children, className = "" }: { n: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Callout n={n} />
      {children}
    </div>
  );
}

const label = "text-[9px] font-bold text-f1-muted uppercase tracking-wider";
const dot = (color: string) => <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: color }} />;

function Tabs({ active }: { active: "Sectors" | "Compare" }) {
  return (
    <div className="flex border-b border-f1-border">
      {(["Sectors", "Compare"] as const).map((t) => (
        <span
          key={t}
          className={`flex-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider border-b-2 ${
            t === active ? "text-white border-f1-red" : "text-f1-muted border-transparent"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function Dropdown({ abbr, name, color }: { abbr: string; name: string; color: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-f1-border bg-f1-dark px-2 py-1.5 text-[10px]">
      <span className="flex items-center gap-1.5 font-bold text-white">
        {dot(color)}{abbr}<span className="font-normal text-f1-muted">{name}</span>
      </span>
      <span className="text-f1-muted">▾</span>
    </div>
  );
}

function Tyre({ c }: { c: keyof typeof TYRE }) {
  return (
    <span
      className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-extrabold leading-none border"
      style={{ borderColor: TYRE[c], color: TYRE[c] }}
    >
      {c}
    </span>
  );
}

const LAPS: { n: number; tag?: "OUT" | "IN" | "DEL"; time: string; s: [string, string, string]; c: [string, string, string]; tyre: keyof typeof TYRE; timeClass?: string }[] = [
  { n: 16, tag: "OUT", time: "2:04.118", s: ["41.902", "48.330", "33.886"], c: ["", "", ""], tyre: "S" },
  { n: 17, time: "1:31.902", s: ["28.488", "35.180", "28.234"], c: ["green", "green", "green"], tyre: "S" },
  { n: 18, time: "1:31.630", s: ["28.412", "35.226", "27.992"], c: ["purple", "", "green"], tyre: "S", timeClass: "text-purple-400" },
  { n: 19, tag: "DEL", time: "1:31.411", s: ["28.390", "35.102", "27.919"], c: ["", "", ""], tyre: "S" },
  { n: 20, tag: "IN", time: "1:52.704", s: ["30.118", "39.906", "42.680"], c: ["", "", ""], tyre: "S" },
];

const SECTOR_CLASS: Record<string, string> = { purple: "text-purple-400", green: "text-green-400", "": "text-white/80" };

function SectorsTab() {
  return (
    <div className="rounded-lg border border-f1-border bg-f1-card overflow-visible">
      <Part n={1}><Tabs active="Sectors" /></Part>

      <Part n={2} className="px-3 pt-2 pb-2">
        <div className={`${label} mb-1`}>Best sectors &amp; ideal laps</div>
        <div className="grid grid-cols-4 gap-1 text-[10px] tabular-nums">
          {[["S1", "28.412", "NOR"], ["S2", "35.106", "VER"], ["S3", "27.950", "PIA"]].map(([s, t, d]) => (
            <div key={s} className="rounded bg-f1-dark px-1.5 py-1">
              <div className="text-[8px] font-bold text-f1-muted">{s}</div>
              <div className="font-bold text-purple-400">{t}</div>
              <div className="text-[9px] text-f1-muted">{d}</div>
            </div>
          ))}
          <div className="rounded bg-f1-dark px-1.5 py-1">
            <div className="text-[8px] font-bold text-f1-muted">THEORETICAL</div>
            <div className="font-bold text-white">1:31.468</div>
            <div className="text-[9px] text-f1-muted">-0.162 to best</div>
          </div>
        </div>
      </Part>

      <Part n={3} className="px-3 pb-2 border-b border-f1-border">
        <div className="text-[10px] tabular-nums">
          <div className="grid grid-cols-[1fr_56px_56px_40px] gap-x-1 text-[8px] font-bold text-f1-muted pb-0.5 border-b border-f1-border">
            <span>DRIVER</span><span className="text-right">IDEAL</span><span className="text-right">BEST LAP</span><span className="text-right">GAP</span>
          </div>
          {[["NOR", NOR, "1:31.584", "1:31.630", "+0.046", true], ["VER", VER, "1:31.577", "1:31.645", "+0.068", false], ["PIA", PIA, "1:31.702", "1:31.788", "+0.086", false]].map(([a, c, i, b, g, sel]) => (
            <div key={a as string} className={`grid grid-cols-[1fr_56px_56px_40px] gap-x-1 py-0.5 ${sel ? "bg-white/10" : ""}`}>
              <span className="flex items-center gap-1 font-bold text-white">{dot(c as string)}{a}</span>
              <span className="text-right text-white">{i}</span>
              <span className="text-right text-white/70">{b}</span>
              <span className="text-right text-f1-muted">{g}</span>
            </div>
          ))}
        </div>
      </Part>

      <Part n={4} className="px-3 py-2 space-y-1.5">
        <Dropdown abbr="NOR" name="Lando Norris" color={NOR} />
        <div className="flex gap-1">
          {["All", "Q1", "Q2", "Q3"].map((r) => (
            <span key={r} className={`px-2 py-0.5 rounded text-[9px] font-bold ${r === "Q3" ? "bg-white/15 text-white" : "bg-f1-dark border border-f1-border text-f1-muted"}`}>{r}</span>
          ))}
        </div>
      </Part>

      <Part n={5} className="mx-3 mb-2">
        <div className="rounded border border-f1-border bg-f1-dark px-2 py-1.5">
          <div className={`${label} mb-1`}>NOR · Lap 18</div>
          <div className="grid grid-cols-[24px_1fr_1fr_1fr] gap-x-2 text-[10px] tabular-nums">
            <span /><span className="text-f1-muted text-[8px]">TIME</span><span className="text-f1-muted text-[8px]">TO BEST</span><span className="text-f1-muted text-[8px]">TO OWN BEST</span>
            {[["S1", "28.412", "purple", "0.000 NOR", "0.000"], ["S2", "35.226", "", "+0.120 VER", "+0.046"], ["S3", "27.992", "green", "+0.042 PIA", "0.000"], ["Lap", "1:31.630", "", "0.000 NOR", "0.000"]].map(([l, t, c, b, o]) => (
              <div key={l} className="contents">
                <span className="text-f1-muted font-bold">{l}</span>
                <span className={`font-bold ${c ? SECTOR_CLASS[c] : "text-white"}`}>{t}</span>
                <span className={b.startsWith("+") ? "text-red-400" : "text-f1-muted"}>{b}</span>
                <span className={o.startsWith("+") ? "text-red-400" : "text-f1-muted"}>{o}</span>
              </div>
            ))}
          </div>
        </div>
      </Part>

      <Part n={6} className="px-3 pb-2">
        {LAPS.map((lap) => {
          const muted = !!lap.tag;
          return (
            <div key={lap.n} className={`flex items-center gap-1 py-0.5 rounded-sm ${lap.n === 18 ? "bg-white/15" : ""} ${muted ? "opacity-60" : ""}`}>
              <span className="w-9 text-[10px] font-bold text-f1-muted tabular-nums flex items-center gap-0.5">
                {lap.n}{lap.tag && <span className={`text-[7px] font-bold ${lap.tag === "DEL" ? "text-red-400" : "text-f1-muted"}`}>{lap.tag}</span>}
              </span>
              <span className={`w-[58px] text-[10px] font-bold tabular-nums ${lap.tag === "DEL" ? "text-f1-muted line-through" : muted ? "text-f1-muted" : lap.timeClass ?? "text-white"}`}>{lap.time}</span>
              {lap.s.map((s, i) => (
                <span key={i} className={`flex-1 text-right text-[10px] tabular-nums ${SECTOR_CLASS[lap.c[i]]}`}>{s}</span>
              ))}
              <span className="w-5 flex justify-end"><Tyre c={lap.tyre} /></span>
            </div>
          );
        })}
      </Part>
    </div>
  );
}

// Simple smooth traces for the mock charts: speed along the lap for two
// drivers, and the gap between them.
function path(values: number[], w: number, h: number, min: number, max: number): string {
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min)) * h).toFixed(1)}`)
    .join(" ");
}
const N = 60;
const speedA = Array.from({ length: N }, (_, i) => 210 + 85 * Math.sin(i / 4.2) + 25 * Math.sin(i / 1.7));
const speedB = speedA.map((v, i) => v + 8 * Math.sin(i / 3.1 + 1));
const gap = Array.from({ length: N }, (_, i) => -0.18 * Math.sin(i / 19) - 0.04 * Math.sin(i / 5));
const CORNERS = [0.08, 0.27, 0.44, 0.63, 0.82];

function CompareTab() {
  return (
    <div className="rounded-lg border border-f1-border bg-f1-card overflow-visible">
      <Part n={7}><Tabs active="Compare" /></Part>

      <Part n={8} className="px-3 py-2 grid grid-cols-2 gap-1.5 border-b border-f1-border">
        <Dropdown abbr="NOR" name="Norris" color={NOR} />
        <Dropdown abbr="VER" name="Verstappen" color={VER} />
      </Part>

      <Part n={9} className="pt-2">
        <div className={`px-3 pb-1 ${label}`}>Best laps</div>
        <div className="mx-3 mb-2 rounded border border-f1-border bg-f1-dark px-2 py-1.5">
          <div className="grid grid-cols-[24px_1fr_1fr_48px] gap-x-2 text-[10px] tabular-nums">
            <span />
            <span className="flex items-center gap-1 text-[9px] font-bold text-white">{dot(NOR)}NOR <span className="font-normal text-f1-muted">lap 18</span></span>
            <span className="flex items-center gap-1 text-[9px] font-bold text-white">{dot(VER)}VER <span className="font-normal text-f1-muted">lap 21</span></span>
            <span className="text-[9px] text-f1-muted text-right">DELTA</span>
            {[["S1", "28.412", "28.530", "-0.118"], ["S2", "35.226", "35.106", "+0.120"], ["S3", "27.992", "28.009", "-0.017"], ["Lap", "1:31.630", "1:31.645", "-0.015"]].map(([l, a, b, d]) => (
              <div key={l} className="contents">
                <span className="font-bold text-f1-muted">{l}</span>
                <span className={d.startsWith("-") ? "text-white font-bold" : "text-white/70"}>{a}</span>
                <span className={d.startsWith("+") ? "text-white font-bold" : "text-white/70"}>{b}</span>
                <span className={`text-right font-bold ${d.startsWith("-") ? "text-green-400" : "text-red-400"}`}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </Part>

      <div className="border-t border-f1-border pt-2 px-3 pb-3 space-y-1.5">
        <Part n={10} className="flex items-center justify-between">
          <span className={label}>Best laps compared</span>
          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-f1-red text-white">Track dominance</span>
        </Part>

        <Part n={11} className="space-y-1">
          <div className="flex gap-1">
            {["Gap", "Speed", "Throttle", "Brake", "Gear"].map((t, i) => (
              <span key={t} className={`px-2 py-0.5 rounded text-[9px] font-bold ${i < 3 ? "bg-white/15 text-white" : "bg-f1-dark border border-f1-border text-f1-muted"}`}>{t}</span>
            ))}
          </div>
          <div className="rounded border border-f1-border bg-f1-dark px-2 py-1 text-[9px] tabular-nums">
            <div className="grid grid-cols-[1fr_52px_28px_44px] gap-x-1">
              <span className="text-[8px] font-bold text-f1-muted uppercase">At 2.41 km</span>
              <span className="text-[8px] font-bold text-f1-muted text-right">SPEED</span>
              <span className="text-[8px] font-bold text-f1-muted text-right">GEAR</span>
              <span className="text-[8px] font-bold text-f1-muted text-right">THROTTLE</span>
              <span className="flex items-center gap-1 font-bold text-white">{dot(NOR)}NOR</span><span className="text-right text-white">287 km/h</span><span className="text-right text-white">7</span><span className="text-right text-white">100%</span>
              <span className="flex items-center gap-1 font-bold text-white">{dot(VER)}VER</span><span className="text-right text-white">281 km/h</span><span className="text-right text-white">7</span><span className="text-right text-white">100%</span>
            </div>
            <div className="mt-0.5 text-green-400">NOR ahead by 0.096s at this point</div>
          </div>
        </Part>

        <Part n={12}>
          <svg viewBox="0 0 260 110" className="w-full h-auto" preserveAspectRatio="none">
            {CORNERS.map((c) => <line key={c} x1={c * 260} x2={c * 260} y1={0} y2={98} stroke="#374151" strokeDasharray="2 3" />)}
            <line x1={0} x2={260} y1={20} y2={20} stroke="#4B5563" strokeWidth={0.6} />
            <path d={path(gap, 260, 40, -0.3, 0.3)} fill="none" stroke="#E5E7EB" strokeWidth={1} />
            <g transform="translate(0,46)">
              <path d={path(speedA, 260, 52, 90, 330)} fill="none" stroke={NOR} strokeWidth={1.1} />
              <path d={path(speedB, 260, 52, 90, 330)} fill="none" stroke={VER} strokeWidth={1.1} />
            </g>
            <line x1={0.46 * 260} x2={0.46 * 260} y1={0} y2={98} stroke="#9CA3AF" strokeWidth={0.8} />
            {CORNERS.map((c, i) => <text key={c} x={c * 260} y={108} fill="#6B7280" fontSize={7} textAnchor="middle">T{[1, 5, 8, 14, 19][i]}</text>)}
          </svg>
        </Part>
      </div>
    </div>
  );
}

const SECTORS_KEY: { name: string; description: string }[] = [
  { name: "Sectors tab", description: "Sector times and laps, one driver at a time." },
  { name: "Best sectors", description: "The fastest S1, S2 and S3 so far and who set them. Theoretical is the three added together, against the best lap." },
  { name: "Ideal laps", description: "Each driver's best three sectors added up, against their best lap. Click a driver to see their laps." },
  { name: "Driver and range", description: "Pick a driver. In qualifying, filter by Q1, Q2 or Q3. Practice shows the last 10 laps or all of them, and a chart of their flying laps." },
  { name: "Lap card", description: "The selected lap's sectors against the session's best and the driver's own best." },
  { name: "Lap list", description: "Every lap with its sectors and tyre. Purple is a session best, green a personal best. Out and in laps are dimmed. Laps deleted by the stewards are struck through, with the reason on hover." },
];

const COMPARE_KEY: { name: string; description: string }[] = [
  { name: "Compare tab", description: "Two drivers' best laps side by side." },
  { name: "Two drivers", description: "Pick who to compare. Click a name in the comparison to open their laps in the Sectors tab." },
  { name: "Best laps", description: "Both best laps sector by sector. The delta is green where the first driver was faster." },
  { name: "Track dominance", description: "Colours the track map by who was faster through each part of the lap. Desktop only." },
  { name: "Traces and readout", description: "Choose which traces to show: gap, speed, throttle, brake and gear. Hover, tap or drag along them to see both cars' values at that point." },
  { name: "Charts", description: "The running gap, then each trace along the lap, with corner numbers along the bottom. Desktop only." },
];

function Key({ items, start }: { items: { name: string; description: string }[]; start: number }) {
  return (
    <ol className="space-y-2.5">
      {items.map((c, i) => (
        <li key={c.name} className="flex items-start gap-2.5">
          <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-f1-red text-white text-[9px] font-extrabold flex items-center justify-center">
            {start + i}
          </span>
          <span className="text-sm text-f1-text leading-snug">
            <span className="font-bold text-white">{c.name}</span> — {c.description}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function LapAnalysisGuide() {
  return (
    <div>
      <div className="grid md:grid-cols-2 gap-6 md:gap-8 pl-3">
        <div className="space-y-4">
          <SectorsTab />
          <Key items={SECTORS_KEY} start={1} />
        </div>
        <div className="space-y-4">
          <CompareTab />
          <Key items={COMPARE_KEY} start={7} />
        </div>
      </div>
      <p className="mt-4 text-xs text-f1-muted">
        Qualifying shown. Everything counts only what has happened by the current replay time, so bests and colours change as the session plays.
      </p>
    </div>
  );
}
