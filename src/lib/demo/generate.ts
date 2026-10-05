/**
 * Deterministic generator of a SYNTHETIC month of NMC email traffic (fictional people, places and tickets).
 * Used by the demo loader and by the simulation test. It produces text that looks like Outlook copy/paste in
 * several styles, plus the ground truth so results can be verified.
 */
import { chain, msg, NMC, type Msg, type Style } from "./builders";

export interface DemoEmployee { employeeId: string; name: string; email: string; department: string; team: string }
export interface Truth { subject: string; employee: string; cls: "FORWARDED" | "NOT_USEFUL" | "DUPLICATE" | "PENDING_REVIEW"; unmatched?: boolean; counted: boolean; outside?: boolean; noDate?: boolean; original?: string }
export interface DemoMonth {
  year: number; month: number;
  employees: DemoEmployee[];
  nmcAddresses: string[];
  batches: string[]; // pasted texts, in order
  repastes: string[]; // texts that re-paste already imported content (must add nothing)
  truth: Truth[];
}

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const EMPLOYEES: DemoEmployee[] = [
  ["Ahmed Ali", "Customer Care", "Baghdad"], ["Sara Hassan", "Customer Care", "Baghdad"], ["Omar Khalid", "Field Services", "South"],
  ["Lina Haddad", "Field Services", "North"], ["Yousef Nasser", "Sales Support", "North"], ["Maya Fadel", "Sales Support", "Baghdad"],
  ["Karim Saleh", "Enterprise", "Baghdad"], ["Noor Jaber", "Enterprise", "South"], ["Hadi Mansour", "Customer Care", "Furat"],
  ["Rana Aziz", "Field Services", "Furat"], ["علي حسين", "Customer Care", "Baghdad"], ["زينب كريم", "Enterprise", "North"],
].map(([name, department, team], i) => ({
  employeeId: `E${String(i + 1).padStart(3, "0")}`, name, department, team,
  email: i < 10 ? `${name.toLowerCase().replace(/\s+/g, ".")}@acme.test` : i === 10 ? "ali.hussein@acme.test" : "zainab.kareem@acme.test",
}));

const DISTRICTS: [string, string][] = [
  ["Mansour", "المنصور"], ["Karrada", "الكرادة"], ["Zayouna", "زيونة"], ["Adhamiyah", "الأعظمية"], ["Kadhimiya", "الكاظمية"], ["Dora", "الدورة"],
  ["Yarmouk", "اليرموك"], ["Jadriya", "الجادرية"], ["Bayaa", "البياع"], ["Amiriyah", "العامرية"], ["Ghazaliya", "الغزالية"], ["Hurriya", "الحرية"],
  ["Shaab", "الشعب"], ["Baladiyat", "البلديات"], ["Harthiya", "الحارثية"], ["Washash", "الوشاش"], ["Saydiya", "السيدية"], ["Jihad", "الجهاد"],
  ["Qadisiya", "القادسية"], ["Salhiya", "الصالحية"],
  ["Basra", ""], ["Najaf", ""], ["Erbil", ""], ["Mosul", ""], ["Kirkuk", ""], ["Hilla", ""], ["Karbala", ""], ["Nasiriyah", ""], ["Amarah", ""], ["Kut", ""],
  ["Ramadi", ""], ["Fallujah", ""], ["Samawah", ""], ["Diwaniyah", ""], ["Baqubah", ""], ["Tikrit", ""], ["Duhok", ""], ["Zakho", ""], ["Sulaymaniyah", ""], ["Halabja", ""],
];
const DEPTS: [string, string, string][] = [
  ["Field Operations", "field.ops", "العمليات الميدانية"], ["NOC Operations", "noc.ops", "عمليات الشبكة"], ["IP Core Team", "ip.core", "الشبكة الأساسية"],
  ["Access Network Team", "access.team", "شبكة الوصول"], ["Transmission Team", "transmission", "النقل"], ["Maintenance Team", "maintenance", "الصيانة"],
];
const TOPICS = [
  (l: string) => `BB outage at ${l}`, (l: string) => `${l} FTTH customers offline`, (l: string) => `Slow internet at ${l} branch`,
  (l: string) => `MPLS link unstable at ${l}`, (l: string) => `Router unreachable at ${l} site`, (l: string) => `Fiber cut near ${l}`, (l: string) => `Packet loss at ${l} exchange`,
];
const ALT_TOPICS = [
  (l: string) => `${l} BB connection is down`, (l: string) => `Customers in ${l} have no internet`, (l: string) => `Cannot reach ${l} customers - service down`,
  (l: string) => `${l} link not working`,
];
const NU_EN = ["Hello {n}, no action required from NMC. This is a known issue.", "Already informed to the concerned team, no further action.", "For information only - nothing to be done.", "No issue found on our side, please avoid duplicate emails."];
const NU_AR = ["لا يتطلب اجراء، المشكلة معروفة مسبقا.", "للعلم فقط، لا داعي لأي اجراء."];
const FW_EN = ["Please investigate {l}.", "Escalated to {d} team. Kindly check and action.", "Forwarded to {d} for your action, ticket {t} created."];
const SIGS = ["Best regards,\n{n}\n{dep} | ACME", "Thanks,\n{n}", "Regards\n{n}\nACME Telecom - {dep}\nThis message may contain confidential information."];
const STYLES: Style[] = ["inline", "mailto", "nextline", "spaced"];

