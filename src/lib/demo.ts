import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/database/client";
import { importEmployees } from "./employees/import-export";
import { importBatch } from "./import/importer";
import { saveSettings } from "./settings";
import { logAudit } from "./audit";

/** Loads the SYNTHETIC sample dataset from /sample-data (fictional people only). */
export async function loadDemoData() {
  const dir = path.resolve(process.cwd(), "sample-data");
  const emp = await importEmployees("employees.csv", fs.readFileSync(path.join(dir, "employees.csv")));
  await saveSettings({ nmcAddresses: ["nmc@acme.test"] });
  const batch = await importBatch({ year: 2026, month: 9, text: fs.readFileSync(path.join(dir, "emails-sept-2026.txt"), "utf8") });
  await logAudit("DEMO_LOADED", "System", "", "Synthetic demo dataset loaded", { employees: emp, batch: batch.batchNumber });
  return { employees: emp, batch };
}

/** Deletes ALL local data (emails, batches, audit log). Optionally also employees and settings. */
export async function resetData(opts: { employees?: boolean; settings?: boolean } = {}) {
  await prisma.email.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.auditLog.deleteMany();
  if (opts.employees) await prisma.employee.deleteMany();
  if (opts.settings) await prisma.setting.deleteMany();
  await logAudit("DATA_RESET", "System", "", `Local data reset (emails${opts.employees ? ", employees" : ""}${opts.settings ? ", settings" : ""})`, opts);
}
