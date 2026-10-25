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

/** The closing card settles: a slow push on a tall photo (a still right after a push), a pan on a wide one. */
function chooseEndMove({ shape, capabilities, prevMove }) {
  const calm = shape === "wide" ? ["pan", "push"] : ["push", "still"];
  const ok = (m) => m !== prevMove && usable(m, { kind: "move", shape, capabilities, strongOk: false, avoid: [] });
  return calm.find(ok) ?? calm[0];
}
/** How strong the closing card's move is: slow, whatever the Energy. */
const END_INTENSITY = 0.3;
/**
 * About this many shots per photo, so a few photos are not cycled over and over. The photo count
 * therefore shapes the cuts: adding or removing a photo can re-time the whole edit.
 */
const SHOTS_PER_PHOTO = 2;

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

export const TITLE_MAX = 40;
export const STATEMENT_MAX = 60;
export const STATEMENT_LIMITS = Object.freeze({ 15: 3, 30: 5, 60: 8, 90: 10, 120: 12, 180: 16 });
const MIN_STATEMENTS = 3;
/** The title stays up at least this long (to the end of the shot it falls in). */
const TITLE_MIN_SEC = 2.5;

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
 * Title on the opening shots (until one ends at or after 2.5 s); the last statement on the end card; the rest
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

/** The first shot that ends at or after TITLE_MIN_SEC, but never the end card (unless it is the only shot). */
function titleShotIndex(cuts) {
  const found = cuts.findIndex((c) => c.end >= TITLE_MIN_SEC);
  return Math.min(found < 0 ? cuts.length - 1 : found, Math.max(0, cuts.length - 2));
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
  // The title spans whole shots until one ends at or after TITLE_MIN_SEC, so a fast edit can't flash it
  // away. It never takes the end card, which carries the closing statement.
  const titleLast = t ? titleShotIndex(cuts) : -1;
  if (t) line(t, cuts[0].start + 0.15, cuts[titleLast].end - 0.05, "title");
  const texts = statements.map((s) => String(s || "").trim()).filter(Boolean);
  if (!texts.length) return out;
  const closing = texts.at(-1);
  const body = texts.slice(0, -1);
  const firstBody = t ? Math.min(titleLast + 1, last) : 1;
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
  const cuts = cutPoints({ grid, energy: e, lengthSec, rnd, maxShots: Math.max(4, photos.length * SHOTS_PER_PHOTO) });
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
    const move = role === "end"
      ?chooseEndMove({ shape, capabilities, prevMove: prev?.move.id })
      : chooseMove({
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
      move: { id: move, intensity: role === "end" ? END_INTENSITY : r3(clamp01(0.25 + 0.6 * e + 0.15 * rIntensity)) },
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
