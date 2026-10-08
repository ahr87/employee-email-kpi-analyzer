import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { attachAdapter } from "@/lib/db";
import { IndexedDbAdapter } from "@/lib/storage/indexeddb";
import { importBatch } from "@/lib/import/importer";
import { monthlyStats } from "@/lib/reports/aggregate";
import { monthlyXlsx } from "@/lib/reports/excel";
import { saveSettings } from "@/lib/settings";
import { createEmployee } from "@/lib/employees/service";
import { exportBackup, restoreBackup, validateBackup } from "@/lib/backup";
import { msg, NMC } from "./helpers";

describe("IndexedDB with thousands of emails", () => {
  it("imports, persists, reloads, backs up and restores 2,000 emails quickly", async () => {
    await attachAdapter(new IndexedDbAdapter());
    for (let i = 0; i < 30; i++) await createEmployee({ employeeId: `P${i}`, name: `Perf User ${i}`, email: `perf${i}@acme.test` });
    await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", label: "", enabled: true }] });
    const parts: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const at = new Date(Date.UTC(2026, 8, 1 + (i % 28), 8 + (i % 9), (i * 7) % 60));
      parts.push(msg({ from: `Perf User ${i % 30}`, email: `perf${i % 30}@acme.test`, at, subject: `Fault report ${i} at Site P${i}`, body: `Customers at Site P${i} report a fault. ${"Lorem ipsum dolor sit amet. ".repeat(10)}` }));
      if (i % 3 === 0) parts.push(msg(NMC(new Date(at.getTime() + 600_000), `FW: Fault report ${i} at Site P${i}`, "Escalated to the field team.", { to: "Field <field@acme.test>" })));
    }
    const t0 = Date.now();
    const half = Math.ceil(parts.length / 2);
    for (const slice of [parts.slice(0, half), parts.slice(half)]) await importBatch({ year: 2026, month: 9, text: slice.join("\n") });
    const tImport = Date.now() - t0;

    const db = await attachAdapter(new IndexedDbAdapter()); // "reopen the site": everything comes back from IndexedDB
    expect(db.emails.size).toBe(parts.length);
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(2000);

    const t1 = Date.now();
    const { json } = await exportBackup();
    const check = validateBackup(json);
    expect(check.ok).toBe(true);
    if (check.ok) await restoreBackup(check.backup);
    expect((await monthlyXlsx(2026, 9)).length).toBeGreaterThan(10_000);
    const tBackup = Date.now() - t1;
    console.log(`PERF-IDB import ${tImport} ms, backup+validate+restore+xlsx ${tBackup} ms (${(json.length / 1e6).toFixed(1)} MB json)`);
    expect(tImport).toBeLessThan(90_000);
    expect(tBackup).toBeLessThan(60_000);
  }, 300_000);
});
