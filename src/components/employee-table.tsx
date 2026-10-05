"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { MonthlyStats } from "@/lib/reports/aggregate";
import { Badge, Input, Select, Td, Th } from "./ui";

type SortKey = "name" | "total" | "FORWARDED" | "NOT_USEFUL" | "DUPLICATE" | "PENDING_REVIEW" | "kpi";
export const ratingStyle: Record<string, string> = {
  EXCELLENT: "bg-emerald-100 text-emerald-800", GOOD: "bg-blue-100 text-blue-800", FAIR: "bg-amber-100 text-amber-800", POOR: "bg-red-100 text-red-800", "N/A": "bg-slate-100 text-slate-500",
};

export function EmployeeTable({ stats }: { stats: MonthlyStats }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [onlyWithEmails, setOnly] = useState(true);
  const [sort, setSort] = useState<SortKey>("total");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const depts = useMemo(() => [...new Set(stats.employees.map((e) => e.department).filter(Boolean))].sort(), [stats]);

  const rows = useMemo(() => {
    const val = (e: MonthlyStats["employees"][number]) =>
      sort === "name" ? e.name.toLowerCase() : sort === "total" ? e.kpi.total : sort === "kpi" ? (e.kpi.score ?? -1) : e.counts[sort];
    return stats.employees
      .filter((e) => (!onlyWithEmails || e.kpi.total > 0) && (!dept || e.department === dept) &&
        (!q || `${e.name} ${e.email} ${e.team}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1); });
  }, [stats, q, dept, onlyWithEmails, sort, dir]);

  const onSort = (k: string) => { if (k === sort) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k as SortKey); setDir(k === "name" ? "asc" : "desc"); } };
  const th = (k: SortKey, label: string, cls?: string) => <Th sort={k} active={sort === k} dir={dir} onSort={onSort} className={cls}>{label}</Th>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
        <Input placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-60" />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="max-w-48">
          <option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={onlyWithEmails} onChange={(e) => setOnly(e.target.checked)} /> Only employees with emails</label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr>{th("name", "Employee")}{th("total", "Total Emails", "text-right")}{th("FORWARDED", "Forwarded", "text-right")}{th("NOT_USEFUL", "Not Useful", "text-right")}{th("DUPLICATE", "Duplicate", "text-right")}{th("PENDING_REVIEW", "Pending", "text-right")}{th("kpi", "KPI", "text-right")}</tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.employeeId} className="hover:bg-slate-50">
                <Td><Link href={`/employees/${e.employeeId}`} className="font-medium text-blue-700 hover:underline">{e.name}</Link><div className="text-xs text-slate-400">{e.department}{e.team ? ` · ${e.team}` : ""}</div></Td>
                <Td className="text-right tabular-nums">{e.kpi.total}</Td>
                <Td className="text-right tabular-nums">{e.counts.FORWARDED}</Td>
                <Td className="text-right tabular-nums">{e.counts.NOT_USEFUL}</Td>
                <Td className="text-right tabular-nums">{e.counts.DUPLICATE}</Td>
                <Td className="text-right tabular-nums">{e.counts.PENDING_REVIEW}</Td>
                <Td className="text-right">{e.kpi.score == null ? <Badge className={ratingStyle["N/A"]}>n/a</Badge> : <Badge className={ratingStyle[e.kpi.rating]}>{e.kpi.score}</Badge>}</Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-400">No employees match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
