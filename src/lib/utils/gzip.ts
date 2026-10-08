/** gzip helpers (browser CompressionStream; also available in Node 18+). Used to keep original Outlook HTML small. */
export const canCompress = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as BufferSource).then(() => writer.close()).catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export const gzip = (text: string) => pipe(new TextEncoder().encode(text), new CompressionStream("gzip"));
export async function gunzip(bytes: Uint8Array): Promise<string> {
  return new TextDecoder("utf-8").decode(await pipe(bytes, new DecompressionStream("gzip")));
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
