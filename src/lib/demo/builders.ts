/**
 * Builders that produce text shaped like what Outlook puts on the clipboard (synthetic content only).
 * Several styles are supported because Outlook's paste differs by view, language and client.
 */
export type Style = "inline" | "mailto" | "nextline" | "spaced";

export interface Msg {
  from: string; // "Display Name"
  email: string;
  at: Date; // wall-clock (UTC fields are used)
  to?: string; // "Name <addr>" strings joined with ;
  cc?: string;
  subject: string;
  body: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function outlookDate(d: Date): string {
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export const numericDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

export function msg(m: Msg, style: Style = "inline"): string {
  const to = m.to ?? "NMC <nmc@acme.test>";
  const fromV = style === "mailto" ? `${m.from} [mailto:${m.email}]` : style === "nextline" ? `${m.from} [${m.email}]` : `${m.from} <${m.email}>`;
  const date = style === "nextline" || style === "inline" ? outlookDate(m.at) : numericDate(m.at);
  if (style === "nextline") {
    return [`From:`, fromV, `Sent:`, date, `To:`, to, ...(m.cc ? [`Cc:`, m.cc] : []), `Subject:`, m.subject, ``, m.body, ``].join("\n");
  }
  if (style === "spaced") {
    return [`From: ${fromV}`, ``, `Sent: ${date}`, ``, `To: ${to}`, ...(m.cc ? [``, `Cc: ${m.cc}`] : []), ``, `Subject: ${m.subject}`, ``, m.body, ``].join("\n");
  }
  return [`From: ${fromV}`, `Sent: ${date}`, `To: ${to}`, ...(m.cc ? [`Cc: ${m.cc}`] : []), `Subject: ${m.subject}`, ``, m.body, ``].join("\n");
}

/** A reply chain as Outlook copies it: newest message first, older ones below a separator line. */
export function chain(msgs: Msg[], style: Style = "inline", separator = "________________________________"): string {
  return msgs.map((m, i) => (i === 0 ? "" : `${separator}\n`) + msg(m, style)).join("\n");
}

export const T = (day: number, h: number, mi: number, month = 9) => new Date(Date.UTC(2026, month - 1, day, h, mi));
export const NMC = (at: Date, subject: string, body: string, extra: Partial<Msg> = {}): Msg => ({
  from: "NMC Desk", email: "nmc@acme.test", at, subject, body, to: "Employee <e@x>", ...extra,
});
