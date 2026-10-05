import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database/client";
import { getSettings } from "../settings";
import { logAudit } from "../audit";
import { RuleBasedClassifier, type EmailClassifier, type ThreadMessage } from "../classification/classifier";
import { compilePhrases } from "../classification/phrases";
import { RuleBasedDuplicateDetector, type DuplicateDetector } from "../duplicate-detection/detector";
import { isNmcAddress, matchEmployee } from "../employees/matching";
import type { ReviewReason } from "../types";

export interface AnalyzeOptions {
  /** Only (re)analyse these emails (still uses the whole month as context). */
  emailIds?: string[];
  /** Also discard manual decisions (explicit full reset). */
  resetManual?: boolean;
  classifier?: EmailClassifier;
  detector?: DuplicateDetector;
  audit?: boolean;
}

const csv = (s: string) => (s ? s.split(",").filter(Boolean) : []);
const ym = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

const FIELDS = {
  id: true, batchId: true, year: true, month: true, senderName: true, senderEmail: true, toRecipients: true, ccRecipients: true,
  subject: true, sentAt: true, sentAtAlt: true, body: true, conversationKey: true, isForward: true, isReply: true, uncertainFields: true,
  incidentIds: true, serviceIds: true, circuitIds: true, locations: true, ipAddresses: true, devices: true,
  monthDecision: true, employeeId: true, employeeManual: true, isManual: true, role: true, kind: true, counted: true,
  autoClass: true, finalClass: true, confidence: true, reason: true, reviewStatus: true, reviewReasons: true,
  duplicateOfId: true, duplicateSimilarity: true, duplicateReason: true, possibleDuplicateOfId: true, possibleDuplicateSim: true,
} satisfies Prisma.EmailSelect;
type Row = Prisma.EmailGetPayload<{ select: typeof FIELDS }>;

/**
 * (Re)analyses one month. Derives, from stored data only: NMC/employee role, employee match, conversation
 * structure (report vs follow-up), business duplicates, classification and review reasons.
 * Manual decisions (approvals / overrides / manual employee assignment) are never touched unless `resetManual`.
 */
