import { decodeEntities, htmlToText, looksLikeHtml } from "./html";
import { normalizeDigits, parseDate } from "./dates";
import type { ParsedEmail, ParseOptions, ParseResult } from "./types";

export type { ParsedEmail, ParseResult, ParseOptions } from "./types";
export { parseDate } from "./dates";

type HeaderKey = "from" | "sent" | "to" | "cc" | "subject" | "messageId";

// English + Arabic (Outlook Arabic UI) header labels.
const LABELS: Record<HeaderKey, string[]> = {
  from: ["from", "sender", "من"],
  sent: ["sent", "date", "received", "sent on", "تم الإرسال", "تم الارسال", "تاريخ الإرسال", "التاريخ", "تاريخ"],
  to: ["to", "إلى", "الى", "إلي"],
  cc: ["cc", "نسخة", "نسخة إلى", "نسخة الى"],
  subject: ["subject", "الموضوع", "موضوع"],
  messageId: ["message-id", "message id"],
};
const LABEL_LOOKUP = new Map<string, HeaderKey>();
for (const [k, arr] of Object.entries(LABELS)) for (const l of arr) LABEL_LOOKUP.set(l.toLowerCase(), k as HeaderKey);

const HEADER_RE = /^[\s>*]*([^\s:：][^:：]{0,24}?)\s*[:：]\s*(.*)$/;
const QUOTE_MARKER_RE =
  /^\s*(-{2,}\s*(original message|forwarded message|الرسالة الأصلية|رسالة معاد توجيهها)[^\n]*|_{5,}|begin forwarded message:?|on .{5,120} wrote:|>.*)\s*$/i;
const HARD_SEP_RE = /^\s*([=#*~]{5,}|-{5,}\s*(email|message)\s*#?\d+\s*-{5,}|-{3,}\s*next email\s*-{3,})\s*$/i;
const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function headerOf(line: string): { key: HeaderKey; value: string } | null {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  const key = LABEL_LOOKUP.get(m[1].trim().toLowerCase());
  return key ? { key, value: m[2].trim() } : null;
}

function isQuoted(lines: string[], idx: number): boolean {
  if (/^\s*>/.test(lines[idx])) return true;
  let seen = 0;
  for (let i = idx - 1; i >= 0 && seen < 3; i--) {
    if (!lines[i].trim()) continue;
    seen++;
    if (QUOTE_MARKER_RE.test(lines[i])) return true;
  }
  return false;
}

/** A "From:" line starts a header block only if other header labels follow closely. */
function startsHeaderBlock(lines: string[], idx: number): boolean {
  const h = headerOf(lines[idx]);
  if (!h || h.key !== "from") return false;
  let others = 0;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 10); i++) {
    if (!lines[i].trim()) break;
    const o = headerOf(lines[i]);
    if (o && o.key !== "from") others++;
  }
  return others >= 1;
}

export function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "<" || ch === "[" || ch === "(") depth++;
    if (ch === ">" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === ";" || ch === "," || ch === "؛") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseAddress(value: string): { name: string; email: string } {
  const v = decodeEntities(value).replace(/mailto:/gi, "").trim();
  const em = EMAIL_RE.exec(v);
  const email = em ? em[0].toLowerCase() : "";
  let name = v
    .replace(/[<\[(]\s*[^<>\[\]()]*@[^<>\[\]()]*[>\])]/g, "")
    .replace(EMAIL_RE, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  if (/^\/o=/i.test(name) || /^\/o=/i.test(v)) name = ""; // Exchange DN, not useful
  return { name, email };
}

function cleanSubjectPrefix(subject: string) {
  const isForward = /^\s*((fw|fwd)\s*:|إعادة توجيه\s*:|احالة\s*:)/i.test(subject);
  const isReply = /^\s*(re\s*:|رد\s*:|ردّ\s*:)/i.test(subject);
  return { isForward, isReply };
}

function parseSegment(rawLines: string[], opts: ParseOptions): ParsedEmail {
  const rawSource = rawLines.join("\n").trim();
  const fields: Partial<Record<HeaderKey, string>> = {};
  let i = 0;
  while (i < rawLines.length && !rawLines[i].trim()) i++;
  let last: HeaderKey | null = null;
  for (; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim()) break;
    const h = headerOf(line);
    if (h && !(h.key in fields)) {
      fields[h.key] = h.value;
      last = h.key;
    } else if (last && (last === "to" || last === "cc") && !h && (EMAIL_RE.test(line) || /;\s*$/.test(rawLines[i - 1] ?? ""))) {
      fields[last] += " " + line.trim(); // wrapped recipient list
    } else if (last === "subject" && !h && false) {
      fields.subject += " " + line.trim();
    } else break;
  }
  const body = rawLines.slice(i).join("\n").replace(/^\s*\n/, "").trim();

  const uncertain: string[] = [];
  const sender = fields.from ? parseAddress(fields.from) : { name: "", email: "" };
  if (!fields.from) uncertain.push("sender");
  if (!sender.email) uncertain.push("senderEmail");

  const subject = decodeEntities(fields.subject ?? "").trim();
  if (!subject) uncertain.push("subject");

  let sentAt: Date | null = null;
  if (fields.sent) sentAt = parseDate(fields.sent, opts.dateOrder ?? "DMY");
  if (!sentAt) uncertain.push("sentAt");

  const mid = fields.messageId?.match(/<[^>]+>/)?.[0] ?? rawSource.match(/^\s*Message-ID:\s*(<[^>]+>)/im)?.[1] ?? null;
  const { isForward, isReply } = cleanSubjectPrefix(subject);

  return {
    senderName: sender.name || (sender.email ? "" : decodeEntities(fields.from ?? "").trim()),
    senderEmail: sender.email,
    to: fields.to ? splitAddressList(fields.to) : [],
    cc: fields.cc ? splitAddressList(fields.cc) : [],
    subject,
    sentAt,
    body,
    rawSource,
    messageId: mid,
    isForward,
    isReply,
    uncertainFields: uncertain,
  };
}

