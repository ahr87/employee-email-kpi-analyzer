"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fmtDate, useApi } from "@/lib/client";
import { useMonth } from "@/components/month";
import { Button, Card, ClassBadge, ConfBadge, EmptyState, ErrorState, Input, Select, Spinner, Td, Th, Badge } from "@/components/ui";
import { ReasonBadges } from "@/components/email-actions";
import { CLASSES, CLASS_LABELS, MONTH_NAMES } from "@/lib/types";
import type { listEmails } from "@/lib/import/emails";

type Result = Awaited<ReturnType<typeof listEmails>>;
interface Emp { id: string; name: string; department: string; team: string }
interface BatchRow { id: string; number: number }

function EmailsInner() {
  const sp = useSearchParams();
  const { year, month, ready } = useMonth();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [allMonths, setAllMonths] = useState(!!sp.get("q"));
  const [f, setF] = useState({ view: "counted", employeeId: "", classification: sp.get("classification") ?? "", reviewStatus: "", department: "", team: "", batchId: "", confidence: "" });
  const [sort, setSort] = useState("sentAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  useEffect(() => { setQ(sp.get("q") ?? ""); if (sp.get("q")) setAllMonths(true); setPage(1); }, [sp]);

  const emps = useApi<{ employees: Emp[] }>("/api/employees");
  const batches = useApi<{ batches: BatchRow[] }>(`/api/batches?year=${year}&month=${month}`);
  const url = useMemo(() => {
    const p = new URLSearchParams({ sort, dir, page: String(page), pageSize: "25" });
    if (!allMonths) { p.set("year", String(year)); p.set("month", String(month)); }
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(f)) if (v && k !== "confidence") p.set(k, v);
    if (f.confidence === "low") p.set("maxConfidence", "74");
    if (f.confidence === "high") p.set("minConfidence", "75");
    return `/api/emails?${p}`;
  }, [q, f, sort, dir, page, year, month, allMonths]);
  const { data, error, loading, reload } = useApi<Result>(ready ? url : null);

  const depts = [...new Set(emps.data?.employees.map((e) => e.department).filter(Boolean))];
  const teams = [...new Set(emps.data?.employees.map((e) => e.team).filter(Boolean))];
  const onSort = (k: string) => { if (k === sort) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir("desc"); } setPage(1); };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">Emails</h1><p className="text-sm text-slate-500">{allMonths ? "All months" : `${MONTH_NAMES[month - 1]} ${year}`}{data ? ` · ${data.total} email(s)` : ""}</p></div>
      </div>
      <Card className="space-y-3 p-3">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-9">
          <Input className="md:col-span-2" aria-label="Search" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select value={f.view} onChange={set("view")} aria-label="Messages shown"><option value="counted">Employee emails (counted)</option><option value="followups">Follow-ups (not counted)</option><option value="nmc">NMC messages (evidence)</option><option value="all">All messages</option></Select>
          <Select value={f.employeeId} onChange={set("employeeId")}><option value="">All employees</option>{emps.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
          <Select value={f.classification} onChange={set("classification")}><option value="">All classifications</option>{CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABELS[c]}</option>)}</Select>
          <Select value={f.confidence} onChange={set("confidence")}><option value="">Any confidence</option><option value="low">Below 75%</option><option value="high">75% and above</option></Select>
          <Select value={f.reviewStatus} onChange={set("reviewStatus")}><option value="">Any review status</option><option value="NEEDS_REVIEW">Needs review</option><option value="REVIEWED">Reviewed</option><option value="OK">Auto-OK</option></Select>
          <Select value={f.department} onChange={set("department")}><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</Select>
          <Select value={f.team} onChange={set("team")}><option value="">All teams</option>{teams.map((d) => <option key={d}>{d}</option>)}</Select>
          <Select value={f.batchId} onChange={set("batchId")}><option value="">All batches</option>{batches.data?.batches.map((b) => <option key={b.id} value={b.id}>Batch {b.number}</option>)}</Select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={allMonths} onChange={(e) => { setAllMonths(e.target.checked); setPage(1); }} /> Search across all months</label>
      </Card>
      <Card>
        {loading && !data ? <Spinner /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.rows.length === 0 ? <EmptyState title="No emails match" hint="Adjust the filters or import emails for this month." /> : (
          <>
            <div className="overflow-x-auto"><table className="w-full">
              <thead><tr>
                <Th sort="sentAt" active={sort === "sentAt"} dir={dir} onSort={onSort}>Date</Th>
                <Th sort="employee" active={sort === "employee"} dir={dir} onSort={onSort}>Employee</Th>
                <Th sort="subject" active={sort === "subject"} dir={dir} onSort={onSort}>Subject</Th>
                <Th sort="finalClass" active={sort === "finalClass"} dir={dir} onSort={onSort}>Classification</Th>
                <Th sort="confidence" active={sort === "confidence"} dir={dir} onSort={onSort}>Conf.</Th>
                <Th>Duplicate of</Th><Th>Review</Th>
              </tr></thead>
              <tbody>{data.rows.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap">{fmtDate(e.sentAt)}</Td>
                  <Td>{e.employee ? <Link className="text-blue-700 hover:underline" href={`/employees/${e.employee.id}`}>{e.employee.name}</Link> : <Badge className="bg-red-50 text-red-700">Unmatched · {e.senderEmail || e.senderName || "?"}</Badge>}</Td>
                  <Td className="max-w-md"><Link href={`/emails/${e.id}`} className="font-medium hover:text-blue-700">{e.subject || "(no subject)"}</Link></Td>
                  <Td>{e.kind === "NMC" ? <Badge className="bg-slate-800 text-white">NMC</Badge> : e.kind === "FOLLOW_UP" ? <Badge className="bg-slate-200 text-slate-700">follow-up</Badge> : <ClassBadge value={e.finalClass} />}{e.isManual && <Badge className="ml-1 bg-blue-50 text-blue-700">manual</Badge>}</Td>
                  <Td><ConfBadge value={e.confidence} /></Td>
                  <Td>{e.duplicateOf ? <Link className="text-xs text-violet-700 hover:underline" href={`/emails/${e.duplicateOf.id}`}>{e.duplicateOf.employee?.name ?? e.duplicateOf.senderName} · {e.duplicateSimilarity}%</Link> : "—"}</Td>
                  <Td>{e.reviewStatus === "NEEDS_REVIEW" ? <ReasonBadges json={e.reviewReasons} /> : <Badge className="bg-slate-100 text-slate-600">{e.reviewStatus === "REVIEWED" ? "Reviewed" : "OK"}</Badge>}</Td>
                </tr>))}
              </tbody></table></div>
            <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm">
              <span className="text-slate-500">Page {page} of {pages}</span>
              <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function EmailsPage() { return <Suspense fallback={<Spinner />}><EmailsInner /></Suspense>; }
