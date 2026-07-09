const HASHTAG_LINE_RX = /^\s*(?:#[\p{L}\p{N}_-]+\s*)+$/u;
const LEADING_LIST_RX = /^\s*(?:[-*•]+|\d+[.)])\s+/;

export function cleanCaptionLine(value) {
  let s = String(value || "").replace(/\r/g, "").trim();
  if (!s) return "";
  if (HASHTAG_LINE_RX.test(s)) return "";

  s = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(LEADING_LIST_RX, "")
    // Strip markdown emphasis/backticks without removing apostrophes.
    .replace(/[`*_~]+/g, "")
    // Remove inline social hashtags if a pasted caption ends with them.
    .replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Remove matching wrapper quotes around the whole line, or around the
  // leading quoted sentence before a scripture reference.
  s = s
    .replace(/^"(.+)"$/s, "$1")
    .replace(/^"([^"]+)"(\s+[—-]\s+.+)$/u, "$1$2")
    .trim();
  return s;
}

export function cleanSpeakableText(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map(cleanCaptionLine)
    .filter(Boolean);
  return lines.join("\n\n").trim();
}

function splitLongLine(line, maxChars) {
  const clean = cleanCaptionLine(line);
  if (!clean) return [];
  const limit = Math.max(28, Number(maxChars) || 72);
  if (clean.length <= limit) return [clean];

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const source = sentences.length > 1 ? sentences : clean.split(/\s+/);
  const out = [];
  let cur = "";
  for (const part of source) {
    const next = cur ? `${cur} ${part}` : part;
    if (next.length <= limit) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    if (part.length <= limit) {
      cur = part;
    } else {
      const words = part.split(/\s+/);
      cur = "";
      for (const word of words) {
        const wnext = cur ? `${cur} ${word}` : word;
        if (wnext.length <= limit) cur = wnext;
        else {
          if (cur) out.push(cur);
          cur = word.slice(0, limit);
        }
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function buildSpeakableLines(value, opts = {}) {
  const maxLines = Math.max(1, Number(opts.maxLines) || 6);
  const maxChars = Math.max(28, Number(opts.maxChars) || 72);
  const lines = [];
  for (const raw of String(value || "").split(/\r?\n/)) {
    for (const part of splitLongLine(raw, maxChars)) {
      if (part) lines.push(part);
      if (lines.length >= maxLines) return lines;
    }
  }
  return lines;
}

export function sanitizeScriptObject(script) {
  const s = script || {};
  return {
    ...s,
    title: cleanCaptionLine(s.title) || "Biblefuel Post",
    hook: cleanCaptionLine(s.hook),
    verse: cleanCaptionLine(s.verse),
    reference: cleanCaptionLine(s.reference),
    reflection: cleanCaptionLine(s.reflection),
    cta: cleanCaptionLine(s.cta),
    hashtags: Array.isArray(s.hashtags)
      ? s.hashtags
          .map((h) => String(h || "").trim())
          .filter(Boolean)
          .map((h) => (h.startsWith("#") ? h : `#${h}`))
      : [],
  };
}
