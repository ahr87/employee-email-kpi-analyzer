"use client";
import Link from "next/link";
import { use, useState } from "react";
import { fmtDate, useApi } from "@/lib/client";
import { useMonth } from "@/components/month";
import { Badge, Button, Card, CardHeader, ClassBadge, ConfBadge, EmptyState, ErrorState, Spinner, Td, Th } from "@/components/ui";
import { ReasonBadges } from "@/components/email-actions";
import { TrendStack, VolumeVsQuality } from "@/components/charts";
import { ratingStyle } from "@/components/employee-table";
import { MONTH_NAMES } from "@/lib/types";
import type { MonthlyStats } from "@/lib/reports/aggregate";
import type { listEmails } from "@/lib/import/emails";

type Emails = Awaited<ReturnType<typeof listEmails>>;
type Trend = { months: ({ month: number; total: number; score: number | null; FORWARDED: number; NOT_USEFUL: number; DUPLICATE: number; PENDING_REVIEW: number; OTHER: number })[] };

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { year, month, ready } = useMonth();
  const [page, setPage] = useState(1);
  const emp = useApi<{ id: string; employeeId: string; name: string; email: string; department: string; team: string; active: boolean }>(`/api/employees/${id}`);
  const stats = useApi<MonthlyStats>(ready ? `/api/dashboard?year=${year}&month=${month}` : null);
  const emails = useApi<Emails>(ready ? `/api/emails?employeeId=${id}&year=${year}&month=${month}&page=${page}&pageSize=25&sort=sentAt&dir=asc` : null);
  const trend = useApi<Trend>(ready ? `/api/trend?year=${year}&employeeId=${id}` : null);

  if (emp.loading) return <Spinner />;
  if (emp.error || !emp.data) return <Card><ErrorState message={emp.error ?? "Employee not found"} onRetry={emp.reload} /></Card>;
  const e = emp.data;
  const row = stats.data?.employees.find((r) => r.employeeId === id);
  const c = row?.counts;
  const pages = emails.data ? Math.max(1, Math.ceil(emails.data.total / emails.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/employees" className="text-xs text-blue-700 hover:underline">← Employees</Link>
        <h1 className="mt-1 text-2xl font-semibold">{e.name} {!e.active && <Badge className="bg-slate-200 text-slate-600">Inactive</Badge>}</h1>
        <p className="text-sm text-slate-500">{e.email} · {e.department || "no department"}{e.team ? ` · ${e.team}` : ""} · <strong>{MONTH_NAMES[month - 1]} {year}</strong></p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[["Total", row?.kpi.total ?? 0], ["Forwarded", c?.FORWARDED ?? 0], ["Not Useful", c?.NOT_USEFUL ?? 0], ["Duplicate", c?.DUPLICATE ?? 0], ["Pending", c?.PENDING_REVIEW ?? 0]].map(([l, v]) => (
          <Card key={l as string} className="p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-semibold tabular-nums">{v}</div></Card>
        ))}
        <Card className="p-4"><div className="text-xs text-slate-500">KPI score</div><div className="mt-1">{row?.kpi.score == null ? <span className="text-slate-400">n/a</span> : <Badge className={`${ratingStyle[row.kpi.rating]} text-base`}>{row.kpi.score}</Badge>}</div></Card>
      </div>
      {trend.data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader title={`${year} — emails by month and outcome`} /><div className="p-2"><TrendStack months={trend.data.months} /></div></Card>
          <Card><CardHeader title="Volume vs. quality" /><div className="p-2"><VolumeVsQuality months={trend.data.months} /></div></Card>
        </div>
      )}
      <Card>
        <CardHeader title="Emails this month" />
        {emails.loading && !emails.data ? <Spinner /> : emails.error ? <ErrorState message={emails.error} onRetry={emails.reload} /> : !emails.data?.rows.length ? <EmptyState title="No emails for this employee in this month" /> : (
          <>
            <div className="overflow-x-auto"><table className="w-full">
              <thead><tr><Th>Date</Th><Th>Subject</Th><Th>Classification</Th><Th>Confidence</Th><Th>Duplicate of</Th><Th>Review</Th></tr></thead>
              <tbody>{emails.data.rows.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap">{fmtDate(m.sentAt)}</Td>
                  <Td><Link href={`/emails/${m.id}`} className="font-medium hover:text-blue-700">{m.subject || "(no subject)"}</Link></Td>
                  <Td><ClassBadge value={m.finalClass} /></Td><Td><ConfBadge value={m.confidence} /></Td>
                  <Td>{m.duplicateOf ? <Link className="text-xs text-violet-700 hover:underline" href={`/emails/${m.duplicateOf.id}`}>{m.duplicateOf.employee?.name ?? m.duplicateOf.senderName} · {m.duplicateSimilarity}%</Link> : "—"}</Td>
                  <Td>{m.reviewStatus === "NEEDS_REVIEW" ? <ReasonBadges json={m.reviewReasons} /> : <Badge className="bg-slate-100 text-slate-600">{m.reviewStatus === "REVIEWED" ? "Reviewed" : "OK"}</Badge>}</Td>
                </tr>))}</tbody></table></div>
            {emails.data.total > emails.data.pageSize && <div className="flex items-center justify-between border-t p-3 text-sm"><span>Page {page} of {pages}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
          </>
        )}
      </Card>
    </div>
  );
}
