import { getToken, clearToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export function wsUrl(path: string): string {
  const base = API_URL.replace(/^http/, "ws");
  const token = getToken();
  const separator = path.includes("?") ? "&" : "?";
  const tokenParam = token ? `${separator}token=${encodeURIComponent(token)}` : "";
  return `${base}${path}${tokenParam}`;
}

export async function apiFetch<T>(path: string): Promise<T> {
  const headers: HeadersInit = {};
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(apiUrl(path), { headers });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
