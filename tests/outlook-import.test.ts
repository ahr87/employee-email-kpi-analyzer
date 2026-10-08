import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, q, seedEmployees } from "./db";
import { getDb } from "@/lib/db";
import { previewOutlookExport, importOutlookExport } from "@/lib/outlook/import";
import { importBatch } from "@/lib/import/importer";
import { listBatches } from "@/lib/import/batches";
import { monthlyStats } from "@/lib/reports/aggregate";
import { saveSettings } from "@/lib/settings";
import { exportBackup, restoreBackup, validateBackup } from "@/lib/backup";
import { ADDR, caseA, caseB, caseC, caseD, caseE, caseF, caseG, generate, mk, toBytes, wrap } from "./fixtures/outlook-export";
import { chain, T } from "./helpers";

const EMP = [
  ["E1", ADDR.ahmed.name, ADDR.ahmed.email], ["E2", ADDR.sara.name, ADDR.sara.email], ["E3", ADDR.omar.name, ADDR.omar.email],
] as const;

beforeEach(async () => {
  await freshDb();
  await seedEmployees(EMP.map(([employeeId, name, email]) => ({ employeeId, name, email })));
  await saveSettings({ nmcAddresses: [{ address: ADDR.nmc.email, label: "NMC", enabled: true }, { address: "@monitoring.acme.test", label: "Monitoring", enabled: true }] });
});

const file = (emails: unknown[], extra?: Record<string, unknown>) => toBytes(wrap(emails, extra));
async function run(emails: unknown[], name = "KPI_Outlook_Export_20261008_105731.json", monthMode: "received" | "selected" = "received", month = 9) {
  const bytes = file(emails);
  const preview = await previewOutlookExport(bytes, name);
  const summary = await importOutlookExport(bytes, name, preview, { year: 2026, month, monthMode });
  return { preview, summary };
}
const byEntry = async (id: string) => q.email((e) => e.externalMessageId === id);

describe("preview before import", () => {
  it("reports totals, date range, senders, conversations, employees and never rejects the whole file for bad messages", async () => {
    const emails = [caseA(), caseC(), { subject: "no entry id" }, mk(300, { receivedAt: "not a date" }), ...caseG()];
    const p = await previewOutlookExport(file(emails), "x.json");
    expect(p.total).toBe(7);
    expect(p.valid).toBe(5);
    expect(p.invalid).toBe(2);
    expect(p.invalidList.map((i) => i.reason).join(" ")).toMatch(/entryId|receivedAt|date/i);
    expect(p.uniqueConversations).toBe(3);
    expect(p.matchedEmployees).toBe(1);
    expect(p.nmcMessages).toBe(1);
    expect(p.dateFrom!.getUTCDate()).toBe(14);
    expect(p.dateTo!.getUTCDate()).toBe(15);
    expect(await q.count()).toBe(0); // preview stores nothing
    expect((await q.batches()).length).toBe(0);
  });
  it("rejects clearly invalid files with a useful message", async () => {
    await expect(previewOutlookExport(toBytes("not json"), "x.json")).rejects.toThrow(/not a JSON|JSON/i);
    await expect(previewOutlookExport(toBytes(JSON.stringify({ source: "Gmail", emails: [] })), "x.json")).rejects.toThrow(/Outlook Desktop/);
    await expect(previewOutlookExport(toBytes(JSON.stringify({ source: "Outlook Desktop" })), "x.json")).rejects.toThrow(/emails/);
  });
  it("counts potential duplicates already stored", async () => {
    await run([caseA(), caseC()]);
    const p = await previewOutlookExport(file([caseA(), caseC(), caseD()]), "again.json");
    expect(p.duplicatesInDb).toBe(2);
  });
});

