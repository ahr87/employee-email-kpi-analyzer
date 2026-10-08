"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { storageWarning } from "./db";

export function errorMessage(e: unknown): string {
  const issues = (e as { issues?: { path: (string | number)[]; message: string }[] } | null)?.issues; // validation errors (zod)
  if (Array.isArray(issues)) return issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (e instanceof DOMException && e.name === "QuotaExceededError") return "The browser storage is full. Export a backup and free some space.";
  return e instanceof Error ? e.message : String(e);
}

/**
 * Runs a local data query (everything is read from the browser's own storage — no network involved).
 * `key` identifies the query: it re-runs when the key changes, or when `reload()` is called. A null key skips it.
 */
export function useQuery<T>(key: string | null, fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!key);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }); // keep the latest closure (runs before the query effect below)
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    fnRef.current()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "—";

export { storageWarning };

export const fmtBytes = (n: number | null | undefined) =>
  n == null ? "unknown" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
