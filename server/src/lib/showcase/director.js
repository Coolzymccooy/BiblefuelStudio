import { mulberry32 } from "../kinetic/director.js";
import { placeCaptions, limitWords } from "../motion/director.js";
import { STYLES, isShowcase } from "../motion/styles.js";
import { TEMPLATES, DENSE, CLOSING_MIN_SEC, SHOWCASE_FPS, SHAPES } from "./templates.js";
import { readInviteDate } from "./inviteDate.js";

/**
 * Plans a Showcase Moment: contiguous scenes cut on the beat, each drawing
 * one to five photos through a template, from 0 to the Moment's length.
 *
 * Photos go in the user's order, hero first, each once; when the time runs
 * out first the dense templates are favoured, and only then are photos left
 * out (`dropped`). When the photos run out first the sequence cycles. The
 * opening scene is the hero alone (the title sits on it); the closing scene
 * is the hero again, as a calendar invite when the details hold a date.
 * Pure and deterministic for a seed.
 */

const r3 = (n) => Math.round(n * 1000) / 1000;
/** Every this many scenes a cream flash marks a new section, in styles that use flashes. */
const FLASH_EVERY = 4;
/** Beats the closing scene takes at least (and CLOSING_MIN_SEC). */
const CLOSING_BEATS = 4;
/** How strongly the dense templates are favoured when the photos would not all fit. */
const DENSE_BOOST = 2;
/** A line clears this long after it is fully shown; only the closing words stay to the end. */
const HOLD_MAX_SEC = 4;
const MIN_SCENE_BEATS = 2;
/**
 * The beat used when the grid has none: a voiceover's pauses or the silent pulse are seconds apart,
 * and counting them as beats made scenes 10 to 17 s long.
 */
const NOMINAL_BEAT_SEC = 0.6;

/** Calm stays longer on each scene, Hype moves on sooner. */
function energyFactor(energy) {
  if (energy < 0.34) return 1.5;
  if (energy <= 0.66) return 1;
  return 0.75;
}

/**
 * Candidate boundaries inside (0, D): a song's beats, then steps of its period past the last one
 * (its beats can end before the Moment does). Without a song there are no beats to cut on, so the
 * boundaries are an even NOMINAL_BEAT_SEC apart.
 */
function boundaries(grid, D) {
  const beats = grid?.kind === "beats";
  const period = beats && grid.period > 0 ? grid.period : NOMINAL_BEAT_SEC;
  const marks = (beats ? grid.marks : []).filter((m) => m.t > 0 && m.t < D).sort((a, b) => a.t - b.t);
  const out = marks.map((m) => ({ t: r3(m.t), downbeat: Boolean(m.downbeat) }));
  let t = out.length ? out.at(-1).t : 0;
  for (t += period; t < D - 0.05; t += period) out.push({ t: r3(t), downbeat: false });
  return { list: out, period };
}

function weightedPick(weights, rnd) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = rnd() * total;
  for (const [id, w] of entries) {
    x -= w;
    if (x < 0) return id;
  }
  return entries.at(-1)?.[0];
}

/** Hero first, then the rest in the user's order. */
const sequenceOf = (count, hero) => [hero, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== hero)];

const averagePhotos = (weights) => {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  return entries.reduce((a, [id, w]) => a + TEMPLATES[id].photos * w, 0) / total;
};
const averageBeats = (weights) => {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  return entries.reduce((a, [id, w]) => a + TEMPLATES[id].beats * w, 0) / total;
};

/** The closing scene's start: the last boundary that leaves it CLOSING_BEATS beats and CLOSING_MIN_SEC. */
function closingIndex(list, period, D) {
  const latest = D - Math.max(CLOSING_MIN_SEC, CLOSING_BEATS * period);
  let at = -1;
  list.forEach((b, i) => { if (b.t <= latest) at = i; });
  return at;
}

/**
 * A style's weights are shares of screen time, so each is divided by the template's beats: a film
 * strip (8 beats) is picked less often than a single (3). Only templates whose animation fits the
 * beats left before the closing are candidates. The last two templates are rested, so even a
 * favoured dense template never dominates a stretch, unless nothing else fits.
 */
function chooseTemplate({ style, recent, room, fits, behind, rnd }) {
  const weigh = (rest) => {
    const weights = {};
    for (const [id, w] of Object.entries(style.templates)) {
      if ((rest && recent.includes(id)) || TEMPLATES[id].photos > room || !fits(id)) continue;
      const perPick = w / TEMPLATES[id].beats;
      weights[id] = behind && DENSE.includes(id) ? perPick * DENSE_BOOST : perPick;
    }
    return weightedPick(weights, rnd);
  };
  return weigh(true) ?? weigh(false) ?? "single";
}

