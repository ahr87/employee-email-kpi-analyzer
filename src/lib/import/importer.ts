import { createHash } from "node:crypto";
import { prisma } from "../database/client";
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

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

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

  const employees = await prisma.employee.findMany();
  const prepared = parsed.map((p) => { const f = fingerprint(p); return { p, hash: f.strict, loose: f.loose }; });

  const hashes = [...new Set(prepared.map((x) => x.hash))];
  const mids = prepared.map((x) => x.p.messageId).filter((x): x is string => !!x);
  const seenHash = new Set<string>();
  const seenMid = new Set<string>();
  const looseSeen = new Map<string, boolean>(); // looseHash -> was the stored/earlier copy a quoted one
  for (let i = 0; i < hashes.length; i += 500) {
    const rows = await prisma.email.findMany({ where: { contentHash: { in: hashes.slice(i, i + 500) } }, select: { contentHash: true } });
    rows.forEach((r) => seenHash.add(r.contentHash));
  }
  const looses = [...new Set(prepared.map((x) => x.loose).filter(Boolean))];
  for (let i = 0; i < looses.length; i += 500) {
    const rows = await prisma.email.findMany({ where: { looseHash: { in: looses.slice(i, i + 500) } }, select: { looseHash: true, quoted: true } });
    rows.forEach((r) => looseSeen.set(r.looseHash, (looseSeen.get(r.looseHash) ?? false) || r.quoted));
  }
  for (let i = 0; i < mids.length; i += 500) {
    const rows = await prisma.email.findMany({ where: { messageId: { in: mids.slice(i, i + 500) } }, select: { messageId: true } });
    rows.forEach((r) => r.messageId && seenMid.add(r.messageId));
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
  const rows = fresh.map(({ p, hash, loose }) => {
    const role = isNmcAddress(p.senderEmail, settings.nmcAddresses) ? "NMC" : "EMPLOYEE";
    const m = matchEmployee({ email: p.senderEmail, name: p.senderName }, employees);
    const ent = extractEntities(p.subject, p.body);
    const out = !!p.sentAt && (p.sentAt.getUTCFullYear() !== year || p.sentAt.getUTCMonth() + 1 !== month);
    if (out) outside++;
    return {
      year, month, role,
      senderName: p.senderName, senderEmail: p.senderEmail,
      toRecipients: p.to.join("; "), ccRecipients: p.cc.join("; "),
      subject: p.subject, sentAt: p.sentAt, sentAtAlt: p.sentAtAlt, body: p.body, rawSource: p.rawSource,
      messageId: p.messageId, contentHash: hash, looseHash: loose, conversationKey: conversationKey(p.subject),
      isForward: p.isForward, isReply: p.isReply, quoted: p.quoted, uncertainFields: JSON.stringify(p.uncertainFields),
      incidentIds: ent.incidents.join(","), serviceIds: ent.services.join(","), circuitIds: ent.circuits.join(","),
      ipAddresses: ent.ips.join(","), devices: ent.devices.join(","), locations: ent.locations.join(","),
      outsideMonth: out, monthDecision: out ? "REVIEW" : "IN_MONTH",
      employeeId: role === "EMPLOYEE" ? (m.employee?.id ?? null) : null,
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

  const batch = await prisma.$transaction(async (tx) => {
    const max = await tx.batch.aggregate({ _max: { number: true } });
    const b = await tx.batch.create({
      data: {
        number: (max._max.number ?? 0) + 1, year, month, totalParsed: parsed.length, newEmails: rows.length,
        exactDuplicates: parsed.length - rows.length, warnings: JSON.stringify(warnings),
      },
    });
    const CH = 250;
    for (let i = 0; i < rows.length; i += CH) {
      await tx.email.createMany({ data: rows.slice(i, i + CH).map((r) => ({ ...r, batchId: b.id })) });
    }
    return b;
  }, { timeout: 300_000, maxWait: 30_000 });

  // incremental analysis: the whole month is re-evaluated so new emails can be originals / duplicates / evidence of others
  try {
    await analyzeMonth(year, month);
  } catch (e) {
    await prisma.batch.update({ where: { id: batch.id }, data: { status: "ANALYSIS_FAILED" } });
    throw new ImportError(`The emails of batch ${batch.number} were stored, but their analysis failed (${(e as Error).message.split("\n").filter(Boolean).pop()}). Open Settings → “Re-analyze month” to retry; do not paste them again.`);
  }

  const mine = await prisma.email.findMany({ where: { batchId: batch.id }, select: { kind: true, role: true, employeeId: true, reviewStatus: true } });
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

  await prisma.batch.update({ where: { id: batch.id }, data: { matched, unmatched, needsReview, autoClassified, warnings: JSON.stringify(warnings) } });
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
  const b = await prisma.batch.findUniqueOrThrow({ where: { id } });
  const n = await prisma.email.count({ where: { batchId: id } });
  await prisma.batch.delete({ where: { id } }); // emails cascade
  await logAudit("BATCH_DELETED", "Batch", id, `Batch ${b.number} deleted (${n} emails)`, { year: b.year, month: b.month });
  await analyzeMonth(b.year, b.month);
}