export function buildDemoMonth(year = 2026, month = 9, seed = 20260915): DemoMonth {
  const rnd = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const day = (d: number, h: number, mi: number, m = month) => new Date(Date.UTC(year, m - 1, d, h, mi));
  const arPool = DISTRICTS.filter((d) => d[1]).map((d, i) => ({ en: d[0], ar: d[1], i }));
  const enPool = DISTRICTS.filter((d) => !d[1]).map((d, i) => ({ en: d[0], ar: "", i: 100 + i }));
  let siteNo = 100;
  const nextPlace = (needAr = false) => {
    if (needAr) return arPool.shift()!;
    if (enPool.length) return enPool.shift()!;
    siteNo++;
    return { en: `Site K${siteNo}`, ar: "", i: -siteNo };
  };
  let inc = 700100;
  let svc = 90100;
  let nth = 0;

  const truth: Truth[] = [];
  type Piece = { at: Date; text: string; group?: string };
  const pieces: Piece[] = [];
  const style = () => pick(STYLES);
  const emps = EMPLOYEES;
  const empAt = (i: number) => emps[i % emps.length];
  const sig = (e: DemoEmployee) => pick(SIGS).replace("{n}", e.name).replace("{dep}", e.department);
  const mk = (e: DemoEmployee | { name: string; email: string }, at: Date, subject: string, body: string, extra: Partial<Msg> = {}): Msg =>
    ({ from: e.name, email: e.email, at, subject, body, ...extra });
  const empBody = (e: DemoEmployee, l: string, extra = "") =>
    `Dear NMC,\n\nCustomers at ${l} are reporting a problem with their connection since this morning. ${extra}\nPlease check.\n\n${sig(e)}`;
  const emit = (msgs: Msg[], asChain: boolean) => {
    const s = style();
    const text = asChain ? chain(msgs, s) : [...msgs].reverse().map((m) => msg(m, s)).join("\n");
    pieces.push({ at: msgs[msgs.length - 1].at, text });
  };
  const dateFor = (n: number) => day(1 + ((n * 7 + int(0, 3)) % 28), int(8, 16), int(0, 59));

  // A. forwarded (30; 5 Arabic)
  for (let n = 0; n < 30; n++) {
    const ar = n % 6 === 5;
    const e = empAt(ar ? 10 + (n % 2) : n);
    const pl = nextPlace(ar); const d = pick(DEPTS); const t = dateFor(nth++);
    const subject = ar ? `انقطاع الخدمة في ${pl.ar}` : pick(TOPICS)(pl.en);
    const body = ar ? `السلام عليكم،\nالخدمة منقطعة في منطقة ${pl.ar} منذ الصباح. يرجى الفحص.\n${e.name}` : empBody(e, pl.en);
    const ack = NMC(new Date(t.getTime() + int(3, 15) * 60000), `RE: ${subject}`, ar ? "تم الاستلام، جاري الفحص." : "Received and checking.", { to: `${e.name} <${e.email}>` });
    const fw = NMC(new Date(t.getTime() + int(20, 90) * 60000), `${ar ? "إعادة توجيه" : "FW"}: ${subject}`,
      ar ? `تم تحويل البلاغ إلى فريق ${d[2]}. يرجى الفحص.` : pick(FW_EN).replace("{l}", pl.en).replace("{d}", d[0]).replace("{t}", `INC${inc++}`),
      { to: `${d[0]} <${d[1]}@acme.test>`, cc: "Shift Lead <shift.lead@acme.test>" });
    const withAck = rnd() < 0.7;
    emit([fw, ...(withAck ? [ack] : []), mk(e, t, subject, body, { to: "NMC <nmc@acme.test>" })], rnd() < 0.6);
    truth.push({ subject, employee: e.name, cls: "FORWARDED", counted: true });
  }

  // B. not useful (20; 4 Arabic)
  for (let n = 0; n < 20; n++) {
    const ar = n % 5 === 4;
    const e = empAt(ar ? 10 + (n % 2) : n + 3);
    const pl = nextPlace(ar); const t = dateFor(nth++);
    const subject = ar ? `سؤال عن الخدمة في ${pl.ar}` : `Question about service at ${pl.en}`;
    const body = ar ? `مرحبا،\nهل هناك مشكلة في ${pl.ar}؟\n${e.name}` : `Hello,\nIs there a known problem at ${pl.en}? A customer asked.\n\n${sig(e)}`;
    const reply = NMC(new Date(t.getTime() + int(10, 60) * 60000), `${ar ? "رد" : "RE"}: ${subject}`,
      (ar ? pick(NU_AR) : pick(NU_EN)).replace("{n}", e.name.split(" ")[0]), { to: `${e.name} <${e.email}>` });
    emit([reply, mk(e, t, subject, body)], rnd() < 0.5);
    truth.push({ subject, employee: e.name, cls: "NOT_USEFUL", counted: true });
  }

  // C. duplicate clusters (15 clusters; 3 with a third reporter)
  for (let k = 0; k < 15; k++) {
    const pl = nextPlace(false); const t = dateFor(nth++); const d = pick(DEPTS);
    const e1 = empAt(k), e2 = empAt(k + 4), e3 = empAt(k + 7);
    const ids = k % 3 === 0 ? `Circuit CKT-${10000 + k}.` : k % 3 === 1 ? `Service ID SVC-${svc++}.` : "";
    // no identifier → both reports describe the same kind of problem (outage family), as real duplicates do
    const outageTopics = [TOPICS[0], TOPICS[1], TOPICS[5]];
    const s1 = (ids ? TOPICS[k % TOPICS.length] : outageTopics[k % 3])(pl.en);
    const s2 = ALT_TOPICS[k % ALT_TOPICS.length](pl.en);
    const s3 = ALT_TOPICS[(k + 1) % ALT_TOPICS.length](pl.en);
    const fw = NMC(new Date(t.getTime() + int(20, 50) * 60000), `FW: ${s1}`, `Escalated to ${d[0]}. Please investigate ${pl.en}.`, { to: `${d[0]} <${d[1]}@acme.test>` });
    const t2 = new Date(t.getTime() + int(5, 40) * 60000);
    emit([fw, mk(e1, t, s1, empBody(e1, pl.en, ids), {})], rnd() < 0.5);
    emit([mk(e2, t2, s2, empBody(e2, pl.en, ids))], false);
    truth.push({ subject: s1, employee: e1.name, cls: "FORWARDED", counted: true });
    truth.push({ subject: s2, employee: e2.name, cls: "DUPLICATE", counted: true, original: s1 });
    if (k % 5 === 0) {
      const t3 = new Date(t.getTime() + int(45, 100) * 60000);
      emit([mk(e3, t3, s3, empBody(e3, pl.en, ids))], false);
      truth.push({ subject: s3, employee: e3.name, cls: "DUPLICATE", counted: true, original: s1 });
    }
  }

  // D. pending: only the employee's email (12; 3 mixed Arabic/English)
  for (let n = 0; n < 12; n++) {
    const e = empAt(n + 5); const pl = nextPlace(false); const t = dateFor(nth++);
    const mixed = n % 4 === 3;
    const subject = mixed ? `MPLS مشكلة في ${pl.en}` : `Please advise: ${pick(["router reboot", "port flapping", "slow speed test", "customer complaint"])} at ${pl.en}`;
    const body = mixed ? `الـ link غير مستقر - unstable at ${pl.en}, device SW-${pl.en.slice(0, 3).toUpperCase()}-0${n + 1}\n${e.name}` : `Hello team,\nCould you advise on this? I think this may need to be forwarded to the field team.\n\n${sig(e)}`;
    emit([mk(e, t, subject, body)], false);
    truth.push({ subject, employee: e.name, cls: "PENDING_REVIEW", counted: true });
  }

  // E. unmatched senders (5): no employee record, no evidence
  for (let n = 0; n < 5; n++) {
    const pl = nextPlace(false); const t = dateFor(nth++);
    const subject = `Fiber damage reported near ${pl.en}`;
    emit([mk({ name: `Contractor ${n + 1}`, email: `contractor${n + 1}@partner.test` }, t, subject, `Fiber damaged near ${pl.en} by roadworks.`)], false);
    truth.push({ subject, employee: "", cls: "PENDING_REVIEW", counted: true, unmatched: true });
  }

  // F. out-of-month (3, August) and missing date (2)
  for (let n = 0; n < 3; n++) {
    const e = empAt(n + 2); const pl = nextPlace(false);
    const subject = `Cable fault at ${pl.en}`;
    emit([mk(e, day(25 + n, 11, 0, month - 1), subject, `Cable fault at ${pl.en}.`)], false);
    truth.push({ subject, employee: e.name, cls: "PENDING_REVIEW", counted: false, outside: true });
  }
  for (let n = 0; n < 2; n++) {
    const e = empAt(n + 6); const pl = nextPlace(false);
    const subject = `Undated report about ${pl.en}`;
    pieces.push({ at: day(15, 12, n), text: `From: ${e.name} <${e.email}>\nSubject: ${subject}\n\nNo timestamp survived the copy for ${pl.en}.\n` });
    truth.push({ subject, employee: e.name, cls: "PENDING_REVIEW", counted: true, noDate: true });
  }

  // G. employee follow-ups (6): reply to an NMC answer — evidence only, not counted
  const nu = truth.filter((x) => x.cls === "NOT_USEFUL").slice(0, 6);
  nu.forEach((x, i) => {
    const e = EMPLOYEES.find((m) => m.name === x.employee)!;
    pieces.push({ at: day(28, 9 + i, 0), text: msg(mk(e, day(28, 9 + i, 0), `RE: ${x.subject}`, "Thanks for the update."), "inline") });
  });

  pieces.sort((a, b) => a.at.getTime() - b.at.getTime());
  const cut1 = Math.floor(pieces.length * 0.35), cut2 = Math.floor(pieces.length * 0.72);
  const batches = [pieces.slice(0, cut1), pieces.slice(cut1, cut2), pieces.slice(cut2)].map((p) => p.map((x) => x.text).join("\n\n"));
  const repastes = [batches[0], batches[1].slice(0, Math.floor(batches[1].length / 2)), pieces.slice(cut2, cut2 + 6).map((x) => x.text).join("\n")];
  return { year, month, employees: EMPLOYEES, nmcAddresses: ["nmc@acme.test", "@monitoring.acme.test"], batches, repastes, truth };
}
