import { getDb } from "../db";
import type { BatchRec } from "../storage/types";

export type BatchView = Omit<BatchRec, "warnings"> & { warnings: string[]; /** messages of this batch that belong to the requested month */ inMonth: number };

/** Batches that contain messages of the given month (an Outlook export may span several months), newest first. */
export async function listBatches(year?: number, month?: number): Promise<BatchView[]> {
  const db = await getDb();
  const perBatch = new Map<string, number>();
  if (year && month) for (const e of db.emails.all()) if (e.year === year && e.month === month) perBatch.set(e.batchId, (perBatch.get(e.batchId) ?? 0) + 1);
  return db.batches.all()
    .filter((b) => !(year && month) || perBatch.has(b.id) || (b.year === year && b.month === month))
    .sort((a, b) => b.number - a.number)
    .map((b) => ({ ...b, warnings: JSON.parse(b.warnings || "[]") as string[], inMonth: perBatch.get(b.id) ?? 0 }));
}
