import { describe, expect, it } from "vitest";
import { parseEmails, parseDate } from "@/lib/parser";

const one = `From: Alice Morgan <alice.morgan@acme.test>
Sent: Tuesday, September 1, 2026 10:05 AM
To: NMC Desk <nmc@acme.test>; Ops <ops@acme.test>
Cc: Lead <lead@acme.test>
Subject: BB outage at Mansour

Line one of body.
Line two.`;

describe("parser", () => {
  it("extracts sender, subject, date, recipients and body", () => {
    const { emails } = parseEmails(one);
    expect(emails).toHaveLength(1);
    const e = emails[0];
    expect(e.senderName).toBe("Alice Morgan");
    expect(e.senderEmail).toBe("alice.morgan@acme.test");
    expect(e.subject).toBe("BB outage at Mansour");
    expect(e.sentAt?.toISOString()).toBe("2026-09-01T10:05:00.000Z");
    expect(e.to).toHaveLength(2);
    expect(e.cc).toEqual(["Lead <lead@acme.test>"]);
    expect(e.body).toBe("Line one of body.\nLine two.");
    expect(e.rawSource).toContain("From: Alice Morgan");
    expect(e.uncertainFields).toEqual([]);
  });

  it("splits multiple pasted emails", () => {
    const text = `${one}\n\nFrom: Bilal <bilal@acme.test>\nSent: 2026-09-02 08:00\nSubject: Second\n\nHi`;
    const { emails } = parseEmails(text);
    expect(emails.map((e) => e.subject)).toEqual(["BB outage at Mansour", "Second"]);
    expect(emails[1].sentAt?.toISOString()).toBe("2026-09-02T08:00:00.000Z");
  });

  it("keeps quoted/forwarded headers inside the body of the same email", () => {
    const text = `From: A <a@x.test>\nSent: 2026-09-02 08:00\nSubject: FW: Thing\n\nSee below\n\n-----Original Message-----\nFrom: B <b@x.test>\nSent: 2026-09-01 08:00\nSubject: Thing\n\nOriginal text`;
    const { emails } = parseEmails(text);
    expect(emails).toHaveLength(1);
    expect(emails[0].isForward).toBe(true);
    expect(emails[0].body).toContain("Original text");
  });

  it("marks missing fields as uncertain instead of inventing them", () => {
    const { emails } = parseEmails("From: Someone\nSubject: Hi\n\nBody");
    expect(emails[0].senderEmail).toBe("");
    expect(emails[0].sentAt).toBeNull();
    expect(emails[0].uncertainFields).toEqual(expect.arrayContaining(["senderEmail", "sentAt"]));
  });

  it("handles empty paste and text without headers", () => {
    expect(parseEmails("   ").emails).toHaveLength(0);
    const r = parseEmails("just some random text");
    expect(r.emails).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/No email headers/);
  });

  it("strips scripts from pasted HTML", () => {
    const html = `<div>From: A &lt;a@x.test&gt;<br>Sent: 2026-09-02 08:00<br>Subject: Hi<br><br><script>alert(1)</script><b>Body</b></div>`;
    const { emails } = parseEmails(html);
    expect(emails[0].body).toBe("Body");
    expect(emails[0].senderEmail).toBe("a@x.test");
  });

  it("parses dd/mm vs mm/dd and Arabic months", () => {
    expect(parseDate("03/04/2026 10:00", "DMY")?.toISOString()).toBe("2026-04-03T10:00:00.000Z");
    expect(parseDate("03/04/2026 10:00", "MDY")?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    expect(parseDate("25/04/2026", "MDY")?.toISOString()).toBe("2026-04-25T00:00:00.000Z");
    expect(parseDate("1 أيلول 2026 3:15 م")?.toISOString()).toBe("2026-09-01T15:15:00.000Z");
    expect(parseDate("not a date")).toBeNull();
  });

  it("parses Arabic header labels", () => {
    const { emails } = parseEmails("من: علي <ali@x.test>\nتم الإرسال: 01/09/2026 10:00\nإلى: nmc@x.test\nالموضوع: انقطاع\n\nنص");
    expect(emails[0].senderEmail).toBe("ali@x.test");
    expect(emails[0].subject).toBe("انقطاع");
    expect(emails[0].sentAt?.getUTCMonth()).toBe(8);
  });
});