/** Tab separated rows copied from an Outlook message *list*: sender, subject, date. */
function parseListRows(lines: string[], opts: ParseOptions): ParsedEmail[] | null {
  const rows = lines.filter((l) => l.trim());
  if (rows.length === 0 || !rows.every((r) => r.split("\t").length >= 3)) return null;
  const out: ParsedEmail[] = [];
  for (const r of rows) {
    const cols = r.split("\t").map((c) => c.trim());
    const dateIdx = cols.findIndex((c) => parseDate(c, opts.dateOrder ?? "DMY"));
    if (dateIdx < 0) return null;
    const rest = cols.filter((_, i) => i !== dateIdx);
    const sender = parseAddress(rest[0]);
    const subject = rest[1] ?? "";
    out.push({
      senderName: sender.name, senderEmail: sender.email, to: [], cc: [], subject,
      sentAt: parseDate(cols[dateIdx], opts.dateOrder ?? "DMY"), body: rest.slice(2).join(" "),
      rawSource: r, messageId: null, ...cleanSubjectPrefix(subject),
      uncertainFields: ["to", ...(sender.email ? [] : ["senderEmail"])],
    });
  }
  return out;
}

export function parseEmails(input: string, opts: ParseOptions = {}): ParseResult {
  const warnings: string[] = [];
  let text = (input ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
  if (!text.trim()) return { emails: [], warnings: ["Nothing to parse: the pasted text is empty."] };

  if (looksLikeHtml(text)) {
    text = htmlToText(text);
    warnings.push("Pasted content contained HTML; it was converted to safe plain text.");
  }
  text = normalizeDigits(text);
  const lines = text.split("\n");

  // find boundaries
  const starts: number[] = [];
  const hardSeps = new Set<number>();
  lines.forEach((line, idx) => {
    if (HARD_SEP_RE.test(line)) hardSeps.add(idx);
  });
  for (let idx = 0; idx < lines.length; idx++) {
    if (!startsHeaderBlock(lines, idx)) continue;
    const afterHardSep = (() => {
      for (let j = idx - 1; j >= 0; j--) {
        if (!lines[j].trim()) continue;
        return hardSeps.has(j);
      }
      return false;
    })();
    if (starts.length === 0 || afterHardSep || !isQuoted(lines, idx)) starts.push(idx);
  }

  if (starts.length === 0) {
    const rows = parseListRows(lines, opts);
    if (rows) return { emails: rows, warnings };
    warnings.push(
      "No email headers (From:/Sent:/Subject:) were found. The whole paste was imported as one email with uncertain fields.",
    );
    const firstLine = lines.find((l) => l.trim())?.trim() ?? "";
    return {
      emails: [{
        senderName: "", senderEmail: "", to: [], cc: [], subject: firstLine.slice(0, 200), sentAt: null,
        body: text.trim(), rawSource: text.trim(), messageId: null, isForward: false, isReply: false,
        uncertainFields: ["sender", "senderEmail", "subject", "sentAt", "to"],
      }],
      warnings,
    };
  }

  if (lines.slice(0, starts[0]).some((l) => l.trim() && !HARD_SEP_RE.test(l))) {
    warnings.push("Text before the first email header was ignored.");
  }

  const emails: ParsedEmail[] = [];
  starts.forEach((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const seg = lines.slice(s, end).filter((_, k) => !hardSeps.has(s + k));
    emails.push(parseSegment(seg, opts));
  });
  return { emails, warnings };
}
