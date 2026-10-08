import { z } from "zod";
import { getDb } from "../db";
import { listAudit, logAudit } from "../audit";
import { CLASSES, CLASS_LABELS, type Classification } from "../types";
import { analyzeMonth } from "./analyze";
import type { EmailRec, EmployeeRec } from "../storage/types";

export const emailFilterSchema = z.object({
  year: z.number().int().optional(),
  month: z.number().int().optional(),
  q: z.string().optional(),
  employeeId: z.string().optional(),
  classification: z.enum(CLASSES).optional(),
  minConfidence: z.number().optional(),
  maxConfidence: z.number().optional(),
  reviewStatus: z.enum(["OK", "NEEDS_REVIEW", "REVIEWED"]).optional(),
  department: z.string().optional(),
  team: z.string().optional(),
  batchId: z.string().optional(),
  unmatched: z.boolean().optional(),
  /** counted = the emails that enter the KPI; followups / nmc = conversation evidence; all = everything */
  view: z.enum(["counted", "followups", "nmc", "external", "all"]).default("counted"),
  /** Where the email came from: a pasted text or an Outlook export file. */
  source: z.enum(["Paste", "Outlook Desktop"]).optional(),
  sort: z.enum(["sentAt", "subject", "confidence", "finalClass", "employee"]).default("sentAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
});
export type EmailFilter = z.input<typeof emailFilterSchema>;

export interface EmployeeRef { id: string; name: string; email: string; department: string; team: string }
export interface EmailSummary extends EmailRec {
  employee: EmployeeRef | null;
  batch: { number: number; source: string; filename: string | null } | null;
  duplicateOf: { id: string; subject: string; sentAt: Date | null; senderName: string; employee: { name: string } | null } | null;
}

const ref = (e: EmployeeRec | undefined): EmployeeRef | null => (e ? { id: e.id, name: e.name, email: e.email, department: e.department, team: e.team } : null);

async function summarize(rows: EmailRec[]): Promise<EmailSummary[]> {
  const db = await getDb();
  return rows.map((e) => {
    const orig = e.duplicateOfId ? db.emails.get(e.duplicateOfId) : undefined;
    const origEmp = orig?.employeeId ? db.employees.get(orig.employeeId) : undefined;
    return {
      ...e,
      employee: ref(db.employees.get(e.employeeId)),
      batch: db.batches.get(e.batchId) ? { number: db.batches.get(e.batchId)!.number, source: db.batches.get(e.batchId)!.source ?? "Paste", filename: db.batches.get(e.batchId)!.filename ?? null } : null,
      duplicateOf: orig ? { id: orig.id, subject: orig.subject, sentAt: orig.sentAt, senderName: orig.senderName, employee: origEmp ? { name: origEmp.name } : null } : null,
    };
  });
}

/** Filtering is done in memory over the locally stored emails (case-insensitive, Arabic-safe). */
export async function listEmails(raw: EmailFilter = {}) {
  const f = emailFilterSchema.parse(raw);
  const db = await getDb();
  const q = f.q?.trim().toLowerCase();
  const qClass = q ? CLASSES.filter((c) => c.toLowerCase().replace(/_/g, " ").includes(q.replace(/_/g, " ")) || CLASS_LABELS[c as Classification].toLowerCase().includes(q)) : [];
  const empOf = (e: EmailRec) => db.employees.get(e.employeeId);

  const rows = db.emails.all().filter((e) => {
    if (f.year && e.year !== f.year) return false;
    if (f.month && e.month !== f.month) return false;
    if (f.employeeId && e.employeeId !== f.employeeId) return false;
    if (f.classification && e.finalClass !== f.classification) return false;
    if (f.minConfidence != null && e.confidence < f.minConfidence) return false;
    if (f.maxConfidence != null && e.confidence > f.maxConfidence) return false;
    if (f.reviewStatus && e.reviewStatus !== f.reviewStatus) return false;
    if (f.batchId && e.batchId !== f.batchId) return false;
    if (f.unmatched && !(e.employeeId === null && e.counted)) return false;
    if (f.view === "counted" && !e.counted) return false;
    if (f.view === "followups" && e.kind !== "FOLLOW_UP") return false;
    if (f.view === "nmc" && e.kind !== "NMC") return false;
    if (f.view === "external" && e.kind !== "EXTERNAL") return false;
    if (f.source && (db.batches.get(e.batchId)?.source ?? "Paste") !== f.source) return false;
    if (f.department || f.team) {
      const emp = empOf(e);
      if (f.department && emp?.department !== f.department) return false;
      if (f.team && emp?.team !== f.team) return false;
    }
    if (q) {
      const emp = empOf(e);
      const hay = [e.subject, e.senderEmail, e.senderName, e.incidentIds, e.serviceIds, e.circuitIds, e.locations, emp?.name ?? "", emp?.email ?? ""].join("\n").toLowerCase();
      if (!hay.includes(q) && !qClass.includes(e.finalClass as Classification)) return false;
    }
    return true;
  });

  const dir = f.dir === "asc" ? 1 : -1;
  const time = (e: EmailRec) => (e.sentAt ? e.sentAt.getTime() : null);
  rows.sort((a, b) => {
    let c = 0;
    if (f.sort === "sentAt") {
      const x = time(a), y = time(b);
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // undated last
      c = x - y;
    } else if (f.sort === "subject") c = a.subject.localeCompare(b.subject);
    else if (f.sort === "confidence") c = a.confidence - b.confidence;
    else if (f.sort === "finalClass") c = a.finalClass.localeCompare(b.finalClass);
    else c = (empOf(a)?.name ?? "￿").localeCompare(empOf(b)?.name ?? "￿");
    return c * dir || (time(b) ?? 0) - (time(a) ?? 0) || a.id.localeCompare(b.id);
  });

  const start = (f.page - 1) * f.pageSize;
  return { total: rows.length, page: f.page, pageSize: f.pageSize, rows: await summarize(rows.slice(start, start + f.pageSize)) };
}

export async function getEmailDetail(id: string) {
  const db = await getDb();
  const email = db.emails.get(id);
  if (!email) return null;
  const [full] = await summarize([email]);
  const batch = db.batches.get(email.batchId);
  const all = db.emails.all();
  const duplicates = all.filter((e) => e.duplicateOfId === id).map((e) => ({
    id: e.id, subject: e.subject, sentAt: e.sentAt, duplicateSimilarity: e.duplicateSimilarity, senderName: e.senderName, employee: e.employeeId && db.employees.get(e.employeeId) ? { name: db.employees.get(e.employeeId)!.name } : null,
  }));
  const possibleRec = email.possibleDuplicateOfId ? db.emails.get(email.possibleDuplicateOfId) : undefined;
  const possible = possibleRec ? (await summarize([possibleRec]))[0] : null;
  const thread = email.conversationKey
    ? all.filter((e) => e.conversationKey === email.conversationKey && e.id !== id)
        .sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0)).slice(0, 50)
        .map((e) => ({ id: e.id, subject: e.subject, sentAt: e.sentAt, senderName: e.senderName, senderEmail: e.senderEmail, role: e.role, kind: e.kind, counted: e.counted, quoted: e.quoted, isForward: e.isForward, isReply: e.isReply, body: e.body, finalClass: e.finalClass }))
    : [];
  const audit = await listAudit({ entityType: "Email", entityId: id });
  return {
    email: { ...full, batch: { number: batch?.number ?? 0, createdAt: batch?.createdAt ?? email.createdAt, source: batch?.source ?? "Paste", filename: batch?.filename ?? null }, duplicates },
    possible, thread, audit,
  };
}
export type EmailDetail = NonNullable<Awaited<ReturnType<typeof getEmailDetail>>>;

