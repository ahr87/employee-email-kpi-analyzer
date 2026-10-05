/** Shared text helpers for classification and duplicate detection. */

export function conversationKey(subject: string): string {
  let s = subject.toLowerCase();
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/^\s*((re|fw|fwd|aw|wg)\s*:|رد\s*:|ردّ\s*:|إعادة توجيه\s*:|احالة\s*:|\[[^\]]{1,20}\])\s*/i, "");
  }
  return s.replace(/\s+/g, " ").trim();
}

export function stripQuoted(body: string): string {
  const idx = body.search(/^\s*(-{2,}\s*original message|_{5,}\s*$|from:\s.+\n\s*sent:)/im);
  return idx > 0 ? body.slice(0, idx) : body;
}
