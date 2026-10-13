"use client";

import { useAppConfig, reportProblemUrl, REPO_URL, KOFI_URL } from "@/lib/config";

export default function SiteFooter() {
  const config = useAppConfig();
  const publicMode = !!config?.public_mode;
  const linkClass = "hover:text-white transition-colors";

  return (
    <footer className="border-t border-f1-border mt-12">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-3 text-xs text-f1-muted leading-relaxed">
        <nav className="flex flex-wrap gap-x-5 gap-y-1 font-bold">
          <a href="/about" className={linkClass}>About</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>GitHub</a>
          <a href={reportProblemUrl()} target="_blank" rel="noopener noreferrer" className={linkClass}>Report a problem</a>
          <a href={`${REPO_URL}/discussions`} target="_blank" rel="noopener noreferrer" className={linkClass}>Ideas &amp; questions</a>
          <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>Support on Ko-fi</a>
          {publicMode && (
            <a href={`${REPO_URL}#self-hosting-guide`} target="_blank" rel="noopener noreferrer" className={linkClass}>Self-host it</a>
          )}
        </nav>
        <p>
          This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE,
          FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One
          Licensing B.V.
        </p>
      </div>
    </footer>
  );
}
