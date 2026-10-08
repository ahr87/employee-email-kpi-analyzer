import { getDb, newId } from "../db";
import { sha256 as sha } from "../utils/hash";
import type { BatchRec, EmailRec } from "../storage/types";
import { StorageFullError } from "../storage/storage";
import { getSettings, saveSettings } from "../settings";
import { logAudit } from "../audit";
import { parseEmails, type ParsedEmail } from "../parser";
import { extractEntities } from "../classification/entities";
import { conversationKey, stripSignature } from "../classification/text";
import { isNmcAddress, matchEmployee } from "../employees/matching";
import { analyzeMonth } from "./analyze";
import { normalizeForAnalysis } from "../text";
import { MONTH_NAMES } from "../types";

export class ImportError extends Error {}

export interface ImportSummary {
  batchId: string;
  batchNumber: number;
  year: number;
  month: number;
  parsed: number; // messages recognised in the paste (incl. chain messages)
  newEmails: number; // imported (stored)
  exactDuplicates: number; // already stored / repeated inside the paste → ignored
  quotedRepeats: number; // of which: quoted copies inside reply/forward chains
  exactDuplicateSubjects: string[];
  matched: number; // counted employee emails matched to an employee
  unmatched: number; // counted employee emails with no employee
  nmcMessages: number; // NMC messages kept as evidence
  followUps: number; // follow-up messages kept as evidence (not counted)
  outsideMonth: number;
  autoClassified: number;
  needsReview: number;
  warnings: string[];
}

const letters = (s: string) => normalizeForAnalysis(s).replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Identity of an email for exact-duplicate prevention.
 * - strict: sender + minute + conversation subject + the first words of the body (so two different emails that one
 *   sender sends in the same minute with the same subject are both kept). Undated emails use the whole body.
 * - loose: sender + minute + conversation subject only. It is used solely to recognise a QUOTED copy of an email that
 *   is already stored (or the other way round), whose body may be truncated or re-wrapped by Outlook.
 */
export function fingerprint(p: { senderEmail: string; senderName: string; sentAt: Date | null; subject: string; body: string }): { strict: string; loose: string } {
  const who = normalizeForAnalysis(p.senderEmail || p.senderName);
  const when = p.sentAt ? p.sentAt.toISOString().slice(0, 16) : "";
  const key = [who, when, conversationKey(normalizeForAnalysis(p.subject))].join("|");
  const body = letters(stripSignature(p.body));
  return { strict: sha(`${key}|${p.sentAt ? body.slice(0, 80) : sha(body)}`), loose: p.sentAt ? sha(key) : "" };
}

