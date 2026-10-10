import fs from "node:fs";
import { isStudioLook, resolveLook, resolveEnergy } from "./looks.js";
import { studioCaptionFilter } from "./filter.js";
import { hasLibass } from "./capability.js";

export const SEED_MAX = 2147483647;
const PHRASE_WORDS = 5;
const PHRASE_CHARS = 28;

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The seed when it is an integer 0..SEED_MAX, else a fresh random one. */
export function normaliseSeed(seed) {
  const text = typeof seed === "number" ? String(seed) : typeof seed === "string" ? seed.trim() : "";
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  return Number.isInteger(n) && n <= SEED_MAX ? n : Math.floor(Math.random() * SEED_MAX);
}

/** One line cut into phrases of at most PHRASE_WORDS words and PHRASE_CHARS characters. */
function phrasesOfLine(line) {
  const out = [];
  let current = [];
  for (const word of line.split(" ")) {
    const next = [...current, word];
    if (current.length > 0 && (next.length > PHRASE_WORDS || next.join(" ").length > PHRASE_CHARS)) {
      out.push(current.join(" "));
      current = [word];
    } else {
      current = next;
    }
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

/**
 * Untimed caption lines (a Script render without word timings) as timed
 * phrases for the engine. The video's length is shared out by character
 * count, and each line is cut into short phrases so none is too long for the
 * effects. A phrase never spans two lines.
 */
export function timedLinePhrases(lines, durationSec) {
  const total = Number(durationSec);
  const texts = (Array.isArray(lines) ? lines : [])
    .map((l) => String(typeof l === "string" ? l : (l?.text ?? "")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (texts.length === 0 || !Number.isFinite(total) || total <= 0) return [];
  const phrases = texts.flatMap(phrasesOfLine);
  const weight = phrases.reduce((sum, p) => sum + p.length, 0);
  let t = 0;
  return phrases.map((text) => {
    const start = t;
    t += total * (text.length / weight);
    return { text, start: round3(start), end: round3(t) };
  });
}

/**
 * How a renderer draws captions for `preset`.
 * - Not a Studio look: drawtext with the preset unchanged.
 * - A Studio look: one libass filter, its .ass file already written to
 *   `assPath`. Timed `words` win; otherwise `lines` are spread over
 *   `durationSec`. A `filter` of "" means there was nothing to caption.
 * - Where libass is missing or the write fails: drawtext with the look's
 *   fallback preset, so captions never fail a render.
 */
export function prepareStudioCaptions({
  preset, assPath, words, lines, durationSec, w, h, energy, seed, title,
  defaultEnergy = "lively", libass = undefined,
}) {
  if (!isStudioLook(preset)) return { mode: "drawtext", preset };
  const fallback = { mode: "drawtext", preset: resolveLook(preset).fallbackPreset };
  // Probe ffmpeg only for a Studio look: non-Studio renders never need libass.
  const canDraw = libass ?? hasLibass();
  if (!canDraw) return fallback;
  const timed = (Array.isArray(words) ? words : []).filter(
    (wd) => wd && String(wd.text || "").trim() && Number.isFinite(wd.start) && Number.isFinite(wd.end),
  );
  try {
    const built = studioCaptionFilter({
      assPath,
      w,
      h,
      look: preset,
      title,
      words: timed.length > 0 ? timed : undefined,
      lines: timed.length > 0 ? undefined : timedLinePhrases(lines, durationSec),
      energy: resolveEnergy(energy, defaultEnergy),
      seed: normaliseSeed(seed),
    });
    for (const f of built.sideFiles) fs.writeFileSync(f.path, f.text, "utf8");
    return { mode: "studio", filter: built.filter, files: built.sideFiles.map((f) => f.path) };
  } catch (err) {
    console.warn(`[CAPTIONS] studio fallback: ${err?.message || err}`);
    return fallback;
  }
}
