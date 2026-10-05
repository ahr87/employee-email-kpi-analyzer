"use client";
import { useEffect, useState } from "react";
import { api, fmtDate, useApi } from "@/lib/client";
import { Button, Card, CardHeader, ErrorState, Field, Input, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { useMonth } from "@/components/month";
import { CLASSES, CLASS_LABELS, MONTH_NAMES } from "@/lib/types";
import type { AppSettings } from "@/lib/settings";

export default function SettingsPage() {
  const toast = useToast();
  const month = useMonth();
  const { data, error, loading, reload } = useApi<AppSettings>("/api/settings");
  const audit = useApi<{ logs: { id: string; createdAt: string; action: string; summary: string }[] }>("/api/audit?limit=30");
  const [s, setS] = useState<AppSettings | null>(null);
  const [nmc, setNmc] = useState("");
  const [teams, setTeams] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) { setS(data); setNmc(data.nmcAddresses.join("\n")); setTeams(data.teamKeywords.join(", ")); } }, [data]);

  if (loading && !s) return <Spinner />;
  if (error || !s) return <Card><ErrorState message={error ?? "Failed to load"} onRetry={reload} /></Card>;
  const num = (v: string) => (v === "" ? 0 : Number(v));

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const body = { ...s, nmcAddresses: nmc.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean), teamKeywords: teams.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean) };
      await api("/api/settings", { method: "PUT", json: body });
      toast("ok", "Settings saved. Use \"Re-analyze month\" to apply classification changes to existing emails."); reload(); audit.reload();
    } catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  }
  async function danger(label: string, fn: () => Promise<unknown>) {
    try { await fn(); toast("ok", label); reload(); audit.reload(); } catch (e) { toast("error", (e as Error).message); }
  }
  const k = s.kpi;
  const setK = (patch: Partial<AppSettings["kpi"]>) => setS({ ...s, kpi: { ...k, ...patch } });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Settings</h1><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button></div>

      <Card><CardHeader title="General" /><div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Application name"><Input value={s.appName} onChange={(e) => setS({ ...s, appName: e.target.value })} /></Field>
        <Field label="Default month (used when no month was chosen yet)">
          <div className="flex gap-2">
            <Select value={s.defaultMonth?.month ?? ""} onChange={(e) => setS({ ...s, defaultMonth: e.target.value ? { year: s.defaultMonth?.year ?? new Date().getFullYear(), month: Number(e.target.value) } : null })}><option value="">Latest imported</option>{MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</Select>
            <Input type="number" value={s.defaultMonth?.year ?? new Date().getFullYear()} disabled={!s.defaultMonth} onChange={(e) => setS({ ...s, defaultMonth: { year: Number(e.target.value), month: s.defaultMonth?.month ?? 1 } })} className="w-28" />
          </div>
        </Field>
        <Field label="Numeric date order in pasted emails" hint="How 03/04/2026 is read."><Select value={s.dateOrder} onChange={(e) => setS({ ...s, dateOrder: e.target.value as "DMY" | "MDY" })}><option value="DMY">Day / Month / Year</option><option value="MDY">Month / Day / Year</option></Select></Field>
      </div></Card>

      <Card><CardHeader title="Classification" /><div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Confidence threshold (0–100)" hint="Automatic results below this value go to the Review queue."><Input type="number" min={0} max={100} value={s.confidenceThreshold} onChange={(e) => setS({ ...s, confidenceThreshold: num(e.target.value) })} /></Field>
        <Field label="NMC addresses / domains (one per line)" hint="Replies and forwards sent by these addresses are used as evidence (escalated / answered) and are not counted as employee emails. Example: nmc@company.com or @company-nmc.com"><Textarea rows={3} value={nmc} onChange={(e) => setNmc(e.target.value)} /></Field>
        <Field label="Team / department keywords" hint="Recipient words that suggest an escalation target (comma separated)."><Textarea rows={3} value={teams} onChange={(e) => setTeams(e.target.value)} /></Field>
        <label className="flex items-start gap-2 text-sm text-slate-500"><input type="checkbox" disabled checked={s.aiAssisted} className="mt-1" /><span>AI-assisted analysis <em>(not available yet — the architecture is prepared; the app works fully without any AI and never sends data externally)</em></span></label>
      </div></Card>

      <Card><CardHeader title="Duplicate detection" /><div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Similarity threshold (30–100)" hint="At or above → DUPLICATE. Within 15 points below → flagged as possible duplicate for review."><Input type="number" min={30} max={100} value={s.similarityThreshold} onChange={(e) => setS({ ...s, similarityThreshold: num(e.target.value) })} /></Field>
        <Field label="Time window (hours)" hint="Only emails this close in time are compared (unless they share an incident / circuit / service ID)."><Input type="number" min={1} value={s.duplicateWindowHours} onChange={(e) => setS({ ...s, duplicateWindowHours: num(e.target.value) })} /></Field>
      </div></Card>

      <Card><CardHeader title="KPI" /><div className="space-y-4 p-4">
        <p className="text-xs text-slate-500">KPI score = weighted share of FINAL classifications × 100, minus penalties. Email volume alone never raises the score. Changes apply instantly to all reports (no re-analysis needed).</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {CLASSES.map((c) => (
            <Field key={c} label={`${CLASS_LABELS[c]} weight (0–1)`}><Input type="number" step="0.1" min={0} max={1} value={k.weights[c]} onChange={(e) => setK({ weights: { ...k.weights, [c]: num(e.target.value) } })} /></Field>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Penalty per Duplicate (points)"><Input type="number" min={0} value={k.penaltiesPerEmail.DUPLICATE ?? 0} onChange={(e) => setK({ penaltiesPerEmail: { ...k.penaltiesPerEmail, DUPLICATE: num(e.target.value) } })} /></Field>
          <Field label="Penalty per Not Useful (points)"><Input type="number" min={0} value={k.penaltiesPerEmail.NOT_USEFUL ?? 0} onChange={(e) => setK({ penaltiesPerEmail: { ...k.penaltiesPerEmail, NOT_USEFUL: num(e.target.value) } })} /></Field>
          <Field label="Pending review emails"><Select value={k.pendingMode} onChange={(e) => setK({ pendingMode: e.target.value as "exclude" | "weighted" })}><option value="exclude">Exclude from score</option><option value="weighted">Count using weight</option></Select></Field>
          <Field label="Minimum emails to score"><Input type="number" min={1} value={k.minimumEmails} onChange={(e) => setK({ minimumEmails: num(e.target.value) })} /></Field>
          <Field label="Target score"><Input type="number" min={0} max={100} value={k.target} onChange={(e) => setK({ target: num(e.target.value) })} /></Field>
          <Field label="Excellent ≥"><Input type="number" value={k.thresholds.excellent} onChange={(e) => setK({ thresholds: { ...k.thresholds, excellent: num(e.target.value) } })} /></Field>
          <Field label="Good ≥"><Input type="number" value={k.thresholds.good} onChange={(e) => setK({ thresholds: { ...k.thresholds, good: num(e.target.value) } })} /></Field>
          <Field label="Fair ≥"><Input type="number" value={k.thresholds.fair} onChange={(e) => setK({ thresholds: { ...k.thresholds, fair: num(e.target.value) } })} /></Field>
        </div>
      </div></Card>

      <Card><CardHeader title="Re-analysis & data" /><div className="space-y-3 p-4 text-sm">
        <p className="text-slate-500">Selected month: <strong>{MONTH_NAMES[month.month - 1]} {month.year}</strong>. Manual decisions are always protected unless you choose the full reset.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => danger("Month re-analyzed (manual decisions kept).", () => api("/api/emails/reanalyze", { method: "POST", json: { year: month.year, month: month.month } }))}>Re-analyze month</Button>
          <Button variant="secondary" onClick={() => confirm("Re-analyze and DISCARD all manual decisions for this month?") && danger("Month re-analyzed; manual decisions discarded.", () => api("/api/emails/reanalyze", { method: "POST", json: { year: month.year, month: month.month, resetManual: true } }))}>Re-analyze + reset manual decisions</Button>
          <Button variant="secondary" onClick={() => danger("Synthetic demo data loaded.", () => api("/api/admin/demo", { method: "POST" }))}>Load synthetic demo data</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <Button variant="danger" onClick={() => { if (confirm(`Delete ALL emails and batches of ${MONTH_NAMES[month.month - 1]} ${month.year}? This cannot be undone.`)) danger("Month dataset deleted.", () => api("/api/admin/month", { method: "DELETE", json: { year: month.year, month: month.month, confirm: "DELETE" } })); }}>Delete this month&apos;s dataset</Button>
          <Button variant="danger" onClick={() => { const t = prompt("This permanently deletes ALL emails, batches and the audit log (employees and settings are kept).\nType RESET to confirm."); if (t === "RESET") danger("All email data deleted.", () => api("/api/admin/reset", { method: "POST", json: { confirm: "RESET" } })); }}>Reset all email data</Button>
          <Button variant="danger" onClick={() => { const t = prompt("This permanently deletes EVERYTHING: emails, employees, settings and audit log.\nType RESET to confirm."); if (t === "RESET") danger("Everything deleted.", () => api("/api/admin/reset", { method: "POST", json: { confirm: "RESET", employees: true, settings: true } })); }}>Reset everything</Button>
        </div>
        <p className="text-xs text-slate-400">Employee import/export lives on the Employees page (CSV and Excel).</p>
      </div></Card>

      <Card><CardHeader title="Audit log (latest 30)" />
        <ul className="divide-y divide-slate-100">{audit.data?.logs.map((l) => <li key={l.id} className="px-4 py-2 text-sm"><span className="text-xs text-slate-400">{fmtDate(l.createdAt)}</span> · <span className="text-xs font-medium text-slate-500">{l.action}</span> · {l.summary}</li>)}{!audit.data?.logs.length && <li className="p-4 text-sm text-slate-400">No entries yet.</li>}</ul>
      </Card>
    </div>
  );
}
