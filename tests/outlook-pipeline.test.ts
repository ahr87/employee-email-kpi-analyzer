import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, q, seedEmployees } from "./db";
import { previewOutlookExport, importOutlookExport } from "@/lib/outlook/import";
import { monthlyStats } from "@/lib/reports/aggregate";
import { saveSettings } from "@/lib/settings";
import { ADDR, caseA, caseB, caseC, caseD, caseE, caseF, caseG, toBytes, wrap } from "./fixtures/outlook-export";

beforeEach(async () => {
  await freshDb();
  await seedEmployees([
    { employeeId: "E1", name: ADDR.ahmed.name, email: ADDR.ahmed.email },
    { employeeId: "E2", name: ADDR.sara.name, email: ADDR.sara.email },
    { employeeId: "E3", name: ADDR.omar.name, email: ADDR.omar.email },
  ]);
  await saveSettings({ nmcAddresses: [{ address: ADDR.nmc.email, label: "NMC", enabled: true }, { address: "@monitoring.acme.test", label: "Monitoring", enabled: true }] });
});

describe("REAL OUTLOOK JSON STRUCTURE → IMPORT → NORMALIZATION → EXISTING ANALYSIS PIPELINE", () => {
  it("runs the exporter's root/field layout (cases A–H together) through every stage", async () => {
    const all = [caseA(), caseB(), caseC(), caseD(), caseE(), ...caseF(), ...caseG(), caseA() /* H: same entryId again */];
    // exact root shape of the VBA exporter, pretty-printed with CRLF, UTF-8 with BOM
    const bytes = toBytes(wrap(all, {}, { bom: true }));
    const root = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
    expect(Object.keys(root)).toEqual(["exportedAt", "source", "emails"]);
    expect(Object.keys(root.emails[0])).toEqual(["entryId", "conversationId", "subject", "from", "fromEmail", "to", "cc", "receivedAt", "body", "htmlBody"]);

    // stage 1+2: validation / preview (nothing stored)
    const p = await previewOutlookExport(bytes, "KPI_Outlook_Export_20261008_105731.json");
    expect(p.total).toBe(all.length);
    expect(p.invalid).toBe(0);
    expect(p.duplicatesInFile).toBe(1);
    expect(await q.count()).toBe(0);

    // stage 3: import
    const s = await importOutlookExport(bytes, "KPI_Outlook_Export_20261008_105731.json", p, { year: 2026, month: 9, monthMode: "received" });
    expect(s.source).toBe("Outlook Desktop");
    expect(s.newEmails).toBe(all.length - 1);
    expect(s.exactDuplicates).toBe(1);

    // stage 4: normalization — quoted history / signature are not analysis input, originals stay raw
    const emails = await q.emails();
    const byId = (id: string) => emails.find((e) => e.externalMessageId === id)!;
    expect(byId(caseD().entryId).body).not.toMatch(/16663542/);
    expect(byId(caseC().entryId).body).not.toMatch(/Senior Network Engineer|confidential/);
    expect(byId(caseB().entryId).body).toMatch(/BT-DW-35033/);

    // stage 5: existing analysis pipeline
    const a = byId(caseA().entryId);
    expect(a.counted).toBe(true);
    expect(a.employeeId).toBeTruthy();
    expect(a.finalClass).toBeTruthy();
    expect(a.incidentIds).toMatch(/17440983/);
    expect(a.devices.toLowerCase()).toMatch(/bt-dw-35033|shmo-m-sr1s-pe01/);
    const e = byId(caseE().entryId);
    expect(e.senderEmail).toBe(ADDR.ahmed.email);
    // monitoring-address alert is evidence only
    expect(byId(caseB().entryId).counted).toBe(false);
    // quoted NMC message inside D's body is NOT a separate stored email
    expect(emails.filter((x) => x.kind === "NMC" && x.subject === "Fiber cut Zafaraniya")).toHaveLength(0);
    // F: similar subjects, different conversations → both counted separately
    expect(emails.filter((x) => x.subject === "Power outage Site 7" && x.counted)).toHaveLength(2);
    // G: one conversation across timestamps
    expect(new Set(emails.filter((x) => x.externalConversationId === "CONV-G").map((x) => x.id)).size).toBe(3);

    // KPI totals equal the counted emails
    const stats = await monthlyStats(2026, 9);
    expect(stats.totalEmails).toBe(emails.filter((x) => x.counted).length);
    expect(stats.totalEmails).toBeGreaterThanOrEqual(6);
  });
});
