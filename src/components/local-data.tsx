"use client";
import { useRef, useState } from "react";
import { Download, HardDrive, Trash2, Upload } from "lucide-react";
import { errorMessage, fmtBytes, storageWarning, useQuery } from "@/lib/client";
import { backupFilename, exportBackup, restoreBackup, validateBackup, type BackupCheck, type BackupSummary } from "@/lib/backup";
import { clearAllLocalData, storageSummary } from "@/lib/data-management";
import { JSON_MIME, downloadFile } from "@/lib/utils/download";
import { Button, Card, CardHeader, ConfirmModal, useToast } from "./ui";

/** Settings card: where the data lives, backup / restore, and "clear everything". Nothing here uses the network. */
export function LocalDataCard({ onChanged, version = 0 }: { onChanged: () => void; version?: number }) {
  const toast = useToast();
  const summary = useQuery(`storage-summary:${version}`, storageSummary);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [withHtml, setWithHtml] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pending, setPending] = useState<{ name: string; ok: Extract<BackupCheck, { ok: true }> } | null>(null);
  const [problems, setProblems] = useState<{ name: string; errors: string[] } | null>(null);

  const changed = () => { summary.reload(); onChanged(); };

  async function doExport() {
    setBusy(true);
    try {
      const { filename, json, summary: s } = await exportBackup(new Date(), { includeOriginalHtml: withHtml });
      downloadFile(filename, json, JSON_MIME);
      toast("ok", `Backup exported (${s.emails} emails, ${s.employees} employees).`);
      summary.reload();
    } catch (e) { toast("error", errorMessage(e)); } finally { setBusy(false); }
  }

  async function pick(f: File) {
    setProblems(null);
    try {
      if (!/\.json$/i.test(f.name)) throw new Error("Choose a .json backup file created by this application.");
      const check = validateBackup(await f.text());
      if (check.ok) setPending({ name: f.name, ok: check });
      else setProblems({ name: f.name, errors: check.errors });
    } catch (e) { setProblems({ name: f.name, errors: [errorMessage(e)] }); }
    if (file.current) file.current.value = "";
  }

  async function doRestore() {
    if (!pending) return;
    setBusy(true);
    try {
      await restoreBackup(pending.ok.backup);
      toast("ok", `Backup restored (${pending.ok.summary.emails} emails, ${pending.ok.summary.employees} employees).`);
      setPending(null);
      changed();
    } catch (e) { toast("error", errorMessage(e)); } finally { setBusy(false); }
  }

  async function doClear() {
    setBusy(true);
    try { await clearAllLocalData(); toast("ok", "All local data was deleted from this browser."); setClearing(false); changed(); }
    catch (e) { toast("error", errorMessage(e)); } finally { setBusy(false); }
  }

  const s = summary.data;
  const sum = (b: BackupSummary) => `${b.employees} employees, ${b.emails} messages in ${b.batches} batches (${b.months} month${b.months === 1 ? "" : "s"}), exported ${b.exportedAt.slice(0, 16).replace("T", " ")}`;

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><HardDrive className="h-4 w-4" />Local data</span>} />
      <div className="space-y-4 p-4 text-sm">
        <p className="text-slate-600">All employees, emails, KPI and analysis results are stored <strong>only in this browser</strong> on this computer (IndexedDB). Nothing is uploaded. Clearing the browser&apos;s site data, or using another browser or computer, means the data is not available — so export a backup regularly.</p>
        {storageWarning() && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">⚠ {storageWarning()} Your data is kept only in memory and will be lost when you close this tab. Export a backup before leaving.</p>}
        {s && (
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {([["Storage used by this site", fmtBytes(s.usageBytes)], ["Employees", s.employees], ["Email messages", s.emails], ["Batches", s.batches], ["Months", s.months]] as [string, string | number][]).map(([k, v]) => (
              <div key={k} className="rounded-md bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport} disabled={busy}><Download className="h-4 w-4" />Export backup</Button>
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={withHtml} onChange={(e) => setWithHtml(e.target.checked)} />Include original Outlook HTML (larger file)</label>
          <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Backup file" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}><Upload className="h-4 w-4" />Restore backup…</Button>
          <Button variant="danger" onClick={() => setClearing(true)} disabled={busy}><Trash2 className="h-4 w-4" />Clear all local data</Button>
        </div>
        <p className="text-xs text-slate-400">“Storage used” is the browser&apos;s estimate for this site (your data plus the offline copy of the app). A backup is one JSON file (<code>{backupFilename()}</code>) with employees, emails, batches, classifications, manual overrides, settings (KPI, NMC addresses, phrases) and the audit log. Keep it somewhere safe: it contains the pasted emails.</p>
        {problems && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="font-medium">“{problems.name}” cannot be restored:</p>
            <ul className="mt-1 list-disc pl-5">{problems.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            <p className="mt-1 text-xs">Nothing was changed.</p>
          </div>
        )}
      </div>

      <ConfirmModal open={!!pending} onClose={() => setPending(null)} title="Restore this backup?" confirmLabel="Replace current data with this backup" onConfirm={doRestore} busy={busy}>
        {pending && (
          <>
            <p><strong>{pending.name}</strong> contains {sum(pending.ok.summary)}.</p>
            <p className="rounded bg-amber-50 p-2 text-amber-900">Restoring <strong>replaces everything currently stored in this browser</strong> ({s ? `${s.employees} employees, ${s.emails} messages` : "current data"}). Export a backup of the current data first if you may need it.</p>
          </>
        )}
      </ConfirmModal>

      <ConfirmModal open={clearing} onClose={() => setClearing(false)} title="Clear all local data?" confirmLabel="Delete everything" requireText="DELETE" onConfirm={doClear} busy={busy}>
        <p className="font-medium text-red-700">This deletes all employee, email, KPI and analysis data stored in this browser.</p>
        <p>Settings (NMC addresses, phrases, KPI formula), manual review decisions and the audit log are deleted too. This cannot be undone. Nothing is stored anywhere else, so without a backup the data is gone.</p>
        <Button variant="secondary" size="sm" onClick={doExport} disabled={busy}><Download className="h-4 w-4" />Export a backup first</Button>
      </ConfirmModal>
    </Card>
  );
}
