import { normalizeForAnalysis } from "../text";

/**
 * Phrase lists used as EVIDENCE by the deterministic classifier (English + Arabic).
 * All lists are editable in Settings → Classification phrases. Matching is done on normalised text
 * (case, Arabic letter variants, diacritics and digits are folded) and skips negated occurrences.
 */
export interface PhraseLists {
  escalation: string[]; // NMC says it escalated / forwarded / asked another team to act
  notUseful: string[]; // NMC says no action is needed / informational / already known
  duplicate: string[]; // NMC says this was already reported / is a duplicate
  useful: string[]; // NMC acknowledges / is working on it (supporting evidence only)
}

export const DEFAULT_PHRASES: PhraseLists = {
  escalation: [
    "escalated to", "escalating to", "escalated this", "forwarded to", "forwarding to", "forwarding this", "forwarded this",
    "i have forwarded", "we have forwarded", "passed to", "passed this to", "handed over to", "referred to", "assigned to",
    "kindly check", "kindly action", "please check", "please action", "for your action", "for action", "please investigate",
    "kindly investigate", "please follow up", "kindly follow up", "to be handled by", "dispatched", "sent to the team",
    "ticket has been created", "ticket created", "ticket raised", "ticket opened", "opened a ticket", "raised a ticket", "case opened", "raised to",
    "تم تحويل", "تم رفع", "تم احالة", "تمت احالة", "تم تصعيد", "تم التصعيد", "تم ارسال", "تم الابلاغ عن", "تم فتح تذكرة", "تم رفع بلاغ",
    "للمتابعة", "يرجى المتابعة", "يرجى الفحص", "يرجى التحقق", "الرجاء التحقق", "الرجاء الفحص", "للاجراء", "يرجى اتخاذ اللازم",
  ],
  notUseful: [
    "no action required", "no action needed", "no action is required", "no further action", "no issue found", "no issues found",
    "for information only", "for your information", "fyi only", "not related to nmc", "already handled", "already informed",
    "already aware", "we are aware", "known issue", "issue already known", "already known", "not an issue", "working as expected",
    "as expected", "not applicable", "out of scope", "no impact", "please avoid duplicate", "kindly avoid", "no need to", "no need for",
    "unnecessary", "not actionable", "everything is normal", "already resolved", "already fixed",
    "لا يتطلب اجراء", "لا يتطلب اي اجراء", "لا يوجد اجراء", "لا داعي", "لا حاجه", "معروفه مسبقا", "المشكله معروفه", "لا توجد مشكله",
    "للعلم فقط", "للاطلاع فقط", "للاطلاع", "لا علاقه", "تم التعامل معها", "تمت المعالجه مسبقا", "يرجى عدم تكرار", "الرجاء عدم تكرار",
  ],
  duplicate: [
    "already reported", "duplicate request", "duplicate report", "duplicate ticket", "duplicate of", "this is a duplicate", "is a duplicate",
    "same issue as", "same incident as", "reported earlier", "reported by another", "reported by someone", "already raised",
    "already logged", "already have a ticket", "ticket already exists", "already open",
    "تم الابلاغ عنها مسبقا", "تم الابلاغ سابقا", "تم الابلاغ عنه مسبقا", "مبلغ عنها", "بلاغ مكرر", "طلب مكرر", "نفس المشكله", "تم رفعها سابقا", "تم تسجيلها مسبقا",
  ],
  useful: [
    "received and checking", "we are checking", "we are looking", "under investigation", "being investigated", "we are working on",
    "ticket has been created", "has been fixed", "has been restored", "restored", "resolved",
    "جاري الفحص", "جاري المتابعة", "قيد المتابعة", "قيد الفحص", "تم الاستلام", "تم الحل", "تم اصلاح", "تم اصلاحها",
  ],
};

export interface CompiledPhrases { escalation: string[]; notUseful: string[]; duplicate: string[]; useful: string[] }

export function compilePhrases(p: PhraseLists): CompiledPhrases {
  const c = (l: string[]) => [...new Set(l.map(normalizeForAnalysis).filter((x) => x.length >= 2))];
  return { escalation: c(p.escalation), notUseful: c(p.notUseful), duplicate: c(p.duplicate), useful: c(p.useful) };
}

const NEGATIONS = /(?:\b(?:not|no|never|without|cannot|can't|isn't|wasn't|wasnt|hasn't|hasnt|haven't|didn't|didnt|don't|dont|unable to|nor)\s+(?:yet\s+|been\s+|be\s+|really\s+)?$|(?:^|\s)(?:لم|لا|بدون|ليس|ما)\s+(?:يتم\s+|تم\s+)?$)/;
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Phrases found in `text` (already normalised with normalizeForAnalysis). Negated occurrences are skipped. */
export function findPhrases(textNorm: string, phrases: string[], opts: { negation?: boolean } = {}): string[] {
  const found: string[] = [];
  for (const p of phrases) {
    let from = 0;
    for (;;) {
      const idx = textNorm.indexOf(p, from);
      if (idx < 0) break;
      from = idx + p.length;
      // whole-word match for latin phrases ("fyi" must not match inside another word)
      if (/^[a-z0-9]/.test(p) && isWordChar(textNorm[idx - 1])) continue;
      if (/[a-z0-9]$/.test(p) && isWordChar(textNorm[idx + p.length])) continue;
      if (opts.negation && NEGATIONS.test(textNorm.slice(Math.max(0, idx - 24), idx))) continue;
      found.push(p);
      break;
    }
  }
  return found;
}

export const DEFAULT_TEAM_KEYWORDS: string[] = [
  "noc", "operations", "support", "field", "engineering", "maintenance", "technical", "team", "department",
  "dept", "planning", "core", "transmission", "access", "ftth", "ip", "backbone", "helpdesk", "تشغيل", "صيانة", "فريق", "قسم", "هندسة",
];
