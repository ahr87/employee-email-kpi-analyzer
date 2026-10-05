/** Phrase lists used by the deterministic classifier (English + Arabic). Editable in one place. */

export const ESCALATION_PHRASES: string[] = [
  "escalated to", "escalating to", "escalated this", "forwarded to", "forwarding to", "forwarding this",
  "kindly check", "kindly action", "please check", "please action", "for your action", "for action",
  "please investigate", "kindly investigate", "assigned to", "ticket has been created", "ticket created",
  "ticket opened", "opened a ticket", "raised a ticket", "raised to", "sent to the team", "handed over",
  "please follow up", "kindly follow up", "for your follow", "to be handled by", "dispatched",
  "تم تحويل", "تم رفع", "تم احالة", "تمت الإحالة", "للمتابعة", "يرجى المتابعة", "يرجى الفحص", "يرجى التحقق",
];

export const NO_ACTION_PHRASES: string[] = [
  "no action required", "no action needed", "no action is required", "no further action", "not required",
  "no need", "already known", "known issue", "already aware", "we are aware", "not an issue",
  "working as expected", "as expected", "for your information", "fyi only", "not actionable", "not applicable",
  "out of scope", "please do not send", "kindly avoid", "unnecessary", "no impact", "already resolved",
  "already fixed", "not related to nmc", "no issue found", "everything is normal",
  "لا يتطلب", "لا داعي", "لا حاجة", "معروفة مسبقا", "معروفة مسبقاً", "ليست مشكلة", "لا يوجد اجراء", "لا يوجد إجراء",
];

/** Recipient words that suggest a department/team (used as supporting evidence only). */
export const DEFAULT_TEAM_KEYWORDS: string[] = [
  "noc", "operations", "support", "field", "engineering", "maintenance", "technical", "team", "department",
  "dept", "planning", "core", "transmission", "access", "ftth", "ip", "backbone", "helpdesk", "تشغيل", "صيانة", "فريق", "قسم",
];

export function findPhrases(text: string, phrases: string[]): string[] {
  const t = text.toLowerCase();
  return phrases.filter((p) => t.includes(p));
}
