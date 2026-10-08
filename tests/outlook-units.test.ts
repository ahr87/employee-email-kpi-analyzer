import { describe, expect, it } from "vitest";
import { splitQuoted } from "@/lib/outlook/quoted";
import { splitSignature } from "@/lib/outlook/signature";
import { normalizeOutlookMessage } from "@/lib/outlook/normalize";
import { htmlToText } from "@/lib/parser/html";
import { streamExport, OutlookFileError, type StreamEvent } from "@/lib/outlook/stream";
import { validateMessage } from "@/lib/outlook/schema";
import { parseReceivedAt } from "@/lib/outlook/dates";
import { extractEntities } from "@/lib/classification/entities";
import { caseA, caseB, caseC, caseD, mk, toBytes, wrap } from "./fixtures/outlook-export";

async function collect(src: string | Uint8Array, chunkSize?: number) {
  const out: StreamEvent[] = [];
  for await (const ev of streamExport(src, { chunkSize })) out.push(ev);
  return out;
}

describe("quoted / previous-message detection", () => {
  it("splits at an Outlook separator + header block", () => {
    const r = splitQuoted(caseD().body);
    expect(r.current).toBe("Team is on site now, ETA 1 hour.");
    expect(r.quoted).toContain("16663542");
    expect(r.marker).toBe("header-block");
  });
  it("splits at 'On … wrote:' (english, wrapped) and multilingual headers", () => {
    expect(splitQuoted("Thanks.\n\nOn Mon, 14 Sep 2026 at 10:00, Sara\nHassan <s@x.test> wrote:\n> hi").current).toBe("Thanks.");
    expect(splitQuoted("Merci.\n\nDe : Sara <s@x.test>\nEnvoyé : lundi\nÀ : Ahmed\nObjet : test\n\nancien").current).toBe("Merci.");
    expect(splitQuoted("Danke.\n\nVon: Sara <s@x.test>\nGesendet: Montag\nAn: Ahmed\nBetreff: Test\n\nalt").current).toBe("Danke.");
  });
  it("leaves a message without history untouched", () => {
    const r = splitQuoted("Just a normal message.\nFrom the site: all fine.");
    expect(r.quoted).toBe("");
    expect(r.current).toContain("all fine");
  });
  it("-----Original Message----- is a separator", () => {
    expect(splitQuoted("See below.\n-----Original Message-----\nFrom: A\nSent: x\nTo: B\nSubject: s\n\nold").current).toBe("See below.");
  });
});

describe("signature detection (analysis copy only)", () => {
  it("removes a long signature + disclaimer", () => {
    const r = splitSignature(caseC().body);
    expect(r.body).toBe("Customers in Karrada report slow browsing since morning.");
    expect(r.signature).toContain("Senior Network Engineer");
  });
  it("keeps technical text that merely looks like a footer", () => {
    const r = splitSignature("Link down.\nTicket NO is 17440983\nHost SHMO-M-SR1S-PE01");
    expect(r.body).toContain("17440983");
    expect(r.body).toContain("SHMO-M-SR1S-PE01");
  });
});

describe("HTML normalization", () => {
  it("converts table to text, drops script/style/unsafe links, keeps safe link targets", () => {
    const t = htmlToText(caseB().htmlBody);
    expect(t).not.toMatch(/alert|border:1px|javascript:|cid:/i);
    expect(t).toContain("DeviceName");
    expect(t).toContain("17439573");
    expect(t).toContain("https://portal.acme.test/t/17439573");
  });
  it("uses HTML when the plain body is empty, plain when it is complete", () => {
    const n = normalizeOutlookMessage("", caseB().htmlBody);
    expect(n.text).toContain("BT-DW-35033");
    const p = normalizeOutlookMessage("Short plain body about Site 5.", "<p>Short plain body about Site 5.</p>");
    expect(p.text).toContain("Short plain body");
  });
  it("normalized copy drops history and signature but technical identifiers survive", () => {
    const n = normalizeOutlookMessage(caseD().body, "");
    expect(n.text).not.toContain("16663542");
    expect(normalizeOutlookMessage(caseA().body, "").text).toContain("SHMO-M-SR1S-PE01");
  });
  it("extracts technical identifiers (tickets, hosts) incl. from an HTML table", () => {
    const e = extractEntities(caseA().subject, caseA().body) as unknown;
    expect(JSON.stringify(e).toLowerCase()).toContain("17440983");
    expect(JSON.stringify(e).toLowerCase()).toContain("bt-dw-35033");
    const t = extractEntities("Zabbix alert summary", normalizeOutlookMessage("", caseB().htmlBody).text) as unknown;
    const s = JSON.stringify(t).toLowerCase();
    for (const id of ["17439573", "17439024", "shmo-m-sr1s-pe01"]) expect(s).toContain(id);
  });
});

