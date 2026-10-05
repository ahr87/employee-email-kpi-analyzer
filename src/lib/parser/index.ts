import { decodeEntities, htmlToText, looksLikeHtml } from "./html";
import { parseDateDetailed } from "./dates";
import { normalizeForAnalysis, parseView } from "../text";
import { conversationKey } from "../classification/text";
import type { ParsedEmail, ParseOptions, ParseResult } from "./types";

export type { ParsedEmail, ParseResult, ParseOptions } from "./types";
export { parseDate, parseDateDetailed } from "./dates";

type HeaderKey = "from" | "sent" | "to" | "cc" | "subject" | "messageId" | "ignore";

/**
 * Header labels (English + Arabic). Matching is done on normalised text, so Arabic letter variants
 * (إ/أ/ا, ى/ي, ة/ه) and bidi marks do not matter. "ignore" labels are consumed but not stored.
 */
const LABELS: Record<HeaderKey, string[]> = {
  from: ["from", "sender", "من", "المرسل"],
  sent: ["sent", "date", "received", "sent on", "sent date", "تم الإرسال", "تاريخ الإرسال", "التاريخ", "تاريخ", "أرسلت", "تم الارسال"],
  to: ["to", "إلى", "الى", "إلي", "الي"],
  cc: ["cc", "نسخة", "نسخة إلى", "نسخة الى", "نسخه"],
  subject: ["subject", "الموضوع", "موضوع"],
  messageId: ["message-id", "message id"],
  ignore: ["importance", "priority", "sensitivity", "attachments", "attachment", "categories", "bcc", "reply-to", "الأهمية", "الاهمية", "أهمية", "المرفقات", "مرفقات", "نسخة مخفية", "when", "where"],
};
const LABEL_LOOKUP = new Map<string, HeaderKey>();
for (const [k, arr] of Object.entries(LABELS)) for (const l of arr) LABEL_LOOKUP.set(normalizeForAnalysis(l), k as HeaderKey);

const HEADER_RE = /^[\s>*_]*([^\s:：][^:：]{0,24}?)[\s*_]*[:：][\s*_]*(.*)$/;
const QUOTE_MARKER_RE =
  /^\s*(-{2,}\s*(original message|forwarded message|الرسالة الأصلية|رسالة معاد توجيهها|الرسالة المعاد توجيهها)[^\n]*|-{5,}\s*forwarded message\s*-{5,}|_{5,}|begin forwarded message:?|on .{5,140} wrote:|في .{5,140} كتب:?)\s*$/i;
