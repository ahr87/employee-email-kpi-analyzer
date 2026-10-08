/**
 * Extracts incident / ticket numbers, service & circuit IDs, IP addresses, device names and
 * locations / sites from free text (English, Arabic and mixed). Works on an analysis copy only.
 */
import { normalizeDigits, normalizeForAnalysis } from "../text";
import { stripSignature } from "./text";

export interface Entities {
  incidents: string[];
  services: string[];
  circuits: string[];
  ips: string[];
  devices: string[];
  locations: string[];
}

export const emptyEntities = (): Entities => ({ incidents: [], services: [], circuits: [], ips: [], devices: [], locations: [] });

const hasDigit = (s: string) => /\d/.test(s);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

function collect(text: string, patterns: RegExp[], min = 4): string[] {
  const out = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const v = norm(m[1] ?? m[0]);
      if (v.length >= min && hasDigit(v)) out.add(v);
    }
  }
  return [...out];
}

export const NON_LOCATION_WORDS = new Set(
  (
    "a an the and or of to in on at for from with by is are was were be been it this that these those our your their " +
    "please kindly urgent issue issues problem problems report reported reporting request customer customers network " +
    "service services connection link internet line lines outage down offline fault failure failed not working " +
    "slow low high no yes hello dear hi thanks thank regards best team support noc nmc fyi re fw fwd update status " +
    "bb ftth fiber fibre olt onu router switch bgp vpn dns adsl wifi lte sdh dwdm power cable modem port vlan gpon mpls " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
    "september october november december am pm site area branch location city district cut interrupted interruption " +
    "disconnected unreachable stopped affected multiple many several some all any new old again still since today " +
    "yesterday tomorrow morning evening night need needed check kindly asap important regarding about subject " +
    "add trigger triggers discovery discoveries alarm alarms zabbix monitoring host hosts interface neighbor neighbour core closed open resolved pending " +
    "tickets report reports remove removed added changed change enable disable enabled disabled confirm confirmed information info " +
    "unstable intermittent received checking investigate forwarded escalated ticket incident circuit device " +
    // Arabic generic words
    "الخدمه الخدمة مشكله مشكلة انقطاع منقطع منقطعه الانترنت الشبكه الشبكة الموقع موقع منطقه منطقة تحية تحيه شكرا مع السلام عليكم يرجى الرجاء الفحص التحقق"
  ).split(" "),
);

