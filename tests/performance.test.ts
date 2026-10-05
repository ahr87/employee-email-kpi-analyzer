import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/database/client";
import { importBatch } from "@/lib/import/importer";
import { monthlyStats } from "@/lib/reports/aggregate";
import { monthlyXlsx } from "@/lib/reports/excel";
import { saveSettings } from "@/lib/settings";
import { resetData } from "@/lib/demo";
import { listEmails } from "@/lib/import/emails";
import { msg, NMC } from "./helpers";

const N = 2500;

beforeAll(async () => {
  await resetData({ employees: true, settings: true });
  await prisma.employee.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ employeeId: `P${i}`, name: `Perf User ${i}`, email: `perf${i}@acme.test` })) });
  await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", label: "", enabled: true }] });
}, 60_000);

describe("thousands of emails", () => {
  it(`imports, analyzes, aggregates and exports ${N} emails in a few batches`, async () => {
    const t0 = Date.now();
    const parts: string[] = [];
    for (let i = 0; i < N; i++) {
      const at = new Date(Date.UTC(2026, 8, 1 + (i % 28), 8 + (i % 9), (i * 7) % 60));
      parts.push(msg({ from: `Perf User ${i % 40}`, email: `perf${i % 40}@acme.test`, at, subject: `Fault report ${i} at Site P${i}`, body: `Customers at Site P${i} report a fault. ${"Lorem ipsum dolor sit amet. ".repeat(10)}` }));
      if (i % 3 === 0) parts.push(msg(NMC(new Date(at.getTime() + 600_000), `${i % 2 ? "FW" : "RE"}: Fault report ${i} at Site P${i}`, i % 2 ? "Escalated to the field team." : "No action required.", { to: "Field <field@acme.test>" })));
    }
    const per = Math.ceil(parts.length / 3);
    let imported = 0;
    for (let b = 0; b < 3; b++) imported += (await importBatch({ year: 2026, month: 9, text: parts.slice(b * per, (b + 1) * per).join("\n") })).newEmails;
    const tImport = Date.now() - t0;
    expect(imported).toBe(parts.length);

    const t1 = Date.now();
    const s = await monthlyStats(2026, 9);
    expect(s.totalEmails).toBe(N);
    const page = await listEmails({ year: 2026, month: 9, page: 3, pageSize: 25, sort: "sentAt", dir: "asc" });
    expect(page.rows).toHaveLength(25);
    const xlsx = await monthlyXlsx(2026, 9);
    expect(xlsx.length).toBeGreaterThan(10_000);
    const tReport = Date.now() - t1;
    console.log(`PERF ${N} emails (${parts.length} messages): import+analysis ${tImport} ms, stats+page+xlsx ${tReport} ms`);
    expect(tImport).toBeLessThan(120_000);
    expect(tReport).toBeLessThan(20_000);
  }, 300_000);
});
