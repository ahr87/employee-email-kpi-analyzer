import { z } from "zod";
import { getDb } from "../db";
import { logAudit } from "../audit";
import { settingsSchema } from "../settings";
import type { AuditRec, BatchRec, EmailRec, EmployeeRec, RawRec } from "../storage/types";
import { fromBase64, toBase64 } from "../utils/gzip";

export const BACKUP_FORMAT = "employee-email-kpi-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 400 * 1024 * 1024;

const isoDate = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)), "must be an ISO date");
const date = isoDate.transform((s) => new Date(s));
const nullableDate = isoDate.nullable().transform((s) => (s ? new Date(s) : null));
const str = z.string().max(5_000_000);
const cls = z.enum(["FORWARDED", "NOT_USEFUL", "DUPLICATE", "PENDING_REVIEW", "OTHER"]);

const employeeSchema = z.object({
  id: z.string().min(1), employeeId: z.string().min(1).max(50), name: z.string().min(1).max(120), email: z.string().min(3).max(200).transform((s) => s.toLowerCase()),
  department: z.string().max(120), team: z.string().max(120), active: z.boolean(), createdAt: date, updatedAt: date,
});
const batchSchema = z.object({
  id: z.string().min(1), number: z.number().int().min(1), year: z.number().int().min(1990).max(2200), month: z.number().int().min(1).max(12), createdAt: date,
  totalParsed: z.number().int().min(0), newEmails: z.number().int().min(0), exactDuplicates: z.number().int().min(0), matched: z.number().int().min(0),
  unmatched: z.number().int().min(0), autoClassified: z.number().int().min(0), needsReview: z.number().int().min(0), warnings: str, status: z.string().max(40),
  source: z.string().max(40).default("Paste"), filename: z.string().max(500).nullable().default(null),
  exportedAt: nullableDate.default(null), dateFrom: nullableDate.default(null), dateTo: nullableDate.default(null),
  uniqueSenders: z.number().int().min(0).default(0), uniqueConversations: z.number().int().min(0).default(0),
});
const emailSchema = z.object({
  id: z.string().min(1), batchId: z.string().min(1), year: z.number().int().min(1990).max(2200), month: z.number().int().min(1).max(12),
  role: z.enum(["EMPLOYEE", "NMC"]), senderName: str, senderEmail: str, toRecipients: str, ccRecipients: str, subject: str,
  sentAt: nullableDate, sentAtAlt: nullableDate, body: str, rawSource: str, messageId: z.string().nullable(), contentHash: z.string().min(1), looseHash: z.string(),
  conversationKey: str, isForward: z.boolean(), isReply: z.boolean(), uncertainFields: str,
  incidentIds: str, serviceIds: str, circuitIds: str, locations: str, ipAddresses: str, devices: str,
  quoted: z.boolean(), kind: z.enum(["REPORT", "FOLLOW_UP", "NMC", "EXTERNAL"]),
  externalMessageId: z.string().nullable().default(null), externalConversationId: z.string().nullable().default(null), extKey: z.string().default(""), normalization: str.default("{}"), counted: z.boolean(), outsideMonth: z.boolean(),
  monthDecision: z.enum(["IN_MONTH", "INCLUDED", "EXCLUDED", "REVIEW"]), employeeId: z.string().nullable(), employeeManual: z.boolean(),
  autoClass: cls, confidence: z.number().min(0).max(100), reason: str, finalClass: cls, isManual: z.boolean(),
  overrideReason: z.string().nullable(), overrideAt: nullableDate,
  duplicateOfId: z.string().nullable(), duplicateSimilarity: z.number().nullable(), duplicateReason: z.string().nullable(),
  possibleDuplicateOfId: z.string().nullable(), possibleDuplicateSim: z.number().nullable(),
  reviewStatus: z.enum(["OK", "NEEDS_REVIEW", "REVIEWED"]), reviewReasons: str, createdAt: date, updatedAt: date,
});
const rawSchema = z.object({
  id: z.string().min(1), batchId: z.string().min(1), entryId: z.string().min(1), conversationId: z.string().nullable(), subject: str, from: str, fromEmail: str, to: str, cc: str,
  receivedAt: z.string().max(100), body: str, htmlChars: z.number().int().min(0), html: z.string().nullable().default(null),
  /** original HTML, gzip + base64 (only present when the backup was made with "include original Outlook HTML") */
  htmlGzBase64: z.string().nullable().default(null),
});
const auditSchema = z.object({ id: z.string().min(1), createdAt: date, action: z.string().max(60), entityType: z.string().max(60), entityId: z.string().max(200), summary: str, details: str });

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: isoDate,
  app: z.string().optional(),
  data: z.object({
    employees: z.array(employeeSchema),
    batches: z.array(batchSchema),
    emails: z.array(emailSchema),
    audit: z.array(auditSchema),
    settings: settingsSchema, // KPI settings, NMC addresses, phrases, thresholds …
    raw: z.array(rawSchema).default([]), // original Outlook messages
  }),
});
export type ParsedBackup = z.output<typeof backupSchema>;

export interface BackupSummary { employees: number; batches: number; emails: number; months: number; audit: number; exportedAt: string }

