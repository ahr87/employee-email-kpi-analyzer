import { describe, expect, it } from "vitest";
import { parseEmails, parseDate, parseDateDetailed, parseAddress } from "@/lib/parser";
import { chain, msg, NMC, T } from "./helpers";

const ahmed = { from: "Ahmed Ali", email: "ahmed@company.test" };

describe("parser — realistic Outlook text", () => {
  it("standard header block (From/Sent/To/Cc/Subject)", () => {
    const { emails } = parseEmails(msg({ ...ahmed, at: T(14, 10, 32), to: "NMC <nmc@company.test>; Ops <ops@company.test>", cc: "Supervisor <sup@company.test>", subject: "BB Link Down", body: "Line one.\nLine two." }));
    expect(emails).toHaveLength(1);
    const e = emails[0];
    expect(e.senderName).toBe("Ahmed Ali");
    expect(e.senderEmail).toBe("ahmed@company.test");
    expect(e.subject).toBe("BB Link Down");
    expect(e.sentAt?.toISOString()).toBe("2026-09-14T10:32:00.000Z");
    expect(e.to).toEqual(["NMC <nmc@company.test>", "Ops <ops@company.test>"]);
    expect(e.cc).toEqual(["Supervisor <sup@company.test>"]);
    expect(e.body).toBe("Line one.\nLine two.");
    expect(e.uncertainFields).toEqual([]);
  });

  it("labels with the value on the NEXT line and [mailto:] / markdown-style addresses", () => {
    const text = `From:
Ahmed Ali [mailto:ahmed@company.test]
Sent:
Monday, September 14, 2026 10:32 AM
To:
NMC [nmc@company.test](mailto:nmc@company.test)
Cc:
Supervisor [supervisor@company.test](mailto:supervisor@company.test)
Subject:
BB Link Down

Body line 1
Body line 2`;
    const { emails } = parseEmails(text);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ senderName: "Ahmed Ali", senderEmail: "ahmed@company.test", subject: "BB Link Down", to: ["NMC <nmc@company.test>"], cc: ["Supervisor <supervisor@company.test>"] });
    expect(emails[0].sentAt?.toISOString()).toBe("2026-09-14T10:32:00.000Z");
    expect(emails[0].body).toBe("Body line 1\nBody line 2");
  });

  it("missing fields: address only, numeric date, no To/Cc", () => {
    const { emails } = parseEmails("From:\nahmed@company.test\nSent:\n14/09/2026 10:32\nSubject:\nBB issue\n\nBody...");
    expect(emails[0]).toMatchObject({ senderEmail: "ahmed@company.test", subject: "BB issue", to: [], cc: [], body: "Body..." });
    expect(emails[0].sentAt?.toISOString()).toBe("2026-09-14T10:32:00.000Z");
  });

  it("tolerates blank lines between header lines (rich-text paste)", () => {
    const { emails } = parseEmails(msg({ ...ahmed, at: T(14, 10, 32), cc: "S <s@company.test>", subject: "BB Link Down", body: "Body" }, "spaced"));
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("BB Link Down");
    expect(emails[0].body).toBe("Body");
  });

  it("ignores Importance/Attachments lines inside the header block", () => {
    const text = "From: Ahmed Ali <ahmed@company.test>\nSent: 14/09/2026 10:32\nTo: NMC <nmc@company.test>\nImportance: High\nAttachments: photo.png\nSubject: BB issue\n\nBody";
    const { emails } = parseEmails(text);
    expect(emails[0].subject).toBe("BB issue");
    expect(emails[0].body).toBe("Body");
  });

  it("splits a reply/forward chain into original, NMC reply and forward (newest first, underscore separators)", () => {
    const text = chain([
      NMC(T(14, 11, 40), "FW: MPLS Issue - Site X", "Please investigate Site X.", { to: "Field Team <field.team@company.test>" }),
      NMC(T(14, 10, 50), "RE: MPLS Issue - Site X", "Received and checking.", { to: "Ahmed Ali <ahmed@company.test>" }),
      { ...ahmed, at: T(14, 10, 32), subject: "MPLS Issue - Site X", body: "Service is unstable at Site X." },
    ]);
    const { emails, warnings } = parseEmails(text);
    expect(emails.map((e) => e.subject)).toEqual(["FW: MPLS Issue - Site X", "RE: MPLS Issue - Site X", "MPLS Issue - Site X"]);
    expect(emails.map((e) => e.quoted)).toEqual([false, true, true]);
    expect(emails[0].isForward).toBe(true);
    expect(emails[1].isReply).toBe(true);
    expect(emails[2].body).toBe("Service is unstable at Site X.");
    expect(emails[0].body).toBe("Please investigate Site X."); // separator not left in the body
    expect(warnings.join(" ")).toMatch(/split out/);
  });

  it("chain with '-----Original Message-----' markers and quoted '>' lines", () => {
    const text = `From: NMC Desk <nmc@company.test>
Sent: 14/09/2026 11:00
To: Ahmed Ali <ahmed@company.test>
Subject: RE: Fault

No action required.

-----Original Message-----
From: Ahmed Ali <ahmed@company.test>
Sent: 14/09/2026 10:00
To: NMC <nmc@company.test>
Subject: Fault

Is this a problem?`;
    const { emails } = parseEmails(text);
    expect(emails).toHaveLength(2);
    expect(emails[0].body).toBe("No action required.");
    expect(emails[1].body).toBe("Is this a problem?");
  });

  it("several separate emails pasted one after another", () => {
    const text = [1, 2, 3].map((i) => msg({ ...ahmed, at: T(14, 9 + i, 0), subject: `Case ${i}`, body: `Body ${i}` })).join("\n");
    const { emails } = parseEmails(text);
    expect(emails.map((e) => e.subject)).toEqual(["Case 1", "Case 2", "Case 3"]);
  });

  it("address with a one-letter local part is not mistaken for an HTML tag", () => {
    const { emails } = parseEmails("From: A B <a@x.test>\nSent: 14/09/2026 10:00\nSubject: Hi\n\nBody");
    expect(emails[0].senderEmail).toBe("a@x.test");
  });

  it("HTML paste is reduced to safe text (no scripts, styles or event handlers survive)", () => {
    const html = `<div>From: Ahmed Ali &lt;ahmed@company.test&gt;<br>Sent: 14/09/2026 10:00<br>Subject: Hi<br><br><script>alert(1)</script><style>p{}</style><p onclick="x()">Hello <b>there</b></p></div>`;
    const { emails, warnings } = parseEmails(html);
    expect(emails[0].senderEmail).toBe("ahmed@company.test");
    expect(emails[0].body).toBe("Hello there");
    expect(emails[0].body).not.toMatch(/script|alert|onclick/i);
    expect(warnings.join(" ")).toMatch(/HTML/);
  });

  it("plain-text paste that merely mentions HTML tags is kept exactly (shown escaped later), not stripped", () => {
    const body = 'see <img src=x onerror="alert(1)"> and <script>alert(2)</script>';
    const { emails } = parseEmails(msg({ ...ahmed, at: T(14, 10, 32), subject: "Tags", body }));
    expect(emails[0].body).toBe(body);
    expect(emails[0].rawSource).toContain(body);
  });

  it("empty paste and text without headers", () => {
    expect(parseEmails("  \n ").emails).toHaveLength(0);
    const r = parseEmails("just some random text");
    expect(r.emails).toHaveLength(1);
    expect(r.emails[0].uncertainFields).toEqual(expect.arrayContaining(["sender", "sentAt"]));
    expect(r.warnings.join(" ")).toMatch(/No email headers/);
  });

  it("never invents missing fields", () => {
    const { emails } = parseEmails("From: Someone\nSubject: Hi\n\nBody");
    expect(emails[0].senderEmail).toBe("");
    expect(emails[0].sentAt).toBeNull();
    expect(emails[0].uncertainFields).toEqual(expect.arrayContaining(["senderEmail", "sentAt"]));
  });
});

