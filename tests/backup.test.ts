import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { backupFilename, exportBackup, restoreBackup, validateBackup } from "@/lib/backup";
import { applyEmailAction } from "@/lib/import/emails";
import { importBatch } from "@/lib/import/importer";
import { monthlyStats } from "@/lib/reports/aggregate";
import { getSettings, saveSettings } from "@/lib/settings";
import { loadDemoData } from "@/lib/demo";
import { freshDb, q, seedEmployees } from "./db";
import { msg, NMC, T } from "./helpers";

const ahmed = { from: "Ahmed Ali", email: "ahmed@company.test" };

async function populate() {
  await freshDb();
  await seedEmployees([{ employeeId: "E1", name: "Ahmed Ali", email: "ahmed@company.test", department: "Care", team: "A" }]);
  await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", label: "NMC", enabled: true }], confidenceThreshold: 70, kpi: { ...(await getSettings()).kpi, target: 65 } });
  await importBatch({ year: 2026, month: 9, text: [
    msg({ ...ahmed, at: T(14, 10, 0), subject: "Fault A", body: "عربي and English body" }),
    msg(NMC(T(14, 11, 0), "FW: Fault A", "Escalated to field.", { to: "Field <field@company.test>" })),
    msg({ ...ahmed, at: T(15, 10, 0), subject: "Fault B", body: "second" }),
  ].join("\n") });
  const b = await q.email((e) => e.subject === "Fault B");
  await applyEmailAction(b.id, { action: "override", classification: "NOT_USEFUL", reason: "checked by phone" });
}

beforeEach(populate);

describe("backup / restore", () => {
  it("exports a dated JSON file with all data and no UI state", async () => {
    const { filename, json, summary } = await exportBackup(new Date("2026-10-08T09:00:00Z"));
    expect(filename).toBe("employee-email-kpi-backup-2026-10-08.json");
    expect(backupFilename(new Date("2026-10-08T23:00:00Z"))).toBe("employee-email-kpi-backup-2026-10-08.json");
    const file = JSON.parse(json);
    expect(Object.keys(file)).toEqual(["format", "version", "exportedAt", "app", "data"]);
    expect(Object.keys(file.data)).toEqual(["employees", "batches", "emails", "audit", "settings", "raw"]);
    expect(summary).toMatchObject({ employees: 1, batches: 1, emails: 3, months: 1 });
    expect(file.data.settings.nmcAddresses[0].address).toBe("nmc@acme.test");
    expect(json).not.toMatch(/eka\.month|localStorage|toast/);
  });

  it("restores everything on an empty browser, including overrides, settings and Arabic text", async () => {
    const before = await monthlyStats(2026, 9);
    const { json } = await exportBackup();
    await freshDb(); // brand-new browser profile
    expect((await getDb()).emails.size).toBe(0);
    const check = validateBackup(json);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    await restoreBackup(check.backup);
    expect(await monthlyStats(2026, 9)).toEqual(before);
    const b = await q.email((e) => e.subject === "Fault B");
    expect(b).toMatchObject({ finalClass: "NOT_USEFUL", isManual: true, overrideReason: "checked by phone" });
    expect(b.sentAt).toEqual(new Date("2026-09-15T10:00:00Z"));
    expect((await q.email((e) => e.subject === "Fault A")).body).toBe("عربي and English body");
    const s = await getSettings();
    expect(s.confidenceThreshold).toBe(70);
    expect(s.kpi.target).toBe(65);
    expect(s.nmcAddresses).toHaveLength(1);
    // the restored data keeps working: a re-paste is still an exact duplicate
    expect((await importBatch({ year: 2026, month: 9, text: msg({ ...ahmed, at: T(15, 10, 0), subject: "Fault B", body: "second" }) })).newEmails).toBe(0);
  });

  it("restore REPLACES the current data (never silently merges)", async () => {
    const { json } = await exportBackup();
    await importBatch({ year: 2026, month: 9, text: msg({ ...ahmed, at: T(20, 10, 0), subject: "Later paste", body: "later" }) });
    expect(await q.count()).toBe(4);
    const check = validateBackup(json);
    if (!check.ok) throw new Error("backup should be valid");
    await restoreBackup(check.backup);
    expect(await q.count()).toBe(3);
    expect(await q.count((e) => e.subject === "Later paste")).toBe(0);
  });

  it("works for a large demo month round trip", async () => {
    await freshDb();
    await loadDemoData();
    const before = await monthlyStats(2026, 9);
    const { json, summary } = await exportBackup();
    expect(summary.emails).toBeGreaterThan(150);
    await freshDb();
    const check = validateBackup(json);
    if (!check.ok) throw new Error(check.errors.join("; "));
    await restoreBackup(check.backup);
    expect(await monthlyStats(2026, 9)).toEqual(before);
  });
});

describe("backup validation (nothing is touched when the file is bad)", () => {
  const good = async () => JSON.parse((await exportBackup()).json);
  const errorsOf = (o: unknown) => { const r = validateBackup(typeof o === "string" ? o : JSON.stringify(o)); return r.ok ? [] : r.errors; };

  it("rejects text that is not JSON or not a backup of this app", async () => {
    expect(errorsOf("not json")[0]).toMatch(/not a valid JSON/);
    expect(errorsOf({ hello: "world" })[0]).toMatch(/not a backup/);
    expect(errorsOf({ ...(await good()), version: 99 })[0]).toMatch(/Unsupported backup version/);
  });

  it("rejects malformed records", async () => {
    const f = await good();
    f.data.emails[0].sentAt = "yesterday";
    expect(errorsOf(f).join(" ")).toMatch(/emails/);
    const g = await good();
    g.data.employees[0].email = 42;
    expect(errorsOf(g).join(" ")).toMatch(/employees/);
    const h = await good();
    h.data.emails[0].finalClass = "SOMETHING_ELSE";
    expect(errorsOf(h).length).toBeGreaterThan(0);
  });

  it("rejects inconsistent data (dangling links, duplicate keys)", async () => {
    const f = await good();
    f.data.emails[0].batchId = "missing";
    expect(errorsOf(f).join(" ")).toMatch(/batch/);
    const g = await good();
    g.data.emails[1].contentHash = g.data.emails[0].contentHash;
    expect(errorsOf(g).join(" ")).toMatch(/identity keys/);
    const h = await good();
    h.data.emails[0].employeeId = "ghost";
    expect(errorsOf(h).join(" ")).toMatch(/employee/);
  });

  it("a rejected file leaves the existing data untouched", async () => {
    const before = await q.count();
    const f = await good();
    f.data.emails[0].batchId = "missing";
    const r = validateBackup(JSON.stringify(f));
    expect(r.ok).toBe(false);
    expect(await q.count()).toBe(before);
  });
});