describe("import: batch, partial import, raw vs normalized", () => {
  it("creates an Outlook batch and imports only valid messages (partial import)", async () => {
    const { summary } = await run([caseA(), { subject: "broken" }, caseC()]);
    expect(summary.newEmails).toBe(2);
    const [b] = await q.batches();
    expect(b.source).toBe("Outlook Desktop");
    expect(b.filename).toBe("KPI_Outlook_Export_20261008_105731.json");
    expect(b.status).toBe("COMPLETED");
    expect(b.uniqueSenders).toBe(1);
    expect(b.uniqueConversations).toBe(2);
    expect(b.dateFrom).toBeTruthy();
  });
  it("keeps the original body and HTML untouched while analysis uses the normalized copy", async () => {
    await run([caseD(), caseB()]);
    const db = await getDb();
    const d = await byEntry(caseD().entryId);
    const raw = (await db.getRaw(d.id))!;
    expect(raw.body).toBe(caseD().body); // original, quoted history and CRLF preserved
    expect(raw.fromEmail).toBe(ADDR.ahmed.email);
    expect(d.body).not.toContain("16663542"); // normalized copy has no quoted history
    expect(d.normalization).toBeTruthy();
    const b = await byEntry(caseB().entryId);
    expect(b.senderEmail).toBe(ADDR.zabbix.email);
    const rb = (await db.getRaw(b.id))!;
    expect(rb.htmlChars).toBeGreaterThan(100);
  });
  it("sender is the top-level From, not an embedded 'From:' inside a forwarded body (case E)", async () => {
    await run([caseE()]);
    const e = await byEntry(caseE().entryId);
    expect(e.senderEmail).toBe(ADDR.ahmed.email);
    expect(e.employeeId).toBeTruthy();
    expect(e.body).not.toContain("Site X MPLS is unstable");
  });
  it("technical identifiers survive into the stored analysis fields (case A)", async () => {
    await run([caseA()]);
    const e = await byEntry(caseA().entryId);
    expect(JSON.stringify(e).toLowerCase()).toMatch(/17440983/);
    expect(JSON.stringify(e).toLowerCase()).toMatch(/shmo-m-sr1s-pe01/);
  });
});

describe("duplicate prevention", () => {
  it("same file imported twice → no duplicates", async () => {
    const emails = [caseA(), caseC(), caseD()];
    await run(emails);
    const { summary } = await run(emails, "again.json");
    expect(summary.newEmails).toBe(0);
    expect(summary.exactDuplicates).toBe(3);
    expect(await q.count()).toBe(3);
  });
  it("same entryId in two different files is imported once (case H)", async () => {
    await run([caseA()]);
    const { summary } = await run([caseA(), caseC()], "second.json");
    expect(summary.newEmails).toBe(1);
    expect(await q.count()).toBe(2);
  });
  it("same entryId twice inside one file is imported once", async () => {
    const { summary } = await run([caseA(), caseA()]);
    expect(summary.newEmails).toBe(1);
  });
  it("different entryId but same conversationId+time+sender+subject → duplicate (re-saved copy)", async () => {
    await run([caseA()]);
    const { summary } = await run([{ ...caseA(), entryId: "ANOTHER-ENTRY-ID" }], "copy.json");
    expect(summary.newEmails).toBe(0);
  });
  it("different conversationId with similar subject is NOT a duplicate (case F)", async () => {
    const { summary } = await run(caseF());
    expect(summary.newEmails).toBe(2);
  });
  it("an Outlook message already imported from a paste is recognised by the existing semantic detection", async () => {
    await importBatch({ year: 2026, month: 9, text: chain([{ from: ADDR.ahmed.name, email: ADDR.ahmed.email, at: T(14, 10, 32), subject: "BB users cannot browse", body: caseC().body.split("\r\n")[0] }]) });
    const before = await q.count();
    const c = { ...caseC(), body: caseC().body.split("\r\n")[0] };
    const { summary } = await run([c]);
    expect(summary.exactDuplicates + summary.newEmails).toBe(1);
    expect(await q.count()).toBeLessThanOrEqual(before + 1);
  });
});

describe("conversationId grouping, NMC evidence and employee matching", () => {
  it("groups by conversationId across different subjects/timestamps and keeps NMC as evidence (case G)", async () => {
    await run(caseG());
    const emails = await q.emails();
    const ids = new Set(emails.map((e) => e.externalConversationId));
    expect(ids).toEqual(new Set(["CONV-G"]));
    const nmc = emails.filter((e) => e.kind === "NMC");
    expect(nmc).toHaveLength(1);
    const counted = emails.filter((e) => e.counted);
    expect(counted).toHaveLength(1); // the later employee message follows the NMC reply → follow-up evidence, not a new report
    expect(emails.filter((e) => e.kind === "FOLLOW_UP")).toHaveLength(1);
    const stats = await monthlyStats(2026, 9);
    expect(stats.totalEmails).toBe(counted.length);
  });
  it("matches employees by fromEmail; a matching display name with a different address is not matched", async () => {
    await run([caseA(), mk(400, { from: ADDR.sara.name, fromEmail: "impostor@elsewhere.test", subject: "Check link", conversationId: "CONV-400" })]);
    const a = await byEntry(caseA().entryId);
    expect(a.employeeId).toBeTruthy();
    const x = await byEntry("00000000AAAA000400");
    expect(x.employeeId ?? null).toBeNull();
    expect(x.counted).toBe(false);
    expect(x.kind).toBe("EXTERNAL");
  });
  it("messages from non-employee senders are evidence only and not counted in KPI", async () => {
    const { summary } = await run([caseB(), caseA()]); // case B is a monitoring-address alert → NMC evidence
    expect(summary.otherSenders + summary.nmcMessages).toBeGreaterThanOrEqual(1);
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(1);
  });
  it("emails with the same conversationId and no NMC response stay separate counted emails for the right employees", async () => {
    await run([mk(501, { conversationId: "CONV-S", subject: "Site 3 down" }), mk(502, { conversationId: "CONV-S", subject: "Site 3 down", from: ADDR.sara.name, fromEmail: ADDR.sara.email, receivedAt: "2026-09-14 11:00:00", body: "Site 3 still down." })]);
    expect((await q.emails((e) => e.counted)).length).toBe(2);
  });
});

