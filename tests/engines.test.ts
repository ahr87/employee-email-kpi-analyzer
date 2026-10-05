import { describe, expect, it } from "vitest";
import { RuleBasedDuplicateDetector, type DuplicateItem } from "@/lib/duplicate-detection/detector";
import { extractEntities } from "@/lib/classification/entities";
import { RuleBasedClassifier, type ClassificationInput } from "@/lib/classification/classifier";
import { matchEmployee, isNmcAddress } from "@/lib/employees/matching";
import { computeKpi, emptyCounts, DEFAULT_KPI_CONFIG } from "@/lib/kpi/engine";

const item = (id: string, owner: string, minute: number, subject: string, body = ""): DuplicateItem => ({
  id, ownerKey: owner, sentAt: Date.UTC(2026, 8, 1, 10, minute), subject, body, entities: extractEntities(subject, body),
});
const opts = { similarityThreshold: 80, uncertainMargin: 15, windowHours: 48 };

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
  email: { body: "please check", subject: "Issue at Mansour", sentAt: 1000, incidentIds: [], isForward: false, isReply: false, role: "EMPLOYEE" },
  thread: [], duplicate: null, possibleDuplicate: null, settings: { confidenceThreshold: 75, teamKeywords: ["noc", "operations"] }, ...over,
});
const nmc = (o: object) => ({ role: "NMC" as const, senderEmail: "nmc@x.test", senderName: "NMC", to: "", cc: "", subject: "", body: "", sentAt: 2000, isForward: false, isReply: false, incidentIds: [], ...o });
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
    const r = clf.classify(base({ duplicate: { originalId: "a", directId: "a", score: 94, minutesApart: 7, signals: ["same location (mansour)"], originalLabel: "Alice" } }));
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
