import type { Classification, ReviewReason } from "../types";
import { stripQuoted } from "./text";
import { ESCALATION_PHRASES, NO_ACTION_PHRASES, findPhrases } from "./phrases";
import { describeDuplicate, type DuplicateMatch } from "../duplicate-detection/detector";

export interface ThreadMessage {
  role: "EMPLOYEE" | "NMC";
  senderEmail: string;
  senderName: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  sentAt: number | null;
  isForward: boolean;
  isReply: boolean;
  incidentIds: string[];
}

export interface ClassificationInput {
  email: {
    body: string;
    subject: string;
    sentAt: number | null;
    incidentIds: string[];
    isForward: boolean;
    isReply: boolean;
    role: "EMPLOYEE" | "NMC";
  };
  /** Other messages of the same conversation (same normalised subject) found in the imported data. */
  thread: ThreadMessage[];
  duplicate: (DuplicateMatch & { originalLabel: string }) | null;
  possibleDuplicate: (DuplicateMatch & { originalLabel: string }) | null;
  settings: { confidenceThreshold: number; teamKeywords: string[] };
}

export interface ClassificationResult {
  classification: Classification;
  confidence: number; // 0-100
  reason: string;
  reviewReasons: ReviewReason[];
}

/** Pluggable contract — a future AI-assisted classifier can implement this and be used instead. */
export interface EmailClassifier {
  classify(input: ClassificationInput): ClassificationResult | Promise<ClassificationResult>;
}

const cap = (n: number) => Math.max(0, Math.min(100, n));
const conf = (score: number) => Math.min(99, Math.round(45 + score * 0.6));

export class RuleBasedClassifier implements EmailClassifier {
  classify(input: ClassificationInput): ClassificationResult {
    const { email, thread, duplicate, possibleDuplicate, settings } = input;
    const reviewReasons: ReviewReason[] = [];

    if (email.role === "NMC") {
      return { classification: "OTHER", confidence: 100, reason: "NMC message used as evidence for other emails; not counted as an employee email.", reviewReasons: [] };
    }

    // 1. Business duplicate wins: the employee reported something already reported.
    if (duplicate) {
      return {
        classification: "DUPLICATE",
        confidence: Math.min(99, duplicate.score),
        reason: describeDuplicate(duplicate, duplicate.originalLabel),
        reviewReasons: duplicate.score < settings.confidenceThreshold ? ["LOW_CONFIDENCE"] : [],
      };
    }
    if (possibleDuplicate) reviewReasons.push("UNCERTAIN_DUPLICATE");

    // 2. Evidence of NMC action in the conversation (later NMC messages) and in the email itself.
    const later = thread.filter(
      (m) => m.role === "NMC" && (email.sentAt == null || m.sentAt == null || m.sentAt >= email.sentAt),
    );
    const evidence: string[] = [];
    let forward = 0;
    let noAction = 0;
    const teamRe = settings.teamKeywords.length
      ? new RegExp(`\\b(${settings.teamKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i")
      : null;

    for (const m of later) {
      const text = stripQuoted(m.body);
      if (m.isForward) { forward += 55; evidence.push("NMC forwarded the message (FW: subject)"); }
      const recipients = `${m.to} ${m.cc}`;
      if (teamRe && teamRe.test(recipients) && (m.isForward || findPhrases(text, ESCALATION_PHRASES).length)) {
        forward += 20; evidence.push("sent to a department/team recipient");
      }
      const esc = findPhrases(text, ESCALATION_PHRASES);
      if (esc.length) { forward += 30 + Math.min(10, (esc.length - 1) * 5); evidence.push(`escalation wording ("${esc[0]}")`); }
      const newIncident = m.incidentIds.filter((id) => !email.incidentIds.includes(id));
      if (newIncident.length) { forward += 15; evidence.push(`ticket/incident ${newIncident[0]} was raised`); }
      const na = findPhrases(text, NO_ACTION_PHRASES);
      if (na.length) { noAction += 45 + Math.min(20, (na.length - 1) * 10); evidence.push(`no-action wording ("${na[0]}")`); }
      if (m.isReply && !m.isForward) noAction += 20;
    }
    // Reply without any forwarding is a weak "replied without escalation" hint only when it also carries no-action wording.
    if (later.length && noAction > 0 && forward === 0) evidence.push(`${later.length} NMC reply message(s) without escalation`);

    // the pasted email itself is a forward (e.g. NMC forwarded it and the forward was pasted)
    if (email.isForward && later.length === 0) { forward += 25; evidence.push("the pasted email itself is a forward"); }

    forward = cap(forward);
    noAction = cap(noAction);

    let result: ClassificationResult;
    if (forward >= 45 && noAction >= 45 && Math.abs(forward - noAction) <= 25) {
      result = {
        classification: "PENDING_REVIEW", confidence: 50,
        reason: "Conflicting evidence: both escalation and no-action wording were found in the conversation.",
        reviewReasons: ["AMBIGUOUS"],
      };
    } else if (forward >= 50 && forward > noAction + 10) {
      result = {
        classification: "FORWARDED", confidence: conf(forward),
        reason: `Evidence of escalation: ${[...new Set(evidence)].join("; ")}.`, reviewReasons: [],
      };
    } else if (noAction >= 45 && noAction > forward + 10) {
      result = {
        classification: "NOT_USEFUL", confidence: conf(noAction),
        reason: `The email was answered without escalation and the content indicates that no NMC action was required (${[...new Set(evidence)].join("; ")}).`,
        reviewReasons: [],
      };
    } else {
      const some = Math.max(forward, noAction);
      result = {
        classification: "PENDING_REVIEW", confidence: Math.min(70, Math.round(30 + some * 0.5)),
        reason: some
          ? `Weak evidence only (${[...new Set(evidence)].join("; ")}); manual review needed.`
          : "No evidence of escalation or of a no-action reply was found in the pasted data.",
        reviewReasons: ["NO_EVIDENCE"],
      };
    }

    if (result.confidence < settings.confidenceThreshold && !result.reviewReasons.includes("NO_EVIDENCE") && !result.reviewReasons.includes("AMBIGUOUS")) {
      result.reviewReasons.push("LOW_CONFIDENCE");
    }
    if (possibleDuplicate) {
      result.reviewReasons.push("UNCERTAIN_DUPLICATE");
      result.reason += ` Possibly a duplicate of "${possibleDuplicate.originalLabel}" (${possibleDuplicate.score}% similar).`;
    }
    result.reviewReasons = [...new Set(result.reviewReasons)];
    return result;
  }
}
