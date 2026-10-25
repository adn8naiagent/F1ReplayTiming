// Mocks of the Broadcast view (multi-view, single view, the volume control)
// and of how the automatic sync lines the video up, with numbered callouts
// and a key underneath, like LapAnalysisGuide. The video itself can't be
// shown, so it's drawn as a placeholder.

const NOR = "#FF8000";
const LEC = "#ED1131";

function Callout({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`absolute z-10 w-4 h-4 rounded-full bg-f1-red text-white text-[9px] font-extrabold flex items-center justify-center shadow ${className}`}>
      {n}
    </span>
  );
}

const pill = "px-1.5 py-0.5 rounded border text-[7px] font-bold leading-none";

/** A stand-in for F1 TV's video */
function VideoPlaceholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#1d2433] via-[#11151f] to-[#0b0d13] flex items-center justify-center">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/15">{label}</span>
    </div>
  );
}

/** A simple circuit outline, drawn as the white track lines used over video */
function MiniTrack({ className = "" }: { className?: string }) {
  const d = "M12 70 L22 30 Q26 18 38 20 L60 26 Q70 29 66 40 L58 52 Q54 60 64 62 L88 64 Q98 66 94 76 L90 84 Q86 90 74 88 L24 84 Q10 82 12 70 Z";
  return (
    <svg viewBox="0 0 106 100" className={className}>
      <path d={d} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="5" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#15151E" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="40" cy="20.6" r="3.2" fill={NOR} stroke="white" strokeWidth="0.8" />
      <circle cx="78" cy="63.4" r="3.2" fill={LEC} stroke="white" strokeWidth="0.8" />
      <text x="40" y="13" textAnchor="middle" fontSize="7" fontWeight="800" fill="white">NOR</text>
    </svg>
  );
}

function TelemetryPill() {
  return (
    <div className="absolute bottom-1 inset-x-0 mx-auto w-fit flex items-center gap-1 h-3.5 px-1 rounded-full bg-black/70 border border-white/10">
      <span className="w-0.5 h-2 rounded-full" style={{ backgroundColor: NOR }} />
      <span className="text-[6px] font-extrabold text-white">NOR</span>
      <span className="text-[7px] font-extrabold text-white tabular-nums">287</span>
      <span className="w-2.5 h-2.5 rounded-[2px] bg-white text-black text-[6px] font-extrabold flex items-center justify-center">7</span>
      <span className="w-5 h-1 rounded-full bg-white/10 overflow-hidden"><span className="block h-full w-4/5 bg-green-400 rounded-full" /></span>
      <span className="px-0.5 rounded-[2px] bg-white/10 text-white/30 text-[5px] font-extrabold leading-[8px]">BRAKE</span>
    </div>
  );
}

