/**
 * Streaming reader for the Outlook exporter's JSON file:
 *   { "exportedAt": "...", "source": "Outlook Desktop", "emails": [ {...}, {...}, ... ] }
 * The file is read in chunks and ONE message at a time is handed out, so exports of thousands of messages (with large
 * HTML bodies) never have to fit into a single JavaScript string. Works on a File/Blob (browser) or bytes/text (tests).
 * Tolerant of what VBA-written JSON often contains: a UTF-8/UTF-16 byte-order mark, raw control characters inside strings
 * (handled later by repairJson) and CRLF line breaks.
 */
export class OutlookFileError extends Error {}

export type StreamEvent =
  | { type: "field"; key: string; value: unknown }
  | { type: "email"; index: number; text: string }
  | { type: "end"; sawEmails: boolean };

export interface StreamInfo {
  encoding: string;
  /** U+FFFD characters produced while decoding (the file is probably not UTF-8). */
  replacementChars: number;
  bytesRead: number;
  totalBytes: number | null;
}

export type ExportSource = Blob | Uint8Array | string;
export interface StreamOptions { chunkSize?: number; info?: StreamInfo }

export async function* byteChunks(source: ExportSource, chunkSize = 1 << 20): AsyncGenerator<Uint8Array> {
  if (typeof source === "string" || source instanceof Uint8Array) {
    const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
    for (let i = 0; i < bytes.length; i += chunkSize) yield bytes.subarray(i, i + chunkSize);
    return;
  }
  const reader = source.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    if (!value) continue;
    if (value.length <= chunkSize) yield value;
    else for (let i = 0; i < value.length; i += chunkSize) yield value.subarray(i, i + chunkSize);
  }
}

function sniff(head: Uint8Array): { encoding: string } {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return { encoding: "utf-8" };
  if (head[0] === 0xff && head[1] === 0xfe) return { encoding: "utf-16le" };
  if (head[0] === 0xfe && head[1] === 0xff) return { encoding: "utf-16be" };
  return { encoding: "utf-8" };
}

async function* decodedChunks(source: ExportSource, opts: StreamOptions): AsyncGenerator<string> {
  const info = opts.info;
  let decoder: TextDecoder | null = null;
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  const decode = (bytes: Uint8Array, last = false) => {
    const t = decoder!.decode(bytes, { stream: !last });
    if (info) info.replacementChars += (t.match(/\ufffd/g) ?? []).length;
    return t;
  };
  for await (const chunk of byteChunks(source, opts.chunkSize)) {
    if (info) info.bytesRead += chunk.length;
    if (!decoder) {
      pending.push(chunk); pendingLen += chunk.length;
      if (pendingLen < 4) continue; // need a few bytes to look for a byte-order mark
      const head = new Uint8Array(pendingLen); let o = 0;
      for (const p of pending) { head.set(p, o); o += p.length; }
      const { encoding } = sniff(head);
      decoder = new TextDecoder(encoding);
      if (info) info.encoding = encoding;
      pending = []; pendingLen = 0;
      const t = decode(head);
      if (t) yield t;
      continue;
    }
    const t = decode(chunk);
    if (t) yield t;
  }
  if (!decoder) { // tiny file
    const head = new Uint8Array(pendingLen); let o = 0;
    for (const p of pending) { head.set(p, o); o += p.length; }
    decoder = new TextDecoder(sniff(head).encoding);
    if (info) info.encoding = sniff(head).encoding;
    const t = decode(head, true);
    if (t) yield t;
  } else {
    const tail = decode(new Uint8Array(0), true);
    if (tail) yield tail;
  }
}

