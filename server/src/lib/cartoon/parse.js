/**
 * Cartoon script parser (spec section 7.2). Turns the admin's pasted or
 * drafted script into a structured film outline: title, verse, style, cast and
 * scenes made of spoken lines and silent actions.
 *
 * Deterministic and pure: no LLM, no I/O, no clock. Like Human mode's parser
 * it never throws and never drops text silently. A line it cannot place goes
 * to `ignored` with its line number, so the editor can show it. Spoken lines
 * keep their wording exactly as written (only the surrounding quotes and outer
 * whitespace are removed), because a saved script is spoken verbatim.
 *
 * The script format, one construct per line:
 *   # Title
 *   Verse: Luke 15:4              (keywords are case-insensitive)
 *   Style: 3D family film         (raw text; a later step maps it to a style id)
 *   Cast:
 *   - Name: look. Voice: voice note.
 *   Scene: Place, director's note
 *   Name: "spoken line"           (straight or curly quotes, or none)
 *   (an action with no speech)
 */

/** The longest script the editor accepts; enforced by callers, not here. */
export const MAX_SCRIPT_CHARS = 8000;

const KEYWORD_RE = /^(verse|style|cast|scene)\s*:\s*(.*)$/i;
// Bullets: "-" and "*" (need a space), plus the ones Word and phones produce:
// bullet, middle dot, en dash, em dash.
const BULLET_CHARS = "•·–—";
const LIST_ITEM_RE = new RegExp(`^(?:[-*]\\s+|[${BULLET_CHARS}]\\s*)(.*)$`);
const TITLE_RE = /^#\s+(.*)$/;
const ACTION_RE = /^\((.*)\)$/;
// A speaker name never starts with a bullet, so a bulleted line outside Cast is ignored.
const SPEAKER_RE = new RegExp(
  `^([^\\s:"\\u201C\\u201D\\u201E()\\-*${BULLET_CHARS}][^:"\\u201C\\u201D\\u201E()]{0,39}?)\\s*:\\s*(.*)$`,
);
const VOICE_RE = /voice\s*:/gi;
const OPENING_QUOTES = new Set(['"', "“", "”", "„"]);
const CLOSING_QUOTES = new Set(['"', "“", "”"]);

function emptyResult() {
  return { title: "", verse: "", style: null, cast: [], scenes: [], ignored: [], warnings: [] };
}

function stripTrailingPeriod(text) {
  return text.trim().replace(/\.$/, "").trim();
}

/** Removes one surrounding pair of double quotes (straight or curly), if any. */
function stripSurroundingQuotes(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !OPENING_QUOTES.has(trimmed[0])) return trimmed;
  let inner = trimmed.slice(1);
  if (inner.length > 0 && CLOSING_QUOTES.has(inner[inner.length - 1])) {
    inner = inner.slice(0, -1);
  }
  return inner.trim();
}

/** "Eli: a shepherd boy. Voice: bright." -> { name, look, voice }; split at the LAST Voice:. */
function parseCastEntry(body) {
  const colon = body.indexOf(":");
  const name = (colon === -1 ? body : body.slice(0, colon)).trim();
  const rest = colon === -1 ? "" : body.slice(colon + 1);
  const voiceMatches = [...rest.matchAll(VOICE_RE)];
  const lastVoice = voiceMatches[voiceMatches.length - 1];
  if (!lastVoice) return { name, look: stripTrailingPeriod(rest), voice: "" };
  return {
    name,
    look: stripTrailingPeriod(rest.slice(0, lastVoice.index)),
    voice: stripTrailingPeriod(rest.slice(lastVoice.index + lastVoice[0].length)),
  };
}

/** "Hillside at dusk, wide" -> place before the first comma, note after it. */
function parseSceneHeading(text) {
  const comma = text.indexOf(",");
  if (comma === -1) return { place: text.trim(), note: "" };
  return { place: text.slice(0, comma).trim(), note: text.slice(comma + 1).trim() };
}

export function parseCartoonScript(markdown) {
  const result = emptyResult();
  const source = typeof markdown === "string" ? markdown.replace(/^﻿/, "") : "";
  const castByLowerName = new Map();
  const warnedSpeakers = new Set();
  let inCast = false;
  let scene = null;

  const ignore = (lineNo, text) => result.ignored.push({ lineNo, text });
  const openScene = (place, note) => {
    scene = { id: `s${result.scenes.length + 1}`, place, note, beats: [] };
    result.scenes.push(scene);
  };
  const addBeat = (beat) => {
    if (!scene) openScene("", "");
    scene.beats.push(beat);
  };
  const resolveSpeaker = (written) => {
    const known = castByLowerName.get(written.toLowerCase());
    if (known) return known;
    const key = written.toLowerCase();
    if (!warnedSpeakers.has(key)) {
      warnedSpeakers.add(key);
      result.warnings.push(`"${written}" speaks but is not in the Cast list.`);
    }
    return written;
  };

  source.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trim();
    if (line === "") return;

    if (inCast) {
      const item = LIST_ITEM_RE.exec(line);
      if (item) {
        const entry = parseCastEntry(item[1]);
        if (entry.name === "") return ignore(lineNo, line);
        result.cast.push(entry);
        castByLowerName.set(entry.name.toLowerCase(), entry.name);
        return;
      }
      inCast = false;
    }

    const title = TITLE_RE.exec(line);
    if (title) {
      if (result.title === "" && title[1].trim() !== "") result.title = title[1].trim();
      else ignore(lineNo, line);
      return;
    }

    const keyword = KEYWORD_RE.exec(line);
    if (keyword) {
      const word = keyword[1].toLowerCase();
      const value = keyword[2].trim();
      if (word === "cast") {
        inCast = true;
        if (value !== "") ignore(lineNo, line);
      } else if (word === "scene") {
        const heading = parseSceneHeading(value);
        openScene(heading.place, heading.note);
      } else if (word === "verse" && result.verse === "" && value !== "") {
        result.verse = value;
      } else if (word === "style" && result.style === null && value !== "") {
        result.style = value;
      } else {
        ignore(lineNo, line);
      }
      return;
    }

    const action = ACTION_RE.exec(line);
    if (action) {
      const text = action[1].trim();
      if (text === "") return ignore(lineNo, line);
      return addBeat({ kind: "action", text, lineNo });
    }

    const speaker = SPEAKER_RE.exec(line);
    if (speaker) {
      const text = stripSurroundingQuotes(speaker[2]);
      if (text === "") return ignore(lineNo, line);
      return addBeat({ kind: "line", speaker: resolveSpeaker(speaker[1].trim()), text, lineNo });
    }

    ignore(lineNo, line);
  });

  return result;
}
