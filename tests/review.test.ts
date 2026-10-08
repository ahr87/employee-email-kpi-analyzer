import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { freshDb, q, seedEmployees } from "./db";
import { importBatch } from "@/lib/import/importer";
import { monthlyStats } from "@/lib/reports/aggregate";
import { saveSettings } from "@/lib/settings";
import { chain, msg, NMC, T } from "./helpers";

const EMP = [["E1", "Ahmed Ali", "ahmed@company.test"], ["E2", "Sara Hassan", "sara@company.test"], ["E3", "Omar Khalid", "omar@company.test"]] as const;
const who = (i: number) => ({ from: EMP[i][1], email: EMP[i][2] });
const imp = (text: string, month = 9) => importBatch({ year: 2026, month, text });

beforeEach(async () => {
  await freshDb();
  await seedEmployees(EMP.map(([employeeId, name, email]) => ({ employeeId, name, email })));
  await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", label: "", enabled: true }] });
});

describe("production-readiness probes: conversation handling", () => {
  it("an employee forwarding an EXTERNAL customer email is the counted report; the quoted customer message is not", async () => {
    await imp(chain([
      NMC(T(14, 11, 0), "FW: Customer complaint BB", "Escalated to the field team.", { to: "Field <field@company.test>" }),
      { ...who(0), at: T(14, 10, 0), subject: "FW: Customer complaint BB", body: "Customer says BB is down, please check." },
      { from: "Customer Joe", email: "joe@gmail.test", at: T(14, 9, 0), subject: "Customer complaint BB", body: "My BB is down since morning." },
    ]));
    const s = await monthlyStats(2026, 9);
    expect(s.totalEmails).toBe(1);
    expect(s.unmatched).toBe(0);
    expect(s.employees.find((e) => e.name === "Ahmed Ali")!.counts.FORWARDED).toBe(1);
  });

  it("the same employee sending the same generic subject on different days gets BOTH emails counted", async () => {
    await imp([
      msg({ ...who(0), at: T(3, 9, 0), subject: "Router down", body: "Site A router is down." }),
      msg({ ...who(0), at: T(20, 9, 0), subject: "Router down", body: "Site B router is down." }),
    ].join("\n"));
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(2);
    // and the same in a later month
    await imp(msg({ ...who(0), at: T(2, 9, 0, 10), subject: "Router down", body: "Site C router is down." }), 10);
    expect((await monthlyStats(2026, 10)).totalEmails).toBe(1);
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(2);
  });

  it("an NMC forward is attributed only to the employee it answered, not to another employee with the same subject", async () => {
    await imp([
      msg({ ...who(0), at: T(14, 9, 0), subject: "Link down", body: "Link down at Site A." }),
      msg({ ...who(1), at: T(14, 9, 30), subject: "Link down", body: "Link down at Site B." }),
      msg(NMC(T(14, 10, 0), "RE: Link down", "Escalated to field team.", { to: "Ahmed Ali <ahmed@company.test>; Field <field@company.test>" })),
    ].join("\n"));
    const db = await getDb();
    const emails = (await q.emails((e) => e.subject === "Link down" && e.counted)).map((e) => ({ ...e, employee: db.employees.get(e.employeeId) }));
    expect(emails.find((e) => e.employee?.name === "Ahmed Ali")!.finalClass).toBe("FORWARDED");
    expect(emails.find((e) => e.employee?.name === "Sara Hassan")!.finalClass).toBe("PENDING_REVIEW");
  });

  it("an NMC reply weeks later (another incident, same subject) is not evidence for an old email", async () => {
    await imp(msg({ ...who(0), at: T(2, 9, 0), subject: "Link down", body: "Link down at Site A." }));
    await imp(msg(NMC(T(28, 10, 0), "FW: Link down", "Escalated to field team.", { to: "Field <field@company.test>" })));
    expect((await q.email((e) => e.subject === "Link down" && e.counted)).finalClass).toBe("PENDING_REVIEW");
  });

  it("two different emails from one sender in the same minute with the same subject are both kept", async () => {
    const m = (body: string) => msg({ ...who(2), at: T(14, 9, 0), subject: "Alarm", body });
    const r = await imp(m("Device SW-AAA-01 down\n") + "\n" + m("Device SW-BBB-02 down\n"));
    expect(r.newEmails).toBe(2);
  });
});

describe("production-readiness probes: exact duplicates vs quoted copies", () => {
  it("a quoted copy with a truncated body is still recognised as the already-stored email", async () => {
    await imp(msg({ ...who(0), at: T(14, 10, 0), subject: "Fault Q", body: "Long description of the fault with many words in it.\nSecond line." }));
    const r = await imp(chain([
      NMC(T(14, 11, 0), "RE: Fault Q", "Received.", { to: "Ahmed <ahmed@company.test>" }),
      { ...who(0), at: T(14, 10, 0), subject: "Fault Q", body: "Long description" }, // different body: truncated copy
    ]));
    expect(r.quotedRepeats).toBe(1);
    expect(await q.count((e) => e.counted)).toBe(1);
  });
});

describe("production-readiness probes: Excel / CSV safety", () => {
  it("formula-looking text stays text in Excel and is neutralised in CSV", async () => {
    await imp(msg({ ...who(0), at: T(14, 10, 0), subject: "=HYPERLINK(\"http://x\",\"click\")", body: "=1+1" }));
    const { monthlyXlsx, monthlyCsv } = await import("@/lib/reports/excel");
    const { loadExcelJS } = await import("@/lib/reports/exceljs");
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await monthlyXlsx(2026, 9)).buffer as ArrayBuffer);
    const ws = wb.getWorksheet("Email Details")!;
    const cell = ws.getRow(2).getCell(6);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(String(cell.value)).toMatch(/^=HYPERLINK/);
    const { toCsv } = await import("@/lib/reports/csv");
    expect(toCsv([["=1+1", "+cmd", "@x", "-5", "ok"]])).toContain("'=1+1,'+cmd,'@x,-5,ok");
    void monthlyCsv;
  });
});

