/**
 * Where the shots change. A grid of candidate times (beats, voice pauses, or
 * an even pulse) plus Energy gives contiguous shot boundaries from 0 to the
 * Moment's length.
 */
export const MIN_SHOT = 0.35;
export const MAX_SHOT = 4;
export const END_CARD_MIN = 1.5;
export const PULSE_SEC = 2;

const r3 = (n) => Math.round(n * 1000) / 1000;
const MAX_BY_BAND = { calm: 4, medium: 3, hype: 1.5 };

export function energyBand(energy) {
  if (energy < 0.34) return "calm";
  if (energy <= 0.66) return "medium";
  return "hype";
}

export function beatGridOf({ beats, downbeats = [], strong = [], period }) {
  const down = new Set(downbeats);
  const hard = new Set(strong);
  return {
    kind: "beats",
    marks: beats.map((t, i) => ({ t, downbeat: down.has(i), strong: hard.has(i) })),
    period,
  };
}

export function pulseGrid(lengthSec) {
  const marks = [];
  for (let t = PULSE_SEC; t < lengthSec; t += PULSE_SEC) marks.push({ t: r3(t), downbeat: true, strong: false });
  return { kind: "pulse", marks, period: PULSE_SEC };
}

export function pauseGrid(pauses, lengthSec) {
  const marks = (pauses || [])
    .map((p) => r3((p.start + p.end) / 2))
    .filter((t) => t > 0 && t < lengthSec)
    .map((t) => ({ t, downbeat: true, strong: false }));
  return { kind: "pauses", marks, period: null };
}

/** Boundaries chosen from the grid's marks, before the length rules. */
function rawBoundaries({ grid, band, rnd }) {
  const marks = grid.marks;
  if (grid.kind !== "beats") return marks.map((m) => ({ ...m }));
  const out = [];
  if (band === "hype") {
    marks.forEach((m, i) => {
      out.push({ ...m });
      const next = marks[i + 1];
      if (m.strong && next && (next.t - m.t) / 2 >= MIN_SHOT) {
        out.push({ t: r3((m.t + next.t) / 2), downbeat: false, strong: false });
      }
    });
    return out;
  }
  // Calm and medium step from the first downbeat so steps of 2/4/8 stay on the bar.
  let i = Math.max(0, marks.findIndex((m) => m.downbeat));
  while (i < marks.length) {
    out.push({ ...marks[i] });
    const step = band === "medium" ? 2 : rnd() < 0.5 ? 4 : 8;
    i += step;
  }
  return out;
}

/**
 * Interior edges for a span cut into `pieces` shots. On a beat grid a two-way
 * split moves onto the nearest downbeat when both halves stay in range, so a
 * long calm shot splits on the bar. Otherwise the edge is the even split point.
 */
function splitEdges({ from, to, pieces, maxLen, marks }) {
  const span = to - from;
  const even = (k) => ({ t: r3(from + (span * k) / pieces), downbeat: false, strong: false });
  if (pieces !== 2 || marks.length === 0) return Array.from({ length: pieces - 1 }, (_, k) => even(k + 1));
  const mid = even(1);
  const fits = marks.filter((m) => m.downbeat
    && m.t - from >= MIN_SHOT && to - m.t >= MIN_SHOT
    && m.t - from <= maxLen && to - m.t <= maxLen);
  if (fits.length === 0) return [mid];
  const best = fits.reduce((p, m) => (Math.abs(m.t - mid.t) < Math.abs(p.t - mid.t) ? m : p));
  return [{ t: best.t, downbeat: true, strong: best.strong }];
}

/** The shots of one span: its first shot keeps `first`'s flags, the rest are cut inside it. */
function shotsOf({ from, to, first, maxLen, marks }) {
  const pieces = Math.max(1, Math.ceil((to - from) / maxLen - 1e-9));
  const edges = [{ t: from, downbeat: first.downbeat, strong: first.strong },
    ...splitEdges({ from, to, pieces, maxLen, marks })];
  return edges.map((e, k) => ({
    start: r3(e.t),
    end: r3(k === edges.length - 1 ? to : edges[k + 1].t),
    downbeat: e.downbeat,
    strong: e.strong,
  }));
}

/** Contiguous shots from 0 to lengthSec, every one MIN_SHOT..MAX_SHOT, the last at least END_CARD_MIN. */
export function cutPoints({ grid, energy, lengthSec, rnd }) {
  const band = energyBand(energy);
  const maxLen = grid.kind === "beats" ? MAX_SHOT : MAX_BY_BAND[band];
  const inner = rawBoundaries({ grid, band, rnd }).filter((m) => m.t >= MIN_SHOT && m.t <= lengthSec - MIN_SHOT);

  // Starts of shots: 0, then each boundary.
  let starts = [{ t: 0, downbeat: true, strong: false }, ...inner];
  // Drop boundaries that make a shot shorter than MIN_SHOT.
  starts = starts.filter((s, i, arr) => i === 0 || s.t - arr[i - 1].t >= MIN_SHOT - 1e-9);
  while (starts.length > 1 && lengthSec - starts.at(-1).t < MIN_SHOT) starts.pop();
  // The end card: merge trailing shots until it is long enough.
  while (starts.length > 1 && lengthSec - starts.at(-1).t < END_CARD_MIN) starts.pop();

  const marks = grid.kind === "beats" ? grid.marks : [];
  const cuts = [];
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].t : lengthSec;
    cuts.push(...shotsOf({ from: s.t, to: end, first: s, maxLen, marks }));
  });
  // Splitting may leave an end card under END_CARD_MIN: give it the shot before.
  while (cuts.length > 1 && cuts.at(-1).end - cuts.at(-1).start < END_CARD_MIN - 1e-9) {
    const last = cuts.pop();
    cuts.at(-1).end = last.end;
  }
  if (cuts.at(-1).end - cuts.at(-1).start > MAX_SHOT) {
    const last = cuts.pop();
    const [mid] = splitEdges({ from: last.start, to: last.end, pieces: 2, maxLen: MAX_SHOT, marks });
    cuts.push({ ...last, end: mid.t }, { start: mid.t, end: last.end, downbeat: mid.downbeat, strong: mid.strong });
  }
  return cuts;
}
