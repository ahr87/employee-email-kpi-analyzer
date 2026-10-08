import { parseView } from "../text";

/**
 * Signature / disclaimer detection for the ANALYSIS copy only (the original body is never changed).
 * A signature is cut when a short closing line ("Best regards", "مع التحية") is followed by a short block, when a
 * disclaimer or "Sent from…" line starts, when the "-- " delimiter appears, or when the message ends with a block of
 * contact details (phone / web / address / social links).
 */
const CLOSING = /^(?:(?:best|kind|warm|many|with|sincere|thanks (?:and|&)|thank you and)\s+)*(?:regards|thanks|thank you|sincerely|cheers|br|best wishes|yours (?:sincerely|faithfully)|rgds|cordialement|mit freundlichen grüßen|saludos)\b[\s,.!:-]*$|^(?:مع التحية|مع تحياتي|مع أطيب التحيات|مع خالص التحية|تحياتي|وتفضلوا بقبول فائق الاحترام|شكرا(?:\s*لكم)?|شكراً(?:\s*لكم)?)[\s,.!:،-]*$/i;
const DISCLAIMER = /^(?:this (?:e-?mail|message|communication)\b.*(?:confidential|intended|privileged)|the information (?:contained|in this)\b|confidentiality notice|disclaimer\b|please consider the environment|sent from my\b|get outlook for\b|sent from outlook|هذه الرسالة.*(?:سرية|مخصصة)|تنويه\b)/i;
const CONTACT = /(?:\b(?:tel|telephone|phone|mobile|mob|cell|fax|gsm|e-?mail|email|web|website|address|skype|whatsapp)\b\s*[:.]|\bwww\.|https?:\/\/|linkedin\.com|facebook\.com|twitter\.com|instagram\.com|youtube\.com|@\w+\.\w{2,}|(?:\+|00)\d[\d\s().-]{7,}|هاتف|موبايل|جوال|الموقع|عنوان)/i;
const SHORT_LINE = /^[^\n]{1,70}$/;

export interface SignatureSplit { body: string; signature: string; reason: "closing" | "disclaimer" | "delimiter" | "contact-block" | null }

export function splitSignature(input: string): SignatureSplit {
  const text = input.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const view = lines.map((l) => parseView(l).trim());
  let cut = -1;
  let reason: SignatureSplit["reason"] = null;
  const nonEmptyAfter = (i: number) => view.slice(i + 1).filter(Boolean).length;
  for (let i = 1; i < lines.length; i++) { // never cut at the very first line
    const v = view[i];
    if (!v) continue;
    if (v === "--" || v === "-- " || /^-- ?$/.test(lines[i])) { cut = i; reason = "delimiter"; break; }
    if (DISCLAIMER.test(v)) { cut = i; reason = "disclaimer"; break; }
    if (v.length <= 50 && CLOSING.test(v) && nonEmptyAfter(i) <= 16) { cut = i; reason = "closing"; break; }
  }
  if (cut < 0) {
    // trailing contact block: at least 3 consecutive short lines at the end with >= 2 contact details
    let end = lines.length - 1;
    while (end >= 0 && !view[end]) end--;
    let start = end;
    while (start >= 0 && (!view[start] || (SHORT_LINE.test(view[start]) && start > 0))) start--;
    const block = view.slice(start + 1, end + 1).filter(Boolean);
    if (block.length >= 3 && block.filter((l) => CONTACT.test(l)).length >= 2 && start >= 0) {
      let first = start + 1;
      // include up to 3 short name/title lines directly above the contact lines
      let extra = 0;
      while (first > 1 && extra < 3 && view[first - 1] && SHORT_LINE.test(view[first - 1]) && !/[.!?؟]$/.test(view[first - 1])) { first--; extra++; }
      if (first > 0) { cut = first; reason = "contact-block"; }
    }
  }
  if (cut < 0) return { body: text.trimEnd(), signature: "", reason: null };
  return { body: lines.slice(0, cut).join("\n").trimEnd(), signature: lines.slice(cut).join("\n").trim(), reason };
}

/** Text without its signature (used by duplicate detection and entity extraction). */
export const stripSignatureText = (text: string) => splitSignature(text).body;
