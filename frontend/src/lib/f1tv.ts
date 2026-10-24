import { apiUrl } from "./api";
import { getToken } from "./auth";

// F1 TV account sign-in for downloading session data (self-hosted only; the
// backend blocks these in public mode).

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

async function call(method: string, path: string, body?: unknown): Promise<F1TVStatus> {
  const token = getToken();
  const res = await fetch(apiUrl(`/api/f1tv${path}`), {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data as F1TVStatus;
}

export const f1tv = {
  status: () => call("GET", "/status"),
  signIn: (email: string, password: string, remember: boolean) =>
    call("POST", "/sign-in", { email, password, remember }),
  signInToken: (token: string) => call("POST", "/sign-in", { token }),
  signOut: () => call("DELETE", "/sign-in"),
};
