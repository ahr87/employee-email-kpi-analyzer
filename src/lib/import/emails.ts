import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database/client";
import { logAudit } from "../audit";
import { CLASSES } from "../types";
import { analyzeMonth } from "./analyze";

export const emailFilterSchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().optional(),
  q: z.string().optional(),
  employeeId: z.string().optional(),
  classification: z.enum(CLASSES).optional(),
  minConfidence: z.coerce.number().optional(),
  maxConfidence: z.coerce.number().optional(),
  reviewStatus: z.enum(["OK", "NEEDS_REVIEW", "REVIEWED"]).optional(),
  department: z.string().optional(),
  team: z.string().optional(),
  batchId: z.string().optional(),
  unmatched: z.coerce.boolean().optional(),
  role: z.enum(["EMPLOYEE", "NMC"]).optional(),
  sort: z.enum(["sentAt", "subject", "confidence", "finalClass", "employee"]).default("sentAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type EmailFilter = z.infer<typeof emailFilterSchema>;

export function buildWhere(f: Partial<EmailFilter>): Prisma.EmailWhereInput {
  const and: Prisma.EmailWhereInput[] = [];
  if (f.year) and.push({ year: f.year });
  if (f.month) and.push({ month: f.month });
  if (f.employeeId) and.push({ employeeId: f.employeeId });
  if (f.classification) and.push({ finalClass: f.classification });
  if (f.minConfidence != null) and.push({ confidence: { gte: f.minConfidence } });
  if (f.maxConfidence != null) and.push({ confidence: { lte: f.maxConfidence } });
  if (f.reviewStatus) and.push({ reviewStatus: f.reviewStatus });
  if (f.batchId) and.push({ batchId: f.batchId });
  if (f.unmatched) and.push({ employeeId: null, role: "EMPLOYEE" });
  and.push({ role: f.role ?? "EMPLOYEE" });
  if (f.department) and.push({ employee: { is: { department: f.department } } });
  if (f.team) and.push({ employee: { is: { team: f.team } } });
  if (f.q?.trim()) {
    const q = f.q.trim();
    const cls = CLASSES.filter((c) => c.toLowerCase().replace(/_/g, " ").includes(q.toLowerCase().replace(/_/g, " ")));
    and.push({
      OR: [
        { subject: { contains: q } }, { senderEmail: { contains: q } }, { senderName: { contains: q } },
        { incidentIds: { contains: q.toLowerCase() } }, { serviceIds: { contains: q.toLowerCase() } },
        { circuitIds: { contains: q.toLowerCase() } }, { locations: { contains: q.toLowerCase() } },
        { employee: { is: { OR: [{ name: { contains: q } }, { email: { contains: q } }] } } },
        ...(cls.length ? [{ finalClass: { in: cls as string[] } }] : []),
      ],
    });
  }
  return { AND: and };
}

export const emailSummarySelect = {
  id: true, year: true, month: true, subject: true, sentAt: true, senderName: true, senderEmail: true,
  finalClass: true, autoClass: true, confidence: true, reason: true, reviewStatus: true, reviewReasons: true,
  isManual: true, monthDecision: true, duplicateOfId: true, duplicateSimilarity: true, batchId: true, employeeId: true,
  possibleDuplicateOfId: true, possibleDuplicateSim: true, role: true,
  employee: { select: { id: true, name: true, email: true, department: true, team: true } },
  batch: { select: { number: true } },
  duplicateOf: { select: { id: true, subject: true, sentAt: true, employee: { select: { name: true } }, senderName: true } },
} satisfies Prisma.EmailSelect;

export async function listEmails(raw: unknown) {
  const f = emailFilterSchema.parse(raw);
  const where = buildWhere(f);
  const dir = f.dir;
  const orderBy: Prisma.EmailOrderByWithRelationInput[] =
    f.sort === "employee" ? [{ employee: { name: dir } }, { sentAt: "desc" }] : [{ [f.sort]: dir } as Prisma.EmailOrderByWithRelationInput, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.email.count({ where }),
    prisma.email.findMany({ where, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize, select: emailSummarySelect }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, rows };
}

export async function getEmailDetail(id: string) {
  const email = await prisma.email.findUnique({
    where: { id },
    include: {
      employee: true, batch: { select: { number: true, createdAt: true } },
      duplicateOf: { include: { employee: true } },
      duplicates: { select: { id: true, subject: true, sentAt: true, duplicateSimilarity: true, employee: { select: { name: true } }, senderName: true } },
    },
  });
  if (!email) return null;
  const possible = email.possibleDuplicateOfId
    ? await prisma.email.findUnique({ where: { id: email.possibleDuplicateOfId }, include: { employee: true } })
    : null;
  const thread = email.conversationKey
    ? await prisma.email.findMany({
        where: { conversationKey: email.conversationKey, id: { not: id } },
        orderBy: { sentAt: "asc" },
        select: { id: true, subject: true, sentAt: true, senderName: true, senderEmail: true, role: true, body: true, finalClass: true },
        take: 50,
      })
    : [];
  const audit = await prisma.auditLog.findMany({ where: { entityType: "Email", entityId: id }, orderBy: { createdAt: "desc" } });
  return { email, possible, thread, audit };
}

export const emailAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("override"), classification: z.enum(CLASSES), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("assignEmployee"), employeeId: z.string().nullable() }),
  z.object({ action: z.literal("monthDecision"), decision: z.enum(["INCLUDED", "EXCLUDED", "REVIEW"]) }),
  z.object({ action: z.literal("clearOverride") }),
]);

