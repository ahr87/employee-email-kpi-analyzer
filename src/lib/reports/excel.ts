import ExcelJS from "exceljs";
import { prisma } from "../database/client";
import { monthlyStats } from "./aggregate";
import { CLASS_LABELS, CLASSES, MONTH_NAMES, REVIEW_REASON_LABELS, type Classification, type ReviewReason } from "../types";
import { toCsv } from "./csv";

const HEAD = { bold: true, color: { argb: "FFFFFFFF" } } as const;

function style(ws: ExcelJS.Worksheet, widths: number[]) {
  const h = ws.getRow(1);
  h.font = HEAD;
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  h.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
}

export async function emailDetailRows(year: number, month: number, onlyReview = false) {
  const emails = await prisma.email.findMany({
    where: { year, month, role: "EMPLOYEE", monthDecision: { not: "EXCLUDED" }, ...(onlyReview ? { reviewStatus: "NEEDS_REVIEW" } : {}) },
    include: { employee: true, batch: { select: { number: true } }, duplicateOf: { include: { employee: true } } },
    orderBy: { sentAt: "asc" },
  });
  return emails.map((e) => ({
    date: e.sentAt ? e.sentAt.toISOString().replace("T", " ").slice(0, 16) : "",
    employee: e.employee?.name ?? "(unmatched)", employeeEmail: e.employee?.email ?? e.senderEmail,
    department: e.employee?.department ?? "", team: e.employee?.team ?? "", subject: e.subject,
    classification: CLASS_LABELS[e.finalClass as Classification] ?? e.finalClass,
    autoClass: CLASS_LABELS[e.autoClass as Classification] ?? e.autoClass, confidence: e.confidence,
    manual: e.isManual ? "Yes" : "No", overrideReason: e.overrideReason ?? "", reason: e.reason,
    duplicateOf: e.duplicateOf ? `${e.duplicateOf.employee?.name ?? e.duplicateOf.senderName} — ${e.duplicateOf.subject}` : "",
    similarity: e.duplicateSimilarity ?? "",
    reviewStatus: e.reviewStatus,
    reviewReasons: (JSON.parse(e.reviewReasons || "[]") as ReviewReason[]).map((r) => REVIEW_REASON_LABELS[r] ?? r).join("; "),
    batch: e.batch.number, monthDecision: e.monthDecision,
  }));
}

export async function summaryRows(year: number, month: number) {
  const s = await monthlyStats(year, month);
  const rows = s.employees.map((e) => [
    e.name, e.email, e.department, e.team, e.counts.FORWARDED + e.counts.NOT_USEFUL + e.counts.DUPLICATE + e.counts.PENDING_REVIEW + e.counts.OTHER,
    e.counts.FORWARDED, e.counts.NOT_USEFUL, e.counts.DUPLICATE, e.counts.PENDING_REVIEW, e.counts.OTHER,
    e.kpi.score ?? "", e.kpi.rating, e.kpi.status.replace(/_/g, " "),
  ]);
  return { stats: s, rows };
}
const SUMMARY_HEAD = ["Employee", "Email", "Department", "Team", "Total Emails", "Forwarded", "Not Useful", "Duplicate", "Pending", "Other", "KPI Score", "Rating", "Status"];

export async function monthlyCsv(year: number, month: number): Promise<string> {
  const { rows } = await summaryRows(year, month);
  return toCsv([SUMMARY_HEAD, ...rows]);
}

export async function monthlyXlsx(year: number, month: number): Promise<Buffer> {
  const { stats, rows } = await summaryRows(year, month);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Employee Email KPI Analyzer";
  const title = `${MONTH_NAMES[month - 1]} ${year}`;

  const s = wb.addWorksheet("Summary");
  s.addRow(SUMMARY_HEAD);
  for (const r of rows) s.addRow(r);
  const tot = s.addRow(["TOTAL", "", "", "", stats.totalEmails, stats.counts.FORWARDED, stats.counts.NOT_USEFUL, stats.counts.DUPLICATE, stats.counts.PENDING_REVIEW, stats.counts.OTHER, "", "", ""]);
  tot.font = { bold: true };
  style(s, [26, 30, 18, 18, 13, 11, 11, 11, 10, 9, 11, 12, 18]);
  s.addRow([]);
  s.addRow([`Month: ${title}. KPI Score measures email QUALITY from final classifications; Total Emails is volume only.`]);

  const d = wb.addWorksheet("Email Details");
  d.addRow(["Date", "Employee", "Employee Email", "Department", "Team", "Subject", "Final Classification", "System Classification", "Confidence %", "Manual Decision", "Override Reason", "Reason", "Duplicate Of", "Similarity %", "Review Status", "Review Reasons", "Batch", "Month Decision"]);
  for (const r of await emailDetailRows(year, month)) d.addRow(Object.values(r));
  style(d, [17, 24, 28, 16, 16, 40, 22, 22, 12, 12, 24, 60, 40, 11, 14, 36, 8, 14]);

  const c = wb.addWorksheet("Classification Summary");
  c.addRow(["Classification", "Emails", "Share %"]);
  for (const k of CLASSES) c.addRow([CLASS_LABELS[k], stats.counts[k], stats.totalEmails ? Math.round((stats.counts[k] / stats.totalEmails) * 1000) / 10 : 0]);
  c.addRow(["Total", stats.totalEmails, 100]).font = { bold: true };
  c.addRow([]);
  c.addRow(["Unmatched employees", stats.unmatched]);
  c.addRow(["Emails needing review", stats.needsReview]);
  style(c, [28, 12, 12]);

  const r = wb.addWorksheet("Review Required");
  r.addRow(["Date", "Employee", "Employee Email", "Department", "Team", "Subject", "Final Classification", "System Classification", "Confidence %", "Manual Decision", "Override Reason", "Reason", "Duplicate Of", "Similarity %", "Review Status", "Review Reasons", "Batch", "Month Decision"]);
  for (const x of await emailDetailRows(year, month, true)) r.addRow(Object.values(x));
  style(r, [17, 24, 28, 16, 16, 40, 22, 22, 12, 12, 24, 60, 40, 11, 14, 36, 8, 14]);

  const e = wb.addWorksheet("Employees");
  e.addRow(["Employee ID", "Name", "Email", "Department", "Team", "Active"]);
  for (const x of await prisma.employee.findMany({ orderBy: { name: "asc" } })) e.addRow([x.employeeId, x.name, x.email, x.department, x.team, x.active ? "Yes" : "No"]);
  style(e, [14, 26, 30, 18, 18, 8]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
