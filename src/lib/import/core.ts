import { getDb, newId } from "../db";
import { sha256 as sha } from "../utils/hash";
import { gzip, canCompress } from "../utils/gzip";
import type { BatchRec, EmailRec, RawRec } from "../storage/types";
import { StorageFullError } from "../storage/storage";
import { getSettings } from "../settings";
import { logAudit } from "../audit";
import { extractEntities } from "../classification/entities";
import { conversationKey, stripSignature } from "../classification/text";
import { isNmcAddress, matchEmployee } from "../employees/matching";
import { analyzeMonth } from "./analyze";
import { normalizeForAnalysis } from "../text";
import { yieldToUi, type ImportItem, type MonthMode, type ProgressFn } from "./types";
import type { ParsedEmail } from "../parser";

export class ImportError extends Error {}

export interface ImportSummary {
  batchId: string;
  batchNumber: number;
  source: string;
  filename: string | null;
  year: number;
  month: number;
  parsed: number; // messages recognised in the paste / file (incl. chain messages)
  newEmails: number; // imported (stored)
  exactDuplicates: number; // already stored / repeated inside the paste or file → ignored
  quotedRepeats: number; // of which: quoted copies inside reply/forward chains
  exactDuplicateSubjects: string[];
  matched: number; // counted employee emails matched to an employee
  unmatched: number; // counted employee emails with no employee (paste only; Outlook imports count them as otherSenders)
  otherSenders: number; // Outlook import: messages from senders that are not configured employees (kept as evidence, not counted)
  nmcMessages: number; // NMC messages kept as evidence
  followUps: number; // follow-up messages kept as evidence (not counted)
  outsideMonth: number;
  autoClassified: number;
  needsReview: number;
  months: { year: number; month: number; count: number }[];
  dateFrom: Date | null;
  dateTo: Date | null;
  uniqueSenders: number;
  uniqueConversations: number;
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

/** Outlook duplicate tier 2: ConversationID + minute + sender + subject (survives a changed EntryID, e.g. after moving a message). */
export function externalKey(conversationId: string | null, p: Pick<ParsedEmail, "senderEmail" | "senderName" | "sentAt" | "subject">): string {
  if (!conversationId || !p.sentAt) return "";
  return sha([conversationId, p.sentAt.toISOString().slice(0, 16), normalizeForAnalysis(p.senderEmail || p.senderName), normalizeForAnalysis(p.subject)].join("|"));
}

async function packRaw(id: string, batchId: string, r: NonNullable<ImportItem["raw"]>): Promise<RawRec> {
  const html = r.htmlBody;
  const compress = html.length > 1024 && canCompress();
  return {
    id, batchId, entryId: r.entryId, conversationId: r.conversationId, subject: r.subject, from: r.from, fromEmail: r.fromEmail, to: r.to, cc: r.cc,
    receivedAt: r.receivedAt, body: r.body, htmlChars: html.length,
    htmlGz: compress ? await gzip(html) : null, html: !html ? null : compress ? null : html,
  };
}

/** All identity keys of what is stored (and of what has been accepted so far in the current import). */
export class DuplicateIndex {
  private hash = new Set<string>();
  private mid = new Set<string>();
  private ext = new Set<string>();
  private extKeys = new Set<string>();
  private loose = new Map<string, boolean>(); // looseHash -> was the stored/earlier copy a quoted one

  static async fromDb(): Promise<DuplicateIndex> {
    const db = await getDb();
    const idx = new DuplicateIndex();
    for (const e of db.emails.all()) {
      idx.hash.add(e.contentHash);
      if (e.messageId) idx.mid.add(e.messageId);
      if (e.externalMessageId) idx.ext.add(e.externalMessageId);
      if (e.extKey) idx.extKeys.add(e.extKey);
      if (e.looseHash) idx.loose.set(e.looseHash, (idx.loose.get(e.looseHash) ?? false) || e.quoted);
    }
    return idx;
  }

