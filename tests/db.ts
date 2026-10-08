import { Db, getDb, attachAdapter } from "@/lib/db";
import { MemoryAdapter } from "@/lib/storage/storage";
import { createEmployee } from "@/lib/employees/service";
import type { EmailRec } from "@/lib/storage/types";

/** A brand-new empty in-memory database (what the IndexedDB adapter would persist, minus the browser). */
export const freshDb = (): Promise<Db> => attachAdapter(new MemoryAdapter());

export async function seedEmployees(rows: { employeeId: string; name: string; email: string; department?: string; team?: string }[]) {
  for (const r of rows) await createEmployee({ department: "", team: "", ...r });
}

/** Tiny query helpers over the stored emails (tests only). */
export const q = {
  emails: async (pred: (e: EmailRec) => boolean = () => true) => (await getDb()).emails.all().filter(pred),
  email: async (pred: (e: EmailRec) => boolean) => {
    const e = (await getDb()).emails.all().find(pred);
    if (!e) throw new Error("No matching email");
    return e;
  },
  count: async (pred: (e: EmailRec) => boolean = () => true) => (await getDb()).emails.all().filter(pred).length,
  batches: async () => (await getDb()).batches.all(),
};
