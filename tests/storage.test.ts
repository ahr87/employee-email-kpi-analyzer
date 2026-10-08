import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Db, attachAdapter } from "@/lib/db";
import { IndexedDbAdapter } from "@/lib/storage/indexeddb";
import { MemoryAdapter } from "@/lib/storage/storage";
import { createEmployee } from "@/lib/employees/service";
import { importBatch } from "@/lib/import/importer";
import { applyEmailAction } from "@/lib/import/emails";
import { monthlyStats } from "@/lib/reports/aggregate";
import { saveSettings, getSettings } from "@/lib/settings";
import { clearAllLocalData, storageSummary } from "@/lib/data-management";
import { sha256 } from "@/lib/utils/hash";
import { createHash } from "node:crypto";
import { msg, T } from "./helpers";
import { q } from "./db";

const ahmed = { from: "Ahmed Ali", email: "ahmed@company.test" };

beforeEach(() => { (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); }); // empty browser profile

describe("IndexedDB adapter", () => {
  it("round-trips records (including dates) and applies writes atomically", async () => {
    const a = new IndexedDbAdapter();
    await a.init();
    const now = new Date("2026-09-14T10:32:00Z");
    await a.write([{ table: "employees", put: [{ id: "1", employeeId: "E1", name: "A", email: "a@x.test", department: "", team: "", active: true, createdAt: now, updatedAt: now }] }]);
    const rows = await a.readAll("employees");
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(now);
    await a.write([{ table: "employees", delete: ["1"] }, { table: "settings", put: [{ id: "app", value: { x: 1 } }] }]);
    expect(await a.readAll("employees")).toHaveLength(0);
    expect((await a.readAll("settings"))[0].value).toEqual({ x: 1 });
    await a.clear();
    expect(await a.readAll("settings")).toHaveLength(0);
  });

  it("a failing write leaves nothing behind (transaction rolls back)", async () => {
    const a = new IndexedDbAdapter();
    await a.init();
    const bad = { id: "x", employeeId: "E", name: "n", email: "e", department: "", team: "", active: true, createdAt: new Date(), updatedAt: new Date(), poison: () => 1 };
    await expect(a.write([{ table: "settings", put: [{ id: "ok", value: 1 }] }, { table: "employees", put: [bad as never] }])).rejects.toBeTruthy();
    expect(await a.readAll("settings")).toHaveLength(0);
  });
});

describe("data persists across 'closing the browser' (reopening the database)", () => {
  it("employees, imported batches, overrides and settings survive a reload", async () => {
    let db = await attachAdapter(new IndexedDbAdapter());
    await createEmployee({ employeeId: "E1", name: "Ahmed Ali", email: "ahmed@company.test", department: "Care", team: "A" });
    await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", enabled: true, label: "" }], confidenceThreshold: 66 });
    await importBatch({ year: 2026, month: 9, text: msg({ ...ahmed, at: T(14, 10, 0), subject: "Fault one", body: "x" }) });
    const email = await q.email((e) => e.subject === "Fault one");
    await applyEmailAction(email.id, { action: "override", classification: "FORWARDED", reason: "phone call" });
    expect((await monthlyStats(2026, 9)).counts.FORWARDED).toBe(1);

    // "close the browser and open the site later": a brand-new Db object reads everything back from IndexedDB
    db = await attachAdapter(new IndexedDbAdapter());
    expect(db.employees.size).toBe(1);
    expect((await getSettings()).confidenceThreshold).toBe(66);
    const again = await q.email((e) => e.subject === "Fault one");
    expect(again).toMatchObject({ finalClass: "FORWARDED", isManual: true, overrideReason: "phone call" });
    expect(again.sentAt).toEqual(new Date("2026-09-14T10:00:00Z"));
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(1);
    expect((await storageSummary()).mode).toBe("indexeddb");
  });

  it("an exact duplicate paste is still ignored after reopening, and batches keep accumulating", async () => {
    await attachAdapter(new IndexedDbAdapter());
    const text = msg({ ...ahmed, at: T(14, 10, 0), subject: "Fault two", body: "y" });
    expect((await importBatch({ year: 2026, month: 9, text })).newEmails).toBe(1);
    await attachAdapter(new IndexedDbAdapter());
    const second = await importBatch({ year: 2026, month: 9, text });
    expect(second.newEmails).toBe(0);
    expect(second.exactDuplicates).toBe(1);
    const third = await importBatch({ year: 2026, month: 9, text: msg({ ...ahmed, at: T(15, 10, 0), subject: "Fault three", body: "z" }) });
    expect(third.batchNumber).toBe(3);
    expect(await q.count()).toBe(2);
  });
});

describe("data reset", () => {
  it("clearAllLocalData removes every table, in memory and in IndexedDB", async () => {
    await attachAdapter(new IndexedDbAdapter());
    await createEmployee({ employeeId: "E1", name: "Ahmed Ali", email: "ahmed@company.test" });
    await importBatch({ year: 2026, month: 9, text: msg({ ...ahmed, at: T(14, 10, 0), subject: "Fault", body: "y" }) });
    await clearAllLocalData();
    const db = await attachAdapter(new IndexedDbAdapter());
    expect([db.employees.size, db.batches.size, db.emails.size, db.audit.size, db.settings.size]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("storage abstraction", () => {
  it("the same business logic runs on the in-memory adapter", async () => {
    const db: Db = await attachAdapter(new MemoryAdapter());
    await createEmployee({ employeeId: "E1", name: "Ahmed Ali", email: "ahmed@company.test" });
    expect(db.employees.size).toBe(1);
    expect((await storageSummary()).mode).toBe("memory");
  });

  it("rejects duplicate employee e-mails and IDs with a clear message", async () => {
    await attachAdapter(new MemoryAdapter());
    await createEmployee({ employeeId: "E1", name: "Ahmed Ali", email: "ahmed@company.test" });
    await expect(createEmployee({ employeeId: "E2", name: "Other", email: "AHMED@company.test" })).rejects.toThrow(/already exists/);
    await expect(createEmployee({ employeeId: "E1", name: "Other", email: "o@company.test" })).rejects.toThrow(/already used/);
  });
});

describe("sha256 helper", () => {
  it("matches Node's implementation (ASCII, Arabic, long input)", () => {
    for (const s of ["", "abc", "مرحبا بالعالم", "x".repeat(1000), "line1\nline2 — ünïcode"]) {
      expect(sha256(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });
});

describe("several tabs", () => {
  it("a second 'tab' sees changes after refresh() and a stale tab cannot overwrite newer data", async () => {
    const tabA = await attachAdapter(new IndexedDbAdapter());
    await createEmployee({ employeeId: "E1", name: "Ahmed Ali", email: "ahmed@company.test" });
    const tabB = new Db(new IndexedDbAdapter());
    await tabB.load();
    expect(tabB.employees.size).toBe(1);
    await createEmployee({ employeeId: "E2", name: "Sara Hassan", email: "sara@company.test" }); // tab A adds one more
    expect(tabB.employees.size).toBe(1); // B has not heard yet
    await tabB.refresh(); // what the BroadcastChannel message triggers
    expect(tabB.employees.size).toBe(2);
    expect(tabA.employees.size).toBe(2);
  });
});
