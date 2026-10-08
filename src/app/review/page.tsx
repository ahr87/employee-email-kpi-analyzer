"use client";
import Link from "next/link";
import { useState } from "react";
import { fmtDate, useQuery } from "@/lib/client";
import { getEmailDetail, listEmails } from "@/lib/import/emails";
import { listEmployees } from "@/lib/employees/service";
import { useMonth } from "@/components/month";
import { Badge, Button, Card, ClassBadge, ConfBadge, EmptyState, ErrorState, Select, Spinner } from "@/components/ui";
import { EmailActions, ReasonBadges, parseReasons } from "@/components/email-actions";
import { MONTH_NAMES, REVIEW_REASON_LABELS, type ReviewReason } from "@/lib/types";

export default function ReviewPage() {
  const { year, month, ready } = useMonth();
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useQuery(ready ? `review:${year}:${month}:${page}` : null, () => listEmails({ year, month, reviewStatus: "NEEDS_REVIEW", pageSize: 10, page, sort: "confidence", dir: "asc" }));
  const emps = useQuery("employees", () => listEmployees());
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState<Record<string, string>>({});

  async function toggle(id: string) {
    setOpen(open === id ? null : id);
    if (!body[id]) { const r = await getEmailDetail(id); setBody((b) => ({ ...b, [id]: r?.email.body ?? "" })); }
  }
  const rows = data?.rows.filter((r) => !reason || parseReasons(r.reviewReasons).includes(reason as ReviewReason)) ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Review Required</h1><p className="text-sm text-slate-500">{MONTH_NAMES[month - 1]} {year}{data ? ` · ${data.total} item(s) waiting` : ""}. Confirming or changing a classification makes it final and protects it from re-analysis.</p></div>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-64"><option value="">All review reasons</option>{Object.entries(REVIEW_REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {loading && !data ? <Spinner /> : error ? <Card><ErrorState message={error} onRetry={reload} /></Card> : rows.length === 0 ? (
        <Card><EmptyState title={data?.total ? "Nothing on this page matches the reason filter" : "Nothing to review 🎉"} hint="All emails for this month are either classified with enough confidence or already reviewed." /></Card>
      ) : rows.map((e) => (
        <Card key={e.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/email?id=${e.id}`} className="font-medium hover:text-blue-700">{e.subject || "(no subject)"}</Link>
              <p className="text-xs text-slate-500">{e.employee ? e.employee.name : <Badge className="bg-red-50 text-red-700">Unmatched</Badge>} · {e.senderName} {e.senderEmail && `<${e.senderEmail}>`} · {fmtDate(e.sentAt)}</p>
            </div>
            <div className="flex items-center gap-2"><span className="text-xs text-slate-400">Suggested</span><ClassBadge value={e.finalClass} /><ConfBadge value={e.confidence} /></div>
          </div>
          <div className="mt-2"><ReasonBadges json={e.reviewReasons} /></div>
          <p className="mt-2 text-sm text-slate-600">{e.reason}</p>
          {e.possibleDuplicateOfId && <p className="mt-1 text-xs text-amber-700">Possible duplicate ({e.possibleDuplicateSim}%) — <Link className="underline" href={`/email?id=${e.possibleDuplicateOfId}`}>open the other email</Link></p>}
          {e.duplicateOf && <p className="mt-1 text-xs text-violet-700">Duplicate of <Link className="underline" href={`/email?id=${e.duplicateOf.id}`}>{e.duplicateOf.subject}</Link> ({e.duplicateSimilarity}%)</p>}
          <button className="mt-2 text-xs text-blue-700 hover:underline" onClick={() => toggle(e.id)}>{open === e.id ? "Hide body" : "Show body"}</button>
          {open === e.id && <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs break-words whitespace-pre-wrap">{body[e.id] ?? "Loading…"}</pre>}
          <div className="mt-3 border-t border-slate-100 pt-3">{emps.data && <EmailActions compact email={e} employees={emps.data} onDone={reload} />}</div>
        </Card>
      ))}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between"><span className="text-sm text-slate-500">Page {page} of {pages}</span>
          <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      )}
    </div>
  );
}