const HARD_SEP_RE = /^\s*([=#*~]{5,}|-{5,}\s*(email|message)\s*#?\d+\s*-{5,}|-{3,}\s*next email\s*-{3,})\s*$/i;
const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
const clean = (s: string) => s.replace(INVISIBLE, "").trim();

interface Header { key: HeaderKey; valueView: string; valueRaw: string }

function headerOf(rawLine: string, viewLine: string): Header | null {
  const m = HEADER_RE.exec(viewLine);
  if (!m) return null;
  const key = LABEL_LOOKUP.get(normalizeForAnalysis(m[1]));
  if (!key) return null;
  const n = m[2].length;
  return { key, valueView: m[2].trim(), valueRaw: rawLine.slice(rawLine.length - n).trim() };
}

interface Block {
  start: number;
  end: number; // first line after the header block
  fields: Partial<Record<HeaderKey, { view: string; raw: string }>>;
  quoted: boolean;
}

function readHeader(raw: string[], view: string[], start: number): Omit<Block, "quoted"> | null {
  const fields: Block["fields"] = {};
  let i = start;
  let pending: HeaderKey | null = null;
  let last: HeaderKey | null = null;
  let seen = 0;
  let end = start;
  while (i < raw.length) {
    const line = view[i];
    if (!line.trim()) {
      // tolerate blank lines inside a header block (rich-text pastes) if another header label follows
      let j = i + 1;
      while (j < raw.length && !view[j].trim()) j++;
      const nxt = j < raw.length ? headerOf(raw[j], view[j]) : null;
      if (pending || (nxt && (nxt.key === "ignore" || !(nxt.key in fields)) && seen > 0 && nxt.key !== "from")) { i = j; continue; }
      break;
    }
    const h = headerOf(raw[i], line);
    if (h && (h.key === "ignore" || !(h.key in fields))) {
      seen++;
      if (h.key !== "ignore") fields[h.key] = { view: h.valueView, raw: h.valueRaw };
      pending = h.valueView ? null : h.key;
      last = h.key;
      i++; end = i;
      continue;
    }
    if (pending && pending !== "ignore") { // value on the line after the label
      fields[pending] = { view: line.trim(), raw: raw[i].trim() };
      last = pending; pending = null; i++; end = i;
      continue;
    }
    if (pending === "ignore") { pending = null; i++; end = i; continue; }
    if (last && (last === "to" || last === "cc") && !h && fields[last] && (EMAIL_RE.test(line) || /[;,؛]\s*$/.test(view[i - 1] ?? ""))) {
      fields[last]!.view += " " + line.trim(); fields[last]!.raw += " " + raw[i].trim();
      i++; end = i;
      continue;
    }
    break;
  }
  // Outlook always prints Sent and/or Subject; "From: Baghdad / To: Basra" inside a body (route descriptions) is not a header
  if (!fields.from || !(fields.sent?.view || fields.subject?.view)) return null;
  return { start, end, fields };
}

function isQuotedStart(raw: string[], idx: number): boolean {
  if (/^\s*>/.test(raw[idx])) return true;
  let seen = 0;
  for (let i = idx - 1; i >= 0 && seen < 3; i--) {
    if (!raw[i].trim()) continue;
    seen++;
    if (QUOTE_MARKER_RE.test(parseView(raw[i]))) return true;
  }
  return false;
}

export function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "<" || ch === "[" || ch === "(") depth++;
    if (ch === ">" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === ";" || ch === "," || ch === "؛" || ch === "،") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseAddress(value: string): { name: string; email: string } {
  const v = decodeEntities(clean(value)).replace(/mailto:/gi, "").trim();
  const em = EMAIL_RE.exec(v);
  const email = em ? em[0].toLowerCase() : "";
  let name = v
    .replace(/[<\[(]\s*[^<>\[\]()]*@[^<>\[\]()]*[>\])]/g, "")
    .replace(EMAIL_RE, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^\/o=/i.test(name) || /^\/o=/i.test(v)) name = ""; // Exchange DN, not useful
  return { name, email };
}

const FWD_PREFIX = /^\s*((fw|fwd|forward)\s*(\[\d+\])?\s*:|إعادة توجيه\s*:|اعادة توجيه\s*:|احالة\s*:|إحالة\s*:|تحويل\s*:|محول\s*:)/i;
const RE_PREFIX = /^\s*((re|aw|sv)\s*(\[\d+\])?\s*:|رد\s*:|ردّ\s*:|الرد\s*:)/i;

function prefixFlags(subject: string) {
  return { isForward: FWD_PREFIX.test(subject), isReply: RE_PREFIX.test(subject) };
}

function formatList(value: string): string[] {
  return splitAddressList(value).map((part) => {
    const a = parseAddress(part);
    return a.email ? (a.name ? `${a.name} <${a.email}>` : a.email) : a.name || clean(part);
  }).filter(Boolean);
}

function buildEmail(block: Block, bodyRaw: string[], rawSource: string, opts: ParseOptions): ParsedEmail {
  const f = block.fields;
  const uncertain: string[] = [];
  const sender = f.from ? parseAddress(f.from.raw) : { name: "", email: "" };
  if (!f.from || !f.from.view) uncertain.push("sender");
  if (!sender.email) uncertain.push("senderEmail");
  const subject = decodeEntities(clean(f.subject?.raw ?? "")).replace(/\s+/g, " ");
  if (!subject) uncertain.push("subject");

  let sentAt: Date | null = null;
  let alt: Date | null = null;
  let evidence: "DMY" | "MDY" | null = null;
  if (f.sent?.view) {
    const r = parseDateDetailed(f.sent.view, opts.dateOrder ?? "DMY");
    sentAt = r.date; alt = r.alt; evidence = r.evidence ?? null;
  }
  if (!sentAt) uncertain.push("sentAt");

  const mid = f.messageId?.view.match(/<[^>]+>/)?.[0] ?? rawSource.match(/^\s*Message-ID:\s*(<[^>]+>)/im)?.[1] ?? null;
  return {
    senderName: sender.name || (sender.email || /^\s*\/o=/i.test(f.from?.raw ?? "") ? "" : decodeEntities(clean(f.from?.raw ?? ""))),
    senderEmail: sender.email,
    to: f.to?.raw ? formatList(f.to.raw) : [],
    cc: f.cc?.raw ? formatList(f.cc.raw) : [],
    subject,
    sentAt,
    sentAtAlt: alt,
    dateOrderEvidence: evidence,
    body: bodyRaw.join("\n").trim(),
    rawSource,
    messageId: mid,
    quoted: block.quoted,
    ...prefixFlags(subject),
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
    const dateIdx = cols.findIndex((c) => parseDateDetailed(c, opts.dateOrder ?? "DMY").date);
    if (dateIdx < 0) return null;
    const rest = cols.filter((_, i) => i !== dateIdx);
    const sender = parseAddress(rest[0]);
    const subject = clean(rest[1] ?? "");
    const d = parseDateDetailed(cols[dateIdx], opts.dateOrder ?? "DMY");
    out.push({
      senderName: sender.name, senderEmail: sender.email, to: [], cc: [], subject,
      sentAt: d.date, sentAtAlt: d.alt, dateOrderEvidence: d.evidence ?? null, quoted: false, body: rest.slice(2).join(" "),
      rawSource: r, messageId: null, ...prefixFlags(subject),
      uncertainFields: ["to", ...(sender.email ? [] : ["senderEmail"])],
    });
  }
  return out;
}

/** Lines that only introduce quoted content and belong to neither message body. */
const isTrailer = (raw: string) => {
  const v = parseView(raw);
  return !v.trim() || QUOTE_MARKER_RE.test(v) || HARD_SEP_RE.test(v) || /^\s*[-_=*]{3,}\s*$/.test(v);
};

/**
 * Parses text copied from Outlook (plain text, rich text or HTML) into individual messages.
 * Every header block (From / Sent / To / Cc / Subject) becomes its own message, so reply/forward chains
 * are split into the original, replies and forwards; messages found below another one are flagged `quoted`.
 * Header detection runs on a normalised view; stored bodies and raw sources keep the pasted characters.
 */
export function parseEmails(input: string, opts: ParseOptions = {}): ParseResult {
  const warnings: string[] = [];
  let text = (input ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return { emails: [], warnings: ["Nothing to parse: the pasted text is empty."] };

  const locate = (raw: string[], view: string[]): Block[] => {
    const found: Block[] = [];
    for (let i = 0; i < raw.length; ) {
      const h = headerOf(raw[i], view[i]);
      if (h && h.key === "from") {
        const b = readHeader(raw, view, i);
        if (b) {
          found.push({ ...b, quoted: found.length > 0 && isQuotedStart(raw, i) });
          i = b.end;
          continue;
        }
      }
      i++;
    }
    return found;
  };

  // Plain text first (keeps the pasted characters exactly). Only when no headers are found and the paste looks like
  // HTML source is it converted to safe text (scripts/styles/comments removed, tags stripped, entities decoded).
  let raw = text.split("\n");
  let view = raw.map(parseView);
  let blocks = locate(raw, view);
  if (blocks.length === 0 && looksLikeHtml(text)) {
    text = htmlToText(text);
    raw = text.split("\n");
    view = raw.map(parseView);
    blocks = locate(raw, view);
    warnings.push("Pasted content contained HTML; it was converted to safe plain text (scripts and styles removed).");
  }

  if (blocks.length === 0) {
    const rows = parseListRows(raw, opts);
    if (rows) return { emails: rows, warnings };
    warnings.push("No email headers (From: / Sent: / Subject:) were found. The whole paste was imported as ONE email with uncertain fields — please check it in Review.");
    const firstLine = raw.find((l) => l.trim())?.trim() ?? "";
    return {
      emails: [{
        senderName: "", senderEmail: "", to: [], cc: [], subject: clean(firstLine).slice(0, 200), sentAt: null, sentAtAlt: null, dateOrderEvidence: null, quoted: false,
        body: text.trim(), rawSource: text.trim(), messageId: null, isForward: false, isReply: false,
        uncertainFields: ["sender", "senderEmail", "subject", "sentAt", "to"],
      }],
      warnings,
    };
  }

  if (raw.slice(0, blocks[0].start).some((l) => l.trim() && !isTrailer(l))) {
    warnings.push("Text before the first email header was ignored.");
  }

  const emails: ParsedEmail[] = [];
  blocks.forEach((b, n) => {
    const stop = n + 1 < blocks.length ? blocks[n + 1].start : raw.length;
    let body = raw.slice(b.end, stop).filter((l) => !HARD_SEP_RE.test(parseView(l)));
    while (body.length && isTrailer(body[body.length - 1])) body.pop();
    if (b.quoted && body.length && body.filter((l) => /^\s*>/.test(l)).length >= body.length / 2) {
      body = body.map((l) => l.replace(/^[\s>]*/, ""));
    }
    emails.push(buildEmail(b, body, raw.slice(b.start, stop).join("\n").trim(), opts));
  });
  // Outlook does not always print a separator before a quoted header block: a block that continues the previous
  // message's conversation (same subject apart from RE:/FW:) and is not newer than it is quoted, too.
  for (let i = 1; i < emails.length; i++) {
    const prev = emails[i - 1], cur = emails[i];
    if (cur.quoted || !cur.subject || conversationKey(cur.subject) !== conversationKey(prev.subject)) continue;
    const sameSender = (cur.senderEmail || cur.senderName) === (prev.senderEmail || prev.senderName);
    if (sameSender && !prev.isReply && !prev.isForward) continue; // two separate emails of one sender, not a chain
    if (!cur.sentAt || !prev.sentAt || cur.sentAt <= prev.sentAt) cur.quoted = true;
  }
  const quotedCount = emails.filter((e) => e.quoted).length;
  if (quotedCount) warnings.push(`${quotedCount} message(s) were found inside reply/forward chains and were split out as separate messages.`);
  return { emails, warnings };
}
