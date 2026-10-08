import { getDb } from "../db";
import { logAudit } from "../audit";
import { analyzeMonth } from "../import/analyze";
import { TABLES } from "../storage/types";

export interface StorageSummary {
  mode: "indexeddb" | "memory";
  employees: number;
  emails: number;
  batches: number;
  months: number;
  usageBytes: number | null;
}

export async function storageSummary(): Promise<StorageSummary> {
  const db = await getDb();
  const months = new Set(db.emails.all().map((e) => `${e.year}-${e.month}`));
  return {
    mode: db.adapter.kind, employees: db.employees.size, emails: db.emails.size, batches: db.batches.size, months: months.size,
    usageBytes: await db.adapter.usage(),
  };
}

/** Deletes email data (emails, batches, audit log). Optionally also employees and settings. */
export async function resetData(opts: { employees?: boolean; settings?: boolean } = {}) {
  const db = await getDb();
  await db.clearAll(["emails", "batches", "audit", ...(opts.employees ? (["employees"] as const) : []), ...(opts.settings ? (["settings"] as const) : [])]);
  await logAudit("DATA_RESET", "System", "", `Local data reset (emails${opts.employees ? ", employees" : ""}${opts.settings ? ", settings" : ""})`, opts);
}

/** Deletes EVERYTHING stored by this application in the browser (no audit entry is kept either). */
export async function clearAllLocalData() {
  const db = await getDb();
  await db.clearAll(TABLES);
}

/** Deletes the whole dataset (all batches and emails) of one month. */
export async function deleteMonthDataset(year: number, month: number) {
  const db = await getDb();
  const emails = db.emails.all().filter((e) => e.year === year && e.month === month);
  const batches = db.batches.all().filter((b) => b.year === year && b.month === month);
  const gone = new Set(emails.map((e) => e.id));
  const relinked = db.emails.all()
    .filter((e) => !gone.has(e.id) && ((e.duplicateOfId && gone.has(e.duplicateOfId)) || (e.possibleDuplicateOfId && gone.has(e.possibleDuplicateOfId))))
    .map((e) => ({ ...e, duplicateOfId: e.duplicateOfId && gone.has(e.duplicateOfId) ? null : e.duplicateOfId, possibleDuplicateOfId: e.possibleDuplicateOfId && gone.has(e.possibleDuplicateOfId) ? null : e.possibleDuplicateOfId }));
  await db.apply([{ table: "emails", delete: [...gone], put: relinked }, { table: "batches", delete: batches.map((b) => b.id) }]);
  await logAudit("DATASET_DELETED", "Month", `${year}-${month}`, `Dataset ${year}-${String(month).padStart(2, "0")} deleted (${emails.length} emails)`, { year, month, emails: emails.length });
  return emails.length;
}

/** Re-runs the analysis of one month (manual decisions stay protected unless resetManual). */
export const reanalyzeMonth = analyzeMonth;