describe("production-readiness probes: chains without separators, parser variants", () => {
  it("a forwarded customer email is recognised as quoted even when Outlook printed no separator line", async () => {
    const text = [
      msg(NMC(T(14, 11, 0), "FW: Customer complaint BB", "Escalated to the field team.", { to: "Field <field@company.test>" })),
      msg({ ...who(0), at: T(14, 10, 0), subject: "FW: Customer complaint BB", body: "Please check this customer." }),
      msg({ from: "Customer Joe", email: "joe@gmail.test", at: T(14, 9, 0), subject: "Customer complaint BB", body: "My BB is down." }),
    ].join("\n");
    await imp(text);
    const s = await monthlyStats(2026, 9);
    expect(s.totalEmails).toBe(1);
    expect(s.unmatched).toBe(0);
  });

  it("date and header variants copied from different Outlook builds", async () => {
    const { parseEmails } = await import("@/lib/parser");
    const p = (sent: string, order: "DMY" | "MDY" = "DMY") => parseEmails(`From:\tAhmed Ali <ahmed@company.test>\nSent:\t${sent}\nSubject:\tX\n\nb`, { dateOrder: order }).emails[0];
    expect(p("Mon 9/14/2026 10:32 AM").sentAt?.toISOString()).toBe("2026-09-14T10:32:00.000Z");
    expect(p("Mon, 14 Sep 2026 10:32:00 +0300").sentAt?.toISOString()).toBe("2026-09-14T10:32:00.000Z");
    expect(p("September 14, 2026 at 10:32 PM").sentAt?.toISOString()).toBe("2026-09-14T22:32:00.000Z");
    expect(p("Monday, 14 September 2026 22:32").sentAt?.toISOString()).toBe("2026-09-14T22:32:00.000Z");
    expect(p("14/09/2026 12:05 AM").sentAt?.toISOString()).toBe("2026-09-14T00:05:00.000Z");
    const noSubject = parseEmails("From: Ahmed Ali <ahmed@company.test>\nSent: 14/09/2026 10:00\nTo: NMC\n\nOnly a body here.").emails[0];
    expect(noSubject.subject).toBe("");
    expect(noSubject.uncertainFields).toContain("subject");
    const dn = parseEmails("From: /O=EXCHANGELABS/OU=X/CN=RECIPIENTS/CN=abc123\nSent: 14/09/2026 10:00\nSubject: Y\n\nb").emails[0];
    expect(dn.senderEmail).toBe("");
    expect(dn.senderName).toBe("");
  });

  it("a signature that merely contains 'From:' or 'To:' lines does not split the email", async () => {
    const { parseEmails } = await import("@/lib/parser");
    const text = msg({ ...who(0), at: T(14, 10, 0), subject: "Sig test", body: "Please check.\n\nRegards\nAhmed\nFrom: Customer Care dept\nTo: be continued" });
    const r = parseEmails(text);
    expect(r.emails).toHaveLength(1);
    expect(r.emails[0].body).toContain("To: be continued");
  });
});

describe("production-readiness probes: database integrity and manual decisions", () => {
  it("deleting a batch removes its emails and links; deleting an employee leaves emails as unmatched", async () => {
    const { deleteBatch } = await import("@/lib/import/importer");
    const r1 = await imp(msg({ ...who(0), at: T(14, 10, 0), subject: "Mansour BB outage", body: "No BB in Mansour." }));
    const r2 = await imp(msg({ ...who(1), at: T(14, 10, 10), subject: "Mansour BB link down", body: "No BB in Mansour." }));
    const dup = await q.email((e) => e.subject === "Mansour BB link down");
    expect(dup.duplicateOfId).not.toBeNull();
    await deleteBatch(r1.batchId);
    const after = await q.email((e) => e.subject === "Mansour BB link down");
    expect(after.duplicateOfId).toBeNull();
    expect(after.finalClass).not.toBe("DUPLICATE"); // the original is gone → re-analysis no longer calls it a duplicate
    expect(await q.count((e) => e.batchId === r1.batchId)).toBe(0);
    const sara = (await getDb()).employees.all().find((e) => e.name === "Sara Hassan")!;
    await (await import("@/lib/employees/service")).deleteEmployee(sara.id);
    expect((await q.email((e) => e.batchId === r2.batchId)).employeeId).toBeNull();
  });

  it("manual decisions survive a settings change that re-analyzes every month", async () => {
    const { applyEmailAction } = await import("@/lib/import/emails");
    const { analyzeAllMonths } = await import("@/lib/import/analyze");
    await imp(msg({ ...who(0), at: T(14, 10, 0), subject: "Manual keeper", body: "x" }));
    const e = await q.email((x) => x.subject === "Manual keeper");
    await applyEmailAction(e.id, { action: "override", classification: "NOT_USEFUL", reason: "phone call" });
    await saveSettings({ similarityThreshold: 70, confidenceThreshold: 60 });
    await analyzeAllMonths();
    const after = await q.email((x) => x.id === e.id);
    expect(after).toMatchObject({ finalClass: "NOT_USEFUL", isManual: true, overrideReason: "phone call", autoClass: "PENDING_REVIEW" });
    expect((await monthlyStats(2026, 9)).counts.NOT_USEFUL).toBe(1);
  });
});
