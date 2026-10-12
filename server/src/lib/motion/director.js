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
  // A wide photo can only pan or split. A split is strong and needs a strong
  // beat; when there is none, a repeated pan beats breaking the beat rule.
  if (shape === "wide") return prevMove !== "pan" ? "pan" : strongOk && role === "body" ? "split2" : "pan";
  return prevMove === "push" ? "still" : "push";
}

function chooseEntrance({ style, index, capabilities, strongOk, prev, r }) {
  if (index === 0) return "cut";
  const id = pick(style.entrances, (m) => usable(m, { kind: "entrance", capabilities, strongOk, avoid: [prev] }), r);
  if (id) return id;
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

/**
 * Title on the opening shots; the last statement on the end card; the rest
 * spread over the body, each starting on a shot (a downbeat one where the
 * group has one) and spanning up to 3 shots, so some shots breathe.
 */
export function placeCaptions({ cuts, title = "", statements = [], period }) {
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
  const captions = placeCaptions({ cuts, title, statements, period: grid.period });
  return {
    plan: { version: 1, ...OUTPUT, durationSec: lengthSec, seed, style: style.id, energy: e, shots, captions },
    dropped,
  };
}
