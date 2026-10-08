import { getDb } from "../db";
import { getSettings } from "../settings";
import { computeKpi, emptyCounts, type ClassCounts, type KpiResult } from "../kpi/engine";
import type { Classification } from "../types";

const COUNTED = ["IN_MONTH", "INCLUDED"];

export interface EmployeeStat {
  employeeId: string; empNo: string; name: string; email: string; department: string; team: string; active: boolean;
  counts: ClassCounts; kpi: KpiResult;
}

export interface MonthlyStats {
  year: number; month: number;
  totalEmployees: number;
  totalEmails: number;
  counts: ClassCounts;
  unmatched: number;
  needsReview: number;
  outsideMonthPending: number;
  nmcMessages: number;
  employees: EmployeeStat[];
}

/** Aggregates FINAL classifications for one month; KPI is computed by the separate KPI engine. */
export async function monthlyStats(year: number, month: number): Promise<MonthlyStats> {
  const settings = await getSettings();
  const db = await getDb();
  const inMonth = db.emails.all().filter((e) => e.year === year && e.month === month);
  const counted = inMonth.filter((e) => e.counted && COUNTED.includes(e.monthDecision));

  const byEmp = new Map<string, ClassCounts>();
  const totals = emptyCounts();
  let unmatched = 0;
  for (const e of counted) {
    totals[e.finalClass as Classification]++;
    if (!e.employeeId) { unmatched++; continue; }
    const c = byEmp.get(e.employeeId) ?? emptyCounts();
    c[e.finalClass as Classification]++;
    byEmp.set(e.employeeId, c);
  }
  const employees = db.employees.all().sort((a, b) => a.name.localeCompare(b.name));
  const rows: EmployeeStat[] = employees
    .filter((e) => e.active || byEmp.has(e.id))
    .map((e) => {
      const counts = byEmp.get(e.id) ?? emptyCounts();
      return { employeeId: e.id, empNo: e.employeeId, name: e.name, email: e.email, department: e.department, team: e.team, active: e.active, counts, kpi: computeKpi(counts, settings.kpi) };
    });
  return {
    year, month, totalEmployees: employees.filter((e) => e.active).length,
    totalEmails: counted.length, counts: totals, unmatched,
    needsReview: inMonth.filter((e) => e.counted && e.reviewStatus === "NEEDS_REVIEW" && e.monthDecision !== "EXCLUDED").length,
    outsideMonthPending: inMonth.filter((e) => e.counted && e.monthDecision === "REVIEW").length,
    nmcMessages: inMonth.filter((e) => e.kind === "NMC").length,
    employees: rows,
  };
}

export async function monthsWithData() {
  const db = await getDb();
  const m = new Map<string, { year: number; month: number; emails: number }>();
  for (const e of db.emails.all()) {
    const k = `${e.year}-${e.month}`;
    const cur = m.get(k) ?? { year: e.year, month: e.month, emails: 0 };
    cur.emails++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

/** Per-month classification counts for a year, optionally for one employee. */
export async function trend(year: number, employeeId?: string) {
  const db = await getDb();
  const settings = await getSettings();
  const rows = db.emails.all().filter((e) => e.year === year && e.counted && COUNTED.includes(e.monthDecision) && (!employeeId || e.employeeId === employeeId));
  return Array.from({ length: 12 }, (_, i) => {
    const counts = emptyCounts();
    for (const e of rows) if (e.month === i + 1) counts[e.finalClass as Classification]++;
    const kpi = computeKpi(counts, settings.kpi);
    return { month: i + 1, total: kpi.total, score: kpi.score, ...counts };
  });
}

/** Everything the dashboard needs for one month. */
export async function dashboard(year: number, month: number) {
  const db = await getDb();
  const stats = await monthlyStats(year, month);
  return { ...stats, batches: db.batches.all().filter((b) => b.year === year && b.month === month).length };
}

/** True while nothing at all has been stored yet (first run). */
export async function isEmptyApp() {
  const db = await getDb();
  return db.employees.size === 0 && db.emails.size === 0;
}
