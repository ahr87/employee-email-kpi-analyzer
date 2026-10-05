import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/database/client";
import { importBatch } from "@/lib/import/importer";
import { analyzeMonth } from "@/lib/import/analyze";
import { applyEmailAction } from "@/lib/import/emails";
import { monthlyStats } from "@/lib/reports/aggregate";
import { monthlyXlsx } from "@/lib/reports/excel";
import { loadDemoData, resetData } from "@/lib/demo";

const mail = (from: string, email: string, when: string, subject: string, body = "Body text") =>
  `From: ${from} <${email}>\nSent: ${when}\nTo: nmc@acme.test\nSubject: ${subject}\n\n${body}\n`;

beforeEach(async () => { await resetData({ employees: true, settings: true }); });

async function seedEmployees() {
  await prisma.employee.createMany({ data: [
    { employeeId: "1", name: "Alice", email: "alice@acme.test" }, { employeeId: "2", name: "Bob", email: "bob@acme.test" },
  ] });
}

describe("data integrity", () => {
  it("batches are additive and never overwrite previous data", async () => {
    await seedEmployees();
    const a = await importBatch({ year: 2026, month: 9, text: mail("Alice", "alice@acme.test", "2026-09-01 10:00", "One") + "\n" + mail("Alice", "alice@acme.test", "2026-09-02 10:00", "Two") });
    expect(a.newEmails).toBe(2);
    const b = await importBatch({ year: 2026, month: 9, text: mail("Bob", "bob@acme.test", "2026-09-03 10:00", "Three") });
    expect(b.newEmails).toBe(1);
    expect(await prisma.email.count()).toBe(3);
    expect(await prisma.batch.count()).toBe(2);
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(3);
  });

  it("exact duplicate pastes are ignored, across batches and inside one paste", async () => {
    await seedEmployees();
    const m = mail("Alice", "alice@acme.test", "2026-09-01 10:00", "One");
    const a = await importBatch({ year: 2026, month: 9, text: m + "\n" + m });
    expect(a.parsed).toBe(2); expect(a.newEmails).toBe(1); expect(a.exactDuplicates).toBe(1);
    const b = await importBatch({ year: 2026, month: 9, text: m });
    expect(b.newEmails).toBe(0); expect(b.exactDuplicates).toBe(1);
    expect(await prisma.email.count()).toBe(1);
  });

  it("flags unmatched senders and out-of-month dates, never discarding them", async () => {
    await seedEmployees();
    const r = await importBatch({ year: 2026, month: 9, text: mail("Zed", "zed@other.test", "2026-09-01 10:00", "X") + "\n" + mail("Alice", "alice@acme.test", "2026-08-30 10:00", "Y") });
    expect(r.unmatched).toBe(1); expect(r.outsideMonth).toBe(1);
    const emails = await prisma.email.findMany();
    expect(emails).toHaveLength(2);
    expect(emails.find((e) => e.subject === "X")!.reviewReasons).toContain("UNMATCHED_EMPLOYEE");
    expect(emails.find((e) => e.subject === "Y")!.reviewReasons).toContain("OUTSIDE_MONTH");
    // out-of-month email is not counted until the user includes it
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(1);
    const y = emails.find((e) => e.subject === "Y")!;
    await applyEmailAction(y.id, { action: "monthDecision", decision: "INCLUDED" });
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(2);
  });

  it("manual overrides drive the KPI and survive re-analysis", async () => {
    await seedEmployees();
    await importBatch({ year: 2026, month: 9, text: mail("Alice", "alice@acme.test", "2026-09-01 10:00", "One") });
    const e = (await prisma.email.findFirst())!;
    expect(e.finalClass).toBe("PENDING_REVIEW");
    await applyEmailAction(e.id, { action: "override", classification: "FORWARDED", reason: "Confirmed by phone" });
    let s = await monthlyStats(2026, 9);
    expect(s.counts.FORWARDED).toBe(1);
    expect(s.employees.find((x) => x.name === "Alice")!.kpi.score).toBe(100);

    await analyzeMonth(2026, 9, { audit: true });
    // a second batch triggers incremental re-analysis of the month too
    await importBatch({ year: 2026, month: 9, text: mail("Bob", "bob@acme.test", "2026-09-02 10:00", "Two") });
    const after = (await prisma.email.findUnique({ where: { id: e.id } }))!;
    expect(after.finalClass).toBe("FORWARDED");
    expect(after.autoClass).toBe("PENDING_REVIEW");
    expect(after.overrideReason).toBe("Confirmed by phone");
    expect(after.reviewStatus).toBe("REVIEWED");
    const log = await prisma.auditLog.findMany({ where: { entityId: e.id } });
    expect(log.some((l) => l.action === "CLASSIFICATION_CHANGED")).toBe(true);

    // explicit full reset removes manual decisions
    await analyzeMonth(2026, 9, { resetManual: true });
    expect((await prisma.email.findUnique({ where: { id: e.id } }))!.finalClass).toBe("PENDING_REVIEW");
  });

  it("empty and invalid input is rejected with a clear error", async () => {
    await expect(importBatch({ year: 2026, month: 9, text: "  " })).rejects.toThrow(/paste/i);
    await expect(importBatch({ year: 2026, month: 13, text: "x" })).rejects.toThrow(/month/i);
  });
});

describe("demo dataset end-to-end", () => {
  it("classifies the synthetic sample as expected and exports Excel", async () => {
    const { batch } = await loadDemoData();
    expect(batch.parsed).toBe(11);
    expect(batch.exactDuplicates).toBe(1);
    expect(batch.nmcMessages).toBe(3);
    expect(batch.unmatched).toBe(1);
    expect(batch.outsideMonth).toBe(1);

    const by = async (subject: string) => (await prisma.email.findFirst({ where: { subject } }))!;
    expect((await by("BB outage at Mansour")).finalClass).toBe("FORWARDED");
    const dup = await by("Mansour BB connection is down");
    expect(dup.finalClass).toBe("DUPLICATE");
    expect(dup.duplicateOfId).toBe((await by("BB outage at Mansour")).id);
    expect((await by("Question about monthly report format")).finalClass).toBe("NOT_USEFUL");
    expect((await by("Router reboot needed")).finalClass).toBe("PENDING_REVIEW");
    expect((await by("Slow internet at Karrada branch")).finalClass).toBe("FORWARDED");
    expect((await by("Fiber cut near Karrada")).employeeId).toBeNull();

    const stats = await monthlyStats(2026, 9);
    expect(stats.totalEmails).toBe(6); // Aug-dated email is held for review, exact duplicate ignored
    expect(stats.counts).toMatchObject({ FORWARDED: 2, DUPLICATE: 1, NOT_USEFUL: 1, PENDING_REVIEW: 2 });

    const xlsx = await monthlyXlsx(2026, 9);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
  });
});
