/**
 * Text normalisation for ANALYSIS copies only. Stored bodies and raw sources are never changed.
 * Handles English, Arabic and mixed text.
 */
const BIDI = /[​-‏‪-‮⁦-⁩﻿]/g;
const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;

export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Same-length cleanup used while parsing headers (keeps line/char positions aligned with the raw text). */
export function parseView(s: string): string {
  return normalizeDigits(s.replace(BIDI, " ").replace(/ /g, " "));
}

/** Aggressive normalisation for phrase matching / similarity: lower-case, Arabic letter folding, no diacritics. */
export function normalizeForAnalysis(s: string): string {
  return normalizeDigits(s.replace(BIDI, ""))
    .replace(TASHKEEL, "")
    .replace(/ـ/g, "") // tatweel
    .replace(/[أإآٱ]/g, "ا") // alef variants -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/[،؛]/g, ",")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
