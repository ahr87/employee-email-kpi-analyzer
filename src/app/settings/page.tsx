"use client";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { errorMessage, fmtDate, useQuery } from "@/lib/client";
import { getSettings, saveSettings } from "@/lib/settings";
import { listAudit } from "@/lib/audit";
import { analyzeAllMonths, analyzeMonth } from "@/lib/import/analyze";
import { deleteMonthDataset, resetData } from "@/lib/data-management";
import { loadDemoData } from "@/lib/demo";
import { LocalDataCard } from "@/components/local-data";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { useMonth } from "@/components/month";
import { CLASSES, CLASS_LABELS, MONTH_NAMES } from "@/lib/types";
import { DEFAULT_PHRASES, type PhraseLists } from "@/lib/classification/phrases";
import type { AppSettings, NmcEntry } from "@/lib/settings";

const PHRASE_META: { key: keyof PhraseLists; title: string; hint: string }[] = [
  { key: "escalation", title: "Escalation phrases", hint: "NMC says it forwarded / escalated / asked another team to act (evidence for FORWARDED)." },
  { key: "notUseful", title: "Not-useful phrases", hint: "NMC says no action is needed, already known, informational… (evidence for NOT USEFUL)." },
  { key: "duplicate", title: "Duplicate phrases", hint: "NMC says the issue was already reported / is a duplicate (evidence for DUPLICATE)." },
  { key: "useful", title: "Useful / action phrases", hint: "NMC acknowledges or is working on it. Supporting evidence only — never enough on its own." },
];

const isValidAddress = (a: string) => /^@?[^\s@]+\.[^\s@]+$/.test(a) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);