  /**
   * Exact-duplicate tiers, strongest first: Outlook EntryID → ConversationID + minute + sender + subject → content hash
   * (sender + minute + subject + body start) → quoted copy → Message-ID.
   */
  keys(item: ImportItem) {
    const p = item.parsed;
    const f = fingerprint(p);
    return { strict: f.strict, loose: f.loose, extId: item.external?.entryId ?? null, extK: externalKey(item.external?.conversationId ?? null, p), messageId: p.messageId, quoted: p.quoted };
  }
  check(k: ReturnType<DuplicateIndex["keys"]>): "entryId" | "conversation" | "content" | "quoted" | "message-id" | null {
    if (k.extId && this.ext.has(k.extId)) return "entryId";
    if (k.extK && this.extKeys.has(k.extK)) return "conversation";
    if (this.hash.has(k.strict)) return "content";
    if (k.loose && this.loose.has(k.loose) && (k.quoted || this.loose.get(k.loose) === true)) return "quoted";
    if (k.messageId && this.mid.has(k.messageId)) return "message-id";
    return null;
  }
  add(k: ReturnType<DuplicateIndex["keys"]>) {
    this.hash.add(k.strict);
    if (k.loose) this.loose.set(k.loose, (this.loose.get(k.loose) ?? false) || k.quoted);
    if (k.messageId) this.mid.add(k.messageId);
    if (k.extId) this.ext.add(k.extId);
    if (k.extK) this.extKeys.add(k.extK);
  }
}

const CHUNK = 250;

export interface RunImportOptions {
  source: "Paste" | "Outlook Desktop";
  year: number;
  month: number;
  monthMode: MonthMode;
  filename?: string | null;
  exportedAt?: Date | null;
  warnings: string[];
  /** Number of messages expected (for progress display). */
  total?: number;
  onProgress?: ProgressFn;
}

/**
 * The import core shared by "Paste & Analyze" and "Import Outlook Export": exact-duplicate prevention, employee matching,
 * month assignment, chunked storage (a small import is ONE atomic transaction), then the existing analysis pipeline.
 * Additive: existing emails are never modified or removed by an import.
 */
export async function runImport(items: AsyncIterable<ImportItem> | Iterable<ImportItem>, opts: RunImportOptions): Promise<ImportSummary> {
  const { year, month, source } = opts;
  const settings = await getSettings();
  const warnings = opts.warnings;
  const db = await getDb();
  const employees = db.employees.all();

  const dupIndex = await DuplicateIndex.fromDb();

  const now = new Date();
  const batchId = newId();
  const number = Math.max(0, ...db.batches.all().map((b) => b.number)) + 1;
  const dupSubjects: string[] = [];
  const senders = new Set<string>();
  const conversations = new Set<string>();
  const months = new Map<string, { year: number; month: number; count: number }>();
  let parsedCount = 0, fresh = 0, quotedRepeats = 0, outside = 0;
  let dateFrom: number | null = null, dateTo: number | null = null;
  let rows: EmailRec[] = [];
  let raws: RawRec[] = [];
  let started = false;
  const written: string[] = []; // ids of everything already stored (for rollback)

  const batchRec = (status: string, extra: Partial<BatchRec> = {}): BatchRec => ({
    id: batchId, number, year, month, createdAt: now, totalParsed: parsedCount, newEmails: fresh, exactDuplicates: parsedCount - fresh,
    matched: 0, unmatched: 0, autoClassified: 0, needsReview: 0, warnings: JSON.stringify(warnings), status,
    source, filename: opts.filename ?? null, exportedAt: opts.exportedAt ?? null,
    dateFrom: dateFrom == null ? null : new Date(dateFrom), dateTo: dateTo == null ? null : new Date(dateTo),
    uniqueSenders: senders.size, uniqueConversations: conversations.size, ...extra,
  });

  const rollback = async () => {
    try {
      await db.apply([{ table: "emails", delete: written }, { table: "raw", delete: written }, { table: "batches", delete: [batchId] }]);
    } catch { /* best effort */ }
  };

  const flush = async (final: boolean) => {
    const ops: Parameters<typeof db.apply>[0] = [];
    if (!started || final) ops.push({ table: "batches", put: [batchRec(final ? "COMPLETED" : "IMPORTING")] });
    if (rows.length) ops.push({ table: "emails", put: rows });
    if (raws.length) ops.push({ table: "raw", put: raws });
    if (!ops.length) return;
    try {
      await db.apply(ops);
    } catch (e) {
      await rollback();
      if (e instanceof StorageFullError) throw new ImportError(e.message);
      throw e;
    }
    started = true;
    written.push(...rows.map((r) => r.id));
    rows = []; raws = [];
  };

  try {
    for await (const item of items as AsyncIterable<ImportItem>) {
      parsedCount++;
      const p = item.parsed;
      senders.add(p.senderEmail || p.senderName.toLowerCase());
      conversations.add(item.external?.conversationId ?? conversationKey(p.subject));
      if (p.sentAt) {
        const t = p.sentAt.getTime();
        dateFrom = dateFrom == null ? t : Math.min(dateFrom, t);
        dateTo = dateTo == null ? t : Math.max(dateTo, t);
      }

      const k = dupIndex.keys(item);
      const dup = dupIndex.check(k);
      if (dup) {
        if (p.quoted) quotedRepeats++;
        if (dupSubjects.length < 20) dupSubjects.push(p.subject || "(no subject)");
      } else {
        dupIndex.add(k);
        const f = { strict: k.strict, loose: k.loose };
        const extId = k.extId;
        const extK = k.extK;

        const role = isNmcAddress(p.senderEmail, settings.nmcAddresses) ? "NMC" : "EMPLOYEE";
        const m = matchEmployee({ email: p.senderEmail, name: p.senderName }, employees, { allowNameFallback: !item.external });
        const ent = extractEntities(p.subject, p.body);
        const byReceived = opts.monthMode === "received" && !!p.sentAt;
        const y = byReceived ? p.sentAt!.getUTCFullYear() : year;
        const mo = byReceived ? p.sentAt!.getUTCMonth() + 1 : month;
        const out = !byReceived && !!p.sentAt && (p.sentAt.getUTCFullYear() !== year || p.sentAt.getUTCMonth() + 1 !== month);
        if (out) outside++;
        const mk = `${y}-${mo}`;
        const cur = months.get(mk) ?? { year: y, month: mo, count: 0 };
        cur.count++;
        months.set(mk, cur);
        const id = newId();
        fresh++;
        rows.push({
          id, batchId, year: y, month: mo, role,
          senderName: p.senderName, senderEmail: p.senderEmail,
          toRecipients: p.to.join("; "), ccRecipients: p.cc.join("; "),
          subject: p.subject, sentAt: p.sentAt, sentAtAlt: p.sentAtAlt, body: p.body, rawSource: p.rawSource,
          messageId: p.messageId, contentHash: f.strict, looseHash: f.loose, conversationKey: conversationKey(p.subject),
          isForward: p.isForward, isReply: p.isReply, quoted: p.quoted, uncertainFields: JSON.stringify(p.uncertainFields),
          incidentIds: ent.incidents.join(","), serviceIds: ent.services.join(","), circuitIds: ent.circuits.join(","),
          ipAddresses: ent.ips.join(","), devices: ent.devices.join(","), locations: ent.locations.join(","),
          externalMessageId: extId, externalConversationId: item.external?.conversationId ?? null, extKey: extK,
          normalization: JSON.stringify(item.normalization ?? {}),
          kind: "REPORT", counted: true,
          outsideMonth: out, monthDecision: out ? "REVIEW" : "IN_MONTH",
          employeeId: role === "EMPLOYEE" ? (m.employee?.id ?? null) : null, employeeManual: false,
          autoClass: "PENDING_REVIEW", confidence: 0, reason: "", finalClass: "PENDING_REVIEW", isManual: false, overrideReason: null, overrideAt: null,
          duplicateOfId: null, duplicateSimilarity: null, duplicateReason: null, possibleDuplicateOfId: null, possibleDuplicateSim: null,
          reviewStatus: "NEEDS_REVIEW", reviewReasons: "[]", createdAt: now, updatedAt: now,
        });
        if (item.raw) raws.push(await packRaw(id, batchId, item.raw));
      }
      if (rows.length >= CHUNK) {
        await flush(false);
        opts.onProgress?.({ phase: "importing", done: parsedCount, total: opts.total ?? parsedCount });
        await yieldToUi();
      }
    }
  } catch (e) {
    if (started) await rollback();
    throw e;
  }
  if (!parsedCount) throw new ImportError("No messages were found to import.");
  opts.onProgress?.({ phase: "importing", done: parsedCount, total: opts.total ?? parsedCount });
  await flush(true);

  // incremental analysis: every affected month is re-evaluated so new emails can be originals / duplicates / evidence of others
  const affected = [...months.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  const monthsToAnalyze = affected.length ? affected : [{ year, month, count: 0 }];
  let analyzedBefore = 0;
  const totalToAnalyze = monthsToAnalyze.reduce((a, m) => a + db.emails.all().filter((e) => e.year === m.year && e.month === m.month).length, 0);
  try {
    for (const m of monthsToAnalyze) {
      const size = db.emails.all().filter((e) => e.year === m.year && e.month === m.month).length;
      await analyzeMonth(m.year, m.month, { onProgress: (done) => opts.onProgress?.({ phase: "analyzing", done: analyzedBefore + done, total: totalToAnalyze }) });
      analyzedBefore += size;
    }
  } catch (e) {
    await db.apply([{ table: "batches", put: [batchRec("ANALYSIS_FAILED")] }]);
    throw new ImportError(`The emails of batch ${number} were stored, but their analysis failed (${(e as Error).message.split("\n").filter(Boolean).pop()}). Open Settings → “Re-analyze month” to retry; do not import them again.`);
  }

  const mine = db.emails.all().filter((e) => e.batchId === batchId);
  const counted = mine.filter((e) => e.kind === "REPORT");
  const matched = counted.filter((e) => e.employeeId).length;
  const unmatched = counted.length - matched;
  const needsReview = counted.filter((e) => e.reviewStatus === "NEEDS_REVIEW").length;
  const autoClassified = counted.length - needsReview;
  const nmcMessages = mine.filter((e) => e.kind === "NMC").length;
  const followUps = mine.filter((e) => e.kind === "FOLLOW_UP").length;
  const otherSenders = mine.filter((e) => e.kind === "EXTERNAL").length;

  const label = source === "Paste" ? "paste" : "file";
  const hasNmc = settings.nmcAddresses.some((n) => n.enabled);
  if (!hasNmc) warnings.push("No NMC addresses are configured (Settings → Classification). Without them NMC replies/forwards cannot be recognised, so most emails will stay in Pending Review.");
  else if (counted.length && nmcMessages === 0) warnings.push(`No messages from your NMC addresses were found in this ${label}, so there is no reply/forward evidence for these emails. Include the NMC replies/forwards${source === "Paste" ? " when copying from Outlook" : " in the export"}.`);
  if (source !== "Paste" && !employees.length) warnings.push("No employees are configured yet — every sender is an “other sender” and nothing is counted. Add employees (Employees page) and use Settings → Re-analyze.");

  const final = batchRec("COMPLETED", { matched, unmatched, needsReview, autoClassified, warnings: JSON.stringify(warnings) });
  await db.apply([{ table: "batches", put: [final] }]);
  await logAudit("BATCH_IMPORTED", "Batch", batchId, `Batch ${number} (${source}${opts.filename ? `, ${opts.filename}` : ""}): ${fresh} new messages, ${parsedCount - fresh} exact duplicates ignored`, {
    source, filename: opts.filename ?? null, parsed: parsedCount, new: fresh, duplicates: parsedCount - fresh,
  });
  opts.onProgress?.({ phase: "done", done: parsedCount, total: opts.total ?? parsedCount });

  return {
    batchId, batchNumber: number, source, filename: opts.filename ?? null, year, month, parsed: parsedCount, newEmails: fresh,
    exactDuplicates: parsedCount - fresh, quotedRepeats, exactDuplicateSubjects: dupSubjects,
    matched, unmatched, otherSenders, nmcMessages, followUps, outsideMonth: outside, autoClassified, needsReview,
    months: affected, dateFrom: final.dateFrom, dateTo: final.dateTo, uniqueSenders: senders.size, uniqueConversations: conversations.size, warnings,
  };
}
