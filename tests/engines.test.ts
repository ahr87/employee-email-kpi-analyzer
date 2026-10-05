import { describe, expect, it } from "vitest";
import { RuleBasedDuplicateDetector, type DuplicateItem } from "@/lib/duplicate-detection/detector";
import { extractEntities } from "@/lib/classification/entities";
import { RuleBasedClassifier, type ClassificationInput } from "@/lib/classification/classifier";
import { compilePhrases, DEFAULT_PHRASES } from "@/lib/classification/phrases";
import { matchEmployee, isNmcAddress } from "@/lib/employees/matching";
import { computeKpi, emptyCounts, DEFAULT_KPI_CONFIG } from "@/lib/kpi/engine";

const item = (id: string, owner: string, minute: number, subject: string, body = ""): DuplicateItem => ({
  id, ownerKey: owner, sentAt: Date.UTC(2026, 8, 1, 10, minute), subject, body, entities: extractEntities(subject, body),
});
const opts = { similarityThreshold: 80, uncertainMargin: 15, windowHours: 48 };
const at = (id: string, owner: string, minute: number, subject: string, body = "") => item(id, owner, minute, subject, body);

describe("duplicate detection", () => {
  const det = new RuleBasedDuplicateDetector();
  it("detects similar incident reported by another employee", () => {
    const r = det.find([item("a", "A", 5, "BB outage at Mansour"), item("b", "B", 12, "Mansour BB connection is down")], opts);
    expect(r.duplicates.get("b")?.originalId).toBe("a");
    expect(r.duplicates.get("b")!.score).toBeGreaterThanOrEqual(80);
    expect(r.duplicates.has("a")).toBe(false);
  });
  it("uses shared circuit IDs even with different wording", () => {
    const r = det.find([
      item("a", "A", 5, "Link failure", "Circuit CKT-48213 is red"),
      item("b", "B", 30, "Customer cannot browse", "ckt-48213 affected"),
    ], opts);
    expect(r.duplicates.get("b")?.originalId).toBe("a");
  });
  it("does not mark unrelated emails or the same employee as duplicates", () => {
    const r = det.find([item("a", "A", 5, "BB outage at Mansour"), item("b", "B", 12, "Question about invoice format"), item("c", "A", 20, "BB outage at Mansour")], opts);
    expect(r.duplicates.size).toBe(0);
  });
  it("chains to the root original", () => {
    const r = det.find([item("a", "A", 1, "BB outage at Mansour"), item("b", "B", 2, "Mansour BB down"), item("c", "C", 3, "BB is down in Mansour")], opts);
    expect(r.duplicates.get("c")?.originalId).toBe("a");
  });
});

const base = (over: Partial<ClassificationInput> = {}): ClassificationInput => ({
  email: { senderEmail: "emp@x.test", body: "please check", subject: "Issue at Mansour", sentAt: 1000, incidentIds: [], role: "EMPLOYEE" },
  thread: [], duplicate: null, possibleDuplicate: null,
  settings: { confidenceThreshold: 75, teamKeywords: ["noc", "operations"], phrases: compilePhrases(DEFAULT_PHRASES), nmcEmails: ["nmc@x.test"] }, ...over,
});
let n = 0;
const nmc = (o: object) => ({ id: `m${n++}`, role: "NMC" as const, senderEmail: "nmc@x.test", senderName: "NMC", to: "", cc: "", subject: "", body: "", sentAt: 2000, isForward: false, isReply: false, incidentIds: [], ...o });
const clf = new RuleBasedClassifier();

describe("classification", () => {
  it("FORWARDED when NMC forwarded to a team", () => {
    const r = clf.classify(base({ thread: [nmc({ isForward: true, to: "NOC Operations <noc@x.test>", body: "Escalated to NOC, ticket INC700123 created", incidentIds: ["inc700123"] })] }));
    expect(r.classification).toBe("FORWARDED");
    expect(r.confidence).toBeGreaterThanOrEqual(90);
    expect(r.reason).toMatch(/escalat/i);
  });
  it("NOT_USEFUL when answered with no-action wording", () => {
    const r = clf.classify(base({ thread: [nmc({ isReply: true, body: "No action required, this is a known issue." })] }));
    expect(r.classification).toBe("NOT_USEFUL");
    expect(r.confidence).toBeGreaterThanOrEqual(75);
  });
  it("DUPLICATE wins when a duplicate match exists", () => {
    const r = clf.classify(base({ duplicate: { originalId: "a", directId: "a", score: 94, minutesApart: 7, signals: ["same location (mansour)"], tier: "STRONG", originalLabel: "Alice" } }));
    expect(r.classification).toBe("DUPLICATE");
    expect(r.confidence).toBe(94);
    expect(r.reason).toContain("Alice");
  });
  it("PENDING_REVIEW without evidence, below threshold", () => {
    const r = clf.classify(base());
    expect(r.classification).toBe("PENDING_REVIEW");
    expect(r.confidence).toBeLessThan(75);
    expect(r.reviewReasons).toContain("NO_EVIDENCE");
  });
  it("conflicting evidence goes to review", () => {
    const r = clf.classify(base({ thread: [nmc({ to: "noc@x.test", body: "escalated to noc" }), nmc({ body: "no action required, already known" })] }));
    expect(r.classification).toBe("PENDING_REVIEW");
  });
});

