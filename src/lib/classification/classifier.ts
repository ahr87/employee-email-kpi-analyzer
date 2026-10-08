import type { Classification, ReviewReason } from "../types";
import { stripQuoted } from "./text";
import { findPhrases, type CompiledPhrases } from "./phrases";
import { describeDuplicate, type DuplicateMatch } from "../duplicate-detection/detector";
import { normalizeForAnalysis } from "../text";

export interface ThreadMessage {
  id: string;
  /** NMC = configured NMC address; OTHER = third party (e.g. another department); EMPLOYEE = an employee/follow-up. */
  role: "NMC" | "OTHER" | "EMPLOYEE";
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
  /** The message did not name this employee and several emails with the same subject exist, so it may belong to another one. */
  shared?: boolean;
}

export interface ClassificationInput {
  email: {
    senderEmail: string;
    /** Display name of the sender (used when recipients are display names without e-mail addresses, as in Outlook exports). */
    senderName?: string;
    body: string;
    subject: string;
    sentAt: number | null;
    incidentIds: string[];
    role: "EMPLOYEE" | "NMC";
  };
  /** Other messages of the same conversation found in the imported data (any month), any order. */
  thread: ThreadMessage[];
  duplicate: (DuplicateMatch & { originalLabel: string }) | null;
  possibleDuplicate: (DuplicateMatch & { originalLabel: string }) | null;
  settings: { confidenceThreshold: number; teamKeywords: string[]; phrases: CompiledPhrases; nmcEmails: string[] };
}

export interface ClassificationResult {
  classification: Classification;
  confidence: number; // 0-100
  reason: string;
  reviewReasons: ReviewReason[];
  /** For DUPLICATE decided from NMC wording alone: best guess of the original email (may be undefined). */
  duplicateOriginalId?: string;
}

/** Pluggable contract — a future AI-assisted classifier can implement this and be used instead. */
export interface EmailClassifier {
  classify(input: ClassificationInput): ClassificationResult | Promise<ClassificationResult>;
}

const cap = (n: number) => Math.max(0, Math.min(100, n));
const conf = (score: number) => Math.min(99, Math.round(45 + score * 0.6));
const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const emailsIn = (s: string) => (s.match(EMAIL_RE) ?? []).map((x) => x.toLowerCase());

/**
 * Evidence-based, deterministic classifier. Keywords are only EVIDENCE and only count when they come from
 * the right party (NMC messages / other teams AFTER the employee's email); words inside the employee's own
 * email never count. Without evidence the answer is PENDING_REVIEW — an escalation or reply is never invented.
 */