describe("parser — Arabic and mixed language", () => {
  const ar = `‏ من: أحمد علي <ahmed@company.test>
‏ تم الإرسال: الاثنين، ١٤ أيلول، ٢٠٢٦ ١٠:٣٢ ص
‏ إلى: مركز المراقبة <nmc@company.test>
‏ نسخة: المشرف <sup@company.test>
‏ الموضوع: انقطاع الخدمة في المنصور

الخدمة منقطعة في منطقة المنصور منذ الصباح رقم الخدمة SVC-90017`;

  it("parses Arabic labels, bidi marks, Arabic month names and Arabic-Indic digits", () => {
    const { emails } = parseEmails(ar);
    expect(emails).toHaveLength(1);
    const e = emails[0];
    expect(e.senderName).toBe("أحمد علي");
    expect(e.senderEmail).toBe("ahmed@company.test");
    expect(e.subject).toBe("انقطاع الخدمة في المنصور");
    expect(e.sentAt?.toISOString()).toBe("2026-09-14T10:32:00.000Z");
    expect(e.to).toEqual(["مركز المراقبة <nmc@company.test>"]);
    expect(e.cc).toEqual(["المشرف <sup@company.test>"]);
  });

  it("does NOT corrupt the original text: body and raw source keep Arabic digits and bidi marks", () => {
    const text = ar.replace("SVC-90017", "رقم ٩٠٠١٧");
    const { emails } = parseEmails(text);
    expect(emails[0].body).toContain("رقم ٩٠٠١٧");
    expect(emails[0].rawSource).toContain("‏");
    expect(emails[0].rawSource).toContain("١٤ أيلول، ٢٠٢٦");
  });

  it("mixed Arabic/English subject, sender and body", () => {
    const text = msg({ from: "سارة Sara Hassan", email: "sara@company.test", at: T(15, 9, 5), subject: "MPLS مشكلة في Site X", body: "الـ link غير مستقر - unstable at Site X (SW-BGD-01)" });
    const { emails } = parseEmails(text);
    expect(emails[0].senderName).toBe("سارة Sara Hassan");
    expect(emails[0].subject).toBe("MPLS مشكلة في Site X");
    expect(emails[0].body).toBe("الـ link غير مستقر - unstable at Site X (SW-BGD-01)");
  });
});

