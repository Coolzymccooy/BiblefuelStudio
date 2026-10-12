import { mulberry32 } from "../kinetic/director.js";
import { cutPoints } from "./cuts.js";
import { resolveStyle } from "./styles.js";
import { getEffect } from "./effects/index.js";
import { OUTPUT } from "./plan.js";

/**
 * The motion director: photos, a timing grid, statements, a style, Energy
 * and a seed in; a motion plan out. Deterministic: every shot draws the same
 * five random numbers whatever happens, so changing one input never reshuffles
 * the rest of the edit.
 */
export const TALL_ANCHOR = Object.freeze({ x: 0.5, y: 0.38 });
export const WIDE_ANCHOR = Object.freeze({ x: 0.5, y: 0.5 });
const r3 = (n) => Math.round(n * 1000) / 1000;
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/** Hero opens and closes; the rest in the user's order, cycled, extras dropped from the end. */
export function assignPhotos(photoCount, heroIndex, shotCount) {
  const hero = heroIndex >= 0 && heroIndex < photoCount ? heroIndex : 0;
  let others = Array.from({ length: photoCount }, (_, i) => i).filter((i) => i !== hero);
  const bodyCount = Math.max(0, shotCount - 2);
  const dropped = Math.max(0, others.length - bodyCount);
  others = others.slice(0, Math.max(bodyCount, 0) || others.length);
  if (!others.length) others = [hero];
  if (shotCount === 1) return { sequence: [hero], dropped };
  const body = Array.from({ length: bodyCount }, (_, k) => others[k % others.length]);
  return { sequence: [hero, ...body, hero], dropped };
}

function pick(weights, ok, r) {
  const entries = Object.entries(weights).filter(([id]) => ok(id));
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let x = r * total;
  for (const [id, w] of entries) {
    x -= w;
    if (x < 0) return id;
  }
  return entries.at(-1)[0];
}

function usable(id, { kind, shape, capabilities, strongOk, avoid }) {
  const e = getEffect(id);
  if (!e || e.kind !== kind) return false;
  if (e.needs.some((n) => !capabilities.includes(n))) return false;
  if (e.strong && !strongOk) return false;
  if (shape && e.shapes && !e.shapes.includes(shape)) return false;
  return !avoid.includes(id);
}

function chooseMove({ style, shape, role, capabilities, strongOk, prevMove, lastForPhoto, r }) {
  const base = { kind: "move", shape, capabilities, strongOk };
  const noSplit = (id) => role === "body" || !id.startsWith("split");
  const tries = [[prevMove, lastForPhoto], [prevMove]];
  for (const avoid of tries) {
    const id = pick(style.moves, (m) => noSplit(m) && usable(m, { ...base, avoid }), r);
    if (id) return id;
  }
  // A wide photo can only pan or split. Pan is the only non-split move that suits a
  // landscape photo, so it is allowed even outside the style's palette. A split is
  // strong and needs a strong beat, and only styles that list one may use it; when
  // there is none, a repeated pan beats breaking the beat or style rules.
  if (shape === "wide") {
    const split = ["split2", "split3"].find((m) => style.moves[m] !== undefined && usable(m, { ...base, avoid: [prevMove] }));
    return prevMove !== "pan" || !split || role !== "body" ? "pan" : split;
  }
  // push/still are the neutral tall-photo moves: they stand in even when outside the style's palette.
  return prevMove === "push" ? "still" : "push";
}

function chooseEntrance({ style, index, capabilities, strongOk, prev, r }) {
  if (index === 0) return "cut";
  const id = pick(style.entrances, (m) => usable(m, { kind: "entrance", capabilities, strongOk, avoid: [prev] }), r);
  if (id) return id;
  // cut (crossfade right after a cut) is the universal neutral entrance: it stands in even when outside the style's palette.
  return prev === "cut" ? "crossfade" : "cut";
}

function chooseOverlays({ style, role, move, energy, capabilities, strongOk, prev, gate, r }) {
  if (role === "open") return [];
  if (role === "end") return getEffect(style.endOverlay) ? [{ id: style.endOverlay }] : [];
  if (move.startsWith("split")) return [];
  if (gate >= style.overlayRate * (0.5 + energy)) return [];
  const id = pick(style.overlays, (m) => usable(m, { kind: "overlay", capabilities, strongOk, avoid: [prev] }), r);
  return id ? [{ id }] : [];
}

const TITLE_MAX = 40;
const STATEMENT_MAX = 60;
const STATEMENT_LIMITS = Object.freeze({ 15: 3, 30: 5, 60: 8 });
const MIN_STATEMENTS = 3;

/** How many statements a Moment of this length uses: the nearest limit at or below it, at least 3. */
export function statementLimit(lengthSec) {
  const keys = Object.keys(STATEMENT_LIMITS).map(Number).filter((k) => k <= lengthSec);
  return keys.length ? Math.max(MIN_STATEMENTS, STATEMENT_LIMITS[Math.max(...keys)]) : MIN_STATEMENTS;
}

