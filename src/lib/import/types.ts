import type { ParsedEmail } from "../parser";

/** What the shared import core needs for one message, whatever its source (pasted text or Outlook export). */
export interface ImportItem {
  parsed: ParsedEmail;
  /** Outlook export only. */
  external?: { entryId: string; conversationId: string | null; receivedAtRaw: string };
  /** Outlook export only: the original message as exported (stored untouched in the `raw` table). */
  raw?: { entryId: string; conversationId: string | null; subject: string; from: string; fromEmail: string; to: string; cc: string; receivedAt: string; body: string; htmlBody: string };
  /** How the analysis copy was derived from the original. */
  normalization?: NormalizationInfo;
}

export interface NormalizationInfo {
  source: "plain" | "html";
  originalChars: number;
  htmlChars: number;
  quotedChars: number;
  signatureChars: number;
  quotedMarker: string | null;
  signatureReason: string | null;
  hasTable: boolean;
}

export type ImportPhase = "validating" | "normalizing" | "importing" | "analyzing" | "done";
export interface ImportProgress { phase: ImportPhase; done: number; total: number }
export type ProgressFn = (p: ImportProgress) => void;

export type MonthMode = "selected" | "received";

/** Lets long-running work give the browser a chance to paint and handle clicks. */
export const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
