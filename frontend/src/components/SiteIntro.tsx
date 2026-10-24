"use client";

import { useEffect, useState } from "react";
import { Flag, CircleDot, Smartphone, RefreshCw, PictureInPicture2, X } from "lucide-react";

// Short "what is this" panel for the public site's home page. Hiding it is
// remembered per browser; an Overview button in the header brings it back.

const DISMISS_KEY = "f1replay_intro_dismissed";

const HIGHLIGHTS = [
  { icon: <Flag className="w-4 h-4" />, title: "Race control", text: "Steward messages, penalties and marshal sector flags on the track map." },
  { icon: <img src="/pit-return.png" alt="" className="w-4 h-4 invert opacity-80" />, title: "Pit prediction", text: "Where each driver would rejoin if they pitted now." },
  { icon: <CircleDot className="w-4 h-4" />, title: "Tyre wear", text: "Current compound, tyre age and tyre history." },
  { icon: <RefreshCw className="w-4 h-4" />, title: "Sync to your TV", text: "Line the replay up with a recording by entering the lap and gaps." },
  { icon: <PictureInPicture2 className="w-4 h-4" />, title: "Picture-in-picture", text: "A floating window to watch alongside the broadcast." },
  { icon: <Smartphone className="w-4 h-4" />, title: "Mobile and tablet", text: "Works on phones and tablets as well as desktop." },
];

/** Whether the intro is showing (null until the saved choice is read, so nothing flashes). */
export function useIntroVisibility() {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  const set = (visible: boolean) => {
    setShow(visible);
    try {
      if (visible) localStorage.removeItem(DISMISS_KEY);
      else localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  return { show, open: () => set(true), dismiss: () => set(false) };
}

export default function SiteIntro({ onDismiss }: { onDismiss: () => void }) {
  const dismiss = onDismiss;

  return (
    <div className="max-w-3xl mx-auto mb-8 bg-f1-card border border-f1-border rounded-xl p-5 relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded text-f1-muted hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Hide introduction"
        title="Hide"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="text-white font-bold text-base sm:text-lg pr-8 leading-snug">
        Replay F1 sessions from 2024 onwards with live timing, car positions on track and telemetry.
      </p>
      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {HIGHLIGHTS.map((h) => (
          <li key={h.title} className="flex items-start gap-3">
            <span className="mt-0.5 w-7 h-7 flex-shrink-0 flex items-center justify-center rounded bg-f1-red/15 text-f1-red">
              {h.icon}
            </span>
            <span className="text-sm leading-snug">
              <span className="font-bold text-white">{h.title}</span>
              <span className="text-f1-muted"> — {h.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-f1-muted">
        Pick a race below to start.{" "}
        <a href="/features" className="text-f1-red hover:underline font-semibold">See all features</a>
      </p>
    </div>
  );
}
