/**
 * Where the shots change. A grid of candidate times (beats, voice pauses, or
 * an even pulse) plus Energy gives contiguous shot boundaries from 0 to the
 * Moment's length.
 */
export const MIN_SHOT = 0.35;
export const MAX_SHOT = 4;
/** The closing card stays up long enough to read its words before the fade to black. */
export const END_CARD_MIN = 3;
export const PULSE_SEC = 2;

const r3 = (n) => Math.round(n * 1000) / 1000;
const MAX_BY_BAND = { calm: 4, medium: 3, hype: 2 };
/**
 * The longest the photo-count gap gets. Below MAX_SHOT, so a span kept at the gap still has room
 * for one more grid step before it would need an off-beat split.
 */
const GAP_CAP = 3;
/** Beats between cuts on a beat grid; calm picks 4 or 8 per cut. */
const STEP_BY_BAND = { medium: 4, hype: 2 };

export function energyBand(energy) {
  if (energy < 0.34) return "calm";
  if (energy <= 0.66) return "medium";
  return "hype";
}

const byTime = (a, b) => a.t - b.t;

export function beatGridOf({ beats, downbeats = [], strong = [], period }) {
  const down = new Set(downbeats);
  const hard = new Set(strong);
  return {
    kind: "beats",
    marks: beats.map((t, i) => ({ t, downbeat: down.has(i), strong: hard.has(i) })).sort(byTime),
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
    .sort((a, b) => a - b)
    .map((t) => ({ t, downbeat: true, strong: false }));
  return { kind: "pauses", marks, period: null };
}

/** Boundaries chosen from the grid's marks, before the length rules. */
function rawBoundaries({ grid, band, rnd }) {
  const marks = grid.marks;
  if (grid.kind !== "beats") return marks.map((m) => ({ ...m }));
  const out = [];
  // Every band steps from the first downbeat so steps of 2/4/8 stay on the bar.
  let i = Math.max(0, marks.findIndex((m) => m.downbeat));
  while (i < marks.length) {
    out.push({ ...marks[i] });
    // Hype punches a strong beat with a quick double cut: one beat, then back on the step.
    if (band === "hype" && marks[i].strong && marks[i + 1]) out.push({ ...marks[i + 1] });
    i += STEP_BY_BAND[band] ?? (rnd() < 0.5 ? 4 : 8);
  }
  return out;
}

/**
 * Interior edges for a span cut into `pieces` shots. On a beat grid a two-way
 * split moves onto the nearest downbeat when both halves stay in range, so a
 * long calm shot splits on the bar. The tail half must be at least `minTail`
 * long, so an end card can keep END_CARD_MIN. Otherwise the edge is the even split point.
 */
function splitEdges({ from, to, pieces, maxLen, marks, minTail = MIN_SHOT }) {
  const span = to - from;
  const even = (k) => ({ t: r3(from + (span * k) / pieces), downbeat: false, strong: false });
  // A two-way split with no bar to land on keeps the tail at least minTail long.
  const mid = { t: r3(to - Math.max(minTail, span / 2)), downbeat: false, strong: false };
  if (pieces === 2 && marks.length === 0) return [mid];
  if (pieces !== 2) return Array.from({ length: pieces - 1 }, (_, k) => even(k + 1));
  // A tolerance, so a bar exactly maxLen away (34.2 - 30.2 is 4.000000000000004) still counts.
  const EPS = 1e-9;
  const fits = marks.filter((m) => m.downbeat
    && m.t - from >= MIN_SHOT - EPS && to - m.t >= minTail - EPS
    && m.t - from <= maxLen + EPS && to - m.t <= maxLen + EPS);
  if (fits.length === 0) return [mid];
  const centre = from + span / 2;
  const best = fits.reduce((p, m) => (Math.abs(m.t - centre) < Math.abs(p.t - centre) ? m : p));
  return [{ t: r3(best.t), downbeat: true, strong: best.strong }];
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

/**
 * Contiguous shots from 0 to lengthSec, every one MIN_SHOT..MAX_SHOT, the last at least END_CARD_MIN.
 * `maxShots` (from the photo count) spaces the cuts out so a few photos are not cycled over and
 * over. It is a target: no shot outgrows MAX_SHOT, so a long Moment never gets fewer than about
 * lengthSec / MAX_SHOT shots.
 */
export function cutPoints({ grid: rawGrid, energy, lengthSec: rawLength, rnd, maxShots }) {
  const lengthSec = r3(rawLength);
  // Round every candidate time once, so each length check compares the times that get emitted.
  const grid = { ...rawGrid, marks: rawGrid.marks.map((m) => ({ ...m, t: r3(m.t) })) };
  const band = energyBand(energy);
  // The shortest a shot may be, from the photo count (see GAP_CAP).
  const gap = Math.min(GAP_CAP, maxShots > 0 ? Math.max(MIN_SHOT, lengthSec / maxShots) : MIN_SHOT);
  // Phrase and pulse grids split long spans by band, unless few photos already hold shots that long.
  const maxLen = grid.kind === "beats" || gap >= MAX_BY_BAND[band] ? MAX_SHOT : MAX_BY_BAND[band];
  const inner = rawBoundaries({ grid, band, rnd }).filter((m) => m.t >= MIN_SHOT && m.t <= lengthSec - MIN_SHOT);

  // Starts of shots: 0, then each boundary.
  let starts = [{ t: 0, downbeat: true, strong: false }, ...inner];
  // Drop boundaries that make a shot shorter than the gap, measured from the last start kept.
  const [first, ...rest] = starts;
  starts = rest.reduce((kept, s) => (s.t - kept.at(-1).t >= gap - 1e-9 ? [...kept, s] : kept), [first]);
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
    const prev = cuts.pop();
    cuts.push({ ...prev, end: last.end });
  }
  if (cuts.at(-1).end - cuts.at(-1).start > MAX_SHOT) {
    const last = cuts.pop();
    const [mid] = splitEdges({
      from: last.start, to: last.end, pieces: 2, maxLen: MAX_SHOT, marks, minTail: END_CARD_MIN,
    });
    cuts.push({ ...last, end: mid.t }, { start: mid.t, end: last.end, downbeat: mid.downbeat, strong: mid.strong });
  }
  return cuts;
}
