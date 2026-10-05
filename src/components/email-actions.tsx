"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { api, fmtDate } from "@/lib/client";
import { CLASS_LABELS, REVIEW_REASON_LABELS, type Classification, type ReviewReason } from "@/lib/types";
import type { listEmails } from "@/lib/import/emails";
import { Badge, Button, ClassBadge, Input, Modal, Select, useToast } from "./ui";

export const parseReasons = (json: string): ReviewReason[] => { try { return JSON.parse(json); } catch { return []; } };
export const ReasonBadges = ({ json }: { json: string }) => (
  <>{parseReasons(json).map((r) => <Badge key={r} className="mr-1 bg-red-50 text-red-700">{REVIEW_REASON_LABELS[r] ?? r}</Badge>)}</>
);

export interface ActionEmail {
  id: string; finalClass: string; employeeId: string | null; monthDecision: string; isManual: boolean;
  year: number; month: number; duplicateOfId?: string | null; possibleDuplicateOfId?: string | null;
}

type Candidates = Awaited<ReturnType<typeof listEmails>>;

/** Choose the original email for a duplicate (suggestion pre-selected when the system found one). */
function DuplicatePicker({ email, onPick, onClose }: { email: ActionEmail; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Candidates | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Candidates>(`/api/emails?year=${email.year}&month=${email.month}&pageSize=12&sort=sentAt&dir=asc${q ? `&q=${encodeURIComponent(q)}` : ""}`)
        .then((d) => { setData(d); setErr(null); }).catch((e: Error) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, email.year, email.month]);
  const suggested = email.duplicateOfId ?? email.possibleDuplicateOfId;
  return (
    <Modal open onClose={onClose} title="Select the original email" wide>
      <p className="mb-3 text-sm text-slate-500">Pick the email that was reported first. This email will be counted as a duplicate of it.</p>
      <Input autoFocus placeholder="Search by subject, employee, incident, location…" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <ul className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200">
        {data?.rows.filter((r) => r.id !== email.id).map((r) => (
          <li key={r.id}>
            <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50" onClick={() => onPick(r.id)}>
              <span className="min-w-0"><span className="block truncate font-medium">{r.subject || "(no subject)"}</span><span className="text-xs text-slate-500">{r.employee?.name ?? r.senderName} · {fmtDate(r.sentAt)}</span></span>
              <span className="flex shrink-0 items-center gap-2">{r.id === suggested && <Badge className="bg-amber-100 text-amber-800">suggested</Badge>}<ClassBadge value={r.finalClass} /></span>
            </button>
          </li>
        ))}
        {data && data.rows.length === 0 && <li className="p-4 text-center text-sm text-slate-400">No emails found.</li>}
        {!data && !err && <li className="p-4 text-center text-sm text-slate-400">Loading…</li>}
      </ul>
    </Modal>
  );
}

const BUTTONS: { cls: Classification; label: string }[] = [
  { cls: "FORWARDED", label: "Forwarded" }, { cls: "NOT_USEFUL", label: "Not Useful" }, { cls: "DUPLICATE", label: "Duplicate" },
  { cls: "PENDING_REVIEW", label: "Pending" }, { cls: "OTHER", label: "Other" },
];

/** One-click review: Confirm / Forwarded / Not Useful / Duplicate (+ pick original) / Pending / Other — shared by Review and Detail. */
export function EmailActions({ email, employees, onDone, compact }: { email: ActionEmail; employees: { id: string; name: string }[]; onDone: () => void; compact?: boolean }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [emp, setEmp] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function run(body: unknown, msg: string) {
    setBusy(true);
    try { await api(`/api/emails/${email.id}`, { method: "PATCH", json: body }); toast("ok", msg); onDone(); }
    catch (e) { toast("error", (e as Error).message); }
    finally { setBusy(false); setPicking(false); }
  }
  const setClass = (cls: Classification, duplicateOfId?: string) =>
    run({ action: "override", classification: cls, reason: reason || undefined, duplicateOfId }, `Marked as ${CLASS_LABELS[cls]}.`);

  return (
    <div className="space-y-3">
      {!email.employeeId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2">
          <span className="text-xs font-medium text-red-700">Unmatched sender — assign to:</span>
          <Select aria-label="Assign employee" value={emp} onChange={(e) => setEmp(e.target.value)} className="max-w-52"><option value="">Choose employee…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
          <Button size="sm" disabled={!emp || busy} onClick={() => run({ action: "assignEmployee", employeeId: emp }, "Employee assigned.")}>Assign</Button>
        </div>
      )}
      {email.monthDecision === "REVIEW" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2">
          <span className="text-xs font-medium text-amber-800">Email date is outside the selected month:</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "monthDecision", decision: "INCLUDED" }, "Included in this month.")}>Include</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "monthDecision", decision: "EXCLUDED" }, "Excluded from this month.")}>Exclude</Button>
        </div>
      )}
      {email.monthDecision === "EXCLUDED" && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "monthDecision", decision: "REVIEW" }, "Moved back to review.")}>Excluded — move back to review</Button>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => run({ action: "approve" }, "Confirmed.")} title="Keep the suggested classification">✓ Confirm</Button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {BUTTONS.map((b) => (
          <Button key={b.cls} size="sm" variant="secondary" disabled={busy}
            className={clsx(email.finalClass === b.cls && "border-blue-600 bg-blue-50 text-blue-800")}
            onClick={() => (b.cls === "DUPLICATE" ? setPicking(true) : setClass(b.cls))}>
            {b.label}{b.cls === "DUPLICATE" ? "…" : ""}
          </Button>
        ))}
        {email.isManual && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ action: "clearOverride" }, "Manual decision removed; re-analyzed.")}>Undo manual</Button>}
        {!compact && <Input placeholder="Note (optional, saved with the next change)" value={reason} onChange={(e) => setReason(e.target.value)} className="ml-2 max-w-xs" />}
      </div>
      {picking && <DuplicatePicker email={email} onClose={() => setPicking(false)} onPick={(id) => setClass("DUPLICATE", id)} />}
    </div>
  );
}
