"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useApi } from "@/hooks/useApi";

interface SessionEntry {
  name: string;
  date_utc: string | null;
  available: boolean;
}

interface Event {
  round_number: number;
  country: string;
  event_name: string;
  location: string;
  event_date: string;
  sessions: SessionEntry[];
  status: "latest" | "available" | "future";
}

interface EventsResponse {
  year: number;
  events: Event[];
}

interface SeasonsResponse {
  seasons: number[];
}

const COUNTRY_FLAGS: Record<string, string> = {
  "Australia": "🇦🇺",
  "Austria": "🇦🇹",
  "Azerbaijan": "🇦🇿",
  "Bahrain": "🇧🇭",
  "Belgium": "🇧🇪",
  "Brazil": "🇧🇷",
  "Canada": "🇨🇦",
  "China": "🇨🇳",
  "Hungary": "🇭🇺",
  "Italy": "🇮🇹",
  "Japan": "🇯🇵",
  "Mexico": "🇲🇽",
  "Monaco": "🇲🇨",
  "Netherlands": "🇳🇱",
  "Qatar": "🇶🇦",
  "Saudi Arabia": "🇸🇦",
  "Singapore": "🇸🇬",
  "Spain": "🇪🇸",
  "United Arab Emirates": "🇦🇪",
  "United Kingdom": "🇬🇧",
  "United States": "🇺🇸",
  "Portugal": "🇵🇹",
  "France": "🇫🇷",
  "Germany": "🇩🇪",
  "Russia": "🇷🇺",
  "Turkey": "🇹🇷",
  "South Africa": "🇿🇦",
  "Las Vegas": "🇺🇸",
  "Miami": "🇺🇸",
};

const SESSION_LABELS: Record<string, string> = {
  Race: "R",
  Qualifying: "Q",
  Sprint: "S",
  "Sprint Qualifying": "SQ",
  "Sprint Shootout": "SQ",
  "Practice 1": "FP1",
  "Practice 2": "FP2",
  "Practice 3": "FP3",
};

function StatusPill({ status }: { status: Event["status"] }) {
  switch (status) {
    case "latest":
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-f1-red text-white">
          Latest
        </span>
      );
    case "available":
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
          Available
        </span>
      );
    case "future":
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-f1-border text-f1-muted">
          Upcoming
        </span>
      );
  }
}