export async function* streamExport(source: ExportSource, opts: StreamOptions = {}): AsyncGenerator<StreamEvent> {
  if (opts.info && typeof source !== "string" && !(source instanceof Uint8Array)) opts.info.totalBytes = source.size;
  if (opts.info && typeof source === "string") opts.info.totalBytes = new TextEncoder().encode(source).length;
  if (opts.info && source instanceof Uint8Array) opts.info.totalBytes = source.length;
  const chunks = decodedChunks(source, opts);
  let buf = "";
  let pos = 0;
  let eof = false;

  /** Appends the next decoded chunk (dropping what was already consumed). Returns false at end of file. */
  const more = async () => {
    if (eof) return false;
    const r = await chunks.next();
    if (r.done) { eof = true; return false; }
    buf = buf.slice(pos) + r.value;
    pos = 0;
    return true;
  };
  const skipWs = async () => {
    for (;;) {
      while (pos < buf.length && /\s/.test(buf[pos])) pos++;
      if (pos < buf.length) return;
      if (!(await more())) return;
    }
  };
  const peek = async () => { await skipWs(); return pos < buf.length ? buf[pos] : ""; };
  const expect = async (ch: string, what: string) => {
    const c = await peek();
    if (c !== ch) throw new OutlookFileError(`The file is not a valid Outlook export: expected ${what} but found ${c ? `“${c}”` : "the end of the file"}.`);
    pos++;
  };

  const STR = /["\\]/g;
  const STRUCT = /["{}\[\]]/g;
  /** Raw JSON text of the next value (string, object, array or primitive). */
  const readValue = async (): Promise<string> => {
    await skipWs();
    if (pos >= buf.length) throw new OutlookFileError("The file ended unexpectedly (it looks truncated).");
    let i = 0; // offset from pos
    let depth = 0;
    let inStr = false;
    const first = buf[pos];
    const primitive = first !== '"' && first !== "{" && first !== "[";
    for (;;) {
      if (pos + i >= buf.length) {
        if (!(await more())) {
          if (primitive && !inStr && depth === 0) { const t = buf.slice(pos); pos = buf.length; return t; }
          throw new OutlookFileError("The file ended unexpectedly (it looks truncated).");
        }
        continue;
      }
      if (primitive) {
        const m = /[,}\]\s]/.exec(buf.slice(pos + i, pos + i + 64));
        if (m) { const t = buf.slice(pos, pos + i + m.index); pos += i + m.index; return t; }
        i = buf.length - pos;
        continue;
      }
      const re = inStr ? STR : STRUCT;
      re.lastIndex = pos + i;
      const m = re.exec(buf);
      if (!m) { i = buf.length - pos; continue; }
      const at = m.index;
      const c = buf[at];
      if (inStr) {
        if (c === "\\") { if (at + 1 >= buf.length) { i = at - pos; if (!(await more())) throw new OutlookFileError("The file ended unexpectedly."); continue; } i = at + 2 - pos; continue; }
        inStr = false; i = at + 1 - pos;
        if (depth === 0) { const t = buf.slice(pos, pos + i); pos += i; return t; }
      } else if (c === '"') { inStr = true; i = at + 1 - pos; }
      else if (c === "{" || c === "[") { depth++; i = at + 1 - pos; }
      else { depth--; i = at + 1 - pos; if (depth === 0) { const t = buf.slice(pos, pos + i); pos += i; return t; } }
    }
  };

  await skipWs();
  if (pos >= buf.length && !(await more())) throw new OutlookFileError("The file is empty.");
  const rootStart = await peek();
  if (rootStart === "[") throw new OutlookFileError("The file is a bare list of messages. Expected an object with “source”, “exportedAt” and “emails” (as written by the Outlook exporter).");
  if (rootStart !== "{") throw new OutlookFileError("This is not a JSON file (it does not start with “{”). Choose the KPI_Outlook_Export_….json file written by the Outlook exporter.");
  pos++;
  let sawEmails = false;
  let index = 0;
  for (;;) {
    const c = await peek();
    if (c === "}") { pos++; break; }
    if (c === "") throw new OutlookFileError("The file ended unexpectedly (it looks truncated).");
    if (c === ",") { pos++; continue; }
    if (c !== '"') throw new OutlookFileError(`The file is not valid JSON (unexpected “${c}” where a field name was expected).`);
    let key: string;
    try { key = JSON.parse(await readValue()) as string; } catch { throw new OutlookFileError("The file is not valid JSON (bad field name)."); }
    await expect(":", "“:”");
    if (key === "emails" && (await peek()) === "[") {
      sawEmails = true;
      pos++;
      for (;;) {
        const n = await peek();
        if (n === "]") { pos++; break; }
        if (n === ",") { pos++; continue; }
        if (n === "") throw new OutlookFileError("The file ended unexpectedly inside the list of emails (it looks truncated).");
        yield { type: "email", index: index++, text: await readValue() };
      }
    } else {
      const text = await readValue();
      let value: unknown = text;
      try { value = JSON.parse(text); } catch { /* keep raw */ }
      if (key === "emails") sawEmails = true;
      yield { type: "field", key, value };
    }
  }
  yield { type: "end", sawEmails };
}

/** Parses one message's JSON text; repairs what VBA-written JSON commonly gets wrong (raw control characters, lone backslashes). */
export function parseElement(text: string): { value: unknown; repaired: boolean } {
  try { return { value: JSON.parse(text), repaired: false }; } catch { /* try to repair */ }
  return { value: JSON.parse(repairJson(text)), repaired: true };
}

export function repairJson(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (c === '"') { out += c; inStr = false; continue; }
    if (c === "\\") {
      const n = text[i + 1];
      if (n !== undefined && '"\\/bfnrt'.includes(n)) { out += c + n; i++; continue; }
      if (n === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { out += text.slice(i, i + 6); i += 5; continue; }
      out += "\\\\"; // a lone backslash (e.g. a Windows path): keep it as a literal backslash
      continue;
    }
    const code = c.charCodeAt(0);
    if (code < 0x20) { out += code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`; continue; }
    out += c;
  }
  return out;
}
