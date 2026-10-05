import { prisma } from "../database/client";
import { getSettings } from "../settings";
import { logAudit } from "../audit";
import { RuleBasedClassifier, type EmailClassifier, type ThreadMessage } from "../classification/classifier";
import { RuleBasedDuplicateDetector, type DuplicateDetector } from "../duplicate-detection/detector";
import { matchEmployee } from "../employees/matching";
import type { Classification, ReviewReason } from "../types";

export interface AnalyzeOptions {
  /** Only (re)analyse these emails (still uses the whole month as context). */
  emailIds?: string[];
  /** Also discard manual decisions (explicit full reset). */
  resetManual?: boolean;
  classifier?: EmailClassifier;
  detector?: DuplicateDetector;
  audit?: boolean;
}

const COUNTED = ["IN_MONTH", "INCLUDED"];

const csv = (s: string) => (s ? s.split(",").filter(Boolean) : []);

/**
 * (Re)analyses one month. Pure derivation from stored data: employee matching, business-duplicate
 * detection, classification, review reasons. Manual decisions (approvals / overrides / manual employee
 * assignment) are never touched unless `resetManual` is set.
 */
export async function analyzeMonth(year: number, month: number, opts: AnalyzeOptions = {}) {
  const settings = await getSettings();
  const classifier = opts.classifier ?? new RuleBasedClassifier();
  const detector = opts.detector ?? new RuleBasedDuplicateDetector();

  if (opts.resetManual) {
    await prisma.email.updateMany({
      where: { year, month, ...(opts.emailIds ? { id: { in: opts.emailIds } } : {}) },
      data: { isManual: false, overrideReason: null, overrideAt: null, employeeManual: false },
    });
  }

  const [emails, employees] = await Promise.all([
    prisma.email.findMany({ where: { year, month, monthDecision: { not: "EXCLUDED" } } }),
    prisma.employee.findMany(),
  ]);
  const target = new Set(opts.emailIds ?? emails.map((e) => e.id));
  const empById = new Map(employees.map((e) => [e.id, e]));

  // 1. employee matching (skip manual assignments)
  const employeeOf = new Map<string, string | null>();
  for (const e of emails) {
    if (e.employeeManual || e.role !== "EMPLOYEE") { employeeOf.set(e.id, e.employeeId); continue; }
    const m = matchEmployee({ email: e.senderEmail, name: e.senderName }, employees);
    employeeOf.set(e.id, m.employee?.id ?? null);
  }

  // 2. business duplicates (employee emails only)
  const dupResult = await detector.find(
    emails
      .filter((e) => e.role === "EMPLOYEE")
      .map((e) => ({
        id: e.id,
        ownerKey: employeeOf.get(e.id) ?? (e.senderEmail || e.senderName || e.id),
        sentAt: e.sentAt ? e.sentAt.getTime() : null,
        subject: e.subject,
        body: e.body,
        entities: { incidents: csv(e.incidentIds), services: csv(e.serviceIds), circuits: csv(e.circuitIds), locations: csv(e.locations) },
      })),
    { similarityThreshold: settings.similarityThreshold, uncertainMargin: 15, windowHours: settings.duplicateWindowHours },
  );

  // 3. threads: NMC messages of the same conversation (may live in any month)
  const keys = [...new Set(emails.map((e) => e.conversationKey).filter(Boolean))];
  const nmcMsgs = keys.length
    ? await prisma.email.findMany({ where: { role: "NMC", conversationKey: { in: keys }, monthDecision: { not: "EXCLUDED" } } })
    : [];
  const threadByKey = new Map<string, ThreadMessage[]>();
  for (const m of nmcMsgs) {
    const arr = threadByKey.get(m.conversationKey) ?? [];
    arr.push({
      role: "NMC", senderEmail: m.senderEmail, senderName: m.senderName, to: m.toRecipients, cc: m.ccRecipients,
      subject: m.subject, body: m.body, sentAt: m.sentAt?.getTime() ?? null, isForward: m.isForward, isReply: m.isReply,
      incidentIds: csv(m.incidentIds),
    });
    threadByKey.set(m.conversationKey, arr);
  }

  const byId = new Map(emails.map((e) => [e.id, e]));
  const label = (id: string) => {
    const o = byId.get(id);
    if (!o) return "another employee";
    const emp = employeeOf.get(id) ? empById.get(employeeOf.get(id)!) : null;
    return emp?.name || o.senderName || o.senderEmail || "unknown sender";
  };

  // 4. classify + persist
  const updates: ReturnType<typeof prisma.email.update>[] = [];
  const counts = { analyzed: 0, skippedManual: 0 };
  for (const e of emails) {
    if (!target.has(e.id)) continue;
    counts.analyzed++;
    const employeeId = employeeOf.get(e.id) ?? null;
    const reasons: ReviewReason[] = [];
    const dup = dupResult.duplicates.get(e.id);
    const poss = dupResult.possible.get(e.id);

    const data: Record<string, unknown> = { employeeId };
    if (dup) {
      data.duplicateOfId = dup.originalId;
      data.duplicateSimilarity = dup.score;
    }

    if (e.role === "EMPLOYEE") {
      if (!employeeId) reasons.push("UNMATCHED_EMPLOYEE");
      if (!e.sentAt) reasons.push("DATE_INVALID");
      if (e.monthDecision === "REVIEW") reasons.push("OUTSIDE_MONTH");
      const uncertain = JSON.parse(e.uncertainFields || "[]") as string[];
      if (uncertain.includes("sender") && !employeeId) reasons.push("PARSE_UNCERTAIN");
    }

    if (e.isManual) {
      counts.skippedManual++;
      const r = reasons.filter((x) => x === "UNMATCHED_EMPLOYEE" || x === "OUTSIDE_MONTH" || x === "DATE_INVALID");
      data.reviewReasons = JSON.stringify(r);
      data.reviewStatus = r.length ? "NEEDS_REVIEW" : "REVIEWED";
    } else {
      const res = await classifier.classify({
        email: {
          body: e.body, subject: e.subject, sentAt: e.sentAt?.getTime() ?? null, incidentIds: csv(e.incidentIds),
          isForward: e.isForward, isReply: e.isReply, role: e.role as "EMPLOYEE" | "NMC",
        },
        thread: (threadByKey.get(e.conversationKey) ?? []),
        duplicate: dup ? { ...dup, originalLabel: label(dup.originalId) } : null,
        possibleDuplicate: poss ? { ...poss, originalLabel: label(poss.originalId) } : null,
        settings: { confidenceThreshold: settings.confidenceThreshold, teamKeywords: settings.teamKeywords },
      });
      const all = e.role === "NMC" ? [] : [...new Set([...reasons, ...res.reviewReasons])];
      Object.assign(data, {
        autoClass: res.classification, finalClass: res.classification, confidence: res.confidence, reason: res.reason,
        duplicateReason: dup ? res.reason : null,
        duplicateOfId: dup?.originalId ?? null, duplicateSimilarity: dup?.score ?? null,
        possibleDuplicateOfId: poss?.originalId ?? null, possibleDuplicateSim: poss?.score ?? null,
        reviewReasons: JSON.stringify(all), reviewStatus: all.length ? "NEEDS_REVIEW" : "OK",
      });
      if (e.role === "NMC") data.reviewStatus = "OK";
    }
    updates.push(prisma.email.update({ where: { id: e.id }, data }));
  }
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) await prisma.$transaction(updates.slice(i, i + CHUNK));

  if (opts.audit) {
    await logAudit("REANALYZED", "Email", "", `Re-analysed ${counts.analyzed} emails for ${year}-${String(month).padStart(2, "0")}${opts.resetManual ? " (manual decisions reset)" : ""}`, {
      year, month, emailIds: opts.emailIds ?? "all", resetManual: !!opts.resetManual, skippedManual: counts.skippedManual,
    });
  }
  return counts;
}

export const isCounted = (decision: string) => COUNTED.includes(decision);
export type { Classification };
