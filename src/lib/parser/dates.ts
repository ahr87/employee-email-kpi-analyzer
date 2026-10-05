const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
// Iraqi / Levantine Arabic month names
const AR_MONTHS: Array<[string, number]> = [
  ["كانون الثاني", 1], ["كانون ثاني", 1], ["يناير", 1], ["شباط", 2], ["فبراير", 2],
  ["آذار", 3], ["اذار", 3], ["مارس", 3], ["نيسان", 4], ["أبريل", 4], ["ابريل", 4],
  ["أيار", 5], ["ايار", 5], ["مايو", 5], ["حزيران", 6], ["يونيو", 6], ["تموز", 7], ["يوليو", 7],
  ["آب", 8], ["اغسطس", 8], ["أغسطس", 8], ["أيلول", 9], ["ايلول", 9], ["سبتمبر", 9],
  ["تشرين الأول", 10], ["تشرين الاول", 10], ["أكتوبر", 10], ["اكتوبر", 10],
  ["تشرين الثاني", 11], ["نوفمبر", 11], ["كانون الأول", 12], ["كانون الاول", 12], ["ديسمبر", 12],
];

export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function valid(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

function extractTime(s: string): { h: number; mi: number; s: number; rest: string } {
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?|ص|م)?/);
  if (!m) return { h: 0, mi: 0, s: 0, rest: s };
  let h = parseInt(m[1], 10);
  const mer = (m[4] ?? "").toLowerCase().replace(/\./g, "");
  if (mer === "pm" || mer === "م") { if (h < 12) h += 12; }
  else if ((mer === "am" || mer === "ص") && h === 12) h = 0;
  return { h, mi: parseInt(m[2], 10), s: m[3] ? parseInt(m[3], 10) : 0, rest: s.replace(m[0], " ") };
}

/** Parse the many date shapes Outlook produces. Returns null when uncertain. */
export function parseDate(input: string, order: "DMY" | "MDY" = "DMY"): Date | null {
  if (!input) return null;
  let s = normalizeDigits(input).replace(/‎|‏/g, "").trim();
  if (!s) return null;
  const t = extractTime(s);
  s = t.rest;

  // ISO: 2026-09-01
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3], t.h, t.mi, t.s);

  // numeric: 01/09/2026
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    let a = +m[1], b = +m[2];
    let day = order === "DMY" ? a : b;
    let mon = order === "DMY" ? b : a;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    return valid(+m[3], mon, day, t.h, t.mi, t.s);
  }

  const lower = s.toLowerCase();
  let month = 0;
  let monthToken = "";
  for (const [name, num] of AR_MONTHS.sort((x, y) => y[0].length - x[0].length)) {
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
    if (year && day) return valid(+year[1], month, +day[1], t.h, t.mi, t.s);
  }
  return null;
}
