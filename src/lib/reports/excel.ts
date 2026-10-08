import type ExcelJS from "exceljs";
import { getDb } from "../db";
import { loadExcelJS } from "./exceljs";
import { monthlyStats, type EmployeeStat } from "./aggregate";
import { CLASS_LABELS, CLASSES, MONTH_NAMES, REVIEW_REASON_LABELS, type Classification, type ReviewReason } from "../types";
import { toCsv } from "./csv";

const NAVY = "FF1F3A5F";
const RATING_FILL: Record<string, string> = { EXCELLENT: "FFD1FAE5", GOOD: "FFDBEAFE", FAIR: "FFFEF3C7", POOR: "FFFEE2E2", "N/A": "FFF1F5F9" };

function header(ws: ExcelJS.Worksheet, rowNo: number, widths: number[], filter = true) {
  const h = ws.getRow(rowNo);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  h.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  h.height = 30;
  ws.views = [{ state: "frozen", ySplit: rowNo }];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  if (filter) ws.autoFilter = { from: { row: rowNo, column: 1 }, to: { row: rowNo, column: widths.length } };
}
const fillRating = (cell: ExcelJS.Cell, rating: string) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RATING_FILL[rating] ?? RATING_FILL["N/A"] } };
  cell.alignment = { horizontal: "center" };
};

export async function emailDetailRows(year: number, month: number, onlyReview = false) {
  const db = await getDb();
  const emails = db.emails.all()
    .filter((e) => e.year === year && e.month === month && e.counted && e.monthDecision !== "EXCLUDED" && (!onlyReview || e.reviewStatus === "NEEDS_REVIEW"))
    .sort((a, b) => (a.sentAt?.getTime() ?? Infinity) - (b.sentAt?.getTime() ?? Infinity));
  return emails.map((e) => {
    const emp = db.employees.get(e.employeeId);
    const orig = db.emails.get(e.duplicateOfId);
    const origEmp = db.employees.get(orig?.employeeId);
    return {
      date: e.sentAt ? e.sentAt.toISOString().replace("T", " ").slice(0, 16) : "",
      employee: emp?.name ?? "(unmatched)", employeeEmail: emp?.email ?? e.senderEmail,
      department: emp?.department ?? "", team: emp?.team ?? "", subject: e.subject,
      classification: CLASS_LABELS[e.finalClass as Classification] ?? e.finalClass,
      suggested: CLASS_LABELS[e.autoClass as Classification] ?? e.autoClass, confidence: e.isManual ? "manual" : e.confidence,
      manual: e.isManual ? "Yes" : "No", overrideReason: e.overrideReason ?? "", reason: e.reason,
      duplicateOf: orig ? `${origEmp?.name ?? orig.senderName} — ${orig.subject}` : "",
      similarity: e.duplicateSimilarity ?? "",
      reviewStatus: e.reviewStatus === "NEEDS_REVIEW" ? "Needs review" : e.reviewStatus === "REVIEWED" ? "Reviewed" : "OK",
      reviewReasons: (JSON.parse(e.reviewReasons || "[]") as ReviewReason[]).map((r) => REVIEW_REASON_LABELS[r] ?? r).join("; "),
      batch: db.batches.get(e.batchId)?.number ?? 0, source: db.batches.get(e.batchId)?.source ?? "Paste", monthDecision: e.monthDecision === "INCLUDED" ? "Included manually" : e.monthDecision === "IN_MONTH" ? "In month" : e.monthDecision,
    };
  });
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : 0);

export async function summaryRows(year: number, month: number) {
  const s = await monthlyStats(year, month);
  const emps = s.employees.filter((e) => e.kpi.total > 0).sort((a, b) => a.name.localeCompare(b.name));
  return { stats: s, emps };
}
const SUMMARY_HEAD = ["Employee", "Department", "Team", "Total Emails", "Forwarded", "Not Useful", "Duplicate", "Pending", "Other", "KPI Score", "Rating"];
const rowOf = (e: EmployeeStat) => [e.name, e.department, e.team, e.kpi.total, e.counts.FORWARDED, e.counts.NOT_USEFUL, e.counts.DUPLICATE, e.counts.PENDING_REVIEW, e.counts.OTHER, e.kpi.score ?? "n/a", e.kpi.rating];

export async function monthlyCsv(year: number, month: number): Promise<string> {
  const { emps } = await summaryRows(year, month);
  return toCsv([[...SUMMARY_HEAD, "Status"], ...emps.map((e) => [...rowOf(e), e.kpi.status.replace(/_/g, " ")])]);
}

