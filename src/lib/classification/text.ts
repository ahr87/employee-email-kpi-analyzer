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

/** Body without the closing signature / disclaimer, so names, company and job titles never act as "locations". */
export function stripSignature(body: string): string {
  const m = body.match(/^[ \t>]*(best regards|kind regards|warm regards|with regards|regards|thanks and regards|thanks|thank you|sincerely|cheers|مع التحية|مع تحياتي|تحياتي|وتفضلوا|شكرا|شكراً|--+\s*$|sent from my)\b.*$/im);
  return m && m.index !== undefined && m.index > 0 ? body.slice(0, m.index) : body;
}
