const HASHTAG_LINE_RX = /^\s*(?:#[\p{L}\p{N}_-]+\s*)+$/u;
const LEADING_LIST_RX = /^\s*(?:[-*•]+|\d+[.)])\s+/;

export function cleanCaptionLine(value: unknown): string {
  let s = String(value ?? '').replace(/\r/g, '').trim();
  if (!s) return '';
  if (HASHTAG_LINE_RX.test(s)) return '';
  // Markdown ATX header line ("## Title", "# Hook") — a structural label, not
  // spoken content. Drop the whole line so TTS neither reads the "##" (it was
  // spoken as "hashtag" and burned into the captions) nor the label word.
  if (/^#{1,6}\s+/.test(s)) return '';
  s = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(LEADING_LIST_RX, '')
    .replace(/[`*_~]+/g, '')
    .replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s
    .replace(/^"(.+)"$/s, '$1')
    .replace(/^"([^"]+)"(\s+[—-]\s+.+)$/u, '$1$2')
    .trim();
}

export function cleanSpeakableText(value: unknown): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(cleanCaptionLine)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function splitLongLine(line: string, maxChars: number): string[] {
  const clean = cleanCaptionLine(line);
  if (!clean) return [];
  const limit = Math.max(28, maxChars || 72);
  if (clean.length <= limit) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const source = sentences.length > 1 ? sentences : clean.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const part of source) {
    const next = cur ? `${cur} ${part}` : part;
    if (next.length <= limit) cur = next;
    else {
      if (cur) out.push(cur);
      cur = part.length <= limit ? part : part.slice(0, limit);
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function buildSpeakableLines(value: unknown, opts: { maxLines?: number; maxChars?: number } = {}): string[] {
  const maxLines = Math.max(1, opts.maxLines || 6);
  const maxChars = Math.max(28, opts.maxChars || 72);
  const out: string[] = [];
  for (const raw of String(value ?? '').split(/\r?\n/)) {
    for (const part of splitLongLine(raw, maxChars)) {
      out.push(part);
      if (out.length >= maxLines) return out;
    }
  }
  return out;
}