describe("monthly filtering by receivedAt", () => {
  const spread = () => [mk(601, { receivedAt: "2026-08-30 09:00:00", conversationId: "C-AUG" }), mk(602, { receivedAt: "2026-09-02 09:00:00", conversationId: "C-SEP" }), mk(603, { receivedAt: "2026-10-01 09:00:00", conversationId: "C-OCT" })];
  it("received mode: every message belongs to the month it was received", async () => {
    const { summary } = await run(spread(), "m.json", "received", 9);
    expect(summary.months.map((m) => `${m.year}-${m.month}`).sort()).toEqual(["2026-10", "2026-8", "2026-9"].sort());
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(1);
    expect((await monthlyStats(2026, 8)).totalEmails).toBe(1);
    expect((await monthlyStats(2026, 10)).totalEmails).toBe(1);
  });
  it("selected mode: out-of-month messages are kept but excluded from the KPI until reviewed", async () => {
    const { summary } = await run(spread(), "m.json", "selected", 9);
    expect(summary.outsideMonth).toBe(2);
    expect(await q.count()).toBe(3);
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(1);
  });
  it("batch listing shows the batch for each month it has messages in", async () => {
    await run(spread());
    for (const m of [8, 9, 10]) expect((await listBatches(2026, m)).length).toBe(1);
  });
});

describe("encoding", () => {
  it("imports UTF-8 Arabic text from a BOM + CRLF file", async () => {
    const bytes = toBytes(wrap([mk(701, { subject: "انقطاع الخدمة في الكرادة", body: "الرابط متوقف منذ الصباح. ticket 17440983" })], {}, { bom: true }));
    const p = await previewOutlookExport(bytes, "ar.json");
    await importOutlookExport(bytes, "ar.json", p, { year: 2026, month: 9, monthMode: "received" });
    const e = await byEntry("00000000AAAA000701");
    expect(e.subject).toContain("انقطاع الخدمة");
  });
});

describe("backup / restore with original Outlook messages", () => {
  it("round-trips emails, batches and raw originals", async () => {
    await run([caseA(), caseB(), caseD()]);
    const { json } = await exportBackup(new Date(), { includeOriginalHtml: true });
    const v = validateBackup(json);
    if (!v.ok) throw new Error(v.errors.join("; "));
    await freshDb();
    await restoreBackup(v.backup);
    const db = await getDb();
    const e = await byEntry(caseD().entryId);
    expect((await db.getRaw(e.id))!.body).toBe(caseD().body);
    expect((await db.getRaw((await byEntry(caseB().entryId)).id))!.htmlChars).toBeGreaterThan(100);
    expect((await q.batches())[0].source).toBe("Outlook Desktop");
  });
});

describe("large batches", () => {
  it("imports 5,000 messages in chunks with progress and re-import adds nothing", async () => {
    const emails = generate(5000);
    const bytes = file(emails);
    const phases = new Set<string>();
    let last = 0;
    const t0 = Date.now();
    const p = await previewOutlookExport(bytes, "big.json");
    expect(p.valid).toBe(5000);
    const s = await importOutlookExport(bytes, "big.json", p, { year: 2026, month: 9, monthMode: "received", onProgress: (x) => { phases.add(x.phase); last = Math.max(last, x.done); } });
    expect(s.newEmails).toBe(5000);
    expect(last).toBeGreaterThanOrEqual(5000);
    expect([...phases].length).toBeGreaterThanOrEqual(2);
    expect(Date.now() - t0).toBeLessThan(120_000);
    const again = await importOutlookExport(bytes, "big.json", await previewOutlookExport(bytes, "big.json"), { year: 2026, month: 9, monthMode: "received" });
    expect(again.newEmails).toBe(0);
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(5000);
  }, 240_000);
});
