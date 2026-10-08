"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileJson, Upload } from "lucide-react";
import { errorMessage, fmtBytes, fmtDate, useQuery } from "@/lib/client";
import { MonthPicker, useMonth } from "@/components/month";
import { BatchesTable } from "@/components/batches-table";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner, useToast } from "@/components/ui";
import { deleteBatch, type ImportSummary } from "@/lib/import/importer";
import { listBatches } from "@/lib/import/batches";
import { importOutlookExport, previewOutlookExport, type OutlookPreview } from "@/lib/outlook/import";
import type { ImportProgress, MonthMode } from "@/lib/import/types";
import { MONTH_NAMES } from "@/lib/types";

const SUMMARY_KEY = "eka.lastOutlookImport";
const n = (x: number) => x.toLocaleString("en-US");
const PHASE: Record<string, string> = { validating: "Validating and normalizing", normalizing: "Normalizing", importing: "Importing", analyzing: "Analyzing", done: "Completed" };

function ProgressBar({ p, bytes }: { p: ImportProgress; bytes?: boolean }) {
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  return (
    <div role="status" aria-live="polite" className="space-y-1.5">
      <div className="flex justify-between text-sm"><span className="font-medium">{PHASE[p.phase]}…</span><span className="tabular-nums text-slate-500">{bytes ? `${fmtBytes(p.done)} / ${fmtBytes(p.total)}` : `${n(p.done)} / ${n(p.total)}`}</span></div>
      <div className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function ImportOutlookPage() {
  const { year, month, set } = useMonth();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OutlookPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [mode, setMode] = useState<MonthMode>("received");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const batches = useQuery("batches:all", () => listBatches());
  useEffect(() => { try { const v = sessionStorage.getItem(SUMMARY_KEY); if (v) setResult(JSON.parse(v)); } catch { /* ignore */ } }, []);

  const guard = (p: ImportProgress) => { if (cancelled.current) throw new Error("cancelled"); setProgress(p); };

  async function choose(f: File) {
    setError(null); setPreview(null); setResult(null); setFile(f); cancelled.current = false;
    try { sessionStorage.removeItem(SUMMARY_KEY); } catch { /* ignore */ }
    setBusy("preview"); setProgress({ phase: "validating", done: 0, total: f.size });
    try {
      const p = await previewOutlookExport(f, f.name, guard);
      setPreview(p);
      setMode(p.months.length > 1 || (p.months[0] && (p.months[0].year !== year || p.months[0].month !== month)) ? "received" : "received");
    } catch (e) {
      if ((e as Error).message !== "cancelled") setError(errorMessage(e));
      setFile(null);
    } finally { setBusy(null); setProgress(null); if (input.current) input.current.value = ""; }
  }

  async function run() {
    if (!file || !preview) return;
    cancelled.current = false;
    setBusy("import"); setError(null); setProgress({ phase: "importing", done: 0, total: preview.valid });
    try {
      const r = await importOutlookExport(file, file.name, preview, { year, month, monthMode: mode, onProgress: guard });
      setResult(r); setPreview(null); setFile(null); batches.reload();
      try { sessionStorage.setItem(SUMMARY_KEY, JSON.stringify(r)); } catch { /* ignore */ }
      toast("ok", `Imported ${n(r.newEmails)} message(s) from ${r.filename}.`);
    } catch (e) {
      if ((e as Error).message === "cancelled") toast("error", "Import cancelled. Messages already stored were removed.");
      else { setError(errorMessage(e)); toast("error", errorMessage(e)); }
    } finally { setBusy(null); setProgress(null); }
  }

  async function del(b: { id: string; number: number; newEmails: number }) {
    if (!confirm(`Delete batch ${b.number} and its ${b.newEmails} emails? Manual decisions on them are lost.`)) return;
    try { await deleteBatch(b.id); toast("ok", "Batch deleted."); batches.reload(); } catch (e) { toast("error", errorMessage(e)); }
  }

  const outside = preview ? preview.months.filter((m) => m.year !== year || m.month !== month).reduce((a, m) => a + m.count, 0) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Import Outlook Export</h1>
        <p className="text-sm text-slate-500">Outlook → run the exporter → choose the <code>KPI_Outlook_Export_….json</code> file here → check the preview → Import &amp; Analyze. The file is read in your browser and never uploaded. Prefer to copy emails by hand? <Link className="text-blue-700 underline" href="/import">Paste &amp; Analyze</Link> is still available.</p>
      </div>

      <Card>
        <CardHeader title="1. Choose the export file" />
        <div className="space-y-3 p-4">
          <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Outlook export file" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
          <div
            className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !busy) choose(f); }}
          >
            <FileJson className="h-8 w-8 text-slate-400" />
            <Button onClick={() => input.current?.click()} disabled={!!busy}><Upload className="h-4 w-4" />Select Outlook export (.json)</Button>
            <p className="text-xs text-slate-500">or drop the file here · thousands of messages are fine; large files are read in chunks</p>
          </div>
          {busy === "preview" && progress && <><ProgressBar p={progress} bytes /><Button variant="secondary" size="sm" onClick={() => { cancelled.current = true; }}>Cancel</Button></>}
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
      </Card>

      {preview && (
        <Card className="border-blue-300 ring-1 ring-blue-100">
          <CardHeader title="Outlook Import Preview" />
          <div className="space-y-4 p-4 text-sm">
            <p><span className="text-slate-500">File:</span> <strong>{preview.filename}</strong> <span className="text-slate-400">· {fmtBytes(preview.sizeBytes)} · {preview.encoding}{preview.exportedAt ? ` · exported ${preview.exportedAt}` : ""}</span></p>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {([
                ["Messages", preview.total, "in the file"],
                ["Valid", preview.valid, "will be imported"],
                ["Invalid", preview.invalid, preview.invalid ? "will be skipped" : "none"],
                ["Unique senders", preview.uniqueSenders, ""],
                ["Conversations", preview.uniqueConversations, "by Outlook ConversationID"],
                ["Employees matched", preview.matchedEmployees, `${n(preview.employeeMessages)} messages — counted`],
                ["Other senders", preview.otherSenders, `${n(preview.otherSenderMessages)} messages — evidence only, not counted`],
                ["Potential duplicates", preview.duplicatesInDb + preview.duplicatesInFile, `${n(preview.duplicatesInDb)} already stored · ${n(preview.duplicatesInFile)} repeated in file`],
              ] as [string, number, string][]).map(([k, v, sub]) => (
                <div key={k} className="rounded-md bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-2xl font-semibold tabular-nums">{n(v)}</dd><div className="text-[11px] text-slate-400">{sub}</div></div>
              ))}
            </dl>
            <p><span className="text-slate-500">Date range (received):</span> <strong>{fmtDate(preview.dateFrom)} → {fmtDate(preview.dateTo)}</strong>{" "}
              <span className="text-slate-400">· {preview.months.map((m) => `${MONTH_NAMES[m.month - 1].slice(0, 3)} ${m.year}: ${n(m.count)}`).join(" · ")}</span></p>
            <p className="text-xs text-slate-500">{n(preview.nmcMessages)} message(s) come from your NMC addresses (used as evidence) · {n(preview.withQuotedHistory)} contain quoted earlier messages (removed from the analysis copy) · {n(preview.withSignature)} have a signature (ignored in analysis) · {n(preview.htmlOnly)} were converted from HTML.</p>

            {preview.invalid > 0 && (
              <details className="rounded border border-amber-200 bg-amber-50 p-3" open={preview.invalid <= 5}>
                <summary className="cursor-pointer font-medium text-amber-900">{n(preview.valid)} message(s) will be imported. {n(preview.invalid)} message(s) could not be parsed.</summary>
                <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-amber-900">
                  {preview.invalidList.map((i) => <li key={i.index}>#{i.index + 1}{i.subject ? ` “${i.subject}”` : ""}{i.entryId ? ` (entry ${i.entryId.slice(0, 12)}…)` : ""}: {i.reason}</li>)}
                  {preview.invalidTruncated && <li>…and {n(preview.invalid - preview.invalidList.length)} more.</li>}
                </ul>
              </details>
            )}
            {preview.warnings.filter((w) => !/cannot be imported and will be skipped/.test(w)).map((w) => <div key={w} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">⚠ {w}</div>)}

            <fieldset className="space-y-2 rounded border border-slate-200 p-3">
              <legend className="px-1 text-xs font-medium text-slate-600">Which month do the messages belong to?</legend>
              <label className="flex items-start gap-2"><input type="radio" name="mode" checked={mode === "received"} onChange={() => setMode("received")} className="mt-1" /><span><strong>The month each message was received</strong> (recommended — works for exports that span several months)</span></label>
              <label className="flex items-start gap-2"><input type="radio" name="mode" checked={mode === "selected"} onChange={() => setMode("selected")} className="mt-1" />
                <span><strong>All into one selected month:</strong> <span className="inline-block align-middle"><MonthPicker year={year} month={month} onChange={set} /></span>
                  {mode === "selected" && outside > 0 && <span className="ml-2 text-xs text-amber-700">{n(outside)} message(s) were received in other months and will wait in Review for your decision.</span>}</span></label>
            </fieldset>

            {busy === "import" && progress ? (
              <><ProgressBar p={progress} /><Button variant="secondary" size="sm" onClick={() => { cancelled.current = true; }}>Cancel</Button></>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button onClick={run} disabled={!!busy || preview.valid === 0}>{preview.invalid ? `Import ${n(preview.valid)} valid message(s) & Analyze` : "Import & Analyze"}</Button>
                <Button variant="secondary" onClick={() => { setPreview(null); setFile(null); }} disabled={!!busy}>Cancel</Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {busy === "preview" && !progress && <Spinner />}

      {result && (
        <Card className="border-blue-300 ring-1 ring-blue-100">
          <CardHeader title={`Import summary — Batch ${String(result.batchNumber).padStart(3, "0")} · Outlook Desktop`} action={<button className="text-xs text-slate-400 hover:text-slate-700" onClick={() => { setResult(null); try { sessionStorage.removeItem(SUMMARY_KEY); } catch { /* ignore */ } }}>dismiss</button>} />
          <div className="space-y-3 p-4 text-sm">
            <p className="text-slate-500">{result.filename} · {fmtDate(result.dateFrom)} → {fmtDate(result.dateTo)} · {n(result.uniqueSenders)} senders · {n(result.uniqueConversations)} conversations</p>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {([
                ["Imported", result.newEmails, "new messages stored"],
                ["Exact duplicates ignored", result.exactDuplicates, "already imported"],
                ["Employee emails counted", result.matched, "matched to an employee"],
                ["Other senders", result.otherSenders, "evidence only, not counted"],
                ["NMC messages", result.nmcMessages, "evidence"],
                ["Follow-ups", result.followUps, "evidence, not counted"],
                ["Automatically classified", result.autoClassified, "no review needed"],
                ["Review required", result.needsReview, "waiting in Review"],
              ] as [string, number, string][]).map(([k, v, sub]) => (
                <div key={k} className="rounded-md bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-2xl font-semibold tabular-nums">{n(v)}</dd><div className="text-[11px] text-slate-400">{sub}</div></div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-500">Months:</span>{result.months.map((m) => <Badge key={`${m.year}-${m.month}`} className="bg-slate-100 text-slate-700">{MONTH_NAMES[m.month - 1]} {m.year}: {n(m.count)}</Badge>)}</div>
            {result.warnings.map((w) => <div key={w} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">⚠ {w}</div>)}
            <div className="flex flex-wrap gap-2">
              <Link href="/review"><Button>{result.needsReview ? `Review ${n(result.needsReview)} item(s)` : "Open review queue"}</Button></Link>
              {result.months.slice(-1).map((m) => <Link key="d" href="/" onClick={() => set(m.year, m.month)}><Button variant="secondary">Dashboard — {MONTH_NAMES[m.month - 1]} {m.year}</Button></Link>)}
              <Link href="/reports"><Button variant="secondary">Monthly report</Button></Link>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="All import batches" />
        {batches.loading && !batches.data ? <Spinner /> : !batches.data?.length ? <EmptyState title="Nothing imported yet" /> : <BatchesTable batches={batches.data} onDelete={del} />}
      </Card>
    </div>
  );
}
