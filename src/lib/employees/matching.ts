export interface MatchableEmployee { id: string; name: string; email: string; active: boolean }

export interface MatchResult<T extends MatchableEmployee> {
  employee: T | null;
  by: "email" | "name" | null;
}

const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Employee matching. The sender e-mail address is the primary key. When Outlook only copied a
 * display name (no address), a UNIQUE exact name match is accepted as a fallback.
 */
export function matchEmployee<T extends MatchableEmployee>(
  sender: { email: string; name: string },
  employees: T[],
): MatchResult<T> {
  const email = sender.email.trim().toLowerCase();
  if (email) {
    const hit = employees.find((e) => e.email.toLowerCase() === email);
    return hit ? { employee: hit, by: "email" } : { employee: null, by: null };
  }
  const n = normName(sender.name);
  if (n) {
    const hits = employees.filter((e) => normName(e.name) === n);
    if (hits.length === 1) return { employee: hits[0], by: "name" };
  }
  return { employee: null, by: null };
}

/** True when the address belongs to NMC staff (exact address, "@domain" or bare domain entries). */
export function isNmcAddress(email: string, nmcAddresses: string[]): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  return nmcAddresses.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.includes("@") && !a.startsWith("@")) return a === e;
    const domain = a.replace(/^@/, "");
    return e.endsWith("@" + domain);
  });
}