describe("streaming reader", () => {
  const file = wrap([caseA(), caseB(), mk(1, { body: "Arabic: مرحبا، الرابط متوقف في الموقع" }), mk(2, { body: 'quote " and \\ backslash and { brace }' })], {}, { bom: true });
  it("yields identical messages for any chunk size (incl. 1 and 3 bytes), BOM + CRLF + UTF-8", async () => {
    const ref = (await collect(toBytes(file))).filter((e) => e.type === "email");
    expect(ref).toHaveLength(4);
    for (const size of [1, 3, 17, 1024]) {
      const got = (await collect(toBytes(file), size)).filter((e) => e.type === "email");
      expect(got.map((g) => (g as { text: string }).text)).toEqual(ref.map((g) => (g as { text: string }).text));
    }
    const arabic = JSON.stringify(ref.map((r) => parseSafe((r as { text: string }).text)));
    expect(arabic).toContain("مرحبا");
  });
  it("tolerates raw control characters and lone backslashes inside strings", async () => {
    const bad = `{"exportedAt":"x","source":"Outlook Desktop","emails":[{"entryId":"E1","receivedAt":"2026-09-01 10:00:00","subject":"S","body":"line1\nline2\tTab C:\\temp\\x"}]}`;
    const ev = (await collect(bad)).filter((e) => e.type === "email") as { text: string }[];
    expect(ev).toHaveLength(1);
  });
  it("reads UTF-16 files", async () => {
    const s = wrap([mk(1, {})]);
    const u16 = new Uint8Array(2 + s.length * 2);
    u16[0] = 0xff; u16[1] = 0xfe;
    for (let i = 0; i < s.length; i++) { u16[2 + i * 2] = s.charCodeAt(i) & 255; u16[3 + i * 2] = s.charCodeAt(i) >> 8; }
    expect((await collect(u16)).filter((e) => e.type === "email")).toHaveLength(1);
  });
  it("rejects clearly invalid files with a useful message", async () => {
    await expect(collect("hello")).rejects.toThrow(OutlookFileError);
    await expect(collect("[1,2]")).rejects.toThrow(/bare list/);
    await expect(collect("")).rejects.toThrow(OutlookFileError);
  });
});

function parseSafe(t: string) { try { return JSON.parse(t); } catch { return t; } }

describe("message schema + dates", () => {
  it("requires entryId and receivedAt; accepts null conversationId and array recipients", () => {
    expect(validateMessage({ entryId: "x", receivedAt: "2026-09-01 10:00:00", conversationId: null, to: ["a@b.test"] }, 0).ok).toBe(true);
    const bad = validateMessage({ subject: "no id" }, 3);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.invalid.index).toBe(3);
    expect(validateMessage("string", 0).ok).toBe(false);
  });
  it("receivedAt: ISO with offset → local wall-clock, naive as written", () => {
    const inst = new Date("2026-09-14T10:32:00+03:00");
    const a = parseReceivedAt("2026-09-14T10:32:00+03:00", "DMY").date!;
    expect(a.getUTCHours()).toBe(inst.getHours());
    const b = parseReceivedAt("2026-09-14 10:32:00", "DMY").date!;
    expect(b.getUTCHours()).toBe(10);
    expect(parseReceivedAt("garbage", "DMY").date).toBeNull();
  });
});
