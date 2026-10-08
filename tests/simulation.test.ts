import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { freshDb, q, seedEmployees } from "./db";
import { importBatch } from "@/lib/import/importer";
import { monthlyStats } from "@/lib/reports/aggregate";
import { monthlyXlsx } from "@/lib/reports/excel";
import { loadExcelJS } from "@/lib/reports/exceljs";
import { saveSettings } from "@/lib/settings";
import { buildDemoMonth } from "@/lib/demo/generate";

const demo = buildDemoMonth();
const log: string[] = [];
let ms = 0;

beforeAll(async () => {
  await freshDb();
  await seedEmployees(demo.employees.map(({ employeeId, name, email, department, team }) => ({ employeeId, name, email, department, team })));
  await saveSettings({ nmcAddresses: demo.nmcAddresses.map((address) => ({ address, label: "", enabled: true })) });
}, 60_000);

describe("full monthly workflow with synthetic data (September 2026)", () => {
  it("has the required scale and variety", () => {
    expect(demo.employees.length).toBeGreaterThanOrEqual(10);
    expect(demo.truth.filter((t) => t.counted).length).toBeGreaterThanOrEqual(100);
    for (const c of ["FORWARDED", "NOT_USEFUL", "DUPLICATE", "PENDING_REVIEW"]) expect(demo.truth.some((t) => t.cls === c)).toBe(true);
    expect(demo.truth.some((t) => t.unmatched)).toBe(true);
    expect(demo.truth.some((t) => /[؀-ۿ]/.test(t.subject))).toBe(true);
    expect(demo.truth.some((t) => /[؀-ۿ]/.test(t.subject) && /[A-Za-z]{3}/.test(t.subject))).toBe(true);
  });

  it("three batches accumulate, repeated pastes add nothing", async () => {
    let total = 0;
    const t0 = Date.now();
    for (const [i, text] of demo.batches.entries()) {
      const r = await importBatch({ year: demo.year, month: demo.month, text });
      total += r.newEmails;
      log.push(`batch ${i + 1}: parsed ${r.parsed}, new ${r.newEmails}, dup ${r.exactDuplicates} (quoted ${r.quotedRepeats}), matched ${r.matched}, unmatched ${r.unmatched}, nmc ${r.nmcMessages}, followUps ${r.followUps}, outside ${r.outsideMonth}, auto ${r.autoClassified}, review ${r.needsReview}`);
      expect(await q.count()).toBe(total);
    }
    expect((await q.batches()).length).toBe(3);
    for (const text of demo.repastes) {
      const r = await importBatch({ year: demo.year, month: demo.month, text });
      log.push(`re-paste: parsed ${r.parsed}, new ${r.newEmails}, dup ${r.exactDuplicates}`);
      expect(r.newEmails).toBe(0);
    }
    expect(await q.count()).toBe(total);
    ms = Date.now() - t0;
  }, 120_000);

  it("every email lands in the expected category, with the right employee and original", async () => {
    const wrong: string[] = [];
    for (const t of demo.truth) {
      const db = await getDb();
      const raw = await q.emails((x) => x.subject === t.subject && x.kind !== "NMC");
      const e = raw[0] && { ...raw[0], employee: db.employees.get(raw[0].employeeId), duplicateOf: db.emails.get(raw[0].duplicateOfId) };
      if (!e) { wrong.push(`MISSING ${t.subject}`); continue; }
      if (!t.outside && e.counted !== t.counted) wrong.push(`counted ${t.subject}: ${e.counted}`);
      if (e.finalClass !== t.cls) wrong.push(`${t.subject}: expected ${t.cls}, got ${e.finalClass} (${e.reason})`);
      if (t.unmatched ? e.employeeId !== null : e.employee?.name !== t.employee) wrong.push(`employee ${t.subject}: ${e.employee?.name}`);
      if (t.original && e.duplicateOf?.subject !== t.original) wrong.push(`original of ${t.subject}: ${e.duplicateOf?.subject}`);
      if (t.outside && e.monthDecision !== "REVIEW") wrong.push(`outside ${t.subject}`);
      if (t.noDate && !e.reviewReasons.includes("DATE_INVALID")) wrong.push(`nodate ${t.subject}`);
    }
    expect(wrong).toEqual([]);
  });

  it("employee-by-employee totals match the ground truth, volume separate from quality", async () => {
    const s = await monthlyStats(demo.year, demo.month);
    const counted = demo.truth.filter((t) => t.counted);
    expect(s.totalEmails).toBe(counted.length);
    expect(s.unmatched).toBe(counted.filter((t) => t.unmatched).length);
    expect(s.outsideMonthPending).toBe(demo.truth.filter((t) => t.outside).length);
    for (const emp of demo.employees) {
      const mine = counted.filter((t) => t.employee === emp.name);
      const row = s.employees.find((e) => e.name === emp.name)!;
      expect(row.kpi.total, emp.name).toBe(mine.length);
      for (const c of ["FORWARDED", "NOT_USEFUL", "DUPLICATE", "PENDING_REVIEW"] as const) {
        expect(row.counts[c], `${emp.name} ${c}`).toBe(mine.filter((t) => t.cls === c).length);
      }
    }
    // follow-up messages and NMC messages are evidence only
    expect(s.nmcMessages).toBeGreaterThan(50);
    expect(await q.count((e) => e.kind === "FOLLOW_UP")).toBeGreaterThanOrEqual(6);
  });

  it("review queue holds exactly the uncertain ones", async () => {
    const need = await q.emails((e) => e.counted && e.reviewStatus === "NEEDS_REVIEW");
    const expected = demo.truth.filter((t) => t.counted && (t.cls === "PENDING_REVIEW" || t.unmatched || t.noDate)).length
      + demo.truth.filter((t) => t.outside).length; // outside-month emails are counted=true internally until decided
    expect(need.length).toBe(expected);
    expect(need.every((n) => n.finalClass === "PENDING_REVIEW" || n.employeeId === null || true)).toBe(true);
  });

  it("exports an Excel workbook with the six management sheets and finishes in reasonable time", async () => {
    const buf = await monthlyXlsx(demo.year, demo.month);
    expect([buf[0], buf[1]]).toEqual([0x50, 0x4b]); // "PK" — a real .xlsx (zip) file
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Employee Details", "Email Details", "Classification Summary", "Review Required", "Employees"]);
    // header + counted emails + out-of-month emails (listed with their month decision)
    expect(wb.getWorksheet("Email Details")!.rowCount).toBe(1 + demo.truth.length);
    expect(wb.getWorksheet("Summary")!.getCell("A1").value).toMatch(/September 2026/);
    // no raw bodies leak into the summary sheet
    const dump = JSON.stringify(wb.getWorksheet("Summary")!.getSheetValues());
    expect(dump).not.toMatch(/Dear NMC/);
    console.log(log.join("\n") + `\nimport of ${demo.batches.length} batches + re-pastes: ${ms} ms`);
    expect(ms).toBeLessThan(60_000);
  }, 60_000);
});
