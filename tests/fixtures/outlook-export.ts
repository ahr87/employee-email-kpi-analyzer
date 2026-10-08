/**
 * ANONYMIZED synthetic fixtures modelled on the structure of the Outlook VBA exporter's JSON
 * (root { exportedAt, source, emails:[{entryId, conversationId, subject, from, fromEmail, to, cc, receivedAt, body, htmlBody}] }).
 * Every name, address, host, ticket, IP and circuit below is invented. No real data.
 */
export interface FxMsg {
  entryId: string;
  conversationId: string | null;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  receivedAt: string;
  body: string;
  htmlBody: string;
}

export const ADDR = {
  ahmed: { name: "Ahmed Ali", email: "ahmed.ali@company.test" },
  sara: { name: "Sara Hassan", email: "sara.hassan@company.test" },
  omar: { name: "Omar Khalid", email: "omar.khalid@company.test" },
  nmc: { name: "NMC Operations", email: "nmc@acme.test" },
  zabbix: { name: "Zabbix Alerts", email: "zabbix@monitoring.acme.test" },
  vendor: { name: "Vendor Support", email: "support@vendor.test" },
};

const SIG = "\r\n\r\nBest regards,\r\nAhmed Ali\r\nSenior Network Engineer\r\nCompany Test Ltd.\r\nMobile: +000 000 0000\r\nahmed.ali@company.test\r\n\r\nThis e-mail and any attachments are confidential and intended solely for the addressee.";

const base = (n: number, o: Partial<FxMsg>): FxMsg => ({
  entryId: `00000000AAAA${String(n).padStart(6, "0")}`,
  conversationId: `CONV-${String(n).padStart(4, "0")}`,
  subject: `Subject ${n}`,
  from: ADDR.ahmed.name, fromEmail: ADDR.ahmed.email,
  to: `${ADDR.nmc.name} <${ADDR.nmc.email}>`, cc: "",
  receivedAt: "2026-09-14 10:32:00",
  body: `Body ${n}`, htmlBody: "",
  ...o,
});

export const mk = base;

/** A. technical identifiers (tickets, hosts, IPs, circuits) */
export const caseA = (): FxMsg => base(101, {
  subject: "Link down BT-DW-35033 - Ticket 17440983",
  conversationId: "CONV-A",
  body: "Hello NMC,\r\nTicket NO is 17440983. Host SHMO-M-SR1S-PE01 (10.20.30.40) lost its uplink on circuit CKT-48213.\r\nPlease check Mansour site.\r\nThanks" + SIG,
});

/** B. HTML table DeviceName / Problem / ZbxProStart / TicketNO, no useful plain body */
export const caseB = (): FxMsg => base(102, {
  subject: "Zabbix alert summary",
  conversationId: "CONV-B",
  from: ADDR.zabbix.name, fromEmail: ADDR.zabbix.email,
  to: `${ADDR.ahmed.name} <${ADDR.ahmed.email}>`,
  body: "",
  htmlBody: `<html><head><style>td{border:1px solid #000}</style><script>alert(1)</script></head><body><p>Dear team,</p>
<table><tr><th>DeviceName</th><th>Problem</th><th>ZbxProStart</th><th>TicketNO</th></tr>
<tr><td>SHMO-M-SR1S-PE01</td><td>Interface down</td><td>2026.09.14 10:01:11</td><td>17439573</td></tr>
<tr><td>BT-DW-35033</td><td>High latency</td><td>2026.09.14 10:05:42</td><td>17439024</td></tr></table>
<img src="cid:logo001"><a href="javascript:alert(2)">click</a><a href="https://portal.acme.test/t/17439573">portal</a></body></html>`,
});

/** C. long signature */
export const caseC = (): FxMsg => base(103, {
  subject: "BB users cannot browse",
  conversationId: "CONV-C",
  body: "Customers in Karrada report slow browsing since morning." + SIG + "\r\nPlease consider the environment before printing.\r\nLine 1\r\nLine 2",
});

