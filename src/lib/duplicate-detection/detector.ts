import { stripQuoted, stripSignature } from "../classification/text";
import type { Entities } from "../classification/entities";
import { contentTokens, conceptsOf, intersects, jaccard, overlap, techOf, tokenize } from "./similarity";

/**
 * Business-duplicate detection: DIFFERENT employees reporting the same underlying incident.
 *
 * Evidence is tiered (strongest first):
 *   VERY STRONG  same incident / ticket number, same circuit ID
 *   STRONG       same service ID (+ location), same device / IP (+ location or similar issue)
 *   MEDIUM       similar subject + body + same location + same issue type + nearby time
 *   WEAK         similar subject only — never enough on its own (capped below the threshold)
 */
export interface DuplicateItem {
  id: string;
  ownerKey: string; // employee id (or sender email when unmatched)
  sentAt: number | null; // epoch ms
  subject: string;
  body: string;
  entities: Entities;
}

export interface DuplicateOptions {
  similarityThreshold: number; // 0-100, default 80
  uncertainMargin: number; // scores within [threshold - margin, threshold) are "possible"
  windowHours: number; // only compare emails this close in time (unless they share an incident/circuit ID)
}

export interface DuplicateMatch {
  originalId: string; // root original
  directId: string; // email it was actually compared with
  score: number;
  minutesApart: number | null;
  signals: string[];
  tier: "VERY_STRONG" | "STRONG" | "MEDIUM" | "WEAK";
}

export interface DuplicateResult {
  duplicates: Map<string, DuplicateMatch>; // score >= threshold
  possible: Map<string, DuplicateMatch>; // uncertain
}

/** Pluggable contract so an AI / semantic detector can replace the deterministic one later. */
export interface DuplicateDetector {
  find(items: DuplicateItem[], opts: DuplicateOptions): DuplicateResult | Promise<DuplicateResult>;
}

export interface Features {
  item: DuplicateItem;
  subjectTokens: Set<string>;
  bodyTokens: Set<string>;
  concepts: Set<string>;
  tech: Set<string>;
  locations: Set<string>;
  incidents: Set<string>;
  services: Set<string>;
  circuits: Set<string>;
  ips: Set<string>;
  devices: Set<string>;
}

export function features(item: DuplicateItem): Features {
  const subjectTokens = contentTokens(item.subject);
  const bodyText = stripSignature(stripQuoted(item.body)).slice(0, 1500);
  const bodyTokens = contentTokens(bodyText);
  const all = [...tokenize(item.subject), ...tokenize(bodyText)];
  return {
    item, subjectTokens, bodyTokens,
    concepts: conceptsOf(all), tech: techOf(all),
    locations: new Set(item.entities.locations), incidents: new Set(item.entities.incidents),
    services: new Set(item.entities.services), circuits: new Set(item.entities.circuits),
    ips: new Set(item.entities.ips), devices: new Set(item.entities.devices),
  };
}

const strongKeys = (f: Features) => [...f.incidents, ...f.circuits, ...f.services, ...f.ips, ...f.devices];

export function scorePair(a: Features, b: Features, windowHours: number, threshold = 80) {
  const signals: string[] = [];
  const subj = jaccard(a.subjectTokens, b.subjectTokens);
  const body = jaccard(a.bodyTokens, b.bodyTokens);
  const sharedLoc = intersects(a.locations, b.locations);
  const loc = overlap(a.locations, b.locations);
  const tech = jaccard(a.tech, b.tech);
  const concept = jaccard(a.concepts, b.concepts);

  // when a body is missing, its weight moves to the subject so short one-line emails can still match
  const bodyMissing = !a.bodyTokens.size || !b.bodyTokens.size;
  let base = (bodyMissing ? 50 : 30) * subj + (bodyMissing ? 0 : 20) * body + 20 * loc + 10 * tech + 15 * concept;
  if (a.locations.size && b.locations.size && !sharedLoc.length) base *= 0.6; // clearly different places

  if (sharedLoc.length) signals.push(`same location (${sharedLoc.slice(0, 2).join(", ")})`);
  if (subj >= 0.5) signals.push(`similar subject (${Math.round(subj * 100)}%)`);
  if (body >= 0.4) signals.push(`similar description (${Math.round(body * 100)}%)`);
  const sharedTech = intersects(a.tech, b.tech);
  if (sharedTech.length) signals.push(`same technology (${sharedTech.slice(0, 3).join(", ")})`);
  if (concept > 0) signals.push("same type of issue");

  // tiered strong evidence
  let floor = 0;
  let tier: DuplicateMatch["tier"] = base >= threshold - 15 ? "MEDIUM" : "WEAK";
  const inc = intersects(a.incidents, b.incidents);
  const cir = intersects(a.circuits, b.circuits);
  const svc = intersects(a.services, b.services);
  const ip = intersects(a.ips, b.ips);
  const dev = intersects(a.devices, b.devices);
  const raise = (v: number, t: DuplicateMatch["tier"]) => { if (v > floor) { floor = v; tier = t; } };
  if (inc.length) { signals.unshift(`same incident/ticket number (${inc[0]})`); raise(96, "VERY_STRONG"); }
  if (cir.length) { signals.unshift(`same circuit ID (${cir[0]})`); raise(93, "VERY_STRONG"); }
  if (svc.length) { signals.unshift(`same service ID (${svc[0]})`); raise(sharedLoc.length ? 90 : 84, "STRONG"); }
  if (ip.length) { signals.unshift(`same IP address (${ip[0]})`); raise(sharedLoc.length || subj >= 0.4 ? 90 : 86, "STRONG"); }
  if (dev.length) { signals.unshift(`same device (${dev[0]})`); raise(sharedLoc.length || subj >= 0.4 ? 90 : 84, "STRONG"); }
  // same specific place + same kind of problem + close in time (medium evidence, just over the threshold)
  const closeMinutes = a.item.sentAt != null && b.item.sentAt != null ? Math.abs(a.item.sentAt - b.item.sentAt) / 60000 : null;
  if (!floor && sharedLoc.length && concept > 0 && closeMinutes != null && closeMinutes <= 120) { floor = threshold + 2; tier = "MEDIUM"; }
  const hasStrong = floor > 0 && tier !== "MEDIUM";

  let score = Math.max(base + (hasStrong ? 15 : 0), floor);
  // similar wording alone is weak evidence: never reach the duplicate threshold without a shared place or identifier
  if (!hasStrong && !sharedLoc.length) score = Math.min(score, threshold - 5);

  let minutes: number | null = null;
  let factor = 0.85; // unknown time
  const veryStrong = inc.length > 0 || cir.length > 0;
  if (a.item.sentAt != null && b.item.sentAt != null) {
    minutes = Math.abs(a.item.sentAt - b.item.sentAt) / 60000;
    const hours = minutes / 60;
    factor = hours <= 2 ? 1 : hours <= windowHours ? 0.95 : veryStrong ? 0.92 : 0;
  }
  return { score: Math.min(100, Math.round(score * factor)), signals, minutes, tier: factor === 0 ? ("WEAK" as const) : tier, hasStrong };
}