/** Imports one pasted batch. Additive: existing emails are never modified or removed. */
export async function importBatch(input: { year: number; month: number; text: string }): Promise<ImportSummary> {
  const { year, month } = input;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ImportError("Select a valid year and month.");
  if (!input.text || !input.text.trim()) throw new ImportError("Nothing to analyze: paste your Outlook emails first.");
  if (input.text.length > 25_000_000) throw new ImportError("The pasted content is too large (limit 25 MB). Paste in smaller batches.");

  const settings = await getSettings();
  let result = parseEmails(input.text, { dateOrder: settings.dateOrder });
  const warnings = [...result.warnings];
  if (!result.emails.length) throw new ImportError(warnings[0] ?? "No emails could be recognised in the pasted text.");

  // numeric dates: if the paste itself proves the order (e.g. 25/04 can only be day/month), trust the evidence
  // over the setting, remember it, and stop flagging ambiguous dates; otherwise ambiguous dates that could change
  // the month are flagged for review.
  const ev = result.emails.map((e) => e.dateOrderEvidence).filter(Boolean) as ("DMY" | "MDY")[];
  const dmy = ev.filter((x) => x === "DMY").length, mdy = ev.length - dmy;
  let order = settings.dateOrder;
  let resolved = settings.dateOrderLearned;
  if (dmy && mdy) {
    warnings.push(`Dates in this paste mix day/month and month/day formats (${dmy} vs ${mdy} unambiguous dates). Using “${settings.dateOrder}” from Settings — check the Review queue for date warnings.`);
    resolved = false;
  } else if (ev.length) {
    order = ev[0];
    if (order !== settings.dateOrder) {
      warnings.push(`Dates in this paste are clearly ${order === "DMY" ? "day/month/year" : "month/day/year"}; that order was used instead of the Settings value (${settings.dateOrder}) and saved to Settings.`);
      result = parseEmails(input.text, { dateOrder: order });
    }
    if (order !== settings.dateOrder || !settings.dateOrderLearned) await saveSettings({ dateOrder: order, dateOrderLearned: true });
    resolved = true;
  }
  const parsed = result.emails;
  if (resolved) for (const p of parsed) p.sentAtAlt = null;
  const ambiguous = parsed.filter((e) => e.sentAtAlt).length;
  if (ambiguous) warnings.push(`${ambiguous} date(s) have an ambiguous day/month order (no date in this paste proves it) and were read as “${order === "DMY" ? "day/month" : "month/day"}”. Those that could fall in another month are flagged in Review.`);

  const db = await getDb();
  const employees = db.employees.all();
  const prepared = parsed.map((p) => { const f = fingerprint(p); return { p, hash: f.strict, loose: f.loose }; });

  // what is already stored (identity keys): strict hash, loose hash (+ was it a quoted copy) and Message-IDs
  const seenHash = new Set<string>();
  const seenMid = new Set<string>();
  const looseSeen = new Map<string, boolean>(); // looseHash -> was the stored/earlier copy a quoted one
  for (const e of db.emails.all()) {
    seenHash.add(e.contentHash);
    if (e.messageId) seenMid.add(e.messageId);
    if (e.looseHash) looseSeen.set(e.looseHash, (looseSeen.get(e.looseHash) ?? false) || e.quoted);
  }

  const fresh: { p: ParsedEmail; hash: string; loose: string }[] = [];
  const dupSubjects: string[] = [];
  let quotedRepeats = 0;
  for (const x of prepared) {
    // a quoted copy equals a stored email with the same sender/minute/subject; a normal email equals a stored QUOTED copy
    const looseDup = !!x.loose && looseSeen.has(x.loose) && (x.p.quoted || looseSeen.get(x.loose) === true);
    const dup = seenHash.has(x.hash) || looseDup || (x.p.messageId && seenMid.has(x.p.messageId));
    if (dup) {
      if (x.p.quoted) quotedRepeats++;
      dupSubjects.push(x.p.subject || "(no subject)");
      continue;
    }
    seenHash.add(x.hash);
    if (x.loose) looseSeen.set(x.loose, (looseSeen.get(x.loose) ?? false) || x.p.quoted);
    if (x.p.messageId) seenMid.add(x.p.messageId);
    fresh.push(x);
  }

  let outside = 0;
  const now = new Date();
  const batchId = newId();
  const rows: EmailRec[] = fresh.map(({ p, hash, loose }) => {
    const role = isNmcAddress(p.senderEmail, settings.nmcAddresses) ? "NMC" : "EMPLOYEE";
    const m = matchEmployee({ email: p.senderEmail, name: p.senderName }, employees);
    const ent = extractEntities(p.subject, p.body);
    const out = !!p.sentAt && (p.sentAt.getUTCFullYear() !== year || p.sentAt.getUTCMonth() + 1 !== month);
    if (out) outside++;
    return {
      id: newId(), batchId, year, month, role,
      senderName: p.senderName, senderEmail: p.senderEmail,
      toRecipients: p.to.join("; "), ccRecipients: p.cc.join("; "),
      subject: p.subject, sentAt: p.sentAt, sentAtAlt: p.sentAtAlt, body: p.body, rawSource: p.rawSource,
      messageId: p.messageId, contentHash: hash, looseHash: loose, conversationKey: conversationKey(p.subject),
      isForward: p.isForward, isReply: p.isReply, quoted: p.quoted, uncertainFields: JSON.stringify(p.uncertainFields),
      incidentIds: ent.incidents.join(","), serviceIds: ent.services.join(","), circuitIds: ent.circuits.join(","),
      ipAddresses: ent.ips.join(","), devices: ent.devices.join(","), locations: ent.locations.join(","),
      kind: "REPORT", counted: true,
      outsideMonth: out, monthDecision: out ? "REVIEW" : "IN_MONTH",
      employeeId: role === "EMPLOYEE" ? (m.employee?.id ?? null) : null, employeeManual: false,
      autoClass: "PENDING_REVIEW", confidence: 0, reason: "", finalClass: "PENDING_REVIEW", isManual: false, overrideReason: null, overrideAt: null,
      duplicateOfId: null, duplicateSimilarity: null, duplicateReason: null, possibleDuplicateOfId: null, possibleDuplicateSim: null,
      reviewStatus: "NEEDS_REVIEW", reviewReasons: "[]", createdAt: now, updatedAt: now,
    };
  });

  // wrong-month safeguard: most dated emails belong to a different month than the one selected
  const dated = parsed.filter((p) => p.sentAt);
  if (dated.length >= 3) {
    const tally = new Map<string, number>();
    for (const p of dated) { const k = `${p.sentAt!.getUTCFullYear()}-${p.sentAt!.getUTCMonth() + 1}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
    const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const [ty, tm] = top.split("-").map(Number);
    if ((ty !== year || tm !== month) && n / dated.length >= 0.5) {
      warnings.push(`Most dated emails (${n} of ${dated.length}) are from ${MONTH_NAMES[tm - 1]} ${ty}, not the selected ${MONTH_NAMES[month - 1]} ${year}. If you chose the wrong month, delete this batch in the Batches table and paste again with the right month.`);
    }
  }

  const batch: BatchRec = {
    id: batchId, number: Math.max(0, ...db.batches.all().map((b) => b.number)) + 1, year, month, createdAt: now,
    totalParsed: parsed.length, newEmails: rows.length, exactDuplicates: parsed.length - rows.length,
    matched: 0, unmatched: 0, autoClassified: 0, needsReview: 0, warnings: JSON.stringify(warnings), status: "COMPLETED",
  };
  // batch + emails are stored in ONE transaction: all or nothing
  try {
    await db.apply([{ table: "batches", put: [batch] }, { table: "emails", put: rows }]);
  } catch (e) {
    if (e instanceof StorageFullError) throw new ImportError(e.message);
    throw e;
  }

  // incremental analysis: the whole month is re-evaluated so new emails can be originals / duplicates / evidence of others
  try {
    await analyzeMonth(year, month);
  } catch (e) {
    await db.apply([{ table: "batches", put: [{ ...batch, status: "ANALYSIS_FAILED" }] }]);
    throw new ImportError(`The emails of batch ${batch.number} were stored, but their analysis failed (${(e as Error).message.split("\n").filter(Boolean).pop()}). Open Settings → “Re-analyze month” to retry; do not paste them again.`);
  }

  const mine = db.emails.all().filter((e) => e.batchId === batch.id);
  const counted = mine.filter((e) => e.kind === "REPORT");
  const matched = counted.filter((e) => e.employeeId).length;
  const unmatched = counted.length - matched;
  const needsReview = counted.filter((e) => e.reviewStatus === "NEEDS_REVIEW").length;
  const autoClassified = counted.length - needsReview;
  const nmcMessages = mine.filter((e) => e.kind === "NMC").length;
  const followUps = mine.filter((e) => e.kind === "FOLLOW_UP").length;

  const hasNmc = settings.nmcAddresses.some((n) => n.enabled);
  if (!hasNmc) warnings.push("No NMC addresses are configured (Settings → Classification). Without them NMC replies/forwards cannot be recognised, so most emails will stay in Pending Review.");
  else if (counted.length && nmcMessages === 0) warnings.push("No messages from your NMC addresses were found in this paste, so there is no reply/forward evidence for these emails. Include the NMC replies/forwards when copying from Outlook.");

  await db.apply([{ table: "batches", put: [{ ...batch, matched, unmatched, needsReview, autoClassified, warnings: JSON.stringify(warnings) }] }]);
  await logAudit("BATCH_IMPORTED", "Batch", batch.id, `Batch ${batch.number}: ${rows.length} new messages, ${parsed.length - rows.length} exact duplicates ignored (${year}-${String(month).padStart(2, "0")})`, {
    parsed: parsed.length, new: rows.length, duplicates: parsed.length - rows.length,
  });

  return {
    batchId: batch.id, batchNumber: batch.number, year, month, parsed: parsed.length, newEmails: rows.length,
    exactDuplicates: parsed.length - rows.length, quotedRepeats, exactDuplicateSubjects: dupSubjects.slice(0, 20),
    matched, unmatched, nmcMessages, followUps, outsideMonth: outside, autoClassified, needsReview, warnings,
  };
}

export async function deleteBatch(id: string) {
  const db = await getDb();
  const b = db.batches.get(id);
  if (!b) throw new ImportError("Batch not found.");
  const gone = new Set(db.emails.all().filter((e) => e.batchId === id).map((e) => e.id));
  // other emails that pointed to a deleted one lose that link (the analysis below re-evaluates them)
  const relinked = db.emails.all()
    .filter((e) => !gone.has(e.id) && ((e.duplicateOfId && gone.has(e.duplicateOfId)) || (e.possibleDuplicateOfId && gone.has(e.possibleDuplicateOfId))))
    .map((e) => ({ ...e, duplicateOfId: e.duplicateOfId && gone.has(e.duplicateOfId) ? null : e.duplicateOfId, possibleDuplicateOfId: e.possibleDuplicateOfId && gone.has(e.possibleDuplicateOfId) ? null : e.possibleDuplicateOfId }));
  await db.apply([{ table: "batches", delete: [id] }, { table: "emails", delete: [...gone], put: relinked }]);
  await logAudit("BATCH_DELETED", "Batch", id, `Batch ${b.number} deleted (${gone.size} emails)`, { year: b.year, month: b.month });
  await analyzeMonth(b.year, b.month);
}
