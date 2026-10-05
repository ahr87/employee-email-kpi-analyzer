import { prisma } from "../database/client";
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
  const base = { year, month, role: "EMPLOYEE", monthDecision: { in: COUNTED } };
  const [grouped, employees, unmatched, needsReview, outside, nmc] = await Promise.all([
    prisma.email.groupBy({ by: ["employeeId", "finalClass"], where: base, _count: true }),
    prisma.employee.findMany({ orderBy: { name: "asc" } }),
    prisma.email.count({ where: { ...base, employeeId: null } }),
    prisma.email.count({ where: { year, month, role: "EMPLOYEE", reviewStatus: "NEEDS_REVIEW", monthDecision: { not: "EXCLUDED" } } }),
    prisma.email.count({ where: { year, month, role: "EMPLOYEE", monthDecision: "REVIEW" } }),
    prisma.email.count({ where: { year, month, role: "NMC" } }),
  ]);
  const byEmp = new Map<string, ClassCounts>();
  const totals = emptyCounts();
  for (const g of grouped) {
    totals[g.finalClass as Classification] += g._count;
    if (!g.employeeId) continue;
    const c = byEmp.get(g.employeeId) ?? emptyCounts();
    c[g.finalClass as Classification] += g._count;
    byEmp.set(g.employeeId, c);
  }
  const rows: EmployeeStat[] = employees
    .filter((e) => e.active || byEmp.has(e.id))
    .map((e) => {
      const counts = byEmp.get(e.id) ?? emptyCounts();
      return { employeeId: e.id, empNo: e.employeeId, name: e.name, email: e.email, department: e.department, team: e.team, active: e.active, counts, kpi: computeKpi(counts, settings.kpi) };
    });
  return {
    year, month, totalEmployees: employees.filter((e) => e.active).length,
    totalEmails: Object.values(totals).reduce((a, b) => a + b, 0), counts: totals, unmatched, needsReview,
    outsideMonthPending: outside, nmcMessages: nmc, employees: rows,
  };
}

export async function monthsWithData() {
  const rows = await prisma.email.groupBy({ by: ["year", "month"], _count: true, orderBy: [{ year: "desc" }, { month: "desc" }] });
  return rows.map((r) => ({ year: r.year, month: r.month, emails: r._count }));
}

/** Per-month classification counts for a year, optionally for one employee. */
export async function trend(year: number, employeeId?: string) {
  const grouped = await prisma.email.groupBy({
    by: ["month", "finalClass"],
    where: { year, role: "EMPLOYEE", monthDecision: { in: COUNTED }, ...(employeeId ? { employeeId } : {}) },
    _count: true,
  });
  const settings = await getSettings();
  return Array.from({ length: 12 }, (_, i) => {
    const counts = emptyCounts();
    for (const g of grouped) if (g.month === i + 1) counts[g.finalClass as Classification] += g._count;
    const kpi = computeKpi(counts, settings.kpi);
    return { month: i + 1, total: kpi.total, score: kpi.score, ...counts };
  });
}