export function backupFilename(now = new Date()) {
  return `employee-email-kpi-backup-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Everything the app stores — and nothing temporary (no UI state). Dates become ISO strings.
 * `includeOriginalHtml` adds the original Outlook HTML bodies (compressed); without it the original PLAIN-TEXT body and
 * all headers of every Outlook message are still included.
 */
export async function exportBackup(now = new Date(), opts: { includeOriginalHtml?: boolean } = {}): Promise<{ filename: string; json: string; summary: BackupSummary }> {
  await logAudit("BACKUP_EXPORTED", "System", "", "Backup exported", {});
  const db = await getDb();
  const { getSettings } = await import("../settings");
  const rawRows = await db.adapter.readAll("raw");
  const raw = rawRows.map((r) => ({
    id: r.id, batchId: r.batchId, entryId: r.entryId, conversationId: r.conversationId, subject: r.subject, from: r.from, fromEmail: r.fromEmail, to: r.to, cc: r.cc,
    receivedAt: r.receivedAt, body: r.body, htmlChars: r.htmlChars,
    html: opts.includeOriginalHtml ? r.html : null,
    htmlGzBase64: opts.includeOriginalHtml && r.htmlGz ? toBase64(r.htmlGz) : null,
  }));
  const data = {
    employees: db.employees.all(), batches: db.batches.all().sort((a, b) => a.number - b.number), emails: db.emails.all(),
    audit: db.audit.all().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()), settings: await getSettings(), raw,
  };
  const file = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), app: "Employee Email KPI Analyzer", data };
  return { filename: backupFilename(now), json: JSON.stringify(file), summary: summarize(file.data, file.exportedAt) };
}

function summarize(d: { employees: unknown[]; batches: unknown[]; emails: { year: number; month: number }[]; audit: unknown[] }, exportedAt: string): BackupSummary {
  return {
    employees: d.employees.length, batches: d.batches.length, emails: d.emails.length, audit: d.audit.length, exportedAt,
    months: new Set(d.emails.map((e) => `${e.year}-${e.month}`)).size,
  };
}

export type BackupCheck = { ok: true; backup: ParsedBackup; summary: BackupSummary } | { ok: false; errors: string[] };

/** Validates a backup file's text completely before anything is touched. */
export function validateBackup(text: string): BackupCheck {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, errors: ["The file is too large to be a backup of this application."] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ["This is not a valid JSON file."] }; }
  if (!raw || typeof raw !== "object" || (raw as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, errors: ["This file is not a backup created by Employee Email KPI Analyzer."] };
  }
  if ((raw as { version?: unknown }).version !== BACKUP_VERSION) {
    return { ok: false, errors: [`Unsupported backup version ${String((raw as { version?: unknown }).version)} (this app reads version ${BACKUP_VERSION}).`] };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.slice(0, 4).join(".") || "file"}: ${i.message}`) };
  }
  const d = parsed.data.data;
  const errors: string[] = [];
  const dupes = (label: string, vals: string[]) => { if (new Set(vals).size !== vals.length) errors.push(`${label} contains duplicates.`); };
  dupes("Employee IDs", d.employees.map((e) => e.id));
  dupes("Employee e-mail addresses", d.employees.map((e) => e.email));
  dupes("Batch numbers", d.batches.map((b) => String(b.number)));
  dupes("Email IDs", d.emails.map((e) => e.id));
  dupes("Email identity keys", d.emails.map((e) => e.contentHash));
  const batchIds = new Set(d.batches.map((b) => b.id));
  const empIds = new Set(d.employees.map((e) => e.id));
  const emailIds = new Set(d.emails.map((e) => e.id));
  if (d.emails.some((e) => !batchIds.has(e.batchId))) errors.push("Some emails refer to a batch that is not in the backup.");
  if (d.emails.some((e) => e.employeeId && !empIds.has(e.employeeId))) errors.push("Some emails refer to an employee that is not in the backup.");
  const emailIdSet = emailIds;
  if (d.raw.some((r) => !emailIdSet.has(r.id))) errors.push("Some original Outlook messages refer to an email that is not in the backup.");
  if (d.emails.some((e) => (e.duplicateOfId && !emailIds.has(e.duplicateOfId)) || (e.possibleDuplicateOfId && !emailIds.has(e.possibleDuplicateOfId)))) errors.push("Some duplicate links point to emails that are not in the backup.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, backup: parsed.data, summary: summarize(d, parsed.data.exportedAt) };
}

/**
 * Replaces ALL data in this browser with the backup (the caller must have asked the user to confirm).
 * Storage is written first and atomically per table set; memory only changes afterwards.
 */
export async function restoreBackup(backup: ParsedBackup) {
  const db = await getDb();
  const d = backup.data;
  await db.replaceAll({
    employees: d.employees as EmployeeRec[], batches: d.batches as BatchRec[], emails: d.emails as EmailRec[], audit: d.audit as AuditRec[],
    settings: [{ id: "app", value: d.settings }],
    raw: d.raw.map((r): RawRec => ({
      id: r.id, batchId: r.batchId, entryId: r.entryId, conversationId: r.conversationId, subject: r.subject, from: r.from, fromEmail: r.fromEmail, to: r.to, cc: r.cc,
      receivedAt: r.receivedAt, body: r.body, htmlChars: r.htmlChars, html: r.html, htmlGz: r.htmlGzBase64 ? fromBase64(r.htmlGzBase64) : null,
    })),
  });
  await logAudit("BACKUP_RESTORED", "System", "", `Backup restored (${d.emails.length} emails, ${d.employees.length} employees)`, { exportedAt: backup.exportedAt });
}