/**
 * @returns {{ plan: object, dropped: number }}
 */
export function directShowcase({
  photos, heroIndex = 0, grid, title = "", statements = [], styleId, energy = 0.5, lengthSec, seed, shape = "tall", details = {},
}) {
  const style = isShowcase(styleId) ? STYLES[styleId] : STYLES.fellowship;
  const rnd = mulberry32(seed);
  const D = lengthSec;
  const n = photos.length;
  const hero = heroIndex >= 0 && heroIndex < n ? heroIndex : 0;
  const factor = energyFactor(energy);
  const { list, period } = boundaries(grid, D);
  const closeAt = closingIndex(list, period, D);
  // Too short for the usual closing: one scene, then the closing over the rest.
  const closeStart = closeAt >= 0 ? list[closeAt].t : r3(Math.max(D * 0.5, D - CLOSING_MIN_SEC));

  const order = sequenceOf(n, hero);
  let next = 0; // position in `order` of the next photo to show
  const seen = new Set();
  const take = (count) => {
    const out = [];
    for (let k = 0; k < count; k += 1) {
      out.push(order[next]);
      next = (next + 1) % n;
    }
    out.forEach((p) => seen.add(p));
    return out;
  };

  const avgPhotos = averagePhotos(style.templates);
  const avgSec = Math.max(MIN_SCENE_BEATS, averageBeats(style.templates) * factor) * period;

  const scenes = [];
  let at = -1; // index in `list` where the current scene ends (-1 = time 0)
  const timeOf = (i) => (i < 0 ? 0 : i >= closeAt ? closeStart : list[i].t);
  const beatsOf = (id) => Math.max(MIN_SCENE_BEATS, Math.round(TEMPLATES[id].beats * factor));
  // The shortest scene the style can make: less than this left, and the scene before runs on to the closing.
  const shortest = Math.min(...Object.keys(style.templates).map(beatsOf));

  if (closeAt < 0) {
    scenes.push({ template: "single", photos: take(1), start: 0, end: closeStart, downbeat: false });
  }
  while (closeAt >= 0 && timeOf(at) < closeStart) {
    const first = scenes.length === 0;
    const remaining = seen.size < n ? n - seen.size : n;
    const left = closeStart - timeOf(at);
    const behind = seen.size < n && (left / avgSec) * avgPhotos < remaining;
    const beatsLeft = closeAt - at;
    const template = first ? "single" : chooseTemplate({
      style, recent: scenes.slice(-2).map((s) => s.template).reverse(), room: n, fits: (id) => beatsOf(id) <= beatsLeft, behind, rnd,
    });
    let end = Math.min(at + beatsOf(template), closeAt);
    // Too little left for another whole scene: this one runs on to the closing scene.
    if (closeAt - end < shortest) end = closeAt;
    const start = timeOf(at);
    // The opening scene is order[0], the hero, so taking one photo shows it and moves on.
    const scenePhotos = take(TEMPLATES[template].photos);
    scenes.push({ template, photos: scenePhotos, start: r3(start), end: r3(timeOf(end)), downbeat: at >= 0 && list[at].downbeat });
    at = end;
  }

  const invite = readInviteDate(details?.date);
  scenes.push({ template: invite ? "invite" : "finale", photos: [hero], start: r3(closeStart), end: D, downbeat: false });

  const words = limitWords({ title, statements, lengthSec: D });
  const placed = placeCaptions({ cuts: scenes, title: words.title, statements: words.statements, period });
  // The calendar card takes the upper part of the closing scene, so its words pop in the lower band.
  const closingWords = (c) => invite && c.start >= r3(closeStart) && !c.effect;
  const captions = placed.map((c, i) => {
    const held = i < placed.length - 1 ? { ...c, holdUntil: r3(Math.min(c.holdUntil, c.end + HOLD_MAX_SEC)) } : c;
    return closingWords(c) ? { ...held, effect: "pop" } : held;
  });
  const flashes = style.flashes
    ? scenes.filter((s, i) => i > 0 && i < scenes.length - 1 && i % FLASH_EVERY === 0).map((s) => s.start)
    : [];
  const { w, h } = SHAPES[shape === "wide" ? "wide" : "tall"];
  return {
    plan: {
      version: 1, kind: "showcase", w, h, fps: SHOWCASE_FPS, durationSec: D, seed, style: style.id, energy,
      shape: shape === "wide" ? "wide" : "tall", beatSec: r3(period),
      scenes: scenes.map(({ template, photos: p, start, end }) => ({ template, photos: p, start, end })),
      captions, invite, flashes,
    },
    dropped: n - seen.size,
  };
}
