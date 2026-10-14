// server/src/lib/lyricVideo/sheetParser.js
/**
 * Reads a pasted lyric sheet: section headings ([CHORUS], VERSE 1:), sung
 * lines, crowd responses in brackets, and stage notes to skip. Words and
 * Yoruba marks are kept exactly as typed; only emoji and bullets go.
 */
export const SHEET_MAX_CHARS = 20000;
export const SHEET_MAX_LINES = 400;

const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;
const BULLETS = /^[\s•*\->#]+/u;
const SOFT_CHARS = /[ẸẹỌọṢṣ]|\p{M}/u;
const BRACKET_HEADING = /^\s*\[(.+)\]\s*$/;
const BOLD_HEADING = /^\s*\*\*(.+)\*\*\s*$/;
const WORD_HEADING = /^\s*((?:final\s+)?(?:intro|verse|pre-?\s?chorus|chorus|hook|refrain|bridge|outro|ending|coda)\b[^a-z]{0,6}):?\s*$/i;
const WHOLE_PAREN = /^\(.*\)$/;
const RESPONSE_SECTIONS = new Set(["chorus", "final", "other"]);
const INLINE_RESPONSE = /^(.*?\S)\s*(\([^()]+\))\s*$/;

export function sectionKind(label) {
  const s = String(label || "").toLowerCase();
  if (/final/.test(s)) return "final";
  if (/pre/.test(s)) return "pre";
  if (/chorus|hook|refrain/.test(s)) return "chorus";
  if (/verse/.test(s)) return "verse";
  if (/intro/.test(s)) return "intro";
  if (/bridge/.test(s)) return "bridge";
  if (/outro|ending|coda/.test(s)) return "outro";
  return "other";
}

export function needsSoftFont(text) {
  return SOFT_CHARS.test(String(text).normalize("NFD"));
}

/** Splits a long line in two at the punctuation nearest its middle, recursively. */
export function splitLongLine(text, { maxWords = 5, maxChars = 28 } = {}) {
  const t = String(text).trim();
  const words = t.split(/\s+/);
  if (words.length <= maxWords && t.length <= maxChars) return [t];
  const cuts = [];
  // A cut must leave at least two words on each side: a one-word orphan ("Abeg,") makes a poor caption.
  for (let i = 1; i < words.length - 2; i += 1) if (/[,!?;:]$/.test(words[i])) cuts.push(i + 1);
  if (!cuts.length) return [t];
  const mid = words.length / 2;
  const at = cuts.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best), cuts[0]);
  const left = words.slice(0, at).join(" ");
  const right = words.slice(at).join(" ");
  return [...splitLongLine(left, { maxWords, maxChars }), ...splitLongLine(right, { maxWords, maxChars })];
}

function clean(raw) {
  return raw.replace(EMOJI, " ").replace(BULLETS, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

/** Heading label for a raw row, or null. Emoji are stripped first so "🎤 [CHORUS]" still reads as a heading. */
function headingOf(row) {
  const line = row.replace(EMOJI, " ").trim();
  const m = line.match(BRACKET_HEADING) || line.match(BOLD_HEADING) || line.match(WORD_HEADING);
  if (!m) return null;
  return m[1].split(/\s+[—–-]\s+/)[0].replace(/:$/, "").trim();
}

export function parseSheet(raw) {
  const rows = String(raw || "").slice(0, SHEET_MAX_CHARS).split(/\r?\n/).slice(0, SHEET_MAX_LINES);
  const hasHeadings = rows.some((r) => headingOf(r));
  const sections = [];
  const lines = [];
  const skipped = [];
  let current = null;
  const ensureSection = () => {
    if (!current) {
      current = { id: `s${sections.length + 1}`, kind: "other", label: "" };
      sections.push(current);
    }
    return current;
  };
  const push = (kind, text) => {
    const section = ensureSection();
    const soft = kind === "lead" && (section.kind === "bridge" || needsSoftFont(text));
    lines.push({ id: `l${lines.length + 1}`, sectionId: section.id, kind: soft ? "soft" : kind, text });
  };
  for (const row of rows) {
    const label = headingOf(row);
    if (label) {
      current = { id: `s${sections.length + 1}`, kind: sectionKind(label), label };
      sections.push(current);
      continue;
    }
    const text = clean(row);
    if (!text) continue;
    if (hasHeadings && !current) { skipped.push(text); continue; } // preamble before the first heading
    if (WHOLE_PAREN.test(text)) {
      // Crowd responses belong to chorus-like sections and follow a sung line; elsewhere it is a stage note.
      const leadsSoFar = lines.some((l) => l.sectionId === current?.id && l.kind !== "response");
      if (leadsSoFar && RESPONSE_SECTIONS.has(current.kind)) push("response", text);
      else skipped.push(text);
      continue;
    }
    const inline = text.match(INLINE_RESPONSE);
    if (inline && !WHOLE_PAREN.test(inline[1])) {
      for (const part of splitLongLine(inline[1])) push("lead", part);
      push("response", inline[2]);
      continue;
    }
    for (const part of splitLongLine(text)) push("lead", part);
  }
  return { sections: sections.filter((s) => lines.some((l) => l.sectionId === s.id)), lines, skipped };
}
