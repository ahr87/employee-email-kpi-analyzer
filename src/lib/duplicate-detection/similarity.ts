import { NON_LOCATION_WORDS } from "../classification/entities";
import { normalizeForAnalysis } from "../text";

/** Words mapped to a shared "concept" so "down" and "outage" count as the same issue. */
const CONCEPTS: Record<string, string> = {
  outage: "outage", down: "outage", offline: "outage", disconnected: "outage", disconnect: "outage",
  disconnection: "outage", failure: "outage", failed: "outage", fault: "outage", cut: "outage",
  unreachable: "outage", interrupted: "outage", interruption: "outage", stopped: "outage", dead: "outage",
  "انقطاع": "outage", "مقطوع": "outage", "منقطع": "outage", "منقطعه": "outage", "متوقف": "outage", "توقف": "outage", "واقع": "outage", "واقعه": "outage", "نازل": "outage", "نازله": "outage", "طافي": "outage", "طافيه": "outage", "مقطوعه": "outage",
  slow: "slow", slowness: "slow", latency: "slow", degraded: "slow", lag: "slow", lagging: "slow", "بطيء": "slow", "بطيئه": "slow", "بطء": "slow",
  unstable: "unstable", flapping: "unstable", intermittent: "unstable", instability: "unstable", "متذبذب": "unstable", "متذبذبه": "unstable", "غير مستقر": "unstable", "مستقر": "unstable",
  billing: "billing", invoice: "billing", payment: "billing",
};

const STOP = new Set(
  (
    "a an the and or of to in on at for from with by is are was were be been it this that these those our your their " +
    "please kindly hello dear hi thanks thank regards best re fw fwd connection link service services internet line " +
    "issue issues problem problems report reported reporting request customer customers not working no has have had " +
    "again still since today we i you he she they them there here as can could would should will may might do does did " +
    "في من الى علي على عن مع هذا هذه ذلك التي الذي ان انه انها لقد قد تم يرجى الرجاء شكرا تحيه مرحبا السلام عليكم الخدمه الانترنت الاتصال مشكله"
  ).split(" "),
);

export const TECH_TERMS = new Set(
  "bb ftth fiber fibre olt onu router switch bgp vpn dns fttx adsl wifi lte 5g sdh dwdm power cable modem port vlan gpon pon radius billing voip sip mpls ospf isis ldp tunnel optical".split(" "),
);

/** Multi-word expressions that mean the same thing as an "outage" (English + Arabic / Iraqi dialect). */
const OUTAGE_PHRASES = [
  /\b(?:no (?:internet|connection|service|signal|link|connectivity)|not working|cannot connect|can't connect|unable to connect|lost (?:connection|service)|link (?:is )?down|services? (?:is |are )?down)\b/g,
  /(?:لا يوجد|لايوجد|ما اكو|ماكو|مافي|لا تتوفر)\s+(?:انترنت|اتصال|خدمه|سيرفس|شبكه|خط)/g,
];

export function tokenize(text: string): string[] {
  let t = normalizeForAnalysis(text);
  for (const re of OUTAGE_PHRASES) t = t.replace(re, " outage ");
  return t
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => CONCEPTS[t] ?? t);
}

export function conceptsOf(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const concepts = new Set(Object.values(CONCEPTS));
  for (const t of tokens) if (concepts.has(t)) out.add(t);
  return out;
}

export function techOf(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) if (TECH_TERMS.has(t)) out.add(t);
  return out;
}

/** Content tokens only (drops location-ish generic words and pure numbers' noise is kept). */
export function contentTokens(text: string): Set<string> {
  return new Set(tokenize(text).filter((t) => !NON_LOCATION_WORDS.has(t) || TECH_TERMS.has(t) || CONCEPTS[t] || t === "outage"));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

export function intersects(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}
