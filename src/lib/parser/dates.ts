import { normalizeDigits } from "../text";

export { normalizeDigits };

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
// Iraqi / Levantine / Gulf Arabic month names (longest first so "تشرين الأول" wins over "تشرين")
const AR_MONTHS: Array<[string, number]> = ([
  ["كانون الثاني", 1], ["كانون ثاني", 1], ["يناير", 1], ["شباط", 2], ["فبراير", 2],
  ["آذار", 3], ["اذار", 3], ["مارس", 3], ["نيسان", 4], ["أبريل", 4], ["ابريل", 4],
  ["أيار", 5], ["ايار", 5], ["مايو", 5], ["حزيران", 6], ["يونيو", 6], ["تموز", 7], ["يوليو", 7],
  ["آب", 8], ["اغسطس", 8], ["أغسطس", 8], ["أيلول", 9], ["ايلول", 9], ["سبتمبر", 9],
  ["تشرين الأول", 10], ["تشرين الاول", 10], ["تشرين أول", 10], ["أكتوبر", 10], ["اكتوبر", 10],
  ["تشرين الثاني", 11], ["تشرين ثاني", 11], ["نوفمبر", 11], ["كانون الأول", 12], ["كانون الاول", 12], ["كانون أول", 12], ["ديسمبر", 12],
] as Array<[string, number]>).sort((x, y) => y[0].length - x[0].length);

export interface DateReading {
  date: Date | null;
  /** The other reading of an all-numeric date whose day/month could be swapped (only when it is a valid, different date). */
  alt: Date | null;
  /** The numeric date itself proves the order (e.g. 25/04 can only be day/month). */
  evidence?: "DMY" | "MDY" | null;
}

function valid(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

function extractTime(s: string): { h: number; mi: number; s: number; rest: string } {
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?|ص|م)?/);
  if (!m) return { h: 0, mi: 0, s: 0, rest: s };
  let h = parseInt(m[1], 10);
  const mer = (m[4] ?? "").toLowerCase().replace(/[.\s]/g, "");
  if (mer === "pm" || mer === "م") { if (h < 12) h += 12; }
  else if ((mer === "am" || mer === "ص") && h === 12) h = 0;
  return { h, mi: parseInt(m[2], 10), s: m[3] ? parseInt(m[3], 10) : 0, rest: s.replace(m[0], " ") };
}

/** Parse the many date shapes Outlook produces, reporting the alternate reading when day/month is ambiguous. */
export function parseDateDetailed(input: string, order: "DMY" | "MDY" = "DMY"): DateReading {
  const none = { date: null, alt: null };
  if (!input) return none;
  let s = normalizeDigits(input).replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/[،،]/g, ",").trim();
  if (!s) return none;
  const t = extractTime(s);
  s = t.rest;

  // ISO: 2026-09-14 (year first, never ambiguous)
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return { date: valid(+m[1], +m[2], +m[3], t.h, t.mi, t.s), alt: null };

  // numeric: 14/09/2026, 09/14/2026, 14.09.26
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) {
    const a = +m[1], b = +m[2];
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let day = order === "DMY" ? a : b;
    let mon = order === "DMY" ? b : a;
    let ambiguous = a <= 12 && b <= 12 && a !== b;
    let evidence: "DMY" | "MDY" | null = null;
    if (a > 12 && b <= 12) evidence = "DMY";
    else if (b > 12 && a <= 12) evidence = "MDY";
    if (mon > 12 && day <= 12) { [day, mon] = [mon, day]; ambiguous = false; } // only one valid reading
    const date = valid(year, mon, day, t.h, t.mi, t.s);
    const alt = ambiguous ? valid(year, day, mon, t.h, t.mi, t.s) : null;
    return { date, alt: alt && date && alt.getTime() !== date.getTime() ? alt : null, evidence };
  }

  const lower = s.toLowerCase();
  let month = 0;
  let monthToken = "";
  for (const [name, num] of AR_MONTHS) {
    if (s.includes(name)) { month = num; monthToken = name; break; }
  }
  if (!month) {
    const mm = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
    if (mm) { month = EN_MONTHS[mm[1]]; monthToken = mm[1]; }
  }
  if (month) {
    const without = lower.replace(monthToken.toLowerCase(), " ");
    const year = without.match(/\b(\d{4})\b/);
    const day = without.replace(/\b\d{4}\b/, " ").match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (year && day) return { date: valid(+year[1], month, +day[1], t.h, t.mi, t.s), alt: null };
  }
  return none;
}

export function parseDate(input: string, order: "DMY" | "MDY" = "DMY"): Date | null {
  return parseDateDetailed(input, order).date;
}
