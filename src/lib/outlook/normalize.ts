import { htmlToText, hasHtmlTable } from "../parser/html";
import { splitQuoted } from "./quoted";
import { splitSignature } from "./signature";
import type { NormalizationInfo } from "../import/types";

export interface NormalizedMessage {
  /** The analysis copy: only what the sender wrote in THIS message, without quoted history or signature. */
  text: string;
  info: NormalizationInfo;
}

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;
const tidy = (s: string) => s.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[​⁠﻿]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/**
 * Builds the normalized analysis representation of an Outlook message. The original (plain + HTML) is stored separately and
 * never modified. Steps: choose the plain body (or the HTML converted to safe text when the plain body is missing/much
 * shorter) → cut quoted / forwarded history → cut signature and disclaimers.
 */
export function normalizeOutlookMessage(plain: string, html: string): NormalizedMessage {
  const plainText = tidy(plain);
  const htmlText = html ? tidy(htmlToText(html)) : "";
  const useHtml = htmlText.length > 0 && (plainText.length === 0 || letters(plainText) < 0.6 * letters(htmlText));
  const chosen = useHtml ? htmlText : plainText;
  const q = splitQuoted(chosen);
  const sig = splitSignature(q.current);
  const text = sig.body || q.current; // never end up with nothing when the message is only a signature
  return {
    text,
    info: {
      source: useHtml ? "html" : "plain",
      originalChars: plain.length, htmlChars: html.length,
      quotedChars: q.quoted.length, signatureChars: sig.signature.length,
      quotedMarker: q.marker, signatureReason: sig.reason,
      hasTable: html ? hasHtmlTable(html) : false,
    },
  };
}
