"use client";
import Link from "next/link";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, fmtDate, useApi } from "@/lib/client";
import { MonthPicker, useMonth } from "@/components/month";
import { Button, Card, CardHeader, EmptyState, Spinner, Td, Textarea, Th, useToast, Badge } from "@/components/ui";
import { MONTH_NAMES } from "@/lib/types";
import type { ImportSummary } from "@/lib/import/importer";

interface BatchRow { id: string; number: number; year: number; month: number; createdAt: string; totalParsed: number; newEmails: number; exactDuplicates: number; needsReview: number; status: string }

export default function ImportPage() {
  const { year, month, set } = useMonth();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const batches = useApi<{ batches: BatchRow[] }>(`/api/batches?year=${year}&month=${month}`);

  async function analyze() {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api<ImportSummary>("/api/import", { method: "POST", json: { year, month, text } });
      setResult(r); setText(""); batches.reload();
      toast("ok", `Batch ${r.batchNumber}: ${r.newEmails} new email(s) analyzed.`);
    } catch (e) { setError((e as Error).message); toast("error", (e as Error).message); }
    finally { setBusy(false); }
  }
  async function del(b: BatchRow) {
    if (!confirm(`Delete batch ${b.number} and its ${b.newEmails} emails? Manual decisions on them are lost.`)) return;
    try { await api(`/api/batches/${b.id}`, { method: "DELETE" }); toast("ok", "Batch deleted."); batches.reload(); }
    catch (e) { toast("error", (e as Error).message); }
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
        <Card className="border-blue-200">
          <CardHeader title={`Result — Batch ${String(result.batchNumber).padStart(3, "0")}`} />
          <div className="space-y-3 p-4 text-sm">
            <ul className="grid gap-1 sm:grid-cols-2">
              <li>Parsed <strong>{result.parsed}</strong> emails</li>
              <li>Matched <strong>{result.matched}</strong> employees</li>
              <li><strong>{result.unmatched}</strong> unmatched</li>
              <li><strong>{result.exactDuplicates}</strong> exact duplicates ignored</li>
              <li><strong>{result.autoClassified}</strong> classified automatically</li>
              <li><strong>{result.needsReview}</strong> require review</li>
              {result.nmcMessages > 0 && <li><strong>{result.nmcMessages}</strong> NMC messages used as evidence</li>}
              {result.outsideMonth > 0 && <li className="text-amber-700"><strong>{result.outsideMonth}</strong> dated outside the selected month (held for your decision)</li>}
            </ul>
            {result.exactDuplicateSubjects.length > 0 && (
              <div className="rounded bg-slate-50 p-2 text-xs text-slate-600">Duplicate email already exists: {result.exactDuplicateSubjects.map((s) => `“${s}”`).join(", ")}</div>
            )}
            {result.warnings.map((w) => <div key={w} className="rounded bg-amber-50 p-2 text-xs text-amber-800">{w}</div>)}
            <div className="flex gap-2"><Link href="/review"><Button>Open review queue</Button></Link><Link href="/"><Button variant="secondary">Dashboard</Button></Link></div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Batches — ${MONTH_NAMES[month - 1]} ${year}`} />
        {batches.loading ? <Spinner /> : !batches.data?.batches.length ? <EmptyState title="No batches for this month yet" /> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><Th>Batch</Th><Th>Imported</Th><Th className="text-right">Emails</Th><Th className="text-right">New</Th><Th className="text-right">Exact duplicates</Th><Th className="text-right">Needs review</Th><Th>Status</Th><Th> </Th></tr></thead>
            <tbody>{batches.data.batches.map((b) => (
              <tr key={b.id}>
                <Td>Batch {String(b.number).padStart(3, "0")}</Td><Td>{fmtDate(b.createdAt)}</Td>
                <Td className="text-right">{b.totalParsed}</Td><Td className="text-right">{b.newEmails}</Td><Td className="text-right">{b.exactDuplicates}</Td><Td className="text-right">{b.needsReview}</Td>
                <Td><Badge className="bg-emerald-50 text-emerald-700">{b.status}</Badge></Td>
                <Td><Button variant="ghost" size="sm" onClick={() => del(b)} aria-label="Delete batch"><Trash2 className="h-4 w-4" /></Button></Td>
              </tr>))}
            </tbody></table></div>
        )}
      </Card>
    </div>
  );
}