/** Applies a manual decision. Manual decisions are audited and protected from re-analysis. */
export async function applyEmailAction(id: string, raw: unknown) {
  const a = emailAction.parse(raw);
  const e = await prisma.email.findUniqueOrThrow({ where: { id } });
  const key = `${e.year}-${String(e.month).padStart(2, "0")}`;

  if (a.action === "override") {
    const changed = a.classification !== e.finalClass;
    await prisma.email.update({
      where: { id },
      data: {
        finalClass: a.classification, isManual: true, overrideReason: a.reason || null, overrideAt: new Date(),
        reviewStatus: "REVIEWED",
      },
    });
    await logAudit(changed ? "CLASSIFICATION_CHANGED" : "CLASSIFICATION_APPROVED", "Email", id,
      changed ? `Classification changed ${e.finalClass} → ${a.classification}` : `Classification confirmed: ${a.classification}`,
      { original: e.autoClass, previousFinal: e.finalClass, final: a.classification, reason: a.reason ?? null });
  } else if (a.action === "approve") {
    await prisma.email.update({
      where: { id }, data: { isManual: true, overrideAt: new Date(), reviewStatus: "REVIEWED" },
    });
    await logAudit("CLASSIFICATION_APPROVED", "Email", id, `Classification approved: ${e.finalClass}`, { final: e.finalClass, confidence: e.confidence });
  } else if (a.action === "clearOverride") {
    await prisma.email.update({ where: { id }, data: { isManual: false, overrideReason: null, overrideAt: null } });
    await logAudit("REANALYZED", "Email", id, "Manual decision removed; email re-analysed", {});
    await analyzeMonth(e.year, e.month, { emailIds: [id] });
  } else if (a.action === "assignEmployee") {
    await prisma.email.update({ where: { id }, data: { employeeId: a.employeeId, employeeManual: a.employeeId != null } });
    await logAudit("EMPLOYEE_ASSIGNED", "Email", id, a.employeeId ? "Email assigned to employee manually" : "Employee assignment removed", { employeeId: a.employeeId });
    await analyzeMonth(e.year, e.month, { emailIds: [id] });
  } else if (a.action === "monthDecision") {
    await prisma.email.update({ where: { id }, data: { monthDecision: a.decision } });
    await logAudit("MONTH_DECISION", "Email", id, `Out-of-month email set to ${a.decision} for ${key}`, { decision: a.decision });
    await analyzeMonth(e.year, e.month);
  }
  return prisma.email.findUniqueOrThrow({ where: { id }, select: emailSummarySelect });
}
