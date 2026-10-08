/**
 * Minimal, dependency-free HTML -> plain text conversion.
 * The application NEVER renders pasted HTML: bodies are reduced to text here
 * (scripts/styles/comments removed, tags stripped, entities decoded) and are
 * displayed as escaped text by React.
 */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", copy: "(c)", reg: "(R)", trade: "(TM)", bull: "*", middot: "·", laquo: "«", raquo: "»", euro: "EUR", shy: "",
};

export function looksLikeHtml(text: string): boolean {
  // a real tag: name followed by whitespace/attributes or ">" — NOT "<a@x.com>" style addresses
  return /<\/?(html|body|div|p|br|table|tr|td|span|a|b|i|u|font|style|script|img)(\s[^<>]*)?\/?>/i.test(text);
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/**
 * Safe HTML → plain text for analysis. Nothing here is ever rendered as HTML: scripts, styles, comments, <head>, images
 * and all attributes are dropped, entities are decoded, <br>/paragraphs become line breaks, table cells are separated by
 * tabs (one table row per line) and links keep their address as text ("label (https://…)") unless the scheme is unsafe.
 */
export function htmlToText(html: string): string {
  let t = html
    // protect "Name <user@host>" addresses from the tag stripper
    .replace(/<([^<>\s@]+@[^<>\s]+)>/g, "&lt;$1&gt;")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|iframe|object|embed|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, "")
    // links: keep a safe target visible as text, drop javascript:/data:/cid: and any other scheme
    .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, a1: string, a2: string, a3: string, inner: string) => {
      const href = decodeEntities((a1 ?? a2 ?? a3 ?? "").trim());
      const label = inner.replace(/<[^>]*>/g, "").trim();
      if (!SAFE_URL.test(href)) return inner;
      const bare = href.replace(/^mailto:/i, "");
      return !label || label.replace(/\s/g, "") === href || label === bare ? ` ${label || href} ` : `${inner} (${bare})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|ul|ol|pre)\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]*>/g, "");
  t = decodeEntities(t).replace(/[\u200b\u200c\u2060\ufeff]/g, "").replace(/\u00a0/g, " ");
  return t
    .split("\n")
    .map((l) => l.replace(/[ ]{2,}/g, " ").replace(/\t[ \t]*/g, "\t").replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the HTML contains a data table (useful to know that table cells were flattened to tab-separated rows). */
export const hasHtmlTable = (html: string) => /<table\b/i.test(html) && /<t[dh]\b/i.test(html);