export class RuleBasedDuplicateDetector implements DuplicateDetector {
  find(items: DuplicateItem[], opts: DuplicateOptions): DuplicateResult {
    const hasIncident = (i: DuplicateItem) => (i.entities.incidents.length ? 0 : 1);
    // chronological; on equal timestamps the email carrying an incident/ticket number is treated as the original
    const sorted = [...items].sort((x, y) => {
      if (x.sentAt == null && y.sentAt == null) return hasIncident(x) - hasIncident(y) || x.id.localeCompare(y.id);
      if (x.sentAt == null) return 1;
      if (y.sentAt == null) return -1;
      return x.sentAt - y.sentAt || hasIncident(x) - hasIncident(y) || x.id.localeCompare(y.id);
    });
    const feats = sorted.map(features);
    const windowMs = opts.windowHours * 3600_000;
    const duplicates = new Map<string, DuplicateMatch>();
    const possible = new Map<string, DuplicateMatch>();
    const keyIndex = new Map<string, number[]>();
    const floor = opts.similarityThreshold - opts.uncertainMargin;

    for (let i = 0; i < feats.length; i++) {
      const cur = feats[i];
      const candidates = new Set<number>();
      for (let j = i - 1; j >= 0; j--) {
        const prev = feats[j];
        if (cur.item.sentAt != null && prev.item.sentAt != null) {
          if (cur.item.sentAt - prev.item.sentAt > windowMs) break;
        } else if (i - j > 300) break;
        candidates.add(j);
      }
      for (const key of strongKeys(cur)) for (const j of keyIndex.get(key) ?? []) candidates.add(j);

      type Scored = { j: number; score: number; signals: string[]; minutes: number | null; tier: DuplicateMatch["tier"] };
      const hits: Scored[] = [];
      let bestBelow: Scored | null = null;
      for (const j of candidates) {
        const prev = feats[j];
        if (prev.item.ownerKey === cur.item.ownerKey) continue; // same person re-sending is not a business duplicate
        const r = scorePair(prev, cur, opts.windowHours, opts.similarityThreshold);
        const s = { j, ...r };
        if (r.score >= opts.similarityThreshold) hits.push(s);
        else if (r.score >= floor && (!bestBelow || r.score > bestBelow.score)) bestBelow = s;
      }
      if (hits.length) {
        // original = earliest report (candidates are already earlier); among equal times the strongest evidence
        hits.sort((x, y) => x.j - y.j || y.score - x.score);
        const pick = hits[0];
        const direct = feats[pick.j].item.id;
        duplicates.set(cur.item.id, {
          originalId: duplicates.get(direct)?.originalId ?? direct, directId: direct,
          score: pick.score, minutesApart: pick.minutes, signals: pick.signals, tier: pick.tier,
        });
      } else if (bestBelow) {
        const direct = feats[bestBelow.j].item.id;
        possible.set(cur.item.id, { originalId: direct, directId: direct, score: bestBelow.score, minutesApart: bestBelow.minutes, signals: bestBelow.signals, tier: bestBelow.tier });
      }
      for (const key of strongKeys(cur)) {
        const arr = keyIndex.get(key) ?? [];
        arr.push(i);
        keyIndex.set(key, arr);
      }
    }
    return { duplicates, possible };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeDuplicate(m: DuplicateMatch, originalLabel: string): string {
  const sig = m.signals.filter((s) => !/apart$/.test(s)).slice(0, 3);
  const what = sig.length ? cap(sig.join(" and ")) : "Similar content";
  const when =
    m.minutesApart == null
      ? "reported the issue first (time unknown)"
      : m.minutesApart < 1 ? "reported the issue at the same time"
      : m.minutesApart < 120 ? `reported the issue ${Math.round(m.minutesApart)} minutes earlier`
      : m.minutesApart < 2880 ? `reported the issue ${Math.round(m.minutesApart / 60)} hours earlier`
      : `reported the issue ${Math.round(m.minutesApart / 1440)} days earlier`;
  return `${what}; ${originalLabel} ${when}. Similarity ${m.score}%.`;
}
