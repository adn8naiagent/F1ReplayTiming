"use client";

import { Lock } from "lucide-react";
import { REPO_URL, useAppConfig } from "@/lib/config";

// Public sites only: why newer sessions are greyed out. F1 put its timing data
// behind F1 TV, so the public archive stops at PUBLIC_ARCHIVE_LAST.

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function PaywallNotice({ className = "" }: { className?: string }) {
  const config = useAppConfig();
  const archive = config?.public_mode ? config.public_archive : null;
  if (!archive) return null;

  const lastEvent = `${archive.year} ${archive.event_name || `Round ${archive.round}`}`;

  return (
    <div className={`bg-f1-card border border-f1-red/40 rounded-xl px-4 py-3 flex items-start gap-3 ${className}`}>
      <Lock className="w-4 h-4 mt-0.5 flex-shrink-0 text-f1-red" />
      <p className="text-sm text-f1-muted leading-relaxed">
        <span className="font-bold text-white">
          From {formatDate(archive.paywall_since)}, F1 requires an F1 TV subscription to access its timing data, which
          is now behind a paywall.
        </span>{" "}
        This site has replays up to the {lastEvent}, and newer sessions can&apos;t be added. You can still run F1
        Replay Timing yourself with your own F1 TV account (Access or higher).{" "}
        <a
          href={`${REPO_URL}#self-hosting-guide`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-f1-red hover:underline font-semibold whitespace-nowrap"
        >
          Self-hosting guide →
        </a>
      </p>
    </div>
  );
}
