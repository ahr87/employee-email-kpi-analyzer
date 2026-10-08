"use client";
import { Trash2 } from "lucide-react";
import { fmtDate } from "@/lib/client";
import type { BatchView } from "@/lib/import/batches";
import { Badge, Button, Td, Th } from "./ui";

export const SourceBadge = ({ source }: { source: string }) => (
  <Badge className={source === "Outlook Desktop" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}>{source === "Outlook Desktop" ? "Outlook import" : "Paste"}</Badge>
);

const range = (b: BatchView) => (b.dateFrom && b.dateTo ? `${fmtDate(b.dateFrom).slice(0, 10)} → ${fmtDate(b.dateTo).slice(0, 10)}` : "—");

/** Import batches with their source (Paste / Outlook Desktop + file name), size and status. */
export function BatchesTable({ batches, onDelete, showInMonth }: { batches: BatchView[]; onDelete: (b: BatchView) => void; showInMonth?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead><tr><Th>Batch</Th><Th>Source</Th><Th>Imported</Th><Th>Messages</Th>{showInMonth && <Th className="text-right">This month</Th>}<Th className="text-right">New</Th><Th className="text-right">Exact duplicates</Th><Th className="text-right">Needs review</Th><Th>Status</Th><Th> </Th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <Td>Batch {String(b.number).padStart(3, "0")}</Td>
              <Td>
                <SourceBadge source={b.source} />
                {b.filename && <div className="mt-0.5 max-w-56 truncate text-xs text-slate-500" title={b.filename}>{b.filename}</div>}
                {b.source === "Outlook Desktop" && <div className="text-[11px] text-slate-400">{range(b)} · {b.uniqueSenders} senders · {b.uniqueConversations} conversations</div>}
              </Td>
              <Td>{fmtDate(b.createdAt)}</Td>
              <Td className="text-right">{b.totalParsed}</Td>
              {showInMonth && <Td className="text-right">{b.inMonth}</Td>}
              <Td className="text-right">{b.newEmails}</Td><Td className="text-right">{b.exactDuplicates}</Td><Td className="text-right">{b.needsReview}</Td>
              <Td><Badge className={b.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-red-100 text-red-800"}>{b.status === "COMPLETED" ? "Completed" : b.status === "IMPORTING" ? "Incomplete — import again" : "Analysis failed — re-analyze"}</Badge></Td>
              <Td><Button variant="ghost" size="sm" onClick={() => onDelete(b)} aria-label={`Delete batch ${b.number}`}><Trash2 className="h-4 w-4" /></Button></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