describe("dates", () => {
  it("common formats", () => {
    const iso = (s: string) => parseDate(s, "DMY")?.toISOString().slice(0, 16);
    expect(iso("September 14, 2026 10:32 AM")).toBe("2026-09-14T10:32");
    expect(iso("14 September 2026 15:05")).toBe("2026-09-14T15:05");
    expect(iso("Mon 14-Sep-2026 3:05 PM")).toBe("2026-09-14T15:05");
    expect(iso("14/09/2026 10:32")).toBe("2026-09-14T10:32");
    expect(iso("09/14/2026 10:32")).toBe("2026-09-14T10:32"); // only one valid reading
    expect(iso("2026-09-14 10:32:11")).toBe("2026-09-14T10:32");
    expect(iso("14.09.26 10:32")).toBe("2026-09-14T10:32");
    expect(iso("12:05 AM, 1 Sep 2026")).toBe("2026-09-01T00:05");
    expect(iso("not a date")).toBeUndefined();
  });

  it("ambiguous numeric dates follow the configured order but expose the alternative", () => {
    const d = parseDateDetailed("03/04/2026 10:00", "DMY");
    expect(d.date?.toISOString()).toBe("2026-04-03T10:00:00.000Z");
    expect(d.alt?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    const m = parseDateDetailed("03/04/2026 10:00", "MDY");
    expect(m.date?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    expect(parseDateDetailed("13/04/2026", "MDY").alt).toBeNull(); // unambiguous
    expect(parseDateDetailed("05/05/2026").alt).toBeNull(); // same either way
  });

  it("address parsing", () => {
    expect(parseAddress("Ahmed Ali [ahmed@company.test](mailto:ahmed@company.test)")).toEqual({ name: "Ahmed Ali", email: "ahmed@company.test" });
    expect(parseAddress('"Ali, Ahmed" <AHMED@Company.test>')).toEqual({ name: "Ali, Ahmed", email: "ahmed@company.test" });
    expect(parseAddress("Ahmed Ali")).toEqual({ name: "Ahmed Ali", email: "" });
  });
});
