import { stripQuoted } from "../classification/text";
import type { Entities } from "../classification/entities";
import { contentTokens, conceptsOf, intersects, jaccard, overlap, techOf, tokenize } from "./similarity";

/** Business-duplicate detection: different employees reporting the same incident. */
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
  windowHours: number; // only compare emails this close in time (unless IDs are shared)
}

export interface DuplicateMatch {
  originalId: string; // root original
  directId: string; // email it was actually compared with
  score: number;
  minutesApart: number | null;
  signals: string[];
}

export interface DuplicateResult {
  duplicates: Map<string, DuplicateMatch>; // score >= threshold
  possible: Map<string, DuplicateMatch>; // uncertain
}

/** Pluggable contract so an AI / semantic detector can replace the deterministic one later. */
export interface DuplicateDetector {
  find(items: DuplicateItem[], opts: DuplicateOptions): DuplicateResult | Promise<DuplicateResult>;
}

interface Features {
  item: DuplicateItem;
  subjectTokens: Set<string>;
  bodyTokens: Set<string>;
  concepts: Set<string>;
  tech: Set<string>;
  locations: Set<string>;
  incidents: Set<string>;
  services: Set<string>;
  circuits: Set<string>;
}

function features(item: DuplicateItem): Features {
  const subjectTokens = contentTokens(item.subject);
  const bodyText = stripQuoted(item.body).slice(0, 1500);
  const bodyTokens = contentTokens(bodyText);
  const all = [...tokenize(item.subject), ...tokenize(bodyText)];
  return {
    item,
    subjectTokens,
    bodyTokens,
    concepts: conceptsOf(all),
    tech: techOf(all),
    locations: new Set(item.entities.locations),
    incidents: new Set(item.entities.incidents),
    services: new Set(item.entities.services),
    circuits: new Set(item.entities.circuits),
  };
}

export function scorePair(a: Features, b: Features, windowHours: number): { score: number; signals: string[]; minutes: number | null } {
  const signals: string[] = [];
  let base = 0;

  const subj = jaccard(a.subjectTokens, b.subjectTokens);
  const body = jaccard(a.bodyTokens, b.bodyTokens);
  const loc = overlap(a.locations, b.locations);
  const tech = jaccard(a.tech, b.tech);
  const concept = jaccard(a.concepts, b.concepts);
  base += 35 * subj + 20 * body + 20 * loc + 10 * tech + 15 * concept;

  const sharedLoc = intersects(a.locations, b.locations);
  if (sharedLoc.length) signals.push(`same location (${sharedLoc.slice(0, 2).join(", ")})`);
  if (subj >= 0.5) signals.push(`similar subject (${Math.round(subj * 100)}%)`);
  if (body >= 0.4) signals.push(`similar body (${Math.round(body * 100)}%)`);
  const sharedTech = intersects(a.tech, b.tech);
  if (sharedTech.length) signals.push(`same technology (${sharedTech.slice(0, 3).join(", ")})`);
  if (concept > 0) signals.push("same type of issue");

  let idBonus = 0;
  for (const [label, x, y] of [
    ["incident number", a.incidents, b.incidents],
    ["circuit ID", a.circuits, b.circuits],
    ["service ID", a.services, b.services],
  ] as const) {
    const shared = intersects(x, y);
    if (shared.length) {
      idBonus = 45;
      signals.unshift(`same ${label} (${shared[0]})`);
    }
  }
  if (idBonus) base = Math.max(base + idBonus, 88); // a shared strong identifier is near-decisive

  let minutes: number | null = null;
  let factor = 0.85; // unknown time
  if (a.item.sentAt != null && b.item.sentAt != null) {
    minutes = Math.abs(a.item.sentAt - b.item.sentAt) / 60000;
    const hours = minutes / 60;
    factor = hours <= 2 ? 1 : hours <= windowHours ? 0.95 : idBonus ? 0.9 : 0;
    if (hours <= 2) signals.push(`${Math.round(minutes)} minutes apart`);
    else if (hours <= windowHours) signals.push(`${Math.round(hours)} hours apart`);
  }
  return { score: Math.min(100, Math.round(base * factor)), signals, minutes };
}

export class RuleBasedDuplicateDetector implements DuplicateDetector {
  find(items: DuplicateItem[], opts: DuplicateOptions): DuplicateResult {
    const sorted = [...items].sort((x, y) => {
      if (x.sentAt == null && y.sentAt == null) return x.id.localeCompare(y.id);
      if (x.sentAt == null) return 1;
      if (y.sentAt == null) return -1;
      return x.sentAt - y.sentAt || x.id.localeCompare(y.id);
    });
    const feats = sorted.map(features);
    const windowMs = opts.windowHours * 3600_000;
    const duplicates = new Map<string, DuplicateMatch>();
    const possible = new Map<string, DuplicateMatch>();
    const idIndex = new Map<string, number[]>();
    const floor = opts.similarityThreshold - opts.uncertainMargin;

    for (let i = 0; i < feats.length; i++) {
      const cur = feats[i];
      const candidates = new Set<number>();
      // time window
      for (let j = i - 1; j >= 0; j--) {
        const prev = feats[j];
        if (cur.item.sentAt != null && prev.item.sentAt != null) {
          if (cur.item.sentAt - prev.item.sentAt > windowMs) break;
        } else if (i - j > 300) break;
        candidates.add(j);
      }
      // shared strong identifiers regardless of time
      for (const key of [...cur.incidents, ...cur.circuits, ...cur.services]) {
        for (const j of idIndex.get(key) ?? []) candidates.add(j);
      }

      let best: { j: number; score: number; signals: string[]; minutes: number | null } | null = null;
      for (const j of candidates) {
        const prev = feats[j];
        if (prev.item.ownerKey === cur.item.ownerKey) continue; // same person re-sending is not a business duplicate
        const r = scorePair(prev, cur, opts.windowHours);
        if (!best || r.score > best.score) best = { j, score: r.score, signals: r.signals, minutes: r.minutes };
      }
      if (best && best.score >= floor) {
        const direct = feats[best.j].item.id;
        const original = duplicates.get(direct)?.originalId ?? direct;
        const match: DuplicateMatch = {
          originalId: original, directId: direct, score: best.score, minutesApart: best.minutes, signals: best.signals,
        };
        if (best.score >= opts.similarityThreshold) duplicates.set(cur.item.id, match);
        else possible.set(cur.item.id, { ...match, originalId: direct });
      }
      for (const key of [...cur.incidents, ...cur.circuits, ...cur.services]) {
        const arr = idIndex.get(key) ?? [];
        arr.push(i);
        idIndex.set(key, arr);
      }
    }
    return { duplicates, possible };
  }
}

export function describeDuplicate(m: DuplicateMatch, originalLabel: string): string {
  const when =
    m.minutesApart == null
      ? ""
      : m.minutesApart < 120
        ? `, ${Math.round(m.minutesApart)} minutes after the original`
        : `, ${Math.round(m.minutesApart / 60)} hours after the original`;
  const sig = m.signals.filter((s) => !/apart$/.test(s)).join("; ");
  return `Another employee (${originalLabel}) reported a highly similar issue: ${sig || "similar content"}${when}. Similarity ${m.score}%.`;
}
