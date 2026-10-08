import { z } from "zod";

export const OUTLOOK_SOURCE = "Outlook Desktop";
export const MAX_BODY_CHARS = 10_000_000;
export const MAX_HTML_CHARS = 25_000_000;

// Optional fields may be missing, null or empty in real exports; zod 4 needs an explicit optional() for missing keys.
const text = (max: number) => z.string().max(max).nullish().transform((v) => v ?? "").optional().transform((v) => v ?? "");
const list = z
  .union([z.string(), z.array(z.string()), z.null()])
  .optional()
  .transform((v) => (Array.isArray(v) ? v.join("; ") : (v ?? "")));

/** One message object as written by the Outlook VBA exporter. Unknown fields are ignored (never trusted or stored). */
export const outlookMessageSchema = z.object({
  entryId: z.string({ error: "entryId is missing" }).trim().min(1, "entryId is empty").max(2000),
  conversationId: z.string().max(2000).nullish().transform((v) => (v?.trim() ? v.trim() : null)),
  subject: text(5000),
  from: text(1000),
  fromEmail: text(1000),
  to: list,
  cc: list,
  receivedAt: z.union([z.string().trim().min(1, "receivedAt is empty"), z.number()], { error: "receivedAt is missing" }),
  body: text(MAX_BODY_CHARS),
  htmlBody: text(MAX_HTML_CHARS),
});
export type OutlookMessage = z.output<typeof outlookMessageSchema>;

export const outlookRootSchema = z.object({
  exportedAt: z.string().optional(),
  source: z.string({ error: "“source” is missing" }),
});

export const sourceMatches = (s: unknown) => typeof s === "string" && s.trim().toLowerCase() === OUTLOOK_SOURCE.toLowerCase();

export interface InvalidMessage { index: number; entryId: string | null; subject: string | null; reason: string }

/** Validates one element. Never throws: a bad message becomes an InvalidMessage and the rest of the file is still imported. */
export function validateMessage(value: unknown, index: number): { ok: true; message: OutlookMessage } | { ok: false; invalid: InvalidMessage } {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const peek = (k: string) => (obj && typeof obj[k] === "string" ? (obj[k] as string).slice(0, 120) : null);
  if (!obj) return { ok: false, invalid: { index, entryId: null, subject: null, reason: "The item is not a message object." } };
  const r = outlookMessageSchema.safeParse(obj);
  if (r.success) return { ok: true, message: r.data };
  const reason = r.error.issues.map((i) => `${i.path.join(".") || "message"}: ${i.message}`).slice(0, 3).join("; ");
  return { ok: false, invalid: { index, entryId: peek("entryId"), subject: peek("subject"), reason } };
}
