import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/database/client";
import { importBatch } from "@/lib/import/importer";
import { applyEmailAction } from "@/lib/import/emails";
import { monthlyStats } from "@/lib/reports/aggregate";
import { saveSettings } from "@/lib/settings";
import { resetData } from "@/lib/demo";
import { chain, msg, NMC, T } from "./helpers";

const EMP = [
  ["E1", "Ahmed Ali", "ahmed@company.test"], ["E2", "Sara Hassan", "sara@company.test"], ["E3", "Omar Khalid", "omar@company.test"],
] as const;
const who = (i: number) => ({ from: EMP[i][1], email: EMP[i][2] });
const mine = async (subject: string) => prisma.email.findFirstOrThrow({ where: { subject, counted: true } });
const imp = (text: string, month = 9) => importBatch({ year: 2026, month, text });

beforeEach(async () => {
  await resetData({ employees: true, settings: true });
  await prisma.employee.createMany({ data: EMP.map(([employeeId, name, email]) => ({ employeeId, name, email })) });
  await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", label: "NMC", enabled: true }, { address: "@monitoring.acme.test", label: "Monitoring", enabled: true }] });
});

describe("Phase 2 cases (Outlook-style pasted text)", () => {
  it("Case 1 — FORWARDED: employee email + NMC response + forward to another team (one pasted chain)", async () => {
    const text = chain([
      NMC(T(14, 11, 40), "FW: MPLS Issue - Site X", "Please investigate Site X.", { to: "Field Team <field.team@company.test>" }),
      NMC(T(14, 10, 50), "RE: MPLS Issue - Site X", "Received and checking.", { to: "Ahmed Ali <ahmed@company.test>" }),
      { ...who(0), at: T(14, 10, 32), subject: "MPLS Issue - Site X", body: "Service is unstable at Site X." },
    ]);
    const r = await imp(text);
    expect(r.newEmails).toBe(3);
    expect(r.nmcMessages).toBe(2);
    const e = await mine("MPLS Issue - Site X");
    expect(e.finalClass).toBe("FORWARDED");
    expect(e.confidence).toBeGreaterThanOrEqual(90);
    expect(e.reviewStatus).toBe("OK");
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(1); // NMC messages are not counted
  });

  it("Case 2 — NOT USEFUL: NMC says no action is required", async () => {
    await imp(chain([
      NMC(T(14, 12, 0), "RE: Slow page", "Hello, no action required from NMC. This is a known issue.", { to: "Sara Hassan <sara@company.test>" }),
      { ...who(1), at: T(14, 11, 30), subject: "Slow page", body: "The portal is slow today." },
    ]));
    const e = await mine("Slow page");
    expect(e.finalClass).toBe("NOT_USEFUL");
    expect(e.reviewStatus).toBe("OK");
  });

  it("Case 3 — DUPLICATE: second employee reports the same incident minutes later", async () => {
    await imp([
      msg({ ...who(0), at: T(14, 10, 5), subject: "BB outage at Mansour", body: "Customers in Mansour have no BB. Circuit CKT-48213." }),
      msg({ ...who(2), at: T(14, 10, 16), subject: "Mansour BB connection is down", body: "BB link down in Mansour, ckt-48213 red." }),
      msg(NMC(T(14, 10, 30), "FW: BB outage at Mansour", "Escalated to NOC.", { to: "NOC Operations <noc@company.test>" })),
    ].join("\n"));
    const a = await mine("BB outage at Mansour");
    const b = await mine("Mansour BB connection is down");
    expect(a.finalClass).toBe("FORWARDED");
    expect(b.finalClass).toBe("DUPLICATE");
    expect(b.duplicateOfId).toBe(a.id);
    expect(b.duplicateSimilarity).toBeGreaterThanOrEqual(80);
    expect(b.reason).toMatch(/circuit ID/i);
    expect(b.reason).toMatch(/Ahmed Ali reported the issue 11 minutes earlier/);
    const s = await monthlyStats(2026, 9);
    expect(s.employees.find((x) => x.name === "Omar Khalid")!.counts.DUPLICATE).toBe(1);
  });

  it("Case 3b — original is chosen by timestamp even if pasted last", async () => {
    await imp([
      msg({ ...who(2), at: T(14, 10, 40), subject: "Mansour BB link down", body: "No BB in Mansour" }),
      msg({ ...who(0), at: T(14, 10, 5), subject: "BB outage at Mansour", body: "No BB in Mansour" }),
    ].join("\n"));
    expect((await mine("Mansour BB link down")).finalClass).toBe("DUPLICATE");
    expect((await mine("BB outage at Mansour")).finalClass).not.toBe("DUPLICATE");
  });

  it("Case 4 — PENDING: only the employee's email, no evidence → review required, nothing invented", async () => {
    const r = await imp(msg({ ...who(1), at: T(15, 9, 0), subject: "Router reboot needed", body: "Please advise, I think we should forward this to the field team." }));
    const e = await mine("Router reboot needed");
    expect(e.finalClass).toBe("PENDING_REVIEW");
    expect(e.confidence).toBeLessThan(75);
    expect(e.reviewStatus).toBe("NEEDS_REVIEW");
    expect(e.reviewReasons).toContain("NO_EVIDENCE");
    expect(r.needsReview).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/No messages from your NMC addresses/);
  });

  it("Case 5 — Arabic employee email + Arabic NMC response (forward) and (no action)", async () => {
    await imp([
      chain([
        NMC(T(16, 10, 40), "إعادة توجيه: انقطاع الخدمة في الكرادة", "تم تحويل البلاغ إلى فريق الصيانة. يرجى الفحص.", { to: "فريق الصيانة <maintenance@company.test>" }),
        { ...who(0), at: T(16, 10, 15), subject: "انقطاع الخدمة في الكرادة", body: "الخدمة منقطعة في منطقة الكرادة منذ ساعة." },
      ]),
      chain([
        NMC(T(16, 12, 30), "رد: سؤال عن الفاتورة", "لا يتطلب اجراء، المشكلة معروفة مسبقا.", { to: "سارة <sara@company.test>" }),
        { ...who(1), at: T(16, 12, 0), subject: "سؤال عن الفاتورة", body: "هل الفاتورة صحيحة؟" },
      ]),
    ].join("\n"));
    const a = await mine("انقطاع الخدمة في الكرادة");
    expect(a.body).toBe("الخدمة منقطعة في منطقة الكرادة منذ ساعة.");
    expect(a.finalClass).toBe("FORWARDED");
    expect((await mine("سؤال عن الفاتورة")).finalClass).toBe("NOT_USEFUL");
  });

  it("Case 6 — mixed Arabic/English content is not corrupted and classifies correctly", async () => {
    const body = "الـ link غير مستقر - MPLS unstable at Site X, device SW-BGD-01 (10.1.2.3)";
    await imp(chain([
      NMC(T(17, 9, 40), "FW: MPLS مشكلة في Site X", "Please check Site X – تم التحويل", { to: "IP Core Team <ipcore@company.test>" }),
      { ...who(2), at: T(17, 9, 10), subject: "MPLS مشكلة في Site X", body },
    ]));
    const e = await mine("MPLS مشكلة في Site X");
    expect(e.body).toBe(body);
    expect(e.rawSource).toContain(body);
    expect(e.devices).toBe("sw-bgd-01");
    expect(e.ipAddresses).toBe("10.1.2.3");
    expect(e.finalClass).toBe("FORWARDED");
  });

  it("Case 7 — the same content pasted twice adds zero new emails (also across chains that quote it)", async () => {
    const text = msg({ ...who(0), at: T(14, 10, 5), subject: "BB outage", body: "Down." });
    const first = await imp(text);
    const second = await imp(text);
    expect(first.newEmails).toBe(1);
    expect(second.newEmails).toBe(0);
    expect(second.exactDuplicates).toBe(1);
    // a later chain that quotes the very same email must not import it again
    const third = await imp(chain([
      NMC(T(14, 10, 30), "RE: BB outage", "Received.", { to: "Ahmed <ahmed@company.test>" }),
      { ...who(0), at: T(14, 10, 5), subject: "BB outage", body: "Down." },
    ]));
    expect(third.newEmails).toBe(1);
    expect(third.quotedRepeats).toBe(1);
    expect(await prisma.email.count({ where: { counted: true } })).toBe(1);
  });

  it("Case 8 — three batches accumulate and late NMC evidence upgrades earlier emails", async () => {
    await imp(msg({ ...who(0), at: T(2, 9, 0), subject: "Issue one", body: "a" }) + "\n" + msg({ ...who(1), at: T(2, 9, 30), subject: "Issue two", body: "b" }));
    await imp(msg({ ...who(2), at: T(3, 9, 0), subject: "Issue three", body: "c" }));
    expect(await prisma.batch.count()).toBe(2);
    expect((await mine("Issue one")).finalClass).toBe("PENDING_REVIEW");
    // third batch contains only the NMC forward for "Issue one"
    await imp(msg(NMC(T(2, 10, 0), "FW: Issue one", "Escalated to the field team.", { to: "Field <field@company.test>" })));
    expect(await prisma.batch.count()).toBe(3);
    expect((await mine("Issue one")).finalClass).toBe("FORWARDED");
    expect((await mine("Issue two")).finalClass).toBe("PENDING_REVIEW");
    expect((await monthlyStats(2026, 9)).totalEmails).toBe(3);
  });
});

