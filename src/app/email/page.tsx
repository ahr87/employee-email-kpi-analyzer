"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fmtDate, useQuery } from "@/lib/client";
import { getEmailDetail } from "@/lib/import/emails";
import { listEmployees } from "@/lib/employees/service";
import { Badge, Button, Card, CardHeader, ClassBadge, ConfBadge, ErrorState, Spinner } from "@/components/ui";
import { EmailActions, ReasonBadges } from "@/components/email-actions";
import { SourceBadge } from "@/components/batches-table";
import { getDb } from "@/lib/db";
import { gunzip } from "@/lib/utils/gzip";
import type { RawRec } from "@/lib/storage/types";

/** The original Outlook message, loaded on demand. HTML is only ever shown as escaped text — never rendered. */
function OriginalMessage({ id, normalization }: { id: string; normalization: string }) {
  const [raw, setRaw] = useState<RawRec | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState("");
  let info: Record<string, unknown> = {};
  try { info = normalization ? JSON.parse(normalization) : {}; } catch { /* old record */ }
  const load = async () => {
    try {
      const r = await (await getDb()).getRaw(id);
      if (!r) { setErr("The original message is not stored (it was not included when this data was restored)."); return; }
      setRaw(r);
      setHtml(r.html ?? (r.htmlGz ? await gunzip(r.htmlGz) : ""));
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the original message."); }
  };
  return (
    <details className="mt-3" onToggle={(ev) => { if ((ev.target as HTMLDetailsElement).open && !raw && !err) void load(); }}>
      <summary className="cursor-pointer text-xs text-slate-500">Original Outlook message (as exported)</summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-slate-500">Analysis used {String(info.source ?? "plain")} text{Number(info.quotedChars) > 0 ? `, ignoring ${info.quotedChars} characters of quoted history` : ""}{Number(info.signatureChars) > 0 ? ` and ${info.signatureChars} characters of signature` : ""}.</p>
        {err && <p className="text-red-700">{err}</p>}
        {raw && (<>
          <p className="text-slate-500">entryId <code>{raw.entryId}</code> · conversationId <code>{raw.conversationId ?? "—"}</code> · received {raw.receivedAt}</p>
          <pre className="max-h-72 overflow-auto rounded bg-slate-900 p-3 break-words whitespace-pre-wrap text-slate-100">{raw.body || "(empty plain body)"}</pre>
          {html && <details><summary className="cursor-pointer text-slate-500">HTML source (shown as text, not rendered)</summary><pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-900 p-3 break-words whitespace-pre-wrap text-slate-100">{html}</pre></details>}
        </>)}
      </div>
    </details>
  );
}


const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[110px_1fr] gap-2 py-1.5 text-sm"><dt className="text-slate-500">{k}</dt><dd className="break-words">{children || "—"}</dd></div>
);

function EmailDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, loading, reload } = useQuery(id ? `email:${id}` : null, async () => { const d = await getEmailDetail(id); if (!d) throw new Error("Email not found."); return d; });
  const emps = useQuery("employees", () => listEmployees());
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Card><ErrorState message={error ?? "Email not found"} onRetry={reload} /></Card>;
  const { email: e, possible, thread, audit } = data;
  const uncertain: string[] = JSON.parse(e.uncertainFields || "[]");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/emails" className="text-xs text-blue-700 hover:underline">← Emails</Link>
        <h1 className="mt-1 text-xl font-semibold">{e.subject || "(no subject)"}</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Email" />
          <dl className="divide-y divide-slate-100 px-4 py-2">
            <Row k="Sender">{e.senderName} {e.senderEmail && <span className="text-slate-500">&lt;{e.senderEmail}&gt;</span>}</Row>
            <Row k="Employee">{e.employee ? <Link className="text-blue-700 hover:underline" href={`/employee?id=${e.employee.id}`}>{e.employee.name} <span className="text-slate-400">({e.employee.department}{e.employee.team ? ` · ${e.employee.team}` : ""})</span></Link> : <Badge className="bg-red-50 text-red-700">Unmatched employee</Badge>}</Row>
            <Row k="Date / time">{fmtDate(e.sentAt)}{e.outsideMonth && <Badge className="ml-2 bg-amber-100 text-amber-800">outside selected month ({e.monthDecision.toLowerCase()})</Badge>}</Row>
            <Row k="To">{e.toRecipients}</Row>
            <Row k="CC">{e.ccRecipients}</Row>
            <Row k="Batch">Batch {e.batch.number} · imported {fmtDate(e.batch.createdAt)}{e.quoted && <Badge className="ml-2 bg-slate-100 text-slate-600">found inside a reply chain</Badge>}</Row>
            <Row k="Source"><SourceBadge source={e.batch.source} />{e.batch.filename && <span className="ml-2 text-xs text-slate-500">{e.batch.filename}</span>}</Row>
            <Row k="In the KPI">{e.kind === "REPORT" ? "Yes — counted as an employee email" : e.kind === "NMC" ? "No — NMC message, used as evidence" : e.kind === "EXTERNAL" ? "No — sender is not a configured employee or NMC address (evidence only)" : "No — follow-up message, used as evidence"}</Row>
            {uncertain.length > 0 && <Row k="Parser unsure"><span className="text-amber-700">{uncertain.join(", ")}</span></Row>}
          </dl>
          <div className="border-t border-slate-100 p-4">
            <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs break-words whitespace-pre-wrap">{e.body || "(empty body)"}</pre>
            {e.externalMessageId ? <OriginalMessage id={e.id} normalization={e.normalization} /> : (
              <details className="mt-3"><summary className="cursor-pointer text-xs text-slate-500">Raw pasted source</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs break-words whitespace-pre-wrap text-slate-100">{e.rawSource}</pre></details>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Classification" />
            <div className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2"><ClassBadge value={e.finalClass} /><ConfBadge value={e.isManual ? 100 : e.confidence} />{e.isManual && <Badge className="bg-blue-50 text-blue-700">manual decision</Badge>}</div>
              <p className="text-slate-600">{e.reason}</p>
              {e.reviewStatus === "NEEDS_REVIEW" && <div><ReasonBadges json={e.reviewReasons} /></div>}
              {e.isManual && (
                <div className="rounded bg-blue-50 p-2 text-xs text-blue-900">
                  Original (system): <strong>{e.autoClass}</strong> ({e.confidence}%) → Final: <strong>{e.finalClass}</strong>
                  {e.overrideReason && <> · Reason: {e.overrideReason}</>}{e.overrideAt && <> · {fmtDate(e.overrideAt)}</>}
                </div>
              )}
              {emps.data && <EmailActions email={e} employees={emps.data} onDone={reload} />}
            </div>
          </Card>

          {(e.duplicateOf || e.duplicates.length > 0 || possible) && (
            <Card>
              <CardHeader title="Duplicate relationship" />
              <div className="space-y-3 p-4 text-sm">
                {e.duplicateReason && <p className="text-slate-600">{e.duplicateReason}</p>}
                {e.duplicateOf && <p>Duplicate of <Link className="text-violet-700 hover:underline" href={`/email?id=${e.duplicateOf.id}`}>{e.duplicateOf.employee?.name ?? e.duplicateOf.senderName} — {e.duplicateOf.subject}</Link> ({fmtDate(e.duplicateOf.sentAt)}) · similarity {e.duplicateSimilarity != null ? `${e.duplicateSimilarity}%` : "selected manually"}</p>}
                {possible && <p className="text-amber-700">Possible duplicate (uncertain, {e.possibleDuplicateSim}%): <Link className="underline" href={`/email?id=${possible.id}`}>{possible.employee?.name ?? possible.senderName} — {possible.subject}</Link></p>}
                {e.duplicates.length > 0 && <div><p className="mb-1 text-slate-500">Later duplicates of this email:</p><ul className="space-y-1">{e.duplicates.map((d) => <li key={d.id}><Link className="text-violet-700 hover:underline" href={`/email?id=${d.id}`}>{d.employee?.name ?? d.senderName} — {fmtDate(d.sentAt)} ({d.duplicateSimilarity}%)</Link></li>)}</ul></div>}
              </div>
            </Card>
          )}
        </div>
      </div>

      {thread.length > 0 && (
        <Card>
          <CardHeader title={`Conversation — ${thread.length} other message${thread.length > 1 ? "s" : ""} with the same subject`} />
          <ul className="divide-y divide-slate-100">{thread.map((m) => (
            <li key={m.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Link href={`/email?id=${m.id}`} className="font-medium text-blue-700 hover:underline">{m.subject}</Link><Badge className={m.role === "NMC" ? "bg-slate-800 text-white" : "bg-slate-100"}>{m.role === "NMC" ? "NMC" : m.counted ? "Employee report" : "Other / follow-up"}</Badge><Badge className="bg-blue-50 text-blue-700">{m.isForward ? "Forward" : m.isReply ? "Reply" : "Original"}</Badge>{m.quoted && <Badge className="bg-slate-100 text-slate-500">quoted</Badge>}<span className="text-xs text-slate-400">{m.senderName} · {fmtDate(m.sentAt)}</span></div>
              <pre className="mt-2 max-h-40 overflow-auto text-xs break-words whitespace-pre-wrap text-slate-600">{m.body}</pre>
            </li>))}</ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Audit history" />
        {audit.length === 0 ? <p className="p-4 text-sm text-slate-400">No manual actions yet.</p> : (
          <ul className="divide-y divide-slate-100">{audit.map((a) => <li key={a.id} className="px-4 py-2 text-sm"><span className="text-xs text-slate-400">{fmtDate(a.createdAt)}</span> · {a.summary}</li>)}</ul>
        )}
      </Card>
      <Button variant="ghost" onClick={reload}>Refresh</Button>
    </div>
  );
}

export default function EmailDetailPage() {
  return <Suspense fallback={<Spinner />}><EmailDetail /></Suspense>;
}