export async function analyzeMonth(year: number, month: number, opts: AnalyzeOptions = {}) {
  const settings = await getSettings();
  const classifier = opts.classifier ?? new RuleBasedClassifier();
  const detector = opts.detector ?? new RuleBasedDuplicateDetector();
  const phrases = compilePhrases(settings.phrases);
  const nmcEmails = settings.nmcAddresses.filter((n) => n.enabled && n.address.includes("@") && !n.address.startsWith("@")).map((n) => n.address.toLowerCase());

  if (opts.resetManual) {
    const ids = opts.emailIds;
    const reset = { isManual: false, overrideReason: null, overrideAt: null, employeeManual: false };
    if (!ids) await prisma.email.updateMany({ where: { year, month }, data: reset });
    else for (let i = 0; i < ids.length; i += 400) await prisma.email.updateMany({ where: { year, month, id: { in: ids.slice(i, i + 400) } }, data: reset });
  }

  const [monthRows, employees] = await Promise.all([
    prisma.email.findMany({ where: { year, month, monthDecision: { not: "EXCLUDED" } }, select: FIELDS }),
    prisma.employee.findMany(),
  ]);
  const inMonth = new Set(monthRows.map((e) => e.id));
  const keys = [...new Set(monthRows.map((e) => e.conversationKey).filter(Boolean))];
  // SQLite limits the number of bound parameters, so look related conversations up in chunks
  const extra: Row[] = [];
  for (let i = 0; i < keys.length; i += 400) {
    extra.push(...(await prisma.email.findMany({ where: { conversationKey: { in: keys.slice(i, i + 400) }, monthDecision: { not: "EXCLUDED" }, NOT: { year, month } }, select: FIELDS })));
  }
  const all: Row[] = [...monthRows, ...extra];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const target = new Set(opts.emailIds ?? monthRows.map((e) => e.id));

  // 1. role + employee matching
  const role = new Map<string, "NMC" | "EMPLOYEE">();
  const employeeOf = new Map<string, string | null>();
  for (const e of all) {
    const r = isNmcAddress(e.senderEmail, settings.nmcAddresses) ? "NMC" : "EMPLOYEE";
    role.set(e.id, r);
    if (r === "NMC") employeeOf.set(e.id, null);
    else if (e.employeeManual) employeeOf.set(e.id, e.employeeId);
    else employeeOf.set(e.id, matchEmployee({ email: e.senderEmail, name: e.senderName }, employees).employee?.id ?? null);
  }

  // 2. conversation structure: group by normalised subject; the first message is the report, replies/forwards and
  //    repeat messages by the same sender are follow-ups (evidence only, not counted).
  const byKey = new Map<string, Row[]>();
  for (const e of all) {
    const k = e.conversationKey || `__solo:${e.id}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
  }
  const kind = new Map<string, "REPORT" | "FOLLOW_UP" | "NMC">();
  const order = (a: Row, b: Row) => (a.sentAt && b.sentAt ? a.sentAt.getTime() - b.sentAt.getTime() : a.sentAt ? -1 : b.sentAt ? 1 : 0) || a.id.localeCompare(b.id);
  const senderKey = (e: Row) => (e.senderEmail || e.senderName).toLowerCase();
  for (const group of byKey.values()) {
    group.sort(order);
    const seenSenders = new Set<string>();
    group.forEach((e, i) => {
      if (role.get(e.id) === "NMC") { kind.set(e.id, "NMC"); return; }
      const sk = senderKey(e);
      const earlier = i > 0;
      const followUp = earlier && ((e.isReply || e.isForward) || (sk && seenSenders.has(sk)));
      kind.set(e.id, followUp ? "FOLLOW_UP" : "REPORT");
      if (sk) seenSenders.add(sk);
    });
  }

  // 3. business duplicates among counted reports of this month
  const reports = monthRows.filter((e) => kind.get(e.id) === "REPORT");
  const dupResult = await detector.find(
    reports.map((e) => ({
      id: e.id,
      ownerKey: employeeOf.get(e.id) ?? (e.senderEmail || e.senderName || e.id),
      sentAt: e.sentAt ? e.sentAt.getTime() : null,
      subject: e.subject,
      body: e.body,
      entities: { incidents: csv(e.incidentIds), services: csv(e.serviceIds), circuits: csv(e.circuitIds), ips: csv(e.ipAddresses), devices: csv(e.devices), locations: csv(e.locations) },
    })),
    { similarityThreshold: settings.similarityThreshold, uncertainMargin: 15, windowHours: settings.duplicateWindowHours },
  );

  const byId = new Map(all.map((e) => [e.id, e]));
  const label = (id: string) => {
    const o = byId.get(id);
    if (!o) return "another employee";
    const emp = employeeOf.get(id) ? empById.get(employeeOf.get(id)!) : null;
    return emp?.name || o.senderName || o.senderEmail || "unknown sender";
  };
  const threadMsg = (m: Row): ThreadMessage => {
    const k = kind.get(m.id);
    const r: ThreadMessage["role"] = role.get(m.id) === "NMC" ? "NMC" : k === "FOLLOW_UP" && !employeeOf.get(m.id) ? "OTHER" : "EMPLOYEE";
    return {
      id: m.id, role: r, senderEmail: m.senderEmail, senderName: m.senderName, to: m.toRecipients, cc: m.ccRecipients,
      subject: m.subject, body: m.body, sentAt: m.sentAt?.getTime() ?? null, isForward: m.isForward, isReply: m.isReply, incidentIds: csv(m.incidentIds),
    };
  };

  // 4. classify + persist
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  const stats = { analyzed: 0, skippedManual: 0, followUps: 0 };
  for (const e of monthRows) {
    if (!target.has(e.id)) continue;
    stats.analyzed++;
    const k = kind.get(e.id)!;
    const r = role.get(e.id)!;
    const employeeId = employeeOf.get(e.id) ?? null;
    const data: Prisma.EmailUncheckedUpdateInput = { employeeId, role: r, kind: k, counted: k === "REPORT" };

    if (k !== "REPORT") {
      if (k === "FOLLOW_UP") stats.followUps++;
      Object.assign(data, {
        autoClass: "OTHER", finalClass: "OTHER", confidence: 100, reviewStatus: "OK", reviewReasons: "[]", isManual: false,
        reason: k === "NMC" ? "NMC message — used as evidence for the employee emails of this conversation; not counted." : "Follow-up message in an existing conversation — used as evidence; not counted as a separate email.",
        duplicateOfId: null, duplicateSimilarity: null, duplicateReason: null, possibleDuplicateOfId: null, possibleDuplicateSim: null,
      });
      if (e.isManual && k === "FOLLOW_UP") delete (data as Record<string, unknown>).isManual;
      updates.push(...maybeUpdate(e, data));
      continue;
    }

    const reasons: ReviewReason[] = [];
    const dup = dupResult.duplicates.get(e.id);
    const poss = dupResult.possible.get(e.id);
    if (!employeeId) reasons.push("UNMATCHED_EMPLOYEE");
    if (!e.sentAt) reasons.push("DATE_INVALID");
    if (e.monthDecision === "REVIEW") reasons.push("OUTSIDE_MONTH");
    if (e.sentAt && e.sentAtAlt && ym(e.sentAt) !== ym(e.sentAtAlt) && (ym(e.sentAt) === year * 12 + month - 1 || ym(e.sentAtAlt) === year * 12 + month - 1)) reasons.push("DATE_AMBIGUOUS");
    const uncertain = JSON.parse(e.uncertainFields || "[]") as string[];
    if (uncertain.includes("sender") && !employeeId) reasons.push("PARSE_UNCERTAIN");

    if (e.isManual) {
      stats.skippedManual++;
      const keep = reasons.filter((x) => ["UNMATCHED_EMPLOYEE", "OUTSIDE_MONTH", "DATE_INVALID", "DATE_AMBIGUOUS"].includes(x));
      Object.assign(data, { reviewReasons: JSON.stringify(keep), reviewStatus: keep.length ? "NEEDS_REVIEW" : "REVIEWED" });
    } else {
      const thread = (byKey.get(e.conversationKey || `__solo:${e.id}`) ?? []).filter((m) => m.id !== e.id).map(threadMsg);
      const res = await classifier.classify({
        email: { senderEmail: e.senderEmail, body: e.body, subject: e.subject, sentAt: e.sentAt?.getTime() ?? null, incidentIds: csv(e.incidentIds), role: r },
        thread,
        duplicate: dup ? { ...dup, originalLabel: label(dup.originalId) } : null,
        possibleDuplicate: poss ? { ...poss, originalLabel: label(poss.originalId) } : null,
        settings: { confidenceThreshold: settings.confidenceThreshold, teamKeywords: settings.teamKeywords, phrases, nmcEmails },
      });
      const all2 = [...new Set([...reasons, ...res.reviewReasons])];
      const origId = res.duplicateOriginalId ?? dup?.originalId ?? null;
      Object.assign(data, {
        autoClass: res.classification, finalClass: res.classification, confidence: res.confidence, reason: res.reason,
        duplicateOfId: res.classification === "DUPLICATE" ? origId : null,
        duplicateSimilarity: res.classification === "DUPLICATE" ? (dup?.score ?? null) : null,
        duplicateReason: res.classification === "DUPLICATE" ? res.reason : null,
        possibleDuplicateOfId: poss?.originalId ?? null, possibleDuplicateSim: poss?.score ?? null,
        reviewReasons: JSON.stringify(all2), reviewStatus: all2.length ? "NEEDS_REVIEW" : "OK",
      });
    }
    updates.push(...maybeUpdate(e, data));
  }
  const CHUNK = 400;
  for (let i = 0; i < updates.length; i += CHUNK) await prisma.$transaction(updates.slice(i, i + CHUNK));
  void inMonth;

  if (opts.audit) {
    await logAudit("REANALYZED", "Email", "", `Re-analysed ${stats.analyzed} emails for ${year}-${String(month).padStart(2, "0")}${opts.resetManual ? " (manual decisions reset)" : ""}`, {
      year, month, emailIds: opts.emailIds ?? "all", resetManual: !!opts.resetManual, skippedManual: stats.skippedManual,
    });
  }
  return stats;
}

/** Skips the write when nothing changed (keeps large re-analyses fast). */
function maybeUpdate(row: Row, data: Prisma.EmailUncheckedUpdateInput): Prisma.PrismaPromise<unknown>[] {
  const cur = row as unknown as Record<string, unknown>;
  const changed = Object.entries(data).some(([k, v]) => cur[k] !== v && !(cur[k] == null && v == null));
  return changed ? [prisma.email.update({ where: { id: row.id }, data })] : [];
}

/** Re-analyses every month that has data (used after settings such as NMC addresses or phrases change). */
export async function analyzeAllMonths() {
  const months = await prisma.email.groupBy({ by: ["year", "month"] });
  for (const m of months) await analyzeMonth(m.year, m.month);
  return months.length;
}
