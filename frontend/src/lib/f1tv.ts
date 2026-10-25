import { apiUrl } from "./api";
import { getToken } from "./auth";

// F1 TV account sign-in (for downloading session data and live timing) and
// video lookups (self-hosted only; the backend blocks these in public mode).

export interface F1TVStatus {
  signed_in: boolean;
  token_valid: boolean;
  expires_at: number | null; // unix seconds
  product: string | null;
  subscription_status: string | null;
  /** "env" or "saved" when the sign-in renews by itself, else null */
  renews: "env" | "saved" | null;
  email: string | null;
  /** Whether F1TV_SECRET_KEY is set, so a saved sign-in survives rebuilds */
  secret_key_set: boolean;
}

export interface F1TVChannel {
  channel_id: string | null;
  title: string | null;
  type: string | null;
  driver_number: number | string | null;
  driver_name: string | null;
  team: string | null;
  color: string | null;
}

export interface F1TVContent {
  content_id: string;
  title: string | null;
  content_subtype: string | null;
  duration: number | null;
  channels: F1TVChannel[];
  emf_attributes: Record<string, string | number>;
}

export interface F1TVPlayback {
  playback_id: string;
  /** Real time (epoch seconds) at the video's 0:00, from the stream */
  video_start_utc: number | null;
  manifest_url: string;
  license_url: string | null;
  stream_type: string | null;
  drm_type: string | null;
  entitlement_token_used: boolean;
  raw: unknown;
}

/** An error from our backend or from F1 TV, with F1's response kept for the debug panel. */
export class F1TVRequestError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(`/api/f1tv${path}`), {
    method,
    headers: { ...authHeaders(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new F1TVRequestError(data?.detail || `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}

export const f1tv = {
  status: () => request<F1TVStatus>("GET", "/status"),
  signIn: (email: string, password: string, remember: boolean) =>
    request<F1TVStatus>("POST", "/sign-in", { email, password, remember }),
  signInToken: (token: string) => request<F1TVStatus>("POST", "/sign-in", { token }),
  signOut: () => request<F1TVStatus>("DELETE", "/sign-in"),
  content: (q: string) => request<F1TVContent>("GET", `/content?q=${encodeURIComponent(q)}`),
  /** Real time (epoch seconds) at a replay's 0:00, to sync the broadcast */
  replayStart: (year: number, round: number, type: string) =>
    request<{ replay_start_utc: number }>("GET", `/replay-start?year=${year}&round=${round}&type=${type}`),
  /** Where the replay's 0:00 is in the session's F1 TV video (seconds),
   *  matched from the onboards' engine sound. Slow the first time. */
  sync: (year: number, round: number, type: string) =>
    request<{ offset: number; content_id: string; drivers?: string[] }>("GET", `/sync?year=${year}&round=${round}&type=${type}`),
  /** Live: how long after the moment on screen F1 TV stamps its live video,
   *  matched from engine sound */
  liveSync: (year: number, round: number, type: string) =>
    request<{ stamp_delay: number; drivers: string[] }>("GET", `/live-sync?year=${year}&round=${round}&type=${type}`),
  /** The F1 TV replay of a session, found from the round and session start */
  find: (year: number, round: number, type: string, live = false) =>
    request<{ content_id: string; title: string | null }>("GET", `/find?year=${year}&round=${round}&type=${type}${live ? "&live=true" : ""}`),
  play: (content: string, channelId: string | null, live = false) =>
    request<F1TVPlayback>("POST", "/play", { content, channel_id: channelId, live }),
};