export class RuleBasedClassifier implements EmailClassifier {
  classify(input: ClassificationInput): ClassificationResult {
    const { email, thread, duplicate, possibleDuplicate, settings } = input;
    const P = settings.phrases;
    const reviewReasons: ReviewReason[] = [];

    if (email.role === "NMC") {
      return { classification: "OTHER", confidence: 100, reason: "NMC message used as evidence for other emails; not counted as an employee email.", reviewReasons: [] };
    }

    // 1. Business duplicate wins: another employee already reported the same incident.
    if (duplicate) {
      return {
        classification: "DUPLICATE",
        confidence: Math.min(99, duplicate.score),
        reason: describeDuplicate(duplicate, duplicate.originalLabel),
        reviewReasons: duplicate.score < settings.confidenceThreshold ? ["LOW_CONFIDENCE"] : [],
        duplicateOriginalId: duplicate.originalId,
      };
    }
    if (possibleDuplicate) reviewReasons.push("UNCERTAIN_DUPLICATE");

    // 2. Evidence from the conversation: messages AFTER the employee's email
    const after = thread.filter((m) => m.role !== "EMPLOYEE" && (email.sentAt == null || m.sentAt == null || m.sentAt >= email.sentAt));
    const nmc = after.filter((m) => m.role === "NMC").sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
    const others = after.filter((m) => m.role === "OTHER");
    const ignore = new Set([email.senderEmail.toLowerCase(), ...settings.nmcEmails.map((e) => e.toLowerCase())].filter(Boolean));
    const teamRe = settings.teamKeywords.length
      ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(${settings.teamKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:$|[^\\p{L}\\p{N}])`, "iu")
      : null;

    const evidence: string[] = [];
    let usedShared = false;
    let forward = 0, noAction = 0, dupWords = 0, useful = 0;
    const add = (e: string) => { if (!evidence.includes(e)) evidence.push(e); };

    for (const m of nmc) {
      const before = forward + noAction + dupWords;
      const text = normalizeForAnalysis(stripQuoted(m.body));
      const recipients = `${m.to} ${m.cc}`;
      const newRecipients = [...new Set(emailsIn(recipients).filter((e) => !ignore.has(e)))];
      const esc = findPhrases(text, P.escalation, { negation: true });
      const na = findPhrases(text, P.notUseful);
      const dp = findPhrases(text, P.duplicate, { negation: true });
      const us = findPhrases(text, P.useful, { negation: true });

      if (m.isForward) { forward += 55; add("NMC forwarded the message (FW:)"); }
      // Outlook exports list recipients by display name only: count other named recipients on a forward / escalation
      if (!emailsIn(recipients).length && (m.isForward || esc.length)) {
        const me = normalizeForAnalysis(email.senderName ?? "");
        const others = recipients.split(";").map((x) => normalizeForAnalysis(x)).filter((x) => x && x !== me);
        if (others.length) {
          forward += 15; add(`NMC sent it on to ${others.length} other recipient(s)`);
          if (teamRe && teamRe.test(recipients)) { forward += 10; add("recipient looks like a department/team"); }
        }
      }
      if (newRecipients.length && (m.isForward || esc.length || m.isReply)) {
        forward += m.isForward || esc.length ? 20 : 15;
        add(`NMC added recipient(s) outside the conversation (${newRecipients.slice(0, 2).join(", ")})`);
        if (teamRe && teamRe.test(recipients)) { forward += 10; add("recipient looks like a department/team"); }
      }
      if (esc.length) { forward += 30 + Math.min(10, (esc.length - 1) * 5); add(`escalation wording (“${esc[0]}”)`); }
      const newInc = m.incidentIds.filter((id) => !email.incidentIds.includes(id));
      if (newInc.length) { forward += 15; add(`ticket/incident ${newInc[0]} was raised by NMC`); }
      if (na.length) { noAction += 45 + Math.min(20, (na.length - 1) * 10); add(`no-action wording (“${na[0]}”)`); }
      if (m.isReply && !m.isForward && !esc.length && !newRecipients.length) noAction += 15;
      if (dp.length) { dupWords += 50 + Math.min(20, (dp.length - 1) * 10); add(`duplicate wording (“${dp[0]}”)`); }
      if (us.length) useful += 10;
      if (m.shared && forward + noAction + dupWords > before) usedShared = true;
    }
    if (others.length && (forward > 0 || nmc.some((m) => m.isForward))) {
      forward += 15; add(`${others.length} reply message(s) from another party after the NMC forward`);
    }
    if (forward >= 30 && useful) { forward += useful; add("NMC acknowledged / reported work in progress"); }

    forward = cap(forward); noAction = cap(noAction); dupWords = cap(dupWords);
    const ev = evidence.join("; ");

    const finish = (r: ClassificationResult): ClassificationResult => {
      if (usedShared && (r.classification === "FORWARDED" || r.classification === "NOT_USEFUL")) {
        r.reviewReasons.push("AMBIGUOUS");
        r.reason += " Note: several emails share this subject and the NMC message does not name this employee — please confirm it belongs to this email.";
      }
      if (r.confidence < settings.confidenceThreshold && !r.reviewReasons.includes("NO_EVIDENCE") && !r.reviewReasons.includes("AMBIGUOUS")) r.reviewReasons.push("LOW_CONFIDENCE");
      if (possibleDuplicate && r.classification !== "DUPLICATE") {
        r.reviewReasons.push("UNCERTAIN_DUPLICATE");
        r.reason += ` Possibly a duplicate of “${possibleDuplicate.originalLabel}” (${possibleDuplicate.score}% similar).`;
      }
      r.reviewReasons = [...new Set([...reviewReasons, ...r.reviewReasons])];
      return r;
    };

    // contradictory evidence → human decision
    if (forward >= 45 && noAction >= 45 && Math.abs(forward - noAction) <= 25) {
      return finish({ classification: "PENDING_REVIEW", confidence: 50, reason: `Contradictory conversation evidence: it contains both escalation and no-action signals (${ev}).`, reviewReasons: ["AMBIGUOUS"] });
    }
    if (dupWords >= 50 && forward < 50 && dupWords > noAction) {
      const orig = possibleDuplicate ?? null;
      return finish({
        classification: "DUPLICATE",
        confidence: orig ? Math.min(90, 70 + Math.round(orig.score / 10)) : 62,
        reason: orig
          ? `NMC indicated the issue was already reported (${ev}); similar earlier email from ${orig.originalLabel}.`
          : `NMC indicated the issue was already reported (${ev}), but the original email is not in the pasted data — please select the original.`,
        reviewReasons: orig ? [] : ["UNCERTAIN_DUPLICATE"],
        duplicateOriginalId: orig?.originalId,
      });
    }
    if (forward >= 50 && forward > noAction + 10) {
      return finish({ classification: "FORWARDED", confidence: conf(forward), reason: `Evidence of escalation: ${ev}.`, reviewReasons: [] });
    }
    if (noAction >= 45 && noAction > forward + 10) {
      return finish({
        classification: "NOT_USEFUL", confidence: conf(noAction),
        reason: `NMC answered without escalating and the reply indicates no NMC action was required (${ev}).`, reviewReasons: [],
      });
    }
    const some = Math.max(forward, noAction);
    const reason = nmc.length || others.length
      ? `Messages after the employee's email were found but they do not prove escalation or a no-action answer${ev ? ` (${ev})` : ""}. Manual review needed.`
      : "No NMC reply or forward was found in the pasted data, so the outcome is unknown. Paste the full conversation (and make sure NMC addresses are set in Settings) or classify manually.";
    return finish({ classification: "PENDING_REVIEW", confidence: Math.min(70, Math.round(30 + some * 0.5)), reason, reviewReasons: ["NO_EVIDENCE"] });
  }
}