const AR_LOC_PREFIX = /(?:^|[\s,.:;(])(?:في|فى|بمنطقه|بمنطقة|منطقه|منطقة|موقع|بموقع|حي|محلة|محله|قضاء|ناحية|ناحيه|مدينة|مدينه)\s+([ء-ي]{3,}(?:\s[ء-ي]{3,})?)/g;

export function extractLocations(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`;
  const out = new Set<string>();
  const explicit =
    /\b(?:location|site|area|branch|city|district|node|exchange|tower)\s*[:\-]?\s*([A-Z][\w-]*(?:\s[A-Z][\w-]*)?)/g;
  for (const m of text.matchAll(explicit)) {
    const parts = m[1].split(/\s/).filter((p) => !NON_LOCATION_WORDS.has(p.toLowerCase()));
    if (parts.length) out.add(parts.join(" ").toLowerCase().trim());
  }
  const prep = /\b(?:at|in|near|around|from|inside)\s+(?:the\s+)?([A-Z][\w-]{2,}(?:\s[A-Z][\w-]{2,})?)/g;
  for (const m of text.matchAll(prep)) {
    const parts = m[1].split(/\s/).filter((p) => !NON_LOCATION_WORDS.has(p.toLowerCase()));
    if (parts.length) out.add(parts.join(" ").toLowerCase());
  }
  // bare capitalised words ("Mansour BB link down") are only trusted in the subject line
  for (const m of subject.matchAll(/\b([A-Z][a-z]{2,}(?:-[A-Za-z]+)?)\b/g)) {
    const w = m[1].toLowerCase();
    if (!NON_LOCATION_WORDS.has(w)) out.add(w);
  }
  for (const m of text.matchAll(AR_LOC_PREFIX)) {
    const parts = m[1].split(/\s/).filter((p) => !NON_LOCATION_WORDS.has(p));
    if (parts.length) out.add(parts.join(" "));
  }
  return [...out].slice(0, 14);
}

/**
 * Ticket numbers in monitoring-style tables: a header row such as "DeviceName  Problem  ZbxProStart  TicketNO"
 * (tab- or multi-space-separated) followed by data rows. The cell under the "Ticket…" column is the ticket number.
 */
export function extractTableTickets(text: string): string[] {
  const lines = text.split("\n");
  const out = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/\t+|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const col = cells.findIndex((c) => /^ticket\s*(?:no\.?|number|id|#)?$/i.test(c));
    if (col < 0 || cells.length < 2) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 400); j++) {
      const row = lines[j].split(/\t|\s{2,}/).map((c) => c.trim());
      if (row.filter(Boolean).length < 2) { if (!lines[j].trim()) continue; break; }
      const v = (row.filter((c) => c !== "")[col] ?? "").replace(/[^A-Za-z0-9-]/g, "");
      if (/^[A-Za-z]{0,4}-?\d{4,}$/.test(v)) out.add(v.toLowerCase());
    }
  }
  return [...out];
}

const IP_RE = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/g;
// network device hostnames such as SW-BGD-01, OLT_12, RTR-KRD-02-A, bgd-ar-03
// monitoring host names such as SHMO-M-SR1S-PE01 or BT-DW-35033: upper-case words joined by 2-5 dashes, containing a digit
const HOST_RE = /\b([A-Z][A-Z0-9]{1,8}(?:-[A-Z0-9]{1,10}){2,5})\b/g;
const DEVICE_RE = /\b((?:sw|swt|rtr|rt|olt|onu|agg|ar|cr|pe|ce|fw|bras|msan|dslam|ap|bts|enb|gnb|node)[-_][a-z0-9]+(?:[-_][a-z0-9]+)*)\b/gi;

export function extractEntities(subject: string, body: string): Entities {
  const bodyNoSig = stripSignature(body);
  const text = normalizeDigits(`${subject}\n${bodyNoSig}`);
  const incidents = collect(text, [
    /\b((?:INC|CHG|TKT|TT|CASE|REQ|PRB|CR|SR)[-_ #:]?\d{4,})\b/gi,
    /\b(?:incident|ticket|case|trouble ticket|tt)\s*(?:no\.?|number|id|#)?\s*[:#]?\s*([A-Z]{0,4}[-_]?\d{4,})\b/gi,
    /(?:رقم التذكرة|رقم البلاغ|تذكرة|بلاغ|رقم الحادث)\s*[:#]?\s*([A-Z]{0,4}[-_]?\d{4,})/gi,
    // "Ticket NO is 17440983", "TT number: 17439573" (label, a few words, then a 6-10 digit number)
    /\b(?:ticket|incident|case|tt)\b\s*(?:no\.?|number|id|#)?[^\n\d]{0,20}?\b(\d{6,10})\b/gi,
  ]);
  for (const t of extractTableTickets(text)) if (!incidents.includes(t)) incidents.push(t);
  const services = collect(text, [
    /\b(SVC[-_]?\d{3,})\b/gi,
    /\bservice\s*(?:id|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi,
    /(?:رقم الخدمة|رقم الخدمه)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi,
  ]);
  const circuits = collect(text, [
    /\b((?:CKT|CCT|CIR|CID|LNK|LINK)[-_]\d{3,}|(?:CKT|CCT|CIR|CID)\d{3,})\b/gi,
    /\b(?:circuit|link)\s*(?:id|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi,
    /(?:رقم الدائرة|رقم اللنك|معرف الدائرة)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi,
  ]);
  const ips = [...new Set([...text.matchAll(IP_RE)].map((m) => m[1]))];
  const devices = [...new Set([
    ...[...text.matchAll(DEVICE_RE)].map((m) => m[1].toLowerCase()),
    ...[...text.matchAll(HOST_RE)].map((m) => m[1].toLowerCase()).filter((h) => !/^(iso|utf|cp|windows|rfc|ieee|ansi)-/.test(h)),
  ].filter(hasDigit))];
  return { incidents, services, circuits, ips, devices, locations: [...new Set(extractLocations(normalizeDigits(subject), normalizeDigits(bodyNoSig)).map(normalizeForAnalysis))] };
}
