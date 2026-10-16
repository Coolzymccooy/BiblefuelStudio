/**
 * Caption lines for the line-caption renderer (used when a voice returns no
 * word timings). That renderer cuts every line at a fixed length, so a whole
 * Series part handed over as one line lost its end on screen while the voice
 * read it all. Long lines are broken at sentence and clause ends first, then
 * between words, so every word still reaches the screen.
 */

// Break after a sentence or clause end that is followed by a space.
const CLAUSE_END = /(?<=[.!?;:])\s+/;

/** @param {string} text @param {number} maxChars @returns {string[]} */
function splitWords(text, maxChars) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * @param {string[]} lines
 * @param {number} maxChars
 * @returns {string[]}
 */
export function splitCaptionLines(lines, maxChars) {
  const out = [];
  for (const raw of lines) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length <= maxChars) {
      out.push(text);
      continue;
    }
    let line = "";
    for (const clause of text.split(CLAUSE_END)) {
      const next = line ? `${line} ${clause}` : clause;
      if (next.length <= maxChars) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (clause.length <= maxChars) {
        line = clause;
      } else {
        const pieces = splitWords(clause, maxChars);
        line = pieces.pop() || "";
        out.push(...pieces);
      }
    }
    if (line) out.push(line);
  }
  return out;
}
