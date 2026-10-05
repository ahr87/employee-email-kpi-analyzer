"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { CLASSES, CLASS_LABELS, REVIEW_REASON_LABELS, type ReviewReason } from "@/lib/types";
import { Badge, Button, Input, Select, useToast } from "./ui";

export const parseReasons = (json: string): ReviewReason[] => { try { return JSON.parse(json); } catch { return []; } };
export const ReasonBadges = ({ json }: { json: string }) => (
  <>{parseReasons(json).map((r) => <Badge key={r} className="mr-1 bg-red-50 text-red-700">{REVIEW_REASON_LABELS[r] ?? r}</Badge>)}</>
);

export interface ActionEmail { id: string; finalClass: string; employeeId: string | null; monthDecision: string; isManual: boolean }

/** Approve / change classification / assign employee / decide out-of-month — shared by Review and Detail pages. */
export function EmailActions({ email, employees, onDone, compact }: { email: ActionEmail; employees: { id: string; name: string }[]; onDone: () => void; compact?: boolean }) {
  const toast = useToast();
  const [cls, setCls] = useState(email.finalClass);
  const [reason, setReason] = useState("");
  const [emp, setEmp] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(body: unknown, msg: string) {
    setBusy(true);
    try { await api(`/api/emails/${email.id}`, { method: "PATCH", json: body }); toast("ok", msg); onDone(); }
    catch (e) { toast("error", (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {!email.employeeId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2">
          <span className="text-xs font-medium text-red-700">Unmatched sender — assign to:</span>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)} className="max-w-52"><option value="">Choose employee…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
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
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Classification" value={cls} onChange={(e) => setCls(e.target.value)} className="w-52">
          {CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABELS[c]}</option>)}
        </Select>
        {!compact && <Input placeholder="Override reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />}
        <Button size="sm" disabled={busy || cls === email.finalClass} onClick={() => run({ action: "override", classification: cls, reason: reason || undefined }, "Classification updated.")}>Change</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "approve" }, "Classification approved.")}>Approve</Button>
        {email.isManual && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ action: "clearOverride" }, "Manual decision removed; re-analyzed.")}>Undo manual</Button>}
      </div>
    </div>
  );
}
