import { apiUrl } from "./api";
import { getToken } from "./auth";

// F1 TV sign-in and video lookups (self-hosted only; the backend blocks
// these in public mode).

export interface F1TVStatus {
  signed_in: boolean;
  valid?: boolean;
  error?: string | null;
  expires_at?: number | null;
  product?: string | null;
  subscription_status?: string | null;
  claim_names?: string[];
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
  const res = await fetch(apiUrl(path), {
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
  status: () => request<F1TVStatus>("GET", "/api/f1tv/status"),
  signIn: (value: string) => request<F1TVStatus>("POST", "/api/f1tv/token", { value }),
  signOut: () => request<F1TVStatus>("DELETE", "/api/f1tv/token"),
  content: (q: string) => request<F1TVContent>("GET", `/api/f1tv/content?q=${encodeURIComponent(q)}`),
  play: (content: string, channelId: string | null) =>
    request<F1TVPlayback>("POST", "/api/f1tv/play", { content, channel_id: channelId }),
};