describe("employee matching", () => {
  const emps = [{ id: "1", name: "Ahmed Ali", email: "ahmed@company.test", active: true }];
  it("matches by email, case-insensitive", () => {
    expect(matchEmployee({ email: "AHMED@company.test", name: "x" }, emps).employee?.name).toBe("Ahmed Ali");
  });
  it("returns unmatched for unknown sender", () => {
    expect(matchEmployee({ email: "other@company.test", name: "Ahmed Ali" }, emps).employee).toBeNull();
  });
  it("falls back to a unique exact name when no address was copied", () => {
    expect(matchEmployee({ email: "", name: "ahmed ali" }, emps).by).toBe("name");
  });
  it("recognises NMC addresses and domains", () => {
    expect(isNmcAddress("nmc@x.test", ["nmc@x.test"])).toBe(true);
    expect(isNmcAddress("a@nmc.test", ["@nmc.test"])).toBe(true);
    expect(isNmcAddress("a@other.test", ["@nmc.test"])).toBe(false);
  });
});

describe("KPI engine", () => {
  it("scores quality from final classifications, not volume", () => {
    const small = { ...emptyCounts(), FORWARDED: 4, NOT_USEFUL: 1 };
    const big = { ...emptyCounts(), FORWARDED: 40, NOT_USEFUL: 10, DUPLICATE: 50 };
    expect(computeKpi(small).score).toBe(80);
    expect(computeKpi(big).score).toBe(40);
    expect(computeKpi(big).total).toBe(100);
  });
  it("excludes pending by default and honours config", () => {
    const c = { ...emptyCounts(), FORWARDED: 1, PENDING_REVIEW: 3 };
    expect(computeKpi(c).score).toBe(100);
    expect(computeKpi(c, { ...DEFAULT_KPI_CONFIG, pendingMode: "weighted" }).score).toBe(25);
  });
  it("applies penalties, minimums and target", () => {
    const c = { ...emptyCounts(), FORWARDED: 3, DUPLICATE: 1 };
    const r = computeKpi(c, { ...DEFAULT_KPI_CONFIG, penaltiesPerEmail: { DUPLICATE: 5 }, target: 70, minimumEmails: 2 });
    expect(r.score).toBe(70);
    expect(r.status).toBe("MEETS_TARGET");
    expect(computeKpi({ ...emptyCounts(), FORWARDED: 1 }, { ...DEFAULT_KPI_CONFIG, minimumEmails: 5 }).status).toBe("INSUFFICIENT_DATA");
  });
});

