import { splitPhrases } from "../captions.js";
import { planPhrases } from "./director.js";
import { resolveLook, resolveEnergy } from "./looks.js";
import { aspectOf, slotsFor } from "./layout.js";
import { render as pop } from "./effects/pop.js";
import { render as stack } from "./effects/stack.js";
import { render as slam } from "./effects/slam.js";
import { render as quote } from "./effects/quote.js";
import { render as curve } from "./effects/curve.js";
import { render as frame } from "./effects/frame.js";
import { render as titleEffect, titleCard } from "./effects/title.js";

const EFFECTS = { pop, stack, slam, quote, curve, frame, title: titleEffect };
const TITLE_MAX_CHARS = 60;

/** Phrases from timed words, or from timed lines with their words spread evenly. */
export function phrasesFrom({ words, lines }) {
  const timed = (Array.isArray(words) ? words : [])
    .filter((w) => w && String(w.text || "").trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
  if (timed.length) {
    return splitPhrases(timed, { maxWords: 5, maxChars: 28 }).map((p) => ({ text: p.text, start: p.start, end: p.end, words: p.words }));
  }
  return (Array.isArray(lines) ? lines : [])
    .filter((l) => l && String(l.text || "").trim() && Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start)
    .map((l) => {
      const parts = String(l.text).trim().split(/\s+/);
      const step = (l.end - l.start) / parts.length;
      return {
        text: String(l.text).trim(), start: l.start, end: l.end,
        words: parts.map((t, i) => ({ text: t, start: Number((l.start + i * step).toFixed(3)), end: Number((l.start + (i + 1) * step).toFixed(3)) })),
      };
    });
}

function header(w, h) {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Kinetic,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,0,0,0,0,100,100,1,0,1,4,3,5,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

/**
 * The whole caption track as an ASS document: phrases, then a plan, then
 * events. `title` adds a title card before the first lyric. Returns "" when
 * there is nothing to draw.
 */
export function buildAss({ words, lines, w, h, look, energy, seed = 1, overrides = {}, title = "" }) {
  const phrases = phrasesFrom({ words, lines });
  if (!phrases.length) return "";
  const aspect = aspectOf(w, h);
  const theLook = resolveLook(look);
  const theEnergy = resolveEnergy(energy);
  const intro = String(title || "").trim().slice(0, TITLE_MAX_CHARS);
  const plan = planPhrases({
    phrases, energy: theEnergy, seed, overrides, slotCount: slotsFor(aspect).length, titleFirst: !intro,
  });
  const card = intro ? titleCard({ text: intro, look: theLook, w, h, aspect, firstStart: phrases[0].start }) : [];
  const events = plan.flatMap((planned, i) => EFFECTS[planned.effect]({
    planned, look: theLook, energy: theEnergy, w, h, aspect,
    nextStart: i + 1 < plan.length ? plan[i + 1].phrase.start : Infinity,
  }));
  return `${header(w, h)}\n${[...card, ...events].join("\n")}\n`;
}
