/**
 * Turn a hand-written long-form script into outline sections — deterministic,
 * no LLM. The author's words are the words; the only text we add is verbatim
 * scripture fetched by reference.
 *
 * Rules (documented for the operator in LongformForm's help text):
 *   - `# Title` on the first line names the project.
 *   - `## Heading`, a `---` rule, or a double blank line starts a section; the
 *     heading is the chapter title and is NOT narrated.
 *   - A line that is only a scripture reference (`Psalm 4:8`, `[Isaiah 40:31]`,
 *     `1 John 4:18`, `Psalm 23:1-3`) is replaced by the verse text, fetched
 *     verbatim, and spoken as "Psalm four, verse eight …" by the voice layer.
 *   - `[pause]` / `[pause 8]` inserts silence (template default / 8 s) by
 *     splitting the section into a continuation that shares the chapter.
 *   - Anything in (parentheses), [brackets] or *asterisks* on a line of its own
 *     is a note to the author and is dropped. Markdown emphasis, list markers,
 *     hashtags, emoji and URLs are stripped everywhere.
 */
import { cleanCaptionLine } from "../speakableScript.js";

const HEADING_RX = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE_RX = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const PAUSE_RX = /^\s*[\[(]\s*pause(?:\s+(\d+(?:\.\d+)?))?\s*[\])]\s*$/i;
// A whole line that is a stage direction: "(soft music)", "[breathe]", "*slowly*".
const NOTE_LINE_RX = /^\s*(?:\([^)]*\)|\[[^\]]*\]|\*[^*]+\*)\s*$/;
const REFERENCE_LINE_RX = /^\s*[\[(]?\s*((?:[1-3]\s)?[A-Z][a-zA-Z]+(?:\s(?:of\s)?[A-Z][a-zA-Z]+)*)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?\s*[\])]?\s*[.]?\s*$/;
const URL_RX = /https?:\/\/\S+|www\.\S+/gi;
const EMOJI_RX = /[\p{Extended_Pictographic}️]/gu;
// Short ALL-CAPS line (2-6 words, no sentence punctuation) reads as a heading.
const CAPS_HEADING_RX = /^\s*[A-Z][A-Z0-9' &-]{2,40}\s*$/;

const DEFAULT_WPM = 170;
// A [pause 999999] typo would otherwise ask ffmpeg for an 11-day silence file.
const MAX_PAUSE_MS = 120_000;

/** True when the line is nothing but a scripture reference. */
export function isReferenceLine(line) {
  return REFERENCE_LINE_RX.test(String(line || ""));
}

function referenceOf(line) {
  const m = REFERENCE_LINE_RX.exec(String(line || ""));
  if (!m) return null;
  return `${m[1]} ${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ""}`;
}

/** Clean one spoken line: shared caption cleaner plus URL/emoji removal. */
function speakable(line) {
  const noUrls = String(line || "").replace(URL_RX, " ").replace(EMOJI_RX, "");
  return cleanCaptionLine(noUrls);
}

function wordCount(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

/**
 * Pass 1: lines → raw blocks. A block is { heading, continuation, pauseMs, lines[] }
 * where lines are either { kind: "text", value } or { kind: "ref", value }.
 */
function tokenise(script) {
  const blocks = [];
  let title = "";
  let current = null;
  let blankRun = 0;
  const open = (heading, extra = {}) => { current = { heading, lines: [], ...extra }; blocks.push(current); };
  const ensure = () => { if (!current) open(""); };

  for (const raw of String(script || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) { blankRun += 1; if (blankRun >= 2 && current && current.lines.length) open(current.heading, { continuation: true, pauseMs: null }); continue; }
    blankRun = 0;

    const h = HEADING_RX.exec(line);
    if (h) {
      const level = h[1].length;
      if (level === 1 && !title && blocks.length === 0) { title = speakable(h[2]) || h[2].trim(); continue; }
      open(speakable(h[2]) || h[2].trim());
      continue;
    }
    if (RULE_RX.test(line)) { open(""); continue; }
    const p = PAUSE_RX.exec(line);
    if (p) {
      ensure();
      const asked = p[1] === undefined ? undefined : Math.min(MAX_PAUSE_MS, Math.max(0, Math.round(Number(p[1]) * 1000)));
      open(current.heading, { continuation: true, pauseMs: asked });
      continue;
    }
    if (isReferenceLine(line)) { ensure(); current.lines.push({ kind: "ref", value: referenceOf(line) }); continue; }
    if (NOTE_LINE_RX.test(line)) continue;
    if (CAPS_HEADING_RX.test(line) && current && current.lines.length === 0 && !current.heading) { current.heading = line; continue; }
    const text = speakable(line);
    if (text) { ensure(); current.lines.push({ kind: "text", value: text }); }
  }
  return { title, blocks };
}

/**
 * @param {string} script
 * @param {{ lookupVerses: (ref: string) => Promise<string>, wpm?: number, defaultPauseMs?: number }} opts
 * @returns {Promise<{ title: string, summary: string, sections: Array<object> }>}
 */
export async function parsePastedScript(script, { lookupVerses, wpm = DEFAULT_WPM, defaultPauseMs = 5000 } = {}) {
  if (typeof lookupVerses !== "function") throw new Error("scriptParser: lookupVerses is required");
  const { title, blocks } = tokenise(script);

  const sections = [];
  let lastHeading = "";
  for (const block of blocks) {
    const refs = block.lines.filter((l) => l.kind === "ref");
    const prose = block.lines.filter((l) => l.kind === "text").map((l) => l.value);
    if (refs.length === 0 && prose.length === 0) continue;

    // First reference in the block is the section's scripture; further
    // references are read inline (the voice layer speaks them naturally).
    let reference = null;
    let verseText = "";
    const inlineVerses = [];
    for (const r of refs) {
      let text;
      try { text = await lookupVerses(r.value); } catch (e) { throw new Error(`scripture lookup failed for ${r.value}: ${e?.message || e}`); }
      text = String(text || "").replace(/\s+/g, " ").trim();
      if (!text) throw new Error(`scripture lookup failed for ${r.value}: no verse text returned`);
      if (!reference) { reference = r.value; verseText = text; } else inlineVerses.push(`${r.value}. ${text}`);
    }

    const body = [...inlineVerses, ...prose].join("\n\n");
    const text = verseText ? `${reference}. ${verseText}${body ? ` ${body}` : ""}` : body;
    const heading = block.heading || (block.continuation ? lastHeading : "") || reference || firstWords(prose[0]);
    lastHeading = heading;
    const targetSec = Math.max(1, Math.round((wordCount(text) / Math.max(1, Number(wpm) || DEFAULT_WPM)) * 60));
    const section = { heading, reference, verseText, text, targetSec };
    if (block.continuation && sections.length > 0) {
      section.continuation = true;
      section.pauseBeforeMs = block.pauseMs === undefined ? defaultPauseMs : block.pauseMs ?? undefined;
      if (section.pauseBeforeMs === undefined) delete section.pauseBeforeMs;
    }
    sections.push(section);
  }

  if (sections.length === 0) throw new Error("script has nothing to narrate — add at least one line of spoken text or a scripture reference");
  const projectTitle = title || sections[0].heading;
  return { title: projectTitle, summary: firstWords(sections[0].text, 30), sections };
}

function firstWords(text, n = 8) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = words.slice(0, n).join(" ");
  return words.length > n ? `${out}…` : out;
}
