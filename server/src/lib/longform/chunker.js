/**
 * Split narration text into provider-sized pieces at sentence boundaries.
 * Pure. Joining the output with a single space reproduces the normalised input.
 */
const SENTENCE_END = /(?<=[.!?…]["')\]]?)\s+/;

function splitLongSentence(sentence, maxChars) {
  const out = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(" ", maxChars);
    const at = cut > 0 ? cut : maxChars;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitForProvider(text, maxChars) {
  const limit = Number(maxChars) || 1000;
  const normalised = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalised) return [];
  const sentences = normalised.split(SENTENCE_END).flatMap((s) => splitLongSentence(s.trim(), limit)).filter(Boolean);

  const chunks = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length <= limit) { current = candidate; continue; }
    if (current) chunks.push(current);
    current = s;
  }
  if (current) chunks.push(current);
  return chunks;
}
