import { locateBlocks, QUOTE_MARKER_RE } from "../parser";
import { parseView } from "../text";

/**
 * Splits an Outlook message body into the CURRENT message and the QUOTED / FORWARDED history below it.
 * The previous messages belong to other mail items; they are never counted as new emails.
 *
 * Boundaries recognised (earliest wins):
 *  - a header block "From: / Sent: / To: / Cc: / Subject:" (English, Arabic, French, German, Spanish labels), together with
 *    the separator line above it (________, ------, -----Original Message-----, Begin forwarded message)
 *  - "On <date>, <person> wrote:" and the French / German / Spanish / Arabic equivalents (also when wrapped onto two lines)
 *  - a run of ">" quoted lines
 */
export type QuotedMarker = "header-block" | "wrote" | "original-message" | "angle-quote" | null;
export interface QuotedSplit { current: string; quoted: string; marker: QuotedMarker; index: number }

const WROTE_RE = /^\s*(?:on\s.{4,200}\bwrote\s*:?|le\s.{4,200}\ba écrit\s*:?|am\s.{4,200}\bschrieb\b.*|el\s.{4,200}\bescribió\s*:?|في\s.{4,200}(?:كتب|كتبت)\s*:?)\s*$/i;
const SEPARATOR_RE = /^\s*[_=\-*]{5,}\s*$/;

export function splitQuoted(input: string): QuotedSplit {
  const text = input.replace(/\r\n?/g, "\n");
  const raw = text.split("\n");
  const view = raw.map(parseView);
  let best: { index: number; marker: QuotedMarker } | null = null;
  const consider = (index: number, marker: QuotedMarker) => { if (!best || index < best.index) best = { index, marker }; };

  // 1. header block (+ the separator lines directly above it)
  const block = locateBlocks(raw, view)[0];
  if (block) {
    let i = block.start;
    while (i > 0 && (!view[i - 1].trim() || SEPARATOR_RE.test(view[i - 1]) || QUOTE_MARKER_RE.test(view[i - 1]))) i--;
    consider(i, "header-block");
  }
  // 2. "On … wrote:" (possibly wrapped over two lines) and explicit markers
  for (let i = 0; i < raw.length; i++) {
    const v = view[i];
    if (!v.trim()) continue;
    if (WROTE_RE.test(v) || (i + 1 < raw.length && v.length < 200 && WROTE_RE.test(`${v} ${view[i + 1].trim()}`))) { consider(i, "wrote"); break; }
    if (/^\s*-{2,}\s*(original message|forwarded message|الرسالة الأصلية|رسالة معاد توجيهها)|^\s*begin forwarded message/i.test(v)) { consider(i, "original-message"); break; }
  }
  // 3. a run of ">" lines
  for (let i = 0; i + 1 < raw.length; i++) {
    if (/^\s*>/.test(raw[i]) && /^\s*>/.test(raw[i + 1])) { consider(i, "angle-quote"); break; }
  }

  if (!best) return { current: text.trimEnd(), quoted: "", marker: null, index: -1 };
  const { index, marker } = best as { index: number; marker: QuotedMarker };
  return { current: raw.slice(0, index).join("\n").trimEnd(), quoted: raw.slice(index).join("\n").trim(), marker, index };
}
