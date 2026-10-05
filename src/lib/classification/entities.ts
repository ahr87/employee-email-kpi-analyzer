/** Extracts incident numbers, service / circuit IDs and locations from free text. */

export interface Entities {
  incidents: string[];
  services: string[];
  circuits: string[];
  locations: string[];
}

const hasDigit = (s: string) => /\d/.test(s);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

function collect(text: string, patterns: RegExp[], group = 0): string[] {
  const out = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const v = norm(m[group + 1] ?? m[0]);
      if (v.length >= 4 && hasDigit(v)) out.add(v);
    }
  }
  return [...out];
}

export const NON_LOCATION_WORDS = new Set(
  (
    "a an the and or of to in on at for from with by is are was were be been it this that these those our your their " +
    "please kindly urgent issue issues problem problems report reported reporting request customer customers network " +
    "service services connection link internet line lines outage down offline fault failure failed not working " +
    "slow low high no yes hello dear hi thanks thank regards best team support noc fyi re fw fwd update status " +
    "bb ftth fiber fibre olt onu router switch bgp vpn dns adsl wifi lte sdh dwdm power cable modem port vlan gpon " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
    "september october november december am pm site area branch location city district cut interrupted interruption " +
    "disconnected unreachable stopped affected multiple many several some all any new old again still since today " +
    "yesterday tomorrow morning evening night need needed check kindly asap important regarding about subject"
  ).split(" "),
);

export function extractLocations(text: string): string[] {
  const out = new Set<string>();
  const explicit =
    /\b(?:location|site|area|branch|city|district|node|exchange|tower)\s*[:\-]\s*([A-Za-z][\w-]*(?:\s[A-Z][\w-]*)?)/gi;
  for (const m of text.matchAll(explicit)) out.add(m[1].toLowerCase().trim());
  const prep = /\b(?:at|in|near|around|from|inside)\s+(?:the\s+)?([A-Z][\w-]{2,}(?:\s[A-Z][\w-]{2,})?)/g;
  for (const m of text.matchAll(prep)) {
    const parts = m[1].split(/\s/).filter((p) => !NON_LOCATION_WORDS.has(p.toLowerCase()));
    if (parts.length) out.add(parts.join(" ").toLowerCase());
  }
  // capitalised words that are not generic vocabulary / acronyms (subjects are often "Mansour BB link down")
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,}(?:-[A-Za-z]+)?)\b/g)) {
    const w = m[1].toLowerCase();
    if (!NON_LOCATION_WORDS.has(w)) out.add(w);
  }
  return [...out].slice(0, 12);
}

export function extractEntities(subject: string, body: string): Entities {
  const text = `${subject}\n${body}`;
  const incidents = collect(text, [
    /\b((?:INC|CHG|TKT|TT|CASE|REQ|PRB)[-_ #:]?\d{4,})\b/gi,
    /\b(?:incident|ticket|case|trouble ticket)\s*(?:no\.?|number|id|#)?\s*[:#]?\s*([A-Z]{0,4}[-_]?\d{4,})\b/gi,
  ]);
  const services = collect(text, [
    /\b(SVC[-_]?\d{3,})\b/gi,
    /\bservice\s*(?:id|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi,
  ]);
  const circuits = collect(text, [
    /\b((?:CKT|CCT|CIR|CID)[-_]?\d{3,})\b/gi,
    /\bcircuit\s*(?:id|no\.?|number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi,
  ]);
  return { incidents, services, circuits, locations: extractLocations(text) };
}
