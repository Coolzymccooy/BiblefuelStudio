import { EFFECTS, assHeader } from "../kinetic/ass.js";
import { planPhrases } from "../kinetic/director.js";
import { resolveLook, resolveEnergy } from "../kinetic/looks.js";
import { aspectOf, slotsFor } from "../kinetic/layout.js";
import { chooseEffects } from "./policy.js";

const isPlaced = (l) => l && Array.isArray(l.words) && l.words.length > 0 && Number.isFinite(l.start) && Number.isFinite(l.end);
const isResponse = (l) => l?.kind === "response";
const MAX_HOLD = 3; // a call and its echoes stay up at most this long after the last echo ends
const GAP = 0.05;
const MIN_HOLD = 0.25;

/**
 * A call and its echoes share the screen until the next lead line (spec 6.2): when a lead line is
 * directly followed by response lines, each of them leaves at min(next lead - 0.05, last echo end + 3),
 * never sooner than its own end + 0.25 and never past the music's end. Other lines are left undefined.
 */
function holdsFor(placed, songEnd) {
  const until = new Array(placed.length).fill(undefined);
  for (let i = 0; i < placed.length; i++) {
    if (isResponse(placed[i]) || !isResponse(placed[i + 1])) continue;
    let j = i + 1;
    while (j < placed.length && isResponse(placed[j])) j++;
    const nextLead = j < placed.length ? placed[j].start - GAP : Infinity;
    const bound = Math.min(nextLead, placed[j - 1].end + MAX_HOLD, songEnd);
    for (let k = i; k < j; k++) until[k] = Math.min(Math.max(placed[k].end + MIN_HOLD, bound), songEnd);
  }
  return until;
}

/**
 * What the captions are planned from: the placed lines, the energy, the shuffle seed and the
 * effect chosen for each line. The render and the effects route both read this, so they cannot disagree.
 */
function planInputs(project) {
  const placed = (project.lines || []).filter(isPlaced);
  const energy = resolveEnergy(project.look?.energy, "wild");
  const seed = Number(project.look?.seed) || 1;
  const effects = chooseEffects({ lines: placed, sections: project.sections || [], title: project.title || "", energy, seed });
  return { placed, energy, seed, effects };
}

/** The effect each placed line is drawn with, keyed by line id. */
export function resolvedEffects(project) {
  const { placed, effects } = planInputs(project);
  return Object.fromEntries(placed.map((l, i) => [l.id, effects[i]]));
}

/** The project's captions as an ASS document, exactly as the render draws them. "" when no line is placed. */
export function buildLyricAss(project, { w, h, layout = "shorts" }) {
  const { placed, energy, seed, effects } = planInputs(project);
  if (!placed.length) return "";
  const base = aspectOf(w, h);
  const aspect = layout === "shorts" && base === "tall" ? "shorts" : base;
  const look = resolveLook(project.look?.id || "studio-lagos-night");
  const songEnd = Number(project.timing?.audibleEnd) || Number(project.song?.durationSec) || Infinity;
  const holds = holdsFor(placed, songEnd);
  const phrases = placed.map((l, i) => ({
    text: l.text, start: l.start, end: l.end, words: l.words, soft: l.kind === "soft",
    ...(holds[i] !== undefined && { holdUntil: holds[i] }),
  }));
  const overrides = Object.fromEntries(effects.map((fx, i) => [i, fx]));
  const plan = planPhrases({
    phrases, energy, seed, overrides, slotCount: slotsFor(aspect).length, titleFirst: false,
  });
  const events = plan.flatMap((planned, i) => EFFECTS[planned.effect]({
    planned, look, energy, w, h, aspect,
    nextStart: i + 1 < plan.length ? plan[i + 1].phrase.start : Infinity,
  }));
  return `${assHeader(w, h)}\n${events.join("\n")}\n`;
}
