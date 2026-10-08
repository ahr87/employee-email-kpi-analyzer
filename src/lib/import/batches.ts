import { getDb } from "../db";
import type { BatchRec } from "../storage/types";

export type BatchView = Omit<BatchRec, "warnings"> & { warnings: string[] };

export async function listBatches(year?: number, month?: number): Promise<BatchView[]> {
  const db = await getDb();
  return db.batches.all()
    .filter((b) => (!year || b.year === year) && (!month || b.month === month))
    .sort((a, b) => b.number - a.number)
    .map((b) => ({ ...b, warnings: JSON.parse(b.warnings || "[]") as string[] }));
}