/** D. previous emails below an Outlook separator */
export const caseD = (): FxMsg => base(104, {
  subject: "RE: Fiber cut Zafaraniya",
  conversationId: "CONV-D",
  receivedAt: "2026-09-14 12:10:00",
  body: "Team is on site now, ETA 1 hour.\r\n\r\n________________________________\r\nFrom: NMC Operations <nmc@acme.test>\r\nSent: Sunday, September 14, 2026 11:40 AM\r\nTo: Ahmed Ali <ahmed.ali@company.test>\r\nSubject: Fiber cut Zafaraniya\r\n\r\nPlease check the fiber cut in Zafaraniya, ticket 16663542.",
});

/** E. forwarded: embedded From/To in body must not override the top-level sender */
export const caseE = (): FxMsg => base(105, {
  subject: "FW: MPLS issue Site X",
  conversationId: "CONV-E",
  receivedAt: "2026-09-14 13:00:00",
  to: "Field Team <field.team@company.test>",
  body: "Please handle.\r\n\r\n-----Original Message-----\r\nFrom: Omar Khalid <omar.khalid@company.test>\r\nSent: 14 September 2026 12:00\r\nTo: Ahmed Ali <ahmed.ali@company.test>\r\nSubject: MPLS issue Site X\r\n\r\nSite X MPLS is unstable.",
});

/** F. similar subjects, different conversationId  /  G. same conversationId, different timestamps */
export const caseF = (): FxMsg[] => [
  base(106, { subject: "Power outage Site 7", conversationId: "CONV-F1", body: "Power is out at Site 7." }),
  base(107, { subject: "Power outage Site 7", conversationId: "CONV-F2", receivedAt: "2026-09-14 10:40:00", from: ADDR.sara.name, fromEmail: ADDR.sara.email, body: "Power is out at Site 7 again." }),
];
export const caseG = (): FxMsg[] => [
  base(108, { subject: "Router flapping", conversationId: "CONV-G", receivedAt: "2026-09-15 08:00:00", body: "Router flapping on Site 9." }),
  base(109, { subject: "RE: Router flapping", conversationId: "CONV-G", receivedAt: "2026-09-15 09:30:00", from: ADDR.nmc.name, fromEmail: ADDR.nmc.email, to: `${ADDR.ahmed.name} <${ADDR.ahmed.email}>`, body: "Received and checking." }),
  base(110, { subject: "RE: Router flapping", conversationId: "CONV-G", receivedAt: "2026-09-15 11:30:00", body: "Fixed after card replacement." }),
];

export const wrap = (emails: unknown[], extra: Record<string, unknown> = {}, opts: { crlf?: boolean; bom?: boolean; pretty?: boolean } = {}): string => {
  const root = { exportedAt: "2026-10-08 10:57:31", source: "Outlook Desktop", ...extra, emails };
  let s = JSON.stringify(root, null, opts.pretty === false ? 0 : 2);
  if (opts.crlf !== false) s = s.replace(/\n/g, "\r\n");
  return (opts.bom ? "﻿" : "") + s;
};

export const toBytes = (s: string) => new TextEncoder().encode(s);

/** n synthetic messages from the 3 employees (with html tables and quoted history to make them realistic in size). */
export function generate(n: number, o: { start?: number; day?: number; employees?: boolean } = {}): FxMsg[] {
  const who = [ADDR.ahmed, ADDR.sara, ADDR.omar];
  const out: FxMsg[] = [];
  for (let i = 0; i < n; i++) {
    const k = (o.start ?? 1000) + i;
    const w = who[i % 3];
    const day = (o.day ?? 1) + (i % 25);
    const hh = 8 + (i % 9), mm = (i * 7) % 60;
    out.push(base(k, {
      entryId: `00000000BBBB${String(k).padStart(8, "0")}`,
      conversationId: `CONV-G${String(k)}`,
      subject: `Issue ${k} at Site ${k % 97} circuit CKT-${40000 + (k % 5000)}`,
      from: w.name, fromEmail: w.email,
      receivedAt: `2026-09-${String(day).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`,
      body: `Hello NMC, link at Site ${k % 97} is down on circuit CKT-${40000 + (k % 5000)} since morning (ref ${k}). Please check.` + SIG + `\r\n\r\n________________________________\r\nFrom: NMC <nmc@acme.test>\r\nSent: Monday\r\nTo: ${w.name}\r\nSubject: older\r\n\r\nolder history ${k}`,
    }));
  }
  return out;
}