describe("conversation structure and review reasons", () => {
  it("a follow-up reply by the employee is evidence, not a second counted email", async () => {
    await imp(chain([
      { ...who(0), at: T(14, 11, 0), subject: "RE: Fault X", body: "Thanks, any news?" },
      NMC(T(14, 10, 30), "RE: Fault X", "Received and checking.", { to: "Ahmed <ahmed@company.test>" }),
      { ...who(0), at: T(14, 10, 0), subject: "Fault X", body: "Fault at X." },
    ]));
    const s = await monthlyStats(2026, 9);
    expect(s.totalEmails).toBe(1);
    expect(await prisma.email.count({ where: { kind: "FOLLOW_UP" } })).toBe(1);
  });

  it("third-party (department) replies are evidence, never counted as unmatched employees", async () => {
    await imp(chain([
      { from: "Field Team", email: "field@company.test", at: T(14, 13, 0), subject: "RE: FW: Fault Y", body: "Fixed on site.", to: "NMC" },
      NMC(T(14, 11, 0), "FW: Fault Y", "Please check.", { to: "Field Team <field@company.test>" }),
      { ...who(1), at: T(14, 10, 0), subject: "Fault Y", body: "Fault at Y." },
    ]));
    const s = await monthlyStats(2026, 9);
    expect(s.totalEmails).toBe(1);
    expect(s.unmatched).toBe(0);
    expect((await mine("Fault Y")).finalClass).toBe("FORWARDED");
  });

  it("unmatched sender, missing date and out-of-month are routed to review", async () => {
    await imp([
      msg({ from: "Zed Outsider", email: "zed@other.test", at: T(14, 9, 0), subject: "Unknown sender", body: "x" }),
      msg({ ...who(0), at: T(2, 9, 0, 8), subject: "August email", body: "y" }),
      "From: Ahmed Ali <ahmed@company.test>\nSubject: No date\n\nz",
    ].join("\n"));
    expect((await mine("Unknown sender")).reviewReasons).toContain("UNMATCHED_EMPLOYEE");
    expect((await mine("August email")).reviewReasons).toContain("OUTSIDE_MONTH");
    expect((await mine("No date")).reviewReasons).toContain("DATE_INVALID");
    const s = await monthlyStats(2026, 9);
    expect(s.totalEmails).toBe(2); // August email is held out until decided
    expect(s.outsideMonthPending).toBe(1);
  });

  it("ambiguous day/month that could change the month is flagged; unambiguous dates in the paste decide the order", async () => {
    await saveSettings({ dateOrder: "DMY" });
    // 03/09/2026 is 3 Sep (DMY) but 9 Mar (MDY) → flagged for September
    const r = await imp("From: Ahmed Ali <ahmed@company.test>\nSent: 03/09/2026 10:00\nSubject: Ambiguous\n\nbody");
    const e = await mine("Ambiguous");
    expect(e.sentAt?.toISOString()).toBe("2026-09-03T10:00:00.000Z");
    expect(e.reviewReasons).toContain("DATE_AMBIGUOUS");
    expect(r.warnings.join(" ")).toMatch(/ambiguous/i);
    // a paste where another date proves month/day order overrides the setting, is remembered, and clears the flags
    const r2 = await imp("From: Sara Hassan <sara@company.test>\nSent: 09/25/2026 10:00\nSubject: Proof\n\nb\n\nFrom: Omar Khalid <omar@company.test>\nSent: 09/03/2026 11:00\nSubject: Same format\n\nb");
    expect(r2.warnings.join(" ")).toMatch(/month\/day\/year/);
    expect((await mine("Same format")).sentAt?.toISOString()).toBe("2026-09-03T11:00:00.000Z");
    expect((await mine("Same format")).reviewReasons).not.toContain("DATE_AMBIGUOUS");
    const learned = await (await import("@/lib/settings")).getSettings();
    expect(learned).toMatchObject({ dateOrder: "MDY", dateOrderLearned: true });
    // later pastes no longer flag ambiguous dates
    await imp("From: Ahmed Ali <ahmed@company.test>\nSent: 04/09/2026 10:00\nSubject: Later paste\n\nbody");
    expect((await mine("Later paste")).reviewReasons).not.toContain("DATE_AMBIGUOUS");
  });

  it("NMC address entries can be disabled", async () => {
    await saveSettings({ nmcAddresses: [{ address: "nmc@acme.test", label: "NMC", enabled: false }] });
    await imp(chain([
      NMC(T(14, 11, 40), "FW: Z", "Escalated to field.", { to: "Field <f@company.test>" }),
      { ...who(0), at: T(14, 10, 32), subject: "Z", body: "z" },
    ]));
    expect((await mine("Z")).finalClass).toBe("PENDING_REVIEW"); // NMC not recognised → no evidence
  });

  it("manual duplicate selection, override and approval drive totals immediately", async () => {
    await imp([
      msg({ ...who(0), at: T(14, 10, 0), subject: "Alpha issue", body: "alpha" }),
      msg({ ...who(1), at: T(14, 11, 0), subject: "Beta issue", body: "beta" }),
    ].join("\n"));
    const a = await mine("Alpha issue"), b = await mine("Beta issue");
    await applyEmailAction(b.id, { action: "override", classification: "DUPLICATE", duplicateOfId: a.id, reason: "Same customer" });
    const after = await prisma.email.findUniqueOrThrow({ where: { id: b.id } });
    expect(after).toMatchObject({ finalClass: "DUPLICATE", duplicateOfId: a.id, isManual: true, reviewStatus: "REVIEWED" });
    await applyEmailAction(a.id, { action: "override", classification: "FORWARDED" });
    const s = await monthlyStats(2026, 9);
    expect(s.counts).toMatchObject({ FORWARDED: 1, DUPLICATE: 1, PENDING_REVIEW: 0 });
    expect(s.employees.find((e) => e.name === "Ahmed Ali")!.kpi.score).toBe(100);
    expect(s.employees.find((e) => e.name === "Sara Hassan")!.kpi.score).toBe(0);
  });
});
