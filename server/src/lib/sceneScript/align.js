/**
 * Word timings for captions: the script's own words, placed in time by the
 * voice provider's word boundaries. The provider never changes a caption's
 * words; when its words cannot be matched, the words are spread by length.
 */

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** Spread words across a line by their length. */
export function spreadWords(text, durSec) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const total = words.reduce((a, w) => a + Math.max(1, norm(w).length), 0) || 1;
  const span = Math.max(0.3, durSec - 0.15);
  let t = 0.05;
  return words.map((w) => {
    const d = (Math.max(1, norm(w).length) / total) * span;
    const item = { text: w, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d;
    return item;
  });
}

/**
 * @param {string} text the caption text (author's words)
 * @param {Array<{text: string, start: number, end: number}>} heard provider words in seconds
 * @param {number} durSec
 */
export function alignWords(text, heard, durSec) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const spoken = (heard || []).filter((h) => norm(h.text));
  if (!words.length) return [];
  const out = [];
  let k = 0;
  for (const w of words) {
    const target = norm(w);
    if (!target) {
      const prev = out.at(-1);
      out.push({ text: w, start: prev ? prev.end : 0, end: prev ? prev.end : 0 });
      continue;
    }
    let got = "";
    let start = null;
    let end = null;
    while (k < spoken.length && got.length < target.length) {
      const piece = norm(spoken[k].text);
      if (!target.startsWith(got + piece)) break;
      got += piece;
      start = start ?? spoken[k].start;
      end = spoken[k].end;
      k += 1;
    }
    if (got !== target) return spreadWords(text, durSec);
    out.push({ text: w, start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return out;
}
