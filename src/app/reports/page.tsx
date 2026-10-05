"use client";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { useApi } from "@/lib/client";
import { useMonth } from "@/components/month";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Spinner, Td, Th } from "@/components/ui";
import { ratingStyle } from "@/components/employee-table";
import { CLASSES, CLASS_LABELS, MONTH_NAMES } from "@/lib/types";
import type { MonthlyStats } from "@/lib/reports/aggregate";

export default function ReportsPage() {
  const { year, month, ready } = useMonth();
  const { data, error, loading, reload } = useApi<MonthlyStats>(ready ? `/api/reports/monthly?year=${year}&month=${month}` : null);
  const history = useApi<{ months: { year: number; month: number; emails: number }[] }>("/api/months");
  const q = `year=${year}&month=${month}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Monthly Report</h1><p className="text-sm text-slate-500">{MONTH_NAMES[month - 1]} {year} — based on FINAL classifications (after manual review).</p></div>
        <div className="no-print flex gap-2">
          <a href={`/api/reports/monthly?${q}&format=xlsx`}><Button><Download className="h-4 w-4" />Export Excel</Button></a>
          <a href={`/api/reports/monthly?${q}&format=csv`}><Button variant="secondary"><Download className="h-4 w-4" />Export CSV</Button></a>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / PDF</Button>
        </div>
      </div>
      {loading ? <Spinner /> : error || !data ? <Card><ErrorState message={error ?? "Failed"} onRetry={reload} /></Card> : data.totalEmails === 0 ? (
        <Card><EmptyState title="No data for this month" hint="Import emails first, or pick another month." action={<Link href="/import"><Button>Paste &amp; Analyze</Button></Link>} /></Card>
      ) : (
        <>
          {data.needsReview > 0 && <div className="no-print rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800"><strong>{data.needsReview}</strong> email(s) still need review — the numbers below may change. <Link href="/review" className="underline">Open review queue</Link></div>}
          <Card>
            <CardHeader title="Classification summary" />
            <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-6">
              <div><div className="text-xs text-slate-500">Total emails</div><div className="text-xl font-semibold">{data.totalEmails}</div></div>
              {CLASSES.map((c) => <div key={c}><div className="text-xs text-slate-500">{CLASS_LABELS[c]}</div><div className="text-xl font-semibold">{data.counts[c]}</div></div>)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Employee totals" />
            <div className="overflow-x-auto"><table className="w-full">
              <thead><tr><Th>Employee</Th><Th className="text-right">Total Emails</Th><Th className="text-right">Forwarded</Th><Th className="text-right">Not Useful</Th><Th className="text-right">Duplicate</Th><Th className="text-right">Pending</Th><Th className="text-right">Other</Th><Th className="text-right">KPI Score</Th></tr></thead>
              <tbody>{data.employees.filter((e) => e.kpi.total > 0).sort((a, b) => a.name.localeCompare(b.name)).map((e) => (
                <tr key={e.employeeId}>
                  <Td><Link className="text-blue-700 hover:underline" href={`/employees/${e.employeeId}`}>{e.name}</Link></Td>
                  <Td className="text-right">{e.kpi.total}</Td><Td className="text-right">{e.counts.FORWARDED}</Td><Td className="text-right">{e.counts.NOT_USEFUL}</Td><Td className="text-right">{e.counts.DUPLICATE}</Td><Td className="text-right">{e.counts.PENDING_REVIEW}</Td><Td className="text-right">{e.counts.OTHER}</Td>
                  <Td className="text-right">{e.kpi.score == null ? "n/a" : <Badge className={ratingStyle[e.kpi.rating]}>{e.kpi.score}</Badge>}</Td>
                </tr>))}
                {data.unmatched > 0 && <tr><Td className="text-red-700">Unmatched senders</Td><Td className="text-right">{data.unmatched}</Td><td colSpan={6} className="border-t border-slate-100" /></tr>}
              </tbody></table></div>
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">Total Emails is volume only. KPI Score measures quality (usefulness, correct escalation, avoidable and duplicate emails) using the formula in Settings → KPI.</p>
          </Card>
        </>
      )}
      <Card className="no-print">
        <CardHeader title="History" />
        <div className="flex flex-wrap gap-2 p-4 text-sm">{history.data?.months.map((m) => <Badge key={`${m.year}-${m.month}`} className="bg-slate-100 text-slate-700">{MONTH_NAMES[m.month - 1]} {m.year}: {m.emails}</Badge>)}{!history.data?.months.length && <span className="text-slate-400">No months imported yet.</span>}</div>
      </Card>
    </div>
  );
}
