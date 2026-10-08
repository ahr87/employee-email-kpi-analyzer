"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { errorMessage, fmtDate, useQuery } from "@/lib/client";
import { deleteBatch, importBatch, type ImportSummary } from "@/lib/import/importer";
import { listBatches } from "@/lib/import/batches";
import { MonthPicker, useMonth } from "@/components/month";
import { Button, Card, CardHeader, EmptyState, Spinner, Td, Textarea, Th, useToast, Badge } from "@/components/ui";
import { MONTH_NAMES } from "@/lib/types";

const SUMMARY_KEY = "eka.lastImport";
export default function ImportPage() {
  const { year, month, set } = useMonth();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  useEffect(() => { try { const v = sessionStorage.getItem(SUMMARY_KEY); if (v) setResult(JSON.parse(v)); } catch { /* ignore */ } }, []);
  const [error, setError] = useState<string | null>(null);
  const batches = useQuery(`batches:${year}:${month}`, () => listBatches(year, month));

  async function analyze() {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await importBatch({ year, month, text });
      setResult(r); setText(""); batches.reload();
      try { sessionStorage.setItem(SUMMARY_KEY, JSON.stringify(r)); } catch { /* ignore */ }
      toast("ok", `Batch ${r.batchNumber}: ${r.newEmails} new email(s) analyzed.`);
    } catch (e) { setError(errorMessage(e)); toast("error", errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function del(b: { id: string; number: number; newEmails: number }) {
    if (!confirm(`Delete batch ${b.number} and its ${b.newEmails} emails? Manual decisions on them are lost.`)) return;
    try { await deleteBatch(b.id); toast("ok", "Batch deleted."); batches.reload(); }
    catch (e) { toast("error", errorMessage(e)); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Paste &amp; Analyze</h1>
        <p className="text-sm text-slate-500">Select emails in Outlook → copy → paste here → Analyze. Nothing is ever read from Outlook automatically; each paste is added as a new batch.</p>
      </div>
      <Card>
        <CardHeader title="1. Choose the analysis month" action={<MonthPicker year={year} month={month} onChange={set} />} />
        <div className="space-y-3 p-4">
          <p className="text-sm font-medium text-slate-700">2. Paste Outlook emails here</p>
          <p className="text-xs text-slate-500">Tip: include the NMC replies and forwards of each conversation (or whole conversations) — the app can only classify what it can see. Reply chains are split into their individual messages automatically.</p>
          <Textarea
            rows={14} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            placeholder={"From: Name <name@company.com>\nSent: Tuesday, September 1, 2026 10:05 AM\nTo: …\nSubject: …\n\nBody…\n\n(paste as many emails as you like; headers are detected automatically)"}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Button onClick={analyze} disabled={busy || !text.trim()}>{busy ? "Analyzing…" : "Analyze Emails"}</Button>
            <Button variant="secondary" onClick={() => { setText(""); setResult(null); setError(null); }} disabled={busy}>Clear</Button>
            <span className="ml-auto text-xs text-slate-400">{text.length.toLocaleString()} characters · target month {MONTH_NAMES[month - 1]} {year}</span>
          </div>
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
      </Card>

      {result && (
        <Card className="border-blue-300 ring-1 ring-blue-100">
          <CardHeader title={`Import summary — Batch ${String(result.batchNumber).padStart(3, "0")} · ${MONTH_NAMES[result.month - 1]} ${result.year}`} action={<button className="text-xs text-slate-400 hover:text-slate-700" onClick={() => { setResult(null); try { sessionStorage.removeItem(SUMMARY_KEY); } catch { /* ignore */ } }}>dismiss</button>} />
          <div className="space-y-3 p-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {([
                ["Imported", result.newEmails, "new messages stored"],
                ["Exact duplicates ignored", result.exactDuplicates, result.quotedRepeats ? `${result.quotedRepeats} were quoted copies in chains` : "already imported"],
                ["Matched employees", result.matched, "employee emails"],
                ["Unmatched", result.unmatched, "sender not in Employees"],
                ["Automatically classified", result.autoClassified, "confident, no review needed"],
                ["Review required", result.needsReview, "waiting in the Review queue"],
                ["Out-of-month", result.outsideMonth, "held for your decision"],
                ["Evidence only", result.nmcMessages + result.followUps, `${result.nmcMessages} NMC · ${result.followUps} follow-ups (not counted)`],
              ] as [string, number, string][]).map(([k, v, sub]) => (
                <div key={k} className="rounded-md bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-2xl font-semibold tabular-nums">{v}</dd><div className="text-[11px] text-slate-400">{sub}</div></div>
              ))}
            </dl>
            {result.exactDuplicateSubjects.length > 0 && (
              <details className="rounded bg-slate-50 p-2 text-xs text-slate-600"><summary className="cursor-pointer">Duplicate email already exists ({result.exactDuplicates})</summary><ul className="mt-1 list-disc pl-5">{result.exactDuplicateSubjects.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
            )}
            {result.warnings.map((w) => <div key={w} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">⚠ {w}</div>)}
            <div className="flex gap-2"><Link href="/review"><Button>{result.needsReview ? `Review ${result.needsReview} item(s)` : "Open review queue"}</Button></Link><Link href="/"><Button variant="secondary">Dashboard</Button></Link><Link href="/reports"><Button variant="secondary">Monthly report</Button></Link></div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Batches — ${MONTH_NAMES[month - 1]} ${year}`} />
        {batches.loading && !batches.data ? <Spinner /> : !batches.data?.length ? <EmptyState title="No batches for this month yet" /> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><Th>Batch</Th><Th>Imported</Th><Th className="text-right">Emails</Th><Th className="text-right">New</Th><Th className="text-right">Exact duplicates</Th><Th className="text-right">Needs review</Th><Th>Status</Th><Th> </Th></tr></thead>
            <tbody>{batches.data.map((b) => (
              <tr key={b.id}>
                <Td>Batch {String(b.number).padStart(3, "0")}</Td><Td>{fmtDate(b.createdAt)}</Td>
                <Td className="text-right">{b.totalParsed}</Td><Td className="text-right">{b.newEmails}</Td><Td className="text-right">{b.exactDuplicates}</Td><Td className="text-right">{b.needsReview}</Td>
                <Td><Badge className={b.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-red-100 text-red-800"}>{b.status === "COMPLETED" ? "Completed" : "Analysis failed — re-analyze"}</Badge></Td>
                <Td><Button variant="ghost" size="sm" onClick={() => del(b)} aria-label="Delete batch"><Trash2 className="h-4 w-4" /></Button></Td>
              </tr>))}
            </tbody></table></div>
        )}
      </Card>
    </div>
  );
}