export async function monthlyXlsx(year: number, month: number): Promise<Uint8Array> {
  const { stats, emps } = await summaryRows(year, month);
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Employee Email KPI Analyzer";
  const title = `${MONTH_NAMES[month - 1]} ${year}`;

  // 1. Summary — one screen for management
  const s = wb.addWorksheet("Summary", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  s.mergeCells("A1:K1");
  s.getCell("A1").value = `Employee Email KPI — ${title}`;
  s.getCell("A1").font = { bold: true, size: 16, color: { argb: NAVY } };
  s.mergeCells("A2:K2");
  s.getCell("A2").value = "Quality score is based on FINAL classifications (after manual review). Total Emails is volume only and is not rewarded by the score.";
  s.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };
  const kpis: [string, number | string][] = [
    ["Total emails", stats.totalEmails], ["Forwarded / escalated", stats.counts.FORWARDED], ["Not useful / replied", stats.counts.NOT_USEFUL],
    ["Duplicate", stats.counts.DUPLICATE], ["Pending review", stats.counts.PENDING_REVIEW], ["Other", stats.counts.OTHER],
    ["Unmatched senders", stats.unmatched], ["Still need review", stats.needsReview],
  ];
  kpis.forEach(([k, v], i) => {
    const r = 4 + Math.floor(i / 4), c = 1 + (i % 4) * 2;
    s.getCell(r, c).value = k; s.getCell(r, c).font = { color: { argb: "FF64748B" } };
    s.getCell(r, c + 1).value = v; s.getCell(r, c + 1).font = { bold: true, size: 14 };
  });
  const hr = 8;
  SUMMARY_HEAD.forEach((h, i) => (s.getCell(hr, i + 1).value = h));
  for (const e of emps) s.addRow(rowOf(e));
  const tot = s.addRow(["TOTAL", "", "", stats.totalEmails, stats.counts.FORWARDED, stats.counts.NOT_USEFUL, stats.counts.DUPLICATE, stats.counts.PENDING_REVIEW, stats.counts.OTHER, "", ""]);
  tot.font = { bold: true };
  tot.eachCell((c) => (c.border = { top: { style: "thin" } }));
  header(s, hr, [30, 18, 16, 13, 12, 12, 12, 10, 9, 11, 12]);
  s.eachRow((row, n) => {
    if (n <= hr) return;
    row.eachCell((c, col) => { if (col >= 4 && col <= 10) c.alignment = { horizontal: "center" }; });
    const rating = String(row.getCell(11).value ?? "");
    if (RATING_FILL[rating]) fillRating(row.getCell(11), rating);
  });

  // 2. Employee Details — shares and quality indicators, volume kept apart from quality
  const d = wb.addWorksheet("Employee Details");
  d.addRow(["Employee", "Email", "Department", "Team", "Active", "Total Emails (volume)", "Forwarded", "Not Useful", "Duplicate", "Pending", "Other",
    "Forwarded %", "Not Useful %", "Duplicate %", "Pending %", "Avoidable % (not useful + duplicate)", "KPI Score (quality)", "Rating", "Status"]);
  for (const e of emps) {
    const t = e.kpi.total, c = e.counts;
    d.addRow([e.name, e.email, e.department, e.team, e.active ? "Yes" : "No", t, c.FORWARDED, c.NOT_USEFUL, c.DUPLICATE, c.PENDING_REVIEW, c.OTHER,
      pct(c.FORWARDED, t), pct(c.NOT_USEFUL, t), pct(c.DUPLICATE, t), pct(c.PENDING_REVIEW, t), pct(c.NOT_USEFUL + c.DUPLICATE, t), e.kpi.score ?? "n/a", e.kpi.rating, e.kpi.status.replace(/_/g, " ")]);
  }
  header(d, 1, [28, 30, 18, 16, 8, 14, 11, 11, 11, 10, 9, 12, 12, 12, 12, 18, 14, 12, 18]);
  d.eachRow((row, n) => {
    if (n === 1) return;
    for (let col = 12; col <= 16; col++) row.getCell(col).numFmt = "0.0%";
    fillRating(row.getCell(18), String(row.getCell(18).value));
  });

  // 3. Email Details (no bodies)
  const detailHead = ["Date", "Employee", "Employee Email", "Department", "Team", "Subject", "Final Classification", "System Suggestion", "Confidence %", "Manual Decision", "Override Reason", "Reason", "Duplicate Of", "Similarity %", "Review Status", "Review Reasons", "Batch", "Source", "Month Decision"];
  const widths = [17, 24, 28, 16, 16, 42, 22, 22, 12, 11, 24, 60, 42, 11, 14, 36, 8, 15, 16];
  const fillDetail = async (ws: ExcelJS.Worksheet, onlyReview: boolean) => {
    ws.addRow(detailHead);
    for (const r of await emailDetailRows(year, month, onlyReview)) ws.addRow(Object.values(r));
    header(ws, 1, widths);
    ws.getColumn(6).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(12).alignment = { wrapText: true, vertical: "top" };
  };
  await fillDetail(wb.addWorksheet("Email Details"), false);

  // 4. Classification Summary
  const c = wb.addWorksheet("Classification Summary");
  c.addRow(["Classification", "Emails", "Share"]);
  for (const k of CLASSES) c.addRow([CLASS_LABELS[k], stats.counts[k], pct(stats.counts[k], stats.totalEmails)]);
  c.addRow(["Total", stats.totalEmails, stats.totalEmails ? 1 : 0]).font = { bold: true };
  c.addRow([]);
  c.addRow(["Unmatched senders", stats.unmatched]);
  c.addRow(["Emails still needing review", stats.needsReview]);
  c.addRow(["Out-of-month emails awaiting a decision", stats.outsideMonthPending]);
  c.addRow(["NMC messages used as evidence", stats.nmcMessages]);
  c.addRow(["Messages from other senders (Outlook import, not counted)", stats.externalMessages]);
  header(c, 1, [58, 12, 12], false);
  for (let r = 2; r <= 7; r++) c.getCell(r, 3).numFmt = "0.0%";

  // 5. Review Required
  await fillDetail(wb.addWorksheet("Review Required"), true);

  // 6. Employees
  const e = wb.addWorksheet("Employees");
  e.addRow(["Employee ID", "Name", "Email", "Department", "Team", "Active"]);
  for (const x of (await getDb()).employees.all().sort((a, b) => a.name.localeCompare(b.name))) e.addRow([x.employeeId, x.name, x.email, x.department, x.team, x.active ? "Yes" : "No"]);
  header(e, 1, [14, 28, 32, 18, 18, 8]);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
