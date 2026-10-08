import type { ParsedEmail } from "../parser";
import { prefixFlags } from "../parser";
import type { ImportItem } from "../import/types";
import { parseReceivedAt } from "./dates";
import { normalizeOutlookMessage } from "./normalize";
import type { OutlookMessage } from "./schema";

const EMAIL = /^[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]{2,}$/;
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
const clean = (s: string) => s.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
const people = (s: string) => s.split(";").map((p) => clean(p)).filter(Boolean);

export interface Prepared { item: ImportItem; evidence: "DMY" | "MDY" | null; ambiguous: boolean }

/**
 * Turns a validated Outlook message into the shared import shape. The TOP-LEVEL from / fromEmail / receivedAt are
 * authoritative for the current message; "From:" lines inside the body belong to quoted or forwarded history and are
 * never used as the sender.
 */
export function prepareMessage(m: OutlookMessage, order: "DMY" | "MDY"): Prepared | { error: string } {
  const at = parseReceivedAt(m.receivedAt, order);
  if (!at.date) return { error: `receivedAt “${String(m.receivedAt).slice(0, 40)}” could not be read as a date.` };
  const norm = normalizeOutlookMessage(m.body, m.htmlBody);
  const email = clean(m.fromEmail).toLowerCase();
  const subject = clean(m.subject);
  const uncertain: string[] = [];
  const senderEmail = EMAIL.test(email) ? email : "";
  if (!senderEmail) uncertain.push("senderEmail");
  const parsed: ParsedEmail = {
    senderName: clean(m.from),
    senderEmail,
    to: people(m.to),
    cc: people(m.cc),
    subject,
    sentAt: at.date,
    sentAtAlt: at.alt,
    dateOrderEvidence: at.evidence,
    quoted: false,
    body: norm.text,
    rawSource: "", // the original lives in the raw table
    messageId: null,
    ...prefixFlags(subject),
    uncertainFields: uncertain,
  };
  return {
    item: {
      parsed,
      external: { entryId: m.entryId, conversationId: m.conversationId, receivedAtRaw: String(m.receivedAt) },
      raw: { entryId: m.entryId, conversationId: m.conversationId, subject: m.subject, from: m.from, fromEmail: m.fromEmail, to: m.to, cc: m.cc, receivedAt: String(m.receivedAt), body: m.body, htmlBody: m.htmlBody },
      normalization: norm.info,
    },
    evidence: at.evidence,
    ambiguous: !!at.alt,
  };
}