describe("duplicate detection — tiers and original selection", () => {
  const det = new RuleBasedDuplicateDetector();
  it("same incident number is very strong, even with unrelated wording and far apart", () => {
    const r = det.find([
      { ...at("a", "A", 0, "Router down", "Ticket INC700123"), sentAt: Date.UTC(2026, 8, 1, 9, 0) },
      { ...at("b", "B", 0, "Customers complaining", "Related to INC700123"), sentAt: Date.UTC(2026, 8, 3, 9, 0) },
    ], opts);
    expect(r.duplicates.get("b")?.tier).toBe("VERY_STRONG");
    expect(r.duplicates.get("b")!.score).toBeGreaterThanOrEqual(85);
  });
  it("same service ID + location nearby is strong", () => {
    const r = det.find([
      at("a", "A", 0, "Slow internet at Karrada", "service id: SVC-90017"),
      at("b", "B", 11, "Karrada customer complains", "Service ID SVC-90017 very slow"),
    ], opts);
    expect(r.duplicates.get("b")?.tier).toBe("STRONG");
    expect(r.duplicates.get("b")?.signals.join(" ")).toMatch(/service ID/);
  });
  it("matches on IP address and device name", () => {
    const r = det.find([
      at("a", "A", 0, "Switch unreachable", "SW-BGD-01 not reachable 10.20.30.40"),
      at("b", "B", 20, "Cannot ping 10.20.30.40", "Seems the access switch is offline"),
    ], opts);
    expect(r.duplicates.get("b")?.signals.join(" ")).toMatch(/IP address/);
  });
  it("similar subject alone is weak: never a duplicate across different places", () => {
    const r = det.find([at("a", "A", 0, "BB outage at Mansour", "Customers offline"), at("b", "B", 5, "BB outage at Karrada", "Customers offline")], opts);
    expect(r.duplicates.size).toBe(0);
  });
  it("identical generic subject with no place or id is only a 'possible' duplicate", () => {
    const r = det.find([at("a", "A", 0, "Link down"), at("b", "B", 5, "Link down")], opts);
    expect(r.duplicates.size).toBe(0);
  });
  it("selects the original by timestamp, not by paste order", () => {
    // listed with the later email first
    const r = det.find([at("late", "B", 30, "Mansour BB link down", "same"), at("early", "A", 5, "BB outage at Mansour", "same")], opts);
    expect(r.duplicates.get("late")?.originalId).toBe("early");
    expect(r.duplicates.has("early")).toBe(false);
  });
  it("on equal timestamps the email with the incident number is the original", () => {
    const a = at("a", "A", 5, "BB outage at Mansour");
    const b = at("b", "B", 5, "BB outage at Mansour", "ticket INC700555");
    const r = det.find([a, b], opts);
    expect(r.duplicates.get("a")?.originalId).toBe("b");
  });
  it("works for Arabic reports", () => {
    const r = det.find([
      at("a", "A", 0, "انقطاع الانترنت في المنصور", "الخدمة منقطعة في منطقة المنصور"),
      at("b", "B", 9, "المنصور الخدمة واقعة", "في المنصور لا يوجد انترنت"),
    ], opts);
    expect(r.duplicates.get("b")?.originalId).toBe("a");
  });
});

describe("classifier — evidence rules", () => {
  it("never classifies from the employee's own wording", () => {
    const r = clf.classify(base({ email: { ...base().email, body: "Please forward this to the field team, no action required from me, already reported" } }));
    expect(r.classification).toBe("PENDING_REVIEW");
  });
  it("a plain reply is not an escalation", () => {
    const r = clf.classify(base({ thread: [nmc({ isReply: true, body: "Received, thank you." })] }));
    expect(r.classification).toBe("PENDING_REVIEW");
  });
  it("received + later forward with new recipient = FORWARDED", () => {
    const r = clf.classify(base({ thread: [
      nmc({ isReply: true, body: "Received and checking.", sentAt: 2000 }),
      nmc({ isForward: true, to: "Field Team <field.team@x.test>", body: "Please investigate Site X.", sentAt: 3000 }),
    ] }));
    expect(r.classification).toBe("FORWARDED");
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });
  it("negated escalation wording is ignored", () => {
    const r = clf.classify(base({ thread: [nmc({ isReply: true, body: "This was not forwarded to anyone; no action required." })] }));
    expect(r.classification).toBe("NOT_USEFUL");
  });
  it("Arabic escalation and no-action wording", () => {
    expect(clf.classify(base({ thread: [nmc({ body: "تم تحويل البلاغ إلى فريق الصيانة", to: "ops@x.test", isForward: true })] })).classification).toBe("FORWARDED");
    expect(clf.classify(base({ thread: [nmc({ isReply: true, body: "لا يتطلب اجراء، المشكلة معروفة مسبقا" })] })).classification).toBe("NOT_USEFUL");
  });
  it("NMC saying 'already reported' without a known original → DUPLICATE for review", () => {
    const r = clf.classify(base({ thread: [nmc({ isReply: true, body: "This issue was already reported earlier by another colleague." })] }));
    expect(r.classification).toBe("DUPLICATE");
    expect(r.reviewReasons).toContain("UNCERTAIN_DUPLICATE");
  });
  it("custom phrases from Settings are honoured", () => {
    const phrases = compilePhrases({ ...DEFAULT_PHRASES, escalation: [...DEFAULT_PHRASES.escalation, "sent over to tier two"] });
    const r = clf.classify({ ...base({ thread: [nmc({ isForward: false, to: "t2@x.test", isReply: true, body: "We sent over to tier two." })] }), settings: { ...base().settings, phrases } });
    expect(r.classification).toBe("FORWARDED");
  });
  it("evidence before the employee's email is ignored", () => {
    const r = clf.classify(base({ thread: [nmc({ isForward: true, sentAt: 500, body: "escalated to noc" })] }));
    expect(r.classification).toBe("PENDING_REVIEW");
  });
});
