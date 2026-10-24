"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { PublicArchive, REPO_URL, useAppConfig } from "@/lib/config";

// Public sites only: why newer sessions are greyed out. F1 put its timing data
// behind F1 TV, so the public archive stops at PUBLIC_ARCHIVE_LAST.

const SEEN_KEY = "f1replay_paywall_notice_seen";

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function usePublicArchive(): PublicArchive | null {
  const config = useAppConfig();
  return config?.public_mode ? config.public_archive : null;
}

function Headline({ archive }: { archive: PublicArchive }) {
  return (
    <>
      From {formatDate(archive.paywall_since)}, F1 requires an F1 TV subscription to access its timing data, which is
      now behind a paywall.
    </>
  );
}

function Details({ archive }: { archive: PublicArchive }) {
  const lastEvent = `${archive.year} ${archive.event_name || `Round ${archive.round}`}`;
  return (
    <>
      This site has replays up to the {lastEvent}, and newer sessions can&apos;t be added. You can still run F1 Replay
      Timing yourself with your own F1 TV account (Access or higher).
    </>
  );
}

function GuideLink() {
  return (
    <a
      href={`${REPO_URL}#self-hosting-guide`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-f1-red hover:underline font-semibold whitespace-nowrap"
    >
      Self-hosting guide →
    </a>
  );
}

export default function PaywallNotice({ className = "" }: { className?: string }) {
  const archive = usePublicArchive();
  if (!archive) return null;

  return (
    <div className={`bg-f1-card border border-f1-red/40 rounded-xl px-4 py-3 flex items-start gap-3 ${className}`}>
      <Lock className="w-4 h-4 mt-0.5 flex-shrink-0 text-f1-red" />
      <p className="text-sm text-f1-muted leading-relaxed">
        <span className="font-bold text-white">
          <Headline archive={archive} />
        </span>{" "}
        <Details archive={archive} /> <GuideLink />
      </p>
    </div>
  );
}

/** The same notice as a one-off overlay on a visitor's first visit, remembered per browser. */
export function PaywallOverlay() {
  const archive = usePublicArchive();
  const [seen, setSeen] = useState(true); // assume seen until storage is read, so nothing flashes

  const dismiss = () => {
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  };

  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_KEY) === "1");
    } catch {
      setSeen(false);
    }
  }, []);

  const show = !!archive && !seen;

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!archive || !show) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={dismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-notice-title"
        className="bg-f1-card border border-f1-red/40 rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-f1-red" />
          <span className="text-[11px] font-bold text-f1-red uppercase tracking-wider">F1 TV now required</span>
        </div>
        <h2 id="paywall-notice-title" className="text-white font-bold text-base leading-snug mb-3">
          <Headline archive={archive} />
        </h2>
        <p className="text-f1-muted text-sm leading-relaxed mb-5">
          <Details archive={archive} />
        </p>
        <div className="flex items-center justify-between gap-3">
          <GuideLink />
          <button
            onClick={dismiss}
            autoFocus
            className="px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