export default function SessionPicker() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const latestRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: seasonsData } = useApi<SeasonsResponse>("/api/seasons");
  const { data: eventsData, loading: eventsLoading } = useApi<EventsResponse>(
    `/api/seasons/${year}/events`,
  );

  const seasons = (seasonsData?.seasons || []).filter((s) => s <= currentYear);
  const events = eventsData?.events || [];

  const displayEvents = events;

  const latestEvent = useMemo(
    () => year === currentYear ? displayEvents.find((e) => e.status === "latest") || null : null,
    [displayEvents, year, currentYear],
  );

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Scroll to latest card when events load
  useEffect(() => {
    if (latestEvent && latestRef.current) {
      latestRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [latestEvent]);

  function EventCard({ evt, isLatestFeature }: { evt: Event; isLatestFeature?: boolean }) {
    const displayEvt = displayEvents.find((e) => e.round_number === evt.round_number) || evt;
    const isLatest = displayEvt.status === "latest" && year === currentYear;
    const isFuture = displayEvt.status === "future";
    const isSelected = selectedEvent?.round_number === evt.round_number;

    return (
      <div
        ref={isLatest && !isLatestFeature ? latestRef : undefined}
        onClick={() => setSelectedEvent(isSelected ? null : evt)}
        className={`bg-f1-card border rounded-xl overflow-hidden transition-all cursor-pointer ${
          isSelected
            ? "border-white/60 ring-1 ring-white/20"
            : isLatest
              ? "border-f1-red ring-1 ring-f1-red/30"
              : isFuture
                ? "border-f1-border opacity-50 hover:opacity-70"
                : "border-f1-border hover:border-f1-red/50"
        }`}
      >
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-f1-muted">
              ROUND {evt.round_number}
            </span>
            <StatusPill status={isLatest ? "latest" : displayEvt.status === "latest" ? "available" : displayEvt.status} />
          </div>
          <h3 className="text-white font-bold mb-1">
            {COUNTRY_FLAGS[evt.country] && <span className="mr-1.5">{COUNTRY_FLAGS[evt.country]}</span>}
            {evt.event_name}
          </h3>
          <p className="text-sm text-f1-muted">
            {evt.location}, {evt.country}
          </p>
          <p className="text-xs text-f1-muted mt-1">{evt.event_date}</p>
        </div>

        {/* Session buttons (shown when selected) */}
        {isSelected && (
          <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-f1-border pt-3">
            {evt.sessions.map((session) => {
              const code = SESSION_LABELS[session.name];
              if (!code) return null;
              if (session.available) {
                return (
                  <a
                    key={session.name}
                    href={`/replay/${year}/${evt.round_number}?type=${code}`}
                    className="px-3 py-1.5 bg-f1-border text-white text-xs font-bold rounded hover:bg-f1-red transition-colors"
                  >
                    {session.name}
                  </a>
                );
              }
              return (
                <span
                  key={session.name}
                  className="px-3 py-1.5 bg-f1-border/40 text-f1-muted/50 text-xs font-bold rounded cursor-not-allowed"
                >
                  {session.name}
                </span>
              );
            })}
            {isFuture && (
              <p className="text-xs text-f1-muted w-full">Sessions not yet started</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-f1-dark">
      {/* Header */}
      <div className="bg-f1-card border-b border-f1-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 flex items-center gap-3 sm:gap-4">
          <img src="/logo.png" alt="F1 Replay" className="w-12 h-12 sm:w-[72px] sm:h-[72px] rounded-lg" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-white mb-0.5 sm:mb-1">F1 Replay Timing</h1>
            <p className="text-f1-muted text-xs sm:text-base">Select a session to replay</p>
          </div>
          {/* Desktop: text buttons */}
          <a
            href="/features"
            className="hidden sm:block px-4 py-2 bg-f1-border text-f1-muted text-sm font-bold rounded hover:text-white transition-colors"
          >
            Features
          </a>
          <a
            href="/about"
            className="hidden sm:block px-4 py-2 bg-f1-border text-f1-muted text-sm font-bold rounded hover:text-white transition-colors"
          >
            About
          </a>
          {/* Mobile: hamburger menu */}
          <div className="relative sm:hidden" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-9 h-9 flex items-center justify-center rounded bg-f1-border text-f1-muted hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 w-40 bg-f1-card border border-f1-border rounded-lg shadow-xl z-50 py-1">
                <a
                  href="/features"
                  className="block px-4 py-2.5 text-sm font-bold text-f1-muted hover:text-white hover:bg-white/5 transition-colors"
                >
                  Features
                </a>
                <a
                  href="/about"
                  className="block px-4 py-2.5 text-sm font-bold text-f1-muted hover:text-white hover:bg-white/5 transition-colors"
                >
                  About
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Season selector */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => { setYear(s); setSelectedEvent(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                year === s
                  ? "bg-f1-red text-white"
                  : "bg-f1-card text-f1-muted hover:text-white border border-f1-border"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {eventsLoading ? (
          <div className="text-f1-muted text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-f1-muted border-t-f1-red rounded-full animate-spin mb-4" />
            <p>Loading data...</p>
          </div>
        ) : (
          <>
            {/* Latest event featured section */}
            {latestEvent && (
              <div className="mb-8">
                <h2 className="text-sm font-bold text-f1-muted uppercase tracking-wider mb-4">
                  Most Recent Round
                </h2>
                <div className="max-w-md">
                  <EventCard evt={latestEvent} isLatestFeature />
                </div>
              </div>
            )}

            {/* All events grid */}
            <h2 className="text-sm font-bold text-f1-muted uppercase tracking-wider mb-4">
              {year} Season
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {displayEvents.map((evt) => (
                <EventCard key={evt.round_number} evt={evt} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