export default function SettingsPage() {
  const toast = useToast();
  const month = useMonth();
  const { data, error, loading, reload } = useQuery("settings", getSettings);
  const audit = useQuery("audit", () => listAudit({ limit: 30 }));
  const [s, setS] = useState<AppSettings | null>(null);
  const [teams, setTeams] = useState("");
  const [phrases, setPhrases] = useState<Record<keyof PhraseLists, string>>({ escalation: "", notUseful: "", duplicate: "", useful: "" });
  const [saving, setSaving] = useState(false);
  const [reanalyze, setReanalyze] = useState(true);
  const [edit, setEdit] = useState<{ index: number; entry: NmcEntry } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0); // bumps whenever stored data changes, so the Local data card refreshes

  useEffect(() => {
    if (!data) return;
    setS(data);
    setTeams(data.teamKeywords.join(", "));
    setPhrases(Object.fromEntries(PHRASE_META.map((m) => [m.key, data.phrases[m.key].join("\n")])) as Record<keyof PhraseLists, string>);
    setDirty(false);
  }, [data]);

  if (loading && !s) return <Spinner />;
  if (error || !s) return <Card><ErrorState message={error ?? "Failed to load"} onRetry={reload} /></Card>;
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const upd = (p: Partial<AppSettings>) => { setS({ ...s, ...p }); setDirty(true); };

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const lines = (v: string) => v.split(/\n+/).map((x) => x.trim()).filter(Boolean);
      const body = {
        ...s,
        teamKeywords: teams.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean),
        phrases: Object.fromEntries(PHRASE_META.map((m) => [m.key, lines(phrases[m.key])])),
        reanalyze,
      };
      const { reanalyze: again, ...patch } = body;
      await saveSettings(patch);
      const months = again ? await analyzeAllMonths() : 0;
      toast("ok", months ? `Settings saved; ${months} month(s) re-analyzed (manual decisions kept).` : "Settings saved.");
      reload(); audit.reload(); setVersion((v) => v + 1);
    } catch (e) { toast("error", errorMessage(e)); } finally { setSaving(false); }
  }
  async function danger(label: string, fn: () => Promise<unknown>) {
    try { await fn(); toast("ok", label); reload(); audit.reload(); setVersion((v) => v + 1); } catch (e) { toast("error", errorMessage(e)); }
  }
  const k = s.kpi;
  const setK = (patch: Partial<AppSettings["kpi"]>) => upd({ kpi: { ...k, ...patch } });

  const saveEntry = () => {
    if (!edit) return;
    const a = edit.entry.address.trim();
    if (!isValidAddress(a)) { toast("error", "Enter an email address (nmc@company.com) or a domain (@company.com)."); return; }
    if (s.nmcAddresses.some((x, i) => i !== edit.index && x.address.toLowerCase() === a.toLowerCase())) { toast("error", "That address is already in the list."); return; }
    const list = [...s.nmcAddresses];
    const entry = { ...edit.entry, address: a };
    if (edit.index >= list.length) list.push(entry); else list[edit.index] = entry;
    upd({ nmcAddresses: list });
    setEdit(null);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-slate-50/95 px-1 py-2 backdrop-blur">
        <h1 className="text-2xl font-semibold">Settings {dirty && <Badge className="ml-2 bg-amber-100 text-amber-800">unsaved changes</Badge>}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={reanalyze} onChange={(e) => setReanalyze(e.target.checked)} /> Re-analyze existing emails after saving</label>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </div>
      </div>

      <Card>
        <CardHeader title="NMC addresses" action={<Button size="sm" onClick={() => setEdit({ index: s.nmcAddresses.length, entry: { address: "", label: "", enabled: true } })}><Plus className="h-4 w-4" />Add</Button>} />
        <div className="space-y-2 p-4">
          <p className="text-xs text-slate-500">Messages sent from these addresses are recognised as NMC replies/forwards inside copied conversations. They are kept as <strong>evidence</strong> and never counted as employee emails. Use a full address or a whole domain (<code>@company.com</code>).</p>
          {s.nmcAddresses.length === 0 && <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">No NMC address configured — without one, replies and forwards cannot be recognised and most emails will stay in Pending Review.</p>}
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {s.nmcAddresses.map((n, i) => (
              <li key={n.address} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" aria-label={`Enable ${n.address}`} checked={n.enabled} onChange={(e) => upd({ nmcAddresses: s.nmcAddresses.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
                <span className={n.enabled ? "font-medium" : "text-slate-400 line-through"}>{n.address}</span>
                {n.label && <span className="text-xs text-slate-400">{n.label}</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${n.address}`} onClick={() => setEdit({ index: i, entry: { ...n } })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${n.address}`} onClick={() => upd({ nmcAddresses: s.nmcAddresses.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
          {edit && (
            <div className="flex flex-wrap items-end gap-2 rounded border border-blue-200 bg-blue-50 p-3">
              <Field label="Address or @domain"><Input autoFocus value={edit.entry.address} onChange={(e) => setEdit({ ...edit, entry: { ...edit.entry, address: e.target.value } })} placeholder="nmc@company.com" className="w-64" /></Field>
              <Field label="Label (optional)"><Input value={edit.entry.label} onChange={(e) => setEdit({ ...edit, entry: { ...edit.entry, label: e.target.value } })} className="w-48" /></Field>
              <Button size="sm" onClick={saveEntry}>OK</Button><Button size="sm" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          )}
        </div>
      </Card>

      <Card><CardHeader title="General" /><div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Application name"><Input value={s.appName} onChange={(e) => upd({ appName: e.target.value })} /></Field>
        <Field label="Default month (when none was chosen yet)">
          <div className="flex gap-2">
            <Select value={s.defaultMonth?.month ?? ""} onChange={(e) => upd({ defaultMonth: e.target.value ? { year: s.defaultMonth?.year ?? new Date().getFullYear(), month: Number(e.target.value) } : null })}><option value="">Latest imported</option>{MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</Select>
            <Input type="number" value={s.defaultMonth?.year ?? new Date().getFullYear()} disabled={!s.defaultMonth} onChange={(e) => upd({ defaultMonth: { year: Number(e.target.value), month: s.defaultMonth?.month ?? 1 } })} className="w-28" />
          </div>
        </Field>
        <Field label="Numeric date order in pasted emails" hint={s.dateOrderLearned ? "✓ Verified automatically from your pasted dates." : "How 03/04/2026 is read. Verified automatically once a pasted date proves the order (e.g. 25/04)."}><Select value={s.dateOrder} onChange={(e) => upd({ dateOrder: e.target.value as "DMY" | "MDY" })}><option value="DMY">Day / Month / Year</option><option value="MDY">Month / Day / Year</option></Select></Field>
      </div></Card>

      <Card><CardHeader title="Classification" /><div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Confidence threshold (0–100)" hint="Automatic results below this value go to the Review queue."><Input type="number" min={0} max={100} value={s.confidenceThreshold} onChange={(e) => upd({ confidenceThreshold: num(e.target.value) })} /></Field>
        <Field label="Team / department keywords" hint="Words in recipient names/addresses that suggest an escalation target (comma separated)."><Textarea rows={3} value={teams} onChange={(e) => { setTeams(e.target.value); setDirty(true); }} /></Field>
        <label className="flex items-start gap-2 text-sm text-slate-500 md:col-span-2"><input type="checkbox" disabled checked={s.aiAssisted} className="mt-1" /><span>AI-assisted analysis <em>(not available — the app works fully without AI and never sends data externally)</em></span></label>
      </div></Card>

      <Card>
        <CardHeader title="Evidence phrases" action={<Button size="sm" variant="secondary" onClick={() => { setPhrases(Object.fromEntries(PHRASE_META.map((m) => [m.key, DEFAULT_PHRASES[m.key].join("\n")])) as Record<keyof PhraseLists, string>); setDirty(true); }}>Reset to defaults</Button>} />
        <div className="space-y-4 p-4">
          <p className="text-xs text-slate-500">One phrase per line, English and/or Arabic (letter variants like أ/ا and diacritics are ignored). Phrases are <strong>evidence only</strong>: they count when found in an NMC message after the employee&apos;s email, not in the employee&apos;s own text, and negated uses (“not forwarded”) are skipped.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {PHRASE_META.map((m) => (
              <Field key={m.key} label={m.title} hint={m.hint}>
                <Textarea rows={8} dir="auto" value={phrases[m.key]} onChange={(e) => { setPhrases({ ...phrases, [m.key]: e.target.value }); setDirty(true); }} className="font-mono text-xs" />
              </Field>
            ))}
          </div>
        </div>
      </Card>

      <Card><CardHeader title="Duplicate detection" /><div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Similarity threshold (30–100)" hint="At or above → DUPLICATE. Within 15 points below → flagged as possible duplicate for review. Same incident / circuit / service / device evidence is weighted much higher than similar wording."><Input type="number" min={30} max={100} value={s.similarityThreshold} onChange={(e) => upd({ similarityThreshold: num(e.target.value) })} /></Field>
        <Field label="Time window (hours)" hint="Only emails this close in time are compared (unless they share an incident / circuit ID)."><Input type="number" min={1} value={s.duplicateWindowHours} onChange={(e) => upd({ duplicateWindowHours: num(e.target.value) })} /></Field>
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

      <LocalDataCard version={version} onChanged={() => { reload(); audit.reload(); setVersion((v) => v + 1); }} />

      <Card><CardHeader title="Re-analysis & demo data" /><div className="space-y-3 p-4 text-sm">
        <p className="text-slate-500">Selected month: <strong>{MONTH_NAMES[month.month - 1]} {month.year}</strong>. Manual decisions are always protected unless you choose the full reset.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => danger("Month re-analyzed (manual decisions kept).", () => analyzeMonth(month.year, month.month, { audit: true }))}>Re-analyze month</Button>
          <Button variant="secondary" onClick={() => confirm("Re-analyze and DISCARD all manual decisions for this month?") && danger("Month re-analyzed; manual decisions discarded.", () => analyzeMonth(month.year, month.month, { audit: true, resetManual: true }))}>Re-analyze + reset manual decisions</Button>
          <Button variant="secondary" onClick={() => danger("Synthetic demo data loaded (September 2026).", async () => { await loadDemoData(); month.set(2026, 9); })}>Load synthetic demo data</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <Button variant="danger" onClick={() => { if (confirm(`Delete ALL emails and batches of ${MONTH_NAMES[month.month - 1]} ${month.year}? This cannot be undone.`)) danger("Month dataset deleted.", () => deleteMonthDataset(month.year, month.month)); }}>Delete this month&apos;s dataset</Button>
          <Button variant="danger" onClick={() => { const t = prompt("This permanently deletes ALL emails, batches and the audit log (employees and settings are kept).\nType RESET to confirm."); if (t === "RESET") danger("All email data deleted.", () => resetData()); }}>Delete all emails (keep employees &amp; settings)</Button>
          
        </div>
        <p className="text-xs text-slate-400">Employee import/export lives on the Employees page (CSV and Excel).</p>
      </div></Card>

      <Card><CardHeader title="Audit log (latest 30)" />
        <ul className="divide-y divide-slate-100">{audit.data?.map((l) => <li key={l.id} className="px-4 py-2 text-sm"><span className="text-xs text-slate-400">{fmtDate(l.createdAt)}</span> · <span className="text-xs font-medium text-slate-500">{l.action}</span> · {l.summary}</li>)}{!audit.data?.length && <li className="p-4 text-sm text-slate-400">No entries yet.</li>}</ul>
      </Card>
    </div>
  );
}