function MultiView() {
  return (
    <div className="relative w-full aspect-[16/9] rounded-lg border border-f1-border overflow-hidden bg-black">
      <div className="absolute inset-y-0 left-0 w-[70%]">
        <VideoPlaceholder label="F1 TV broadcast" />
        <div className="absolute top-2 left-2 space-y-1">
          <div className="relative flex items-center gap-1">
            <Callout n={1} className="-left-2.5 -top-1.5" />
            <span className="flex rounded border border-f1-border overflow-hidden">
              <span className="px-1.5 py-0.5 text-[7px] font-bold bg-white text-black">Multi-view</span>
              <span className="px-1.5 py-0.5 text-[7px] font-bold bg-black/70 text-f1-muted">Single view</span>
            </span>
          </div>
          <div className="relative flex items-center gap-1">
            <Callout n={2} className="-left-2.5 -top-1.5" />
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 border border-f1-border">
              <span className="w-1 h-1 rounded-full bg-green-400" />
              <span className="text-[7px] text-white/80">Synced by engine sound (VER, STR)</span>
            </span>
            <span className={`${pill} bg-black/70 border-f1-border text-f1-muted`}>Sync manually</span>
          </div>
          <div className="flex items-center gap-1 px-1 py-0.5 rounded bg-black/60 border border-f1-border w-fit">
            <span className="text-[6px] font-bold text-f1-muted uppercase tracking-wider">Fine-tune video sync</span>
            {["−5s", "−0.5s", "+0.5s", "+5s"].map((t) => (
              <span key={t} className={`${pill} bg-black/70 border-f1-border text-f1-muted`}>{t}</span>
            ))}
          </div>
          <div className="relative flex items-center gap-1">
            <Callout n={3} className="-left-2.5 -top-1.5" />
            {([["Track map", true], ["Race control", true], ["Team radio", true], ["Radio audio", false]] as const).map(([t, on]) => (
              <span key={t} className={`${pill} flex items-center gap-0.5 bg-black/80 ${on ? "border-white/40 text-white" : "border-f1-border text-white/60"}`}>
                <span className={`w-1 h-1 rounded-full ${on ? "bg-green-400" : "bg-white/25"}`} />{t}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-2 inset-x-0 flex justify-center">
          <div className="relative flex items-center gap-1 px-2 py-0.5 rounded bg-black/70 border border-white/10">
            <Callout n={8} className="-left-2.5 -top-2" />
            <span className="w-1 h-1 rounded-full bg-orange-400" />
            <span className="text-[6px] font-bold text-orange-300 uppercase tracking-wider">Race control</span>
            <span className="text-[7px] text-white">Car 10 (GAS) time deleted – track limits at turn 9</span>
          </div>
        </div>
      </div>

      <div className="absolute top-[12%] bottom-[6%] left-[70%] -ml-1 w-2 flex items-center justify-center">
        <div className="relative w-0.5 h-8 rounded-full bg-white/60">
          <Callout n={7} className="-left-2 -top-5" />
        </div>
      </div>

      <div className="absolute top-[12%] bottom-[4%] right-[2%] w-[26%] flex flex-col gap-1.5">
        <div className="relative w-full aspect-video rounded border border-white/10 overflow-hidden">
          <VideoPlaceholder label="Onboard" />
          <span className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded bg-f1-dark border border-f1-border text-[6px] font-bold text-white">
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: NOR }} />NOR <span className="text-f1-muted">▾</span>
          </span>
          <span className="absolute top-1 right-4 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-black/70 text-[6px] font-bold text-white">
            <span className="w-1 h-1 rounded-full bg-green-400" />Telemetry
          </span>
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-black/70 text-white/80 text-[7px] leading-none flex items-center justify-center">×</span>
          <TelemetryPill />
        </div>
        <Callout n={4} className="-left-2 -top-2" />
        <Callout n={5} className="-left-2 top-[18%]" />
        <span className="flex items-center justify-between px-1 py-0.5 rounded bg-f1-dark border border-f1-border text-[6px] text-f1-muted">
          Add a second onboard <span>▾</span>
        </span>
        <div className="relative flex-1 min-h-0">
          <Callout n={6} className="-left-2 top-0" />
          <MiniTrack className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}

function SingleView() {
  return (
    <div className="relative w-full aspect-[16/9] rounded-lg border border-f1-border overflow-hidden bg-black">
      <VideoPlaceholder label="F1 TV broadcast" />
      <div className="absolute right-[3%] top-1/2 -translate-y-1/2 w-[30%] aspect-square">
        <Callout n={9} className="-left-2 top-0" />
        <MiniTrack className="w-full h-full" />
      </div>
    </div>
  );
}

function VolumeControl() {
  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-f1-border bg-f1-card px-3 py-2">
      <Callout n={10} className="-left-2 -top-2" />
      <svg className="w-4 h-4 text-white flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
      <span className="relative w-20 h-1 rounded-full bg-white/20 flex-shrink-0">
        <span className="absolute inset-y-0 left-0 w-3/5 rounded-full bg-white" />
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white" style={{ left: "60%" }} />
      </span>
      <span className="text-[10px] text-f1-muted truncate">-5m -1m -30s -5s</span>
      <span className="w-6 h-6 flex-shrink-0 rounded-full bg-f1-red flex items-center justify-center text-white text-[9px]">▶</span>
    </div>
  );
}

/** Engine pitch from an onboard's sound against the driver's revs in the
 *  timing: sliding one along the other until they line up gives the offset */
export function SyncDiagram() {
  // A flying lap's revs: rising through each gear, dipping into corners
  const revs = [62, 70, 78, 84, 88, 60, 52, 66, 76, 83, 87, 89, 64, 56, 70, 80, 86, 89, 90, 58, 50, 64, 75];
  const toPath = (vals: number[], dx: number, y0: number) =>
    vals.map((v, i) => `${i ? "L" : "M"}${(i * 12 + dx).toFixed(1)} ${(y0 - v * 0.42).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 300 124" className="w-full max-w-md h-auto">
      <text x="0" y="10" fontSize="8" fontWeight="700" fill="#8A8A9A">ENGINE SOUND FROM AN ONBOARD (VIDEO)</text>
      <path d={toPath(revs, 30, 58)} fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
      <text x="0" y="74" fontSize="8" fontWeight="700" fill="#8A8A9A">THE DRIVER&apos;S REVS (TIMING DATA)</text>
      <path d={toPath(revs, 6, 120)} fill="none" stroke={NOR} strokeWidth="2" strokeLinejoin="round" />
      {[78, 162, 258].map((x) => (
        <line key={x} x1={x} y1={22} x2={x - 24} y2={84} stroke="#E10600" strokeWidth="1" strokeDasharray="2 2" />
      ))}
      <text x="296" y="100" fontSize="8" fontWeight="700" fill="#E10600" textAnchor="end">same moment</text>
    </svg>
  );
}

const MULTI_KEY: { name: string; description: string }[] = [
  { name: "View", description: "Switch between Multi-view and Single view. Your choice is remembered." },
  { name: "Sync", description: "How the session is synced, with Sync manually beside it to line it up yourself. Underneath, Fine-tune video sync nudges the video ±0.5s or ±5s against the timing." },
  { name: "Overlays", description: "Turn the track map, race control and team radio on or off. Radio audio is separate, as the broadcast often plays the same message. Your choices are remembered." },
  { name: "Onboards", description: "Pick up to two drivers' onboard cameras from the menu. Each has Sectors and Telemetry switches and × to close it." },
  { name: "Onboard telemetry", description: "Speed, gear, a throttle gauge and a brake light for that driver, from the timing. In qualifying and practice, a strip along the bottom edge fills in with their mini-sectors (purple, green, yellow)." },
  { name: "Track map", description: "Under the onboards. Drivers selected on the leaderboard are highlighted, with their names." },
  { name: "Panel width", description: "Drag the edge between the broadcast and the panel to make the panel narrower." },
  { name: "Race control", description: "The latest message along the bottom of the broadcast. It fades after a few seconds." },
];

const OTHER_KEY: { name: string; description: string }[] = [
  { name: "Single view", description: "The broadcast full width, with the track map's lines over it." },
  { name: "Volume", description: "Mute, and a volume slider that opens on hover, at the left of the playback controls while the broadcast shows." },
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

export default function BroadcastGuide() {
  return (
    <div className="space-y-6 pl-3">
      <div className="grid md:grid-cols-[3fr_2fr] gap-6 items-start">
        <MultiView />
        <Key items={MULTI_KEY} start={1} />
      </div>
      <div className="grid md:grid-cols-[3fr_2fr] gap-6 items-start">
        <div className="space-y-3">
          <SingleView />
          <VolumeControl />
        </div>
        <Key items={OTHER_KEY} start={9} />
      </div>
      <p className="text-xs text-f1-muted">
        Shown with mock video. Controls on the video appear on hover, or for a few seconds after a tap on touch screens.
      </p>
    </div>
  );
}
