import { prisma } from "../database/client";
import { importEmployees } from "../employees/import-export";
import { importBatch } from "../import/importer";
import { saveSettings } from "../settings";
import { logAudit } from "../audit";
import { buildDemoMonth } from "./generate";

/** Loads the SYNTHETIC demo month (fictional people, places and tickets) — 12 employees, 100+ emails in 3 batches. */
export async function loadDemoData() {
  const demo = buildDemoMonth();
  const csv = ["Employee ID,Employee Name,Email Address,Department,Team,Active", ...demo.employees.map((e) => `${e.employeeId},${e.name},${e.email},${e.department},${e.team},Yes`)].join("\n");
  const emp = await importEmployees("employees.csv", Buffer.from(csv, "utf8"));
  await saveSettings({ nmcAddresses: demo.nmcAddresses.map((address) => ({ address, label: "NMC (demo)", enabled: true })), defaultMonth: { year: demo.year, month: demo.month } });
  const batches = [];
  for (const text of demo.batches) batches.push(await importBatch({ year: demo.year, month: demo.month, text }));
  await logAudit("DEMO_LOADED", "System", "", "Synthetic demo dataset loaded", { employees: emp, batches: batches.map((b) => b.batchNumber) });
  return { employees: emp, batch: batches[batches.length - 1], batches };
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
