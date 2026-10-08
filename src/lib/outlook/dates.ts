import { parseDateDetailed } from "../parser";

export interface ReceivedAt { date: Date | null; alt: Date | null; evidence: "DMY" | "MDY" | null }

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})$/i;

/** The wall-clock reading of an instant in the user's own time zone, stored the way the app stores all times (as UTC fields). */
const localWallClock = (instant: Date) =>
  new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate(), instant.getHours(), instant.getMinutes(), instant.getSeconds()));

/**
 * `receivedAt` is the authoritative message time. ISO values with an explicit offset ("…Z", "…+03:00") are real instants
 * and are shown in the user's local time (so the month matches what Outlook displays); values without an offset
 * ("2026-10-08 10:57:31", the usual VBA Format() output) are already local wall-clock time and are used as written.
 * Numeric locale formats (03/04/2026 10:00 PM) follow the day/month order logic used for pasted emails.
 */
export function parseReceivedAt(value: string | number, order: "DMY" | "MDY"): ReceivedAt {
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? { date: null, alt: null, evidence: null } : { date: localWallClock(d), alt: null, evidence: null };
  }
  const v = value.trim();
  if (ISO_WITH_OFFSET.test(v)) {
    const d = new Date(v.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? { date: null, alt: null, evidence: null } : { date: localWallClock(d), alt: null, evidence: null };
  }
  const r = parseDateDetailed(v, order);
  return { date: r.date, alt: r.alt, evidence: r.evidence ?? null };
}
