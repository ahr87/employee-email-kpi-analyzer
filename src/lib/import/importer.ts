import { createHash } from "node:crypto";
import { prisma } from "../database/client";
import { getSettings } from "../settings";
import { logAudit } from "../audit";
import { parseEmails } from "../parser";
import { extractEntities } from "../classification/entities";
import { conversationKey } from "../classification/text";
import { isNmcAddress, matchEmployee } from "../employees/matching";
import { analyzeMonth } from "./analyze";

export class ImportError extends Error {}

export interface ImportSummary {
  batchId: string;
  batchNumber: number;
  year: number;
  month: number;
  parsed: number;
  newEmails: number;
  exactDuplicates: number;
  exactDuplicateSubjects: string[];
  matched: number;
  unmatched: number;
  nmcMessages: number;
  outsideMonth: number;
  autoClassified: number;
  needsReview: number;
  warnings: string[];
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function fingerprint(p: { senderEmail: string; senderName: string; sentAt: Date | null; subject: string; body: string }): string {
  const when = p.sentAt ? p.sentAt.toISOString().slice(0, 16) : "";
  return sha([norm(p.senderEmail || p.senderName), when, norm(p.subject), sha(norm(p.body))].join("|"));
}

/** Imports one pasted batch. Additive: existing emails are never modified or removed. */
export async function importBatch(input: { year: number; month: number; text: string }): Promise<ImportSummary> {
  const { year, month } = input;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ImportError("Select a valid year and month.");
  if (!input.text || !input.text.trim()) throw new ImportError("Nothing to analyze: paste your Outlook emails first.");
  if (input.text.length > 20_000_000) throw new ImportError("The pasted content is too large (limit 20 MB). Paste in smaller batches.");

  const settings = await getSettings();
  const { emails: parsed, warnings } = parseEmails(input.text, { dateOrder: settings.dateOrder });
  if (!parsed.length) throw new ImportError(warnings[0] ?? "No emails could be recognised in the pasted text.");

  const employees = await prisma.employee.findMany();
  const prepared = parsed.map((p) => ({ p, hash: fingerprint(p) }));

  const hashes = prepared.map((x) => x.hash);
  const mids = prepared.map((x) => x.p.messageId).filter((x): x is string => !!x);
  const existing = await prisma.email.findMany({
    where: { OR: [{ contentHash: { in: hashes } }, ...(mids.length ? [{ messageId: { in: mids } }] : [])] },
    select: { contentHash: true, messageId: true },
  });
  const seenHash = new Set(existing.map((e) => e.contentHash));
  const seenMid = new Set(existing.map((e) => e.messageId).filter(Boolean) as string[]);

  const fresh: typeof prepared = [];
  const dupSubjects: string[] = [];
  for (const x of prepared) {
    const dup = seenHash.has(x.hash) || (x.p.messageId && seenMid.has(x.p.messageId));
    if (dup) { dupSubjects.push(x.p.subject || "(no subject)"); continue; }
    seenHash.add(x.hash);
    if (x.p.messageId) seenMid.add(x.p.messageId);
    fresh.push(x);
  }

  let matched = 0, unmatched = 0, nmc = 0, outside = 0;
  const rows = fresh.map(({ p, hash }) => {
    const role = isNmcAddress(p.senderEmail, settings.nmcAddresses) ? "NMC" : "EMPLOYEE";
    const m = matchEmployee({ email: p.senderEmail, name: p.senderName }, employees);
    if (role === "NMC") nmc++; else if (m.employee) matched++; else unmatched++;
    const ent = extractEntities(p.subject, p.body);
    const out = !!p.sentAt && (p.sentAt.getUTCFullYear() !== year || p.sentAt.getUTCMonth() + 1 !== month);
    if (out) outside++;
    return {
      year, month, role,
      senderName: p.senderName, senderEmail: p.senderEmail,
      toRecipients: p.to.join("; "), ccRecipients: p.cc.join("; "),
      subject: p.subject, sentAt: p.sentAt, body: p.body, rawSource: p.rawSource,
      messageId: p.messageId, contentHash: hash, conversationKey: conversationKey(p.subject),
      isForward: p.isForward, isReply: p.isReply, uncertainFields: JSON.stringify(p.uncertainFields),
      incidentIds: ent.incidents.join(","), serviceIds: ent.services.join(","), circuitIds: ent.circuits.join(","),
      locations: ent.locations.join(","),
      outsideMonth: out, monthDecision: out ? "REVIEW" : "IN_MONTH",
      employeeId: role === "EMPLOYEE" ? (m.employee?.id ?? null) : null,
    };
  });

  const batch = await prisma.$transaction(async (tx) => {
    const max = await tx.batch.aggregate({ _max: { number: true } });
    const b = await tx.batch.create({
      data: {
        number: (max._max.number ?? 0) + 1, year, month, totalParsed: parsed.length, newEmails: rows.length,
        exactDuplicates: parsed.length - rows.length, matched, unmatched,
        warnings: JSON.stringify(warnings),
      },
    });
    const CH = 200;
    for (let i = 0; i < rows.length; i += CH) {
      await tx.email.createMany({ data: rows.slice(i, i + CH).map((r) => ({ ...r, batchId: b.id })) });
    }
    return b;
  }, { timeout: 120_000 });

  // incremental analysis: the month is re-evaluated so new emails can be originals/duplicates/evidence of others
  await analyzeMonth(year, month);

  const stat = await prisma.email.groupBy({
    by: ["reviewStatus"],
    where: { batchId: batch.id, role: "EMPLOYEE" },
    _count: true,
  });
  const needsReview = stat.find((s) => s.reviewStatus === "NEEDS_REVIEW")?._count ?? 0;
  const autoClassified = stat.filter((s) => s.reviewStatus !== "NEEDS_REVIEW").reduce((a, s) => a + s._count, 0);
  await prisma.batch.update({ where: { id: batch.id }, data: { needsReview, autoClassified } });
  await logAudit("BATCH_IMPORTED", "Batch", batch.id, `Batch ${batch.number}: ${rows.length} new emails, ${parsed.length - rows.length} exact duplicates ignored (${year}-${String(month).padStart(2, "0")})`, {
    parsed: parsed.length, new: rows.length, duplicates: parsed.length - rows.length,
  });

  return {
    batchId: batch.id, batchNumber: batch.number, year, month, parsed: parsed.length, newEmails: rows.length,
    exactDuplicates: parsed.length - rows.length, exactDuplicateSubjects: dupSubjects.slice(0, 20),
    matched, unmatched, nmcMessages: nmc, outsideMonth: outside, autoClassified, needsReview, warnings,
  };
}

export async function deleteBatch(id: string) {
  const b = await prisma.batch.findUniqueOrThrow({ where: { id } });
  const n = await prisma.email.count({ where: { batchId: id } });
  await prisma.batch.delete({ where: { id } }); // emails cascade
  await logAudit("BATCH_DELETED", "Batch", id, `Batch ${b.number} deleted (${n} emails)`, { year: b.year, month: b.month });
  await analyzeMonth(b.year, b.month);
}
