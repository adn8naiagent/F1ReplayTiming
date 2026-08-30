"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useApi } from "@/hooks/useApi";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import StorageManager from "./StorageManager";

interface SessionMenu {
  x: number;
  y: number;
  href: string;
  label: string;
  key: string;
  year: number;
  round: number;
  code: string;
  precomputed: boolean;
  sizeBytes?: number;
}

interface SessionEntry {
  name: string;
  date_utc: string | null;
  available: boolean;
  precomputed?: boolean;
  size_bytes?: number;
}

interface LiveSessionInfo {
  year: number;
  round_number: number;
  event_name: string;
  country: string;
  session_name: string;
  session_type: string;
  session_start: string;
  pre_session: boolean;
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

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatLocalTime(dateUtc: string | null): { dayDate: string; time: string } | null {
  if (!dateUtc) return null;
  try {
    const date = new Date(dateUtc);
    if (isNaN(date.getTime())) return null;
    const weekday = date.toLocaleString([], { weekday: "short" });
    const day = date.getDate();
    const month = date.toLocaleString([], { month: "short" });
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    return { dayDate: `${weekday} ${day} ${month}`, time };
  } catch {
    return null;
  }
}

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  useEffect(() => {
    setNavigating(false);
    const handlePageShow = () => setNavigating(false);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("popstate", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("popstate", handlePageShow);
    };
  }, []);
  const latestRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Right-click / long-press menu on a session pill
  const [ctxMenu, setCtxMenu] = useState<SessionMenu | null>(null);
  const [reprocessing, setReprocessing] = useState<Set<string>>(new Set());
  const [reprocessModal, setReprocessModal] = useState<{ label: string; key: string; state: "running" | "done" | "error"; message: string } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ label: string; year: number; round: number; code: string; sizeLabel: string | null; state: "confirm" | "deleting" | "done" | "error"; message: string } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  function authFetch(path: string, init?: RequestInit) {
    const token = getToken();
    return fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  function clearReprocessing(key: string) {
    setReprocessing((p) => {
      const n = new Set(p);
      n.delete(key);
      return n;
    });
  }

  async function reprocess(m: SessionMenu) {
    setCtxMenu(null);
    setReprocessing((p) => new Set(p).add(m.key));
    setReprocessModal({ label: m.label, key: m.key, state: "running", message: "Starting…" });
    const finish = (state: "done" | "error", message: string) => {
      clearReprocessing(m.key);
      setReprocessModal((prev) => (prev && prev.key === m.key ? { ...prev, state, message } : prev));
    };
    try {
      const res = await authFetch(
        `/api/sessions/${m.year}/${m.round}/reprocess?type=${m.code}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error();
      const poll = async () => {
        try {
          const s = await authFetch(
            `/api/sessions/${m.year}/${m.round}/reprocess/status?type=${m.code}`,
          ).then((r) => r.json());
          if (s.state === "running") {
            setReprocessModal((prev) => (prev && prev.key === m.key ? { ...prev, message: s.message || prev.message } : prev));
            setTimeout(poll, 1500);
            return;
          }
          finish(
            s.state === "done" ? "done" : "error",
            s.message || (s.state === "done" ? "Reprocess complete" : "Reprocess failed"),
          );
        } catch {
          finish("error", "Lost connection while reprocessing.");
        }
      };
      setTimeout(poll, 1500);
    } catch {
      finish("error", "Failed to start reprocessing.");
    }
  }

  async function confirmDelete() {
    if (!deleteModal) return;
    const m = deleteModal;
    setDeleteModal({ ...m, state: "deleting" });
    try {
      const res = await authFetch(
        `/api/sessions/${m.year}/${m.round}?type=${m.code}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      const body = await res.json();
      setDeleteModal({
        ...m,
        state: "done",
        message: `Freed ${formatSize(body.freed_bytes) || "0 KB"}.`,
      });
    } catch {
      setDeleteModal({ ...m, state: "error", message: "Failed to delete this session's data." });
    }
  }

  // Close the context menu on outside click, scroll, resize, or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    // Only close on clicks OUTSIDE the menu, so item clicks still register.
    const onDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onClose = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onClose, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onClose, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [ctxMenu]);

  const { data: seasonsData } = useApi<SeasonsResponse>("/api/seasons");
  const { data: eventsData, loading: eventsLoading } = useApi<EventsResponse>(
    `/api/seasons/${year}/events`,
  );
  const { data: liveData } = useApi<{ live: LiveSessionInfo | null }>("/api/live/status");
  const liveSession = liveData?.live || null;

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

  // No auto-scroll — let the page load at the top

  function EventRow({ evt, id }: { evt: Event; id?: string }) {
    const displayEvt = displayEvents.find((e) => e.round_number === evt.round_number) || evt;
    const isLatest = displayEvt.status === "latest" && year === currentYear;
    const isFuture = displayEvt.status === "future";
    const selectionKey = id || String(evt.round_number);
    const isSelected = selectedKey === selectionKey;

    return (
      <div
        className={`bg-f1-card border rounded-lg overflow-hidden transition-all cursor-pointer ${
          isSelected && isLatest
            ? "border-f1-red ring-1 ring-f1-red/30"
            : isSelected
              ? "border-white/60 ring-1 ring-white/20"
              : isLatest
                ? "border-f1-red ring-1 ring-f1-red/30"
              : isFuture
                ? "border-f1-border opacity-50 hover:opacity-70"
                : "border-f1-border hover:border-f1-red/50"
        }`}
      >
        {/* Compact header row */}
        <div
          className="px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-4 cursor-pointer"
          onClick={() => { if (isSelected) { setSelectedKey(null); } else { setSelectedKey(selectionKey); setSelectedEvent(evt); } }}
        >
          <span className="text-xs font-bold text-f1-muted w-8 flex-shrink-0">R{evt.round_number}</span>
          <div className="flex-1 min-w-0">
            <span className="text-white font-bold text-sm">
              {COUNTRY_FLAGS[evt.country] && <span className="mr-1.5">{COUNTRY_FLAGS[evt.country]}</span>}
              {evt.event_name}
            </span>
            <div className="sm:hidden flex items-center justify-between mt-0.5">
              <span className="text-xs text-f1-muted">{evt.event_date}</span>
              <StatusPill status={isLatest ? "latest" : displayEvt.status === "latest" ? "available" : displayEvt.status} />
            </div>
          </div>
          <span className="text-xs text-f1-muted hidden sm:block flex-shrink-0 w-44 text-right truncate">
            {evt.location}, {evt.country}
          </span>
          <span className="text-xs text-f1-muted hidden sm:block flex-shrink-0 w-20 text-right">{evt.event_date}</span>
          <span className="hidden sm:flex flex-shrink-0 w-20 justify-end">
            <StatusPill status={isLatest ? "latest" : displayEvt.status === "latest" ? "available" : displayEvt.status} />
          </span>
          <svg
            className={`w-4 h-4 text-f1-muted transition-transform flex-shrink-0 ${isSelected ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Expanded session drawer */}
        {isSelected && (
          <div className="px-4 pb-3 flex flex-wrap gap-3 border-t border-f1-border pt-3" onClick={(e) => e.stopPropagation()}>
            {evt.sessions.map((session) => {
              const code = SESSION_LABELS[session.name];
              if (!code) return null;
              const localTime = formatLocalTime(session.date_utc);
              const isLive = liveSession?.year === year && liveSession?.round_number === evt.round_number && liveSession?.session_type === code;
              if (isLive) {
                return (
                  <div key={session.name} className="flex flex-col items-center">
                    {localTime && (
                      <span className="text-[10px] text-red-400 mb-1 text-center leading-tight">
                        {localTime.dayDate}<br />{localTime.time}
                      </span>
                    )}
                    <a
                      href={`/live?year=${year}&round=${evt.round_number}&type=${code}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNavigating(true);
                      }}
                      className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded hover:bg-red-500 transition-colors flex items-center gap-1.5"
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                      </span>
                      {session.name}
                    </a>
                  </div>
                );
              }
              if (session.available) {
                const sizeLabel = formatSize(session.size_bytes);
                const tooltip = session.precomputed
                  ? `Downloaded${sizeLabel ? ` · ${sizeLabel}` : ""} — right-click for options`
                  : "Not downloaded — will process when opened";
                const href = `/replay?year=${year}&round=${evt.round_number}&type=${code}`;
                const sKey = `${year}_${evt.round_number}_${code}`;
                const busy = reprocessing.has(sKey);
                const openMenu = (x: number, y: number) =>
                  setCtxMenu({ x, y, href, label: session.name, key: sKey, year, round: evt.round_number, code, precomputed: !!session.precomputed, sizeBytes: session.size_bytes });
                return (
                  <div key={session.name} className="flex flex-col items-center">
                    {localTime && (
                      <span className="text-[10px] text-f1-muted mb-1 text-center leading-tight">
                        {localTime.dayDate}<br />{localTime.time}
                      </span>
                    )}
                    <a
                      href={href}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressClickRef.current) { suppressClickRef.current = false; e.preventDefault(); return; }
                        setNavigating(true);
                      }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); }}
                      onTouchStart={(e) => {
                        const t = e.touches[0];
                        longPressRef.current = setTimeout(() => { suppressClickRef.current = true; openMenu(t.clientX, t.clientY); }, 500);
                      }}
                      onTouchEnd={() => { if (longPressRef.current) clearTimeout(longPressRef.current); }}
                      onTouchMove={() => { if (longPressRef.current) clearTimeout(longPressRef.current); }}
                      title={tooltip}
                      className="px-3 py-1.5 bg-f1-border text-white text-xs font-bold rounded hover:bg-f1-red transition-colors flex items-center gap-1.5 select-none"
                    >
                      {session.name}
                      {busy ? (
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" aria-label="Reprocessing" />
                      ) : session.precomputed ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" aria-label="Downloaded" />
                      ) : null}
                    </a>
                  </div>
                );
              }
              return (
                <div key={session.name} className="flex flex-col items-center">
                  {localTime && (
                    <span className="text-[10px] text-f1-muted/50 mb-1 text-center leading-tight">
                      {localTime.dayDate}<br />{localTime.time}
                    </span>
                  )}
                  <span
                    className="px-3 py-1.5 bg-f1-border/40 text-f1-muted/50 text-xs font-bold rounded cursor-not-allowed"
                  >
                    {session.name}
                  </span>
                </div>
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
      {/* Loading overlay */}
      {navigating && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-f1-muted border-t-f1-red rounded-full animate-spin" />
            <p className="text-white font-bold text-sm">Loading session...</p>
          </div>
        </div>
      )}

      {/* Session context menu (right-click / long-press) */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 min-w-[11rem] bg-f1-card border border-f1-border rounded-lg shadow-xl py-1 text-sm"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            onClick={() => { setNavigating(true); window.location.href = ctxMenu.href; }}
            className="block w-full text-left px-4 py-2 text-white hover:bg-white/5 transition-colors"
          >
            Open
          </button>
          <button
            onClick={() => { window.open(ctxMenu.href, "_blank", "noopener,noreferrer"); setCtxMenu(null); }}
            className="block w-full text-left px-4 py-2 text-white hover:bg-white/5 transition-colors"
          >
            Open in new tab
          </button>
          <button
            onClick={() => { window.open(ctxMenu.href, "_blank", "noopener,noreferrer,width=1280,height=820"); setCtxMenu(null); }}
            className="block w-full text-left px-4 py-2 text-white hover:bg-white/5 transition-colors"
          >
            Open in new window
          </button>
          <div className="my-1 border-t border-f1-border" />
          <button
            onClick={() => reprocess(ctxMenu)}
            className="block w-full text-left px-4 py-2 text-white hover:bg-white/5 transition-colors"
          >
            ↻ Reprocess
          </button>
          {ctxMenu.precomputed && (
            <button
              onClick={() => {
                setDeleteModal({
                  label: ctxMenu.label,
                  year: ctxMenu.year,
                  round: ctxMenu.round,
                  code: ctxMenu.code,
                  sizeLabel: formatSize(ctxMenu.sizeBytes),
                  state: "confirm",
                  message: "",
                });
                setCtxMenu(null);
              }}
              className="block w-full text-left px-4 py-2 text-red-400 hover:bg-white/5 transition-colors"
            >
              Delete data{ctxMenu.sizeBytes ? ` (${formatSize(ctxMenu.sizeBytes)})` : ""}
            </button>
          )}
        </div>
      )}

      {storageOpen && <StorageManager onClose={() => setStorageOpen(false)} />}

      {/* Delete confirmation */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-f1-card border border-f1-border rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-white font-bold text-base mb-1">
              {deleteModal.state === "done" ? "Data deleted" : `Delete ${deleteModal.label} data?`}
            </h3>
            {deleteModal.state === "confirm" && (
              <>
                <p className="text-f1-muted text-sm mb-4">
                  Removes the stored data for this session
                  {deleteModal.sizeLabel ? `, freeing ${deleteModal.sizeLabel}` : ""}. Open the
                  session to download it again.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setDeleteModal(null)}
                    className="px-4 py-2 bg-f1-border text-white text-sm font-bold rounded hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
            {deleteModal.state === "deleting" && (
              <div className="flex items-center gap-3 mt-3">
                <span className="w-5 h-5 border-2 border-f1-muted border-t-f1-red rounded-full animate-spin flex-shrink-0" />
                <span className="text-white text-sm">Deleting…</span>
              </div>
            )}
            {(deleteModal.state === "done" || deleteModal.state === "error") && (
              <>
                <p className={`text-sm mb-2 ${deleteModal.state === "done" ? "text-green-400" : "text-red-400"}`}>
                  {deleteModal.message}
                </p>
                <div className="flex justify-end mt-5">
                  <button
                    onClick={() => {
                      setDeleteModal(null);
                      if (deleteModal.state === "done") window.location.reload();
                    }}
                    className="px-4 py-2 bg-f1-border text-white text-sm font-bold rounded hover:bg-f1-red transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reprocess progress modal */}
      {reprocessModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-f1-card border border-f1-border rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-white font-bold text-base mb-1">Reprocessing {reprocessModal.label}</h3>
            {reprocessModal.state === "running" && (
              <>
                <p className="text-f1-muted text-sm mb-4">
                  Rebuilding this session&apos;s data. This usually takes 1–3 minutes. You can close this and it will keep running.
                </p>
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 border-2 border-f1-muted border-t-f1-red rounded-full animate-spin flex-shrink-0" />
                  <span className="text-white text-sm">{reprocessModal.message}</span>
                </div>
              </>
            )}
            {reprocessModal.state === "done" && (
              <p className="text-green-400 text-sm mb-2">
                Done. Reopen the session to see the updated data.
              </p>
            )}
            {reprocessModal.state === "error" && (
              <p className="text-red-400 text-sm mb-2">{reprocessModal.message}</p>
            )}
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setReprocessModal(null)}
                className="px-4 py-2 bg-f1-border text-white text-sm font-bold rounded hover:bg-f1-red transition-colors"
              >
                {reprocessModal.state === "running" ? "Hide" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          <button
            onClick={() => setStorageOpen(true)}
            className="hidden sm:block px-4 py-2 bg-f1-border text-f1-muted text-sm font-bold rounded hover:text-white transition-colors"
          >
            Storage
          </button>
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
                <button
                  onClick={() => { setMenuOpen(false); setStorageOpen(true); }}
                  className="block w-full text-left px-4 py-2.5 text-sm font-bold text-f1-muted hover:text-white hover:bg-white/5 transition-colors"
                >
                  Storage
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Season selector */}
        <div className="flex gap-2 mb-8 flex-wrap max-w-3xl mx-auto">
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
            {/* Live session banner — only show on the year that has the live session */}
            {liveSession && liveSession.year === year && (
              <div className="mb-8 max-w-3xl mx-auto">
                <a
                  href={`/live?year=${liveSession.year}&round=${liveSession.round_number}&type=${liveSession.session_type}`}
                  onClick={() => setNavigating(true)}
                  className="block bg-f1-card border border-f1-red/50 rounded-xl overflow-hidden hover:border-f1-red transition-all group"
                >
                  <div className="px-4 py-4 flex items-center gap-4">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 rounded text-sm font-extrabold text-white uppercase flex-shrink-0">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                      </span>
                      LIVE
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-bold group-hover:text-red-400 transition-colors">
                        {COUNTRY_FLAGS[liveSession.country] && <span className="mr-1.5">{COUNTRY_FLAGS[liveSession.country]}</span>}
                        {liveSession.event_name} — {liveSession.session_name}
                      </h3>
                      <p className="text-f1-muted text-sm">
                        {liveSession.pre_session ? "Starting soon — click to open live timing" : "Session in progress — click to open live timing"}
                      </p>
                    </div>
                    <svg className="w-5 h-5 text-f1-muted group-hover:text-white transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </a>
              </div>
            )}

            {/* Latest round at top */}
            {latestEvent && (
              <div className="mb-6 max-w-3xl mx-auto">
                <h2 className="text-sm font-bold text-f1-muted uppercase tracking-wider mb-3">
                  Most Recent Round
                </h2>
                <EventRow evt={latestEvent} id="featured" />
              </div>
            )}

            {/* Season list */}
            <h2 className="text-sm font-bold text-f1-muted uppercase tracking-wider mb-4 max-w-3xl mx-auto">
              {year} Season
            </h2>
            <div className="flex flex-col gap-2 max-w-3xl mx-auto">
              {displayEvents.map((evt) => (
                <EventRow key={evt.round_number} evt={evt} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