const clip = (text, max) => String(text ?? "").trim().slice(0, max).trim();

/** The words a Moment actually uses: the first N statements, each cut to its limit, and a capped title. */
export function limitWords({ title, statements, lengthSec }) {
  return {
    title: clip(title, TITLE_MAX),
    statements: statements.map((s) => clip(s, STATEMENT_MAX)).filter(Boolean).slice(0, statementLimit(lengthSec)),
  };
}

/**
 * Title on the opening shots; the last statement on the end card; the rest
 * spread over the body, each starting on a shot (a downbeat one where the
 * group has one) and spanning up to 3 shots, so some shots breathe. Each
 * caption's words are placed by `end`; it stays up (holdUntil) until the next
 * caption starts, and the last one until the Moment ends.
 */
export function placeCaptions({ cuts, title = "", statements = [], period }) {
  const placed = layoutCaptions({ cuts, title, statements, period });
  const endOfMoment = r3(cuts.at(-1).end);
  return placed.map((c, i) => ({ ...c, holdUntil: i + 1 < placed.length ? placed[i + 1].start : endOfMoment }));
}

function layoutCaptions({ cuts, title, statements, period }) {
  const beat = period && period > 0 ? period : 0.5;
  const out = [];
  const line = (text, start, end, effect) => {
    const words = String(text).trim().split(/\s+/).length;
    const reveal = r3(Math.max(0.2, Math.min(words * beat, (end - start) * 0.6)));
    const c = { text: String(text).trim(), start: r3(start), end: r3(end), reveal, holdUntil: r3(end) };
    if (effect) c.effect = effect;
    out.push(c);
  };
  const last = cuts.length - 1;
  const t = String(title || "").trim();
  if (t) line(t, cuts[0].start + 0.15, cuts[Math.min(1, Math.max(0, last - 1))].end - 0.05, "title");
  const texts = statements.map((s) => String(s || "").trim()).filter(Boolean);
  if (!texts.length) return out;
  const closing = texts.at(-1);
  const body = texts.slice(0, -1);
  const firstBody = t ? Math.min(2, last) : 1;
  const slots = [];
  for (let i = firstBody; i < last; i += 1) slots.push(i);
  const kept = body.slice(0, slots.length);
  if (kept.length) {
    const size = Math.floor(slots.length / kept.length);
    kept.forEach((text, j) => {
      const group = slots.slice(j * size, j === kept.length - 1 ? slots.length : (j + 1) * size);
      const downIdx = group.findIndex((i) => cuts[i].downbeat);
      const first = downIdx > 0 && downIdx < group.length ? downIdx : 0;
      const span = group.slice(first, first + 3);
      line(text, cuts[span[0]].start + 0.05, cuts[span.at(-1)].end - 0.05);
    });
  }
  if (last > 0 || !t) line(closing, cuts[last].start + 0.15, cuts[last].end - 0.1);
  return out;
}

export function directMoment({
  photos, heroIndex = 0, grid, title = "", statements = [], styleId, energy, lengthSec, seed, capabilities = [],
}) {
  const rnd = mulberry32(seed);
  const style = resolveStyle(styleId);
  const e = clamp01(energy);
  const cuts = cutPoints({ grid, energy: e, lengthSec, rnd });
  const { sequence, dropped } = assignPhotos(photos.length, heroIndex, cuts.length);
  const lastMoveOf = new Map();
  const shots = [];
  cuts.forEach((c, i) => {
    const [rMove, rEntrance, rGate, rOverlay, rIntensity] = [rnd(), rnd(), rnd(), rnd(), rnd()];
    const photo = sequence[i];
    const shape = photos[photo]?.shape === "wide" ? "wide" : "tall";
    const role = i === 0 ? "open" : i === cuts.length - 1 ? "end" : "body";
    const prev = shots[i - 1];
    const strongOk = Boolean(c.downbeat || c.strong);
    const move = chooseMove({
      style, shape, role, capabilities, strongOk, prevMove: prev?.move.id, lastForPhoto: lastMoveOf.get(photo), r: rMove,
    });
    lastMoveOf.set(photo, move);
    const entrance = chooseEntrance({ style, index: i, capabilities, strongOk, prev: prev?.entrance.id, r: rEntrance });
    const overlays = chooseOverlays({
      style, role, move, energy: e, capabilities, strongOk, prev: prev?.overlays[0]?.id, gate: rGate, r: rOverlay,
    });
    shots.push({
      start: c.start,
      end: c.end,
      photo,
      role,
      move: { id: move, intensity: r3(clamp01(0.25 + 0.6 * e + 0.15 * rIntensity)) },
      entrance: { id: entrance },
      overlays,
      anchor: { ...(shape === "wide" ? WIDE_ANCHOR : TALL_ANCHOR) },
    });
  });
  const words = limitWords({ title, statements, lengthSec });
  const captions = placeCaptions({ cuts, ...words, period: grid.period });
  return {
    plan: { version: 1, ...OUTPUT, durationSec: lengthSec, seed, style: style.id, energy: e, shots, captions },
    dropped,
  };
}
