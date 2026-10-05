"use client";
import Link from "next/link";
import { ClipboardPaste, AlertCircle } from "lucide-react";
import { useApi } from "@/lib/client";
import { useMonth } from "@/components/month";
import { Button, Card, CardHeader, EmptyState, ErrorState, Spinner, Badge } from "@/components/ui";
import { ClassPie, EmployeeStackedBar, TrendStack, VolumeVsQuality } from "@/components/charts";
import { EmployeeTable, ratingStyle } from "@/components/employee-table";
import { MONTH_NAMES } from "@/lib/types";
import type { MonthlyStats } from "@/lib/reports/aggregate";

type Trend = { months: ({ month: number; total: number; score: number | null; FORWARDED: number; NOT_USEFUL: number; DUPLICATE: number; PENDING_REVIEW: number; OTHER: number })[] };

function Stat({ label, value, href, tone, sub, highlight }: { label: string; value: number; href?: string; tone?: string; sub?: string; highlight?: boolean }) {
  const body = (
    <Card className={`p-4 transition hover:shadow ${highlight ? "border-red-300 ring-1 ring-red-200" : ""}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Dashboard() {
  const { year, month, ready } = useMonth();
  const { data, error, loading, reload } = useApi<MonthlyStats & { batches: number }>(ready ? `/api/dashboard?year=${year}&month=${month}` : null);
  const trend = useApi<Trend>(ready ? `/api/trend?year=${year}` : null);

  const header = (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Employee Email KPI</h1>
        <p className="text-sm text-slate-500">Month: <strong>{MONTH_NAMES[month - 1]} {year}</strong>{data ? ` · ${data.batches} batch(es) imported` : ""}</p>
      </div>
      <Link href="/import"><Button><ClipboardPaste className="h-4 w-4" />Paste Outlook emails</Button></Link>
    </div>
  );
  if (!ready || loading) return <>{header}<Spinner /></>;
  if (error || !data) return <>{header}<Card><ErrorState message={error ?? "Could not load dashboard."} onRetry={reload} /></Card></>;
  if (data.totalEmails === 0 && data.needsReview === 0) {
    return (
      <>{header}
        <Card><EmptyState title="No emails analyzed for this month yet" hint="Copy emails from Outlook, paste them on the import page and click Analyze. Or load the synthetic demo data from Settings to explore the app." action={<Link href="/import"><Button>Paste &amp; Analyze</Button></Link>} /></Card>
      </>
    );
  }
  const scored = data.employees.filter((e) => e.kpi.score != null && e.kpi.total > 0).sort((a, b) => b.kpi.score! - a.kpi.score!);
  const top = scored.slice(0, 3), low = [...scored].reverse().slice(0, 3);
  const useful = data.counts.FORWARDED + data.counts.OTHER;
  const qs = `year=${year}&month=${month}`;

  return (
    <div className="space-y-5">
      {header}
      {data.needsReview > 0 && (
        <Link href="/review" className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-orange-800 hover:bg-orange-100">
          <AlertCircle className="h-4 w-4" /> <strong>{data.needsReview}</strong> email(s) require manual review before the KPI is final →
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total Emails" value={data.totalEmails} href={`/emails?${qs}`} sub={`from ${data.employees.filter((e) => e.kpi.total > 0).length} of ${data.totalEmployees} employees`} />
        <Stat label="Useful / Forwarded" value={data.counts.FORWARDED + data.counts.OTHER} href={`/emails?${qs}&classification=FORWARDED`} tone="text-emerald-700" />
        <Stat label="Not Useful" value={data.counts.NOT_USEFUL} href={`/emails?${qs}&classification=NOT_USEFUL`} tone="text-amber-700" />
        <Stat label="Duplicate" value={data.counts.DUPLICATE} href={`/emails?${qs}&classification=DUPLICATE`} tone="text-violet-700" />
        <Stat label="Pending Review" value={data.counts.PENDING_REVIEW} href={`/emails?${qs}&classification=PENDING_REVIEW`} tone="text-orange-600" />
        <Stat label="Unmatched" value={data.unmatched} href="/review" tone="text-red-700" sub="sender not in Employees" />
        <Stat label="Review Required" value={data.needsReview} href="/review" tone={data.needsReview ? "text-red-700" : "text-emerald-700"} sub={data.needsReview ? "click to resolve" : "all clear"} highlight={data.needsReview > 0} />
      </div>
      <p className="-mt-2 text-xs text-slate-400">{data.nmcMessages} NMC message(s) used as evidence · counts show employee emails only (replies and follow-ups are not counted).</p>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card><CardHeader title={`Outcome of ${data.totalEmails} emails (${useful} useful)`} /><div className="p-2"><ClassPie counts={data.counts} /></div></Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Email quality by employee" />
          <div className="max-h-[420px] overflow-y-auto p-2"><EmployeeStackedBar rows={data.employees.filter((e) => e.kpi.total > 0).sort((a, b) => b.kpi.total - a.kpi.total).slice(0, 15)} /></div>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {[{ title: "Highest email quality", rows: top }, { title: "Lowest email quality", rows: low }].map((b) => (
          <Card key={b.title}>
            <CardHeader title={b.title} />
            <ul className="divide-y divide-slate-100">
              {b.rows.length === 0 && <li className="p-4 text-sm text-slate-400">Not enough data.</li>}
              {b.rows.map((e) => (
                <li key={e.employeeId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link href={`/employees/${e.employeeId}`} className="text-blue-700 hover:underline">{e.name}</Link>
                  <span className="flex items-center gap-2 text-xs text-slate-500">{e.kpi.total} emails <Badge className={ratingStyle[e.kpi.rating]}>{e.kpi.score}</Badge></span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card><CardHeader title="Employee performance" /><EmployeeTable stats={data} /></Card>

      {trend.data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader title={`${year} — classification trend`} /><div className="p-2"><TrendStack months={trend.data.months} /></div></Card>
          <Card><CardHeader title={`${year} — volume vs. quality`} /><div className="p-2"><VolumeVsQuality months={trend.data.months} /></div><p className="px-4 pb-3 text-xs text-slate-400">More emails is not better: the KPI score reflects usefulness, correct escalation and avoidable/duplicate emails.</p></Card>
        </div>
      )}
    </div>
  );
}