export const emailAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("override"), classification: z.enum(CLASSES), reason: z.string().max(500).optional(), duplicateOfId: z.string().optional() }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("assignEmployee"), employeeId: z.string().nullable() }),
  z.object({ action: z.literal("monthDecision"), decision: z.enum(["INCLUDED", "EXCLUDED", "REVIEW"]) }),
  z.object({ action: z.literal("clearOverride") }),
]);

/** Applies a manual decision. Manual decisions are audited and protected from re-analysis. */
export async function applyEmailAction(id: string, raw: unknown) {
  const a = emailAction.parse(raw);
  const db = await getDb();
  const e = db.emails.get(id);
  if (!e) throw new Error("Email not found.");
  const key = `${e.year}-${String(e.month).padStart(2, "0")}`;
  const save = (patch: Partial<EmailRec>) => db.apply([{ table: "emails", put: [{ ...db.emails.get(id)!, ...patch, updatedAt: new Date() }] }]);

  if (a.action === "override") {
    const changed = a.classification !== e.finalClass;
    if (a.duplicateOfId && a.duplicateOfId === id) throw new Error("An email cannot be a duplicate of itself.");
    if (a.duplicateOfId && !db.emails.get(a.duplicateOfId)) throw new Error("The selected original email does not exist.");
    await save({
      finalClass: a.classification, isManual: true, overrideReason: a.reason || null, overrideAt: new Date(), reviewStatus: "REVIEWED",
      ...(a.classification === "DUPLICATE" && a.duplicateOfId
        ? { duplicateOfId: a.duplicateOfId, duplicateSimilarity: null, duplicateReason: "Original email selected manually." }
        : {}),
    });
    await logAudit(changed ? "CLASSIFICATION_CHANGED" : "CLASSIFICATION_APPROVED", "Email", id,
      changed ? `Classification changed ${e.finalClass} → ${a.classification}` : `Classification confirmed: ${a.classification}`,
      { original: e.autoClass, previousFinal: e.finalClass, final: a.classification, reason: a.reason ?? null, duplicateOfId: a.duplicateOfId ?? null });
  } else if (a.action === "approve") {
    await save({ isManual: true, overrideAt: new Date(), reviewStatus: "REVIEWED" });
    await logAudit("CLASSIFICATION_APPROVED", "Email", id, `Classification approved: ${e.finalClass}`, { final: e.finalClass, confidence: e.confidence });
  } else if (a.action === "clearOverride") {
    await save({ isManual: false, overrideReason: null, overrideAt: null });
    await logAudit("REANALYZED", "Email", id, "Manual decision removed; email re-analysed", {});
    await analyzeMonth(e.year, e.month, { emailIds: [id] });
  } else if (a.action === "assignEmployee") {
    if (a.employeeId && !db.employees.get(a.employeeId)) throw new Error("The selected employee does not exist.");
    await save({ employeeId: a.employeeId, employeeManual: a.employeeId != null });
    await logAudit("EMPLOYEE_ASSIGNED", "Email", id, a.employeeId ? "Email assigned to employee manually" : "Employee assignment removed", { employeeId: a.employeeId });
    await analyzeMonth(e.year, e.month, { emailIds: [id] });
  } else if (a.action === "monthDecision") {
    await save({ monthDecision: a.decision });
    await logAudit("MONTH_DECISION", "Email", id, `Out-of-month email set to ${a.decision} for ${key}`, { decision: a.decision });
    await analyzeMonth(e.year, e.month);
  }
  return (await summarize([db.emails.get(id)!]))[0];
}
