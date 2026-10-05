/**
 * Minimal, dependency-free HTML -> plain text conversion.
 * The application NEVER renders pasted HTML: bodies are reduced to text here
 * (scripts/styles/comments removed, tags stripped, entities decoded) and are
 * displayed as escaped text by React.
 */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", copy: "(c)",
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

export function htmlToText(html: string): string {
  let t = html
    // protect "Name <user@host>" addresses from the tag stripper
    .replace(/<([^<>\s@]+@[^<>\s]+)>/g, "&lt;$1&gt;")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]*>/g, "");
  t = decodeEntities(t);
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
