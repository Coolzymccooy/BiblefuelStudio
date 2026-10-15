import { EFFECTS, assHeader } from "../kinetic/ass.js";
import { planPhrases } from "../kinetic/director.js";
import { resolveLook, resolveEnergy } from "../kinetic/looks.js";
import { aspectOf, slotsFor } from "../kinetic/layout.js";
import { echoInkTop } from "../kinetic/effects/echo.js";
import { chooseEffects } from "./policy.js";

const isPlaced = (l) => l && Array.isArray(l.words) && l.words.length > 0 && Number.isFinite(l.start) && Number.isFinite(l.end);
const isResponse = (l) => l?.kind === "response";
const MAX_HOLD = 3; // a call and its echoes stay up at most this long after the last echo ends
const GAP = 0.05;
const MIN_HOLD = 0.25;
const ECHO_GAP = 0.02; // a call's ink stays at least this share of the height above its echo's

/**
 * The call-and-echo groups (spec 6.2): a lead line not drawn as an echo, directly followed by
 * response lines that are all drawn as echoes. Only these share the screen, because only an echo
 * has its own place under the call. Anything else (a reply pinned to another effect, a lead set to
 * Echo) is drawn one line after another, as every other line is.
 */
function holdGroups(placed, effects) {
  const groups = [];
  for (let i = 0; i < placed.length; i++) {
    if (isResponse(placed[i]) || !isResponse(placed[i + 1])) continue;
    let j = i + 1;
    while (j < placed.length && isResponse(placed[j])) j++;
    const echoes = Array.from({ length: j - i - 1 }, (_, k) => i + 1 + k);
    if (effects[i] !== "echo" && echoes.every((k) => effects[k] === "echo")) groups.push({ call: i, echoes, next: j });
    i = j - 1;
  }
  return groups;
}

/**
 * When the lines of each call-and-echo group leave: the call and its last echo stay up until
 * min(next lead - 0.05, last echo end + 3), never sooner than their own end + 0.25 and never past
 * the music's end. An echo before another echo leaves when the next one comes, by the effects'
 * own rule, so two echoes never share their place. Other lines are left undefined.
 */
function holdsFor(placed, groups, songEnd) {
  const until = new Array(placed.length).fill(undefined);
  for (const { call, echoes, next } of groups) {
    const last = echoes[echoes.length - 1];
    const nextLead = next < placed.length ? placed[next].start - GAP : Infinity;
    const bound = Math.min(nextLead, placed[last].end + MAX_HOLD, songEnd);
    for (const k of [call, last]) until[k] = Math.min(Math.max(placed[k].end + MIN_HOLD, bound), songEnd);
  }
  return until;
}

/**
 * Where each group's call must keep its ink above, as a pixel y: the highest ink among its echoes
 * less a visible gap (2% of the height). The call and its echoes share the screen (spec 6.2), so
 * they must never overlap. Other lines are left undefined, which keeps their captions exactly as before.
 */
function clearancesFor(placed, groups, phrases, { look, w, h, aspect }) {
  const below = new Array(placed.length).fill(undefined);
  for (const { call, echoes } of groups) {
    const tops = echoes.map((j) => echoInkTop({ phrase: phrases[j], look, w, h, aspect }));
    below[call] = Math.floor(Math.min(...tops) - ECHO_GAP * h);
  }
  return below;
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
  const groups = holdGroups(placed, effects);
  const holds = holdsFor(placed, groups, songEnd);
  const held = placed.map((l, i) => ({
    text: l.text, start: l.start, end: l.end, words: l.words, soft: l.kind === "soft",
    ...(holds[i] !== undefined && { holdUntil: holds[i] }),
  }));
  const clears = clearancesFor(placed, groups, held, { look, w, h, aspect });
  const phrases = held.map((p, i) => (clears[i] === undefined ? p : { ...p, clearBelow: clears[i] }));
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
