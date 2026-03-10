"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";

// Simple in-memory cache shared across all useApi calls
const apiCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 120_000; // 2 minutes

export function useApi<T>(path: string | null) {
  const cached = path ? apiCache.get(path) : null;
  const isFresh = cached && Date.now() - cached.ts < CACHE_TTL;

  const [data, setData] = useState<T | null>(
    isFresh ? (cached!.data as T) : null,
  );
  const [loading, setLoading] = useState(!!path && !isFresh);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!path) {
      setData(null);
      return;
    }

    // If we already served from cache, still revalidate in the background
    const cachedEntry = apiCache.get(path);
    const hasCached = cachedEntry && Date.now() - cachedEntry.ts < CACHE_TTL;
    if (hasCached) {
      setData(cachedEntry!.data as T);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    setError(null);

    apiFetch<T>(path)
      .then((result) => {
        apiCache.set(path, { data: result, ts: Date.now() });
        if (!cancelled && pathRef.current === path) setData(result);
      })
      .catch((err) => {
        if (!cancelled && !hasCached) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, loading, error };
}
