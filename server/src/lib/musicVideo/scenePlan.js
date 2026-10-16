// server/src/lib/musicVideo/scenePlan.js
//
// AI music videos: the scene plan for a timed song. Scenes are cut on the
// song's own sections, so the pictures change where the music does, and every
// scene fits one Seedance clip (4 to 12 s). Pure: no files, no clock.
//
// The client mirrors this in client/src/lib/musicVideoPlan.ts to count the
// clips for its estimate; a change here must be made there too.

export const SCENE_MAX_SEC = 12;
export const SCENE_MIN_SEC = 4;
/** Scene length when the song has no section starts to cut on. */
export const FALLBACK_SCENE_SEC = 8;

const EPS = 1e-6;
const INTRO = { kind: "intro", label: "Intro" };
const NO_SECTION = { kind: "other", label: "" };

const finite = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * Where the scenes stop: the song file's full length, its quiet tail included. The lyric render
 * plays the whole file (and may pad it for the end card), so the AI video must cover all of it;
 * a background shorter than the render is looped from its start.
 */
function songEnd(durationSec) {
  return finite(durationSec) && durationSec > 0 ? durationSec : 0;
}

/** The lines timing has placed, inside the song, in time order. */
function timedLines(lines, end) {
  return (Array.isArray(lines) ? lines : [])
    .filter((l) => l && finite(l.start) && finite(l.end) && l.end > l.start && l.start < end)
    .map((l) => ({ start: Math.max(0, l.start), end: Math.min(end, l.end), text: String(l.text ?? "").trim() }))
    .sort((a, b) => a.start - b.start);
}

/**
 * One block per section that has a start, running to the next start (the last
 * to the end). A stretch before the first start is an intro. A section with no
 * start has no block: its lines fall inside the block before it. Null when no
 * section has a start.
 */
function sectionBlocks(sections, end) {
  const started = (Array.isArray(sections) ? sections : [])
    .filter((s) => s && finite(s.start) && s.start < end)
    .map((s) => ({ start: Math.max(0, s.start), kind: String(s.kind || "other"), label: String(s.label ?? "") }))
    .sort((a, b) => a.start - b.start);
  if (!started.length) return null;
  const blocks = started[0].start > EPS ? [{ ...INTRO, start: 0, end: started[0].start }] : [];
  started.forEach((s, i) => {
    const blockEnd = i + 1 < started.length ? started[i + 1].start : end;
    if (blockEnd - s.start > EPS) blocks.push({ ...s, end: blockEnd });
  });
  // A first section that starts a hair after 0 would leave a sliver; the block list must start at 0.
  if (blocks.length) blocks[0] = { ...blocks[0], start: 0 };
  return blocks;
}

/** The block cut at line starts; a stretch with no line start for longer than maxSec is cut evenly. */
function atomsOf(block, lines, maxSec) {
  const cuts = [...new Set(lines.map((l) => l.start).filter((t) => t > block.start + EPS && t < block.end - EPS))];
  const points = [block.start, ...cuts.sort((a, b) => a - b), block.end];
  const atoms = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const n = Math.max(1, Math.ceil((b - a) / maxSec - EPS));
    for (let k = 0; k < n; k++) atoms.push({ start: k === 0 ? a : a + ((b - a) * k) / n, end: k === n - 1 ? b : a + ((b - a) * (k + 1)) / n });
  }
  return atoms;
}

/**
 * Pieces of the block: line-start atoms joined until a piece reaches the
 * target or the next atom would take it past maxSec. A section's target is an
 * even share of it (a 30 s verse makes three pieces of about 10 s); without
 * sections it is the fallback length.
 */
function splitBlock(block, lines, { maxSec, targetSec }) {
  const len = block.end - block.start;
  if (targetSec === undefined && len <= maxSec + EPS) return [block];
  const target = targetSec ?? len / Math.ceil(len / maxSec - EPS);
  const pieces = [];
  let cur = null;
  for (const atom of atomsOf(block, lines, maxSec)) {
    if (!cur) { cur = { ...block, start: atom.start, end: atom.end }; continue; }
    if (atom.end - cur.start > maxSec + EPS || cur.end - cur.start >= target - EPS) {
      pieces.push(cur);
      cur = { ...block, start: atom.start, end: atom.end };
    } else {
      cur = { ...cur, end: atom.end };
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

const lengthOf = (p) => p.end - p.start;

/**
 * Pieces shorter than minSec joined to a neighbour: the one the join keeps
 * within maxSec, the shorter one first. When neither fits, the short piece and
 * its shorter neighbour are shared out as two even halves (each then lies
 * between maxSec/2 and maxSec, so the loop ends).
 */
function mergeShort(pieces, { minSec, maxSec }) {
  let list = pieces;
  for (;;) {
    if (list.length < 2) return list;
    const i = list.findIndex((p) => lengthOf(p) < minSec - EPS);
    if (i < 0) return list;
    const options = [i - 1, i + 1]
      .filter((j) => j >= 0 && j < list.length)
      .map((j) => ({ j, span: list[Math.max(i, j)].end - list[Math.min(i, j)].start, len: lengthOf(list[j]) }))
      .sort((x, y) => (x.span <= maxSec + EPS ? 0 : 1) - (y.span <= maxSec + EPS ? 0 : 1) || x.len - y.len);
    const { j, span } = options[0];
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const first = list[a];
    const second = list[b];
    let joined;
    if (span <= maxSec + EPS) {
      const keeper = lengthOf(first) >= lengthOf(second) ? first : second;
      joined = [{ ...keeper, start: first.start, end: second.end }];
    } else {
      const mid = first.start + span / 2;
      joined = [{ ...first, end: mid }, { ...second, start: mid }];
    }
    list = [...list.slice(0, a), ...joined, ...list.slice(b + 1)];
  }
}

/** A line is in a piece when its middle is, or when it fills at least half of the piece (a held note cut evenly). */
function linesIn(piece, lines) {
  return lines.filter((l) => {
    const overlap = Math.min(l.end, piece.end) - Math.max(l.start, piece.start);
    if (overlap <= EPS) return false;
    const mid = (l.start + l.end) / 2;
    return (mid >= piece.start && mid < piece.end) || overlap >= lengthOf(piece) / 2 - EPS;
  });
}

/**
 * @param {object} args
 * @param {Array<{id:string,kind:string,label:string,start?:number}>} args.sections
 * @param {Array<{text:string,start?:number,end?:number}>} args.lines
 * @param {number} args.durationSec the song file's length; the last scene runs to it
 * @returns {Array<{startMs:number,endMs:number,kind:string,label:string,text:string}>}
 *   contiguous from 0 to the end; kind "instrumental" (with empty text) where no line is sung
 */
export function planMusicScenes({
  sections = [], lines = [], durationSec,
  maxSec = SCENE_MAX_SEC, minSec = SCENE_MIN_SEC, targetSec = FALLBACK_SCENE_SEC,
} = {}) {
  const end = songEnd(durationSec);
  if (!(end > 0)) return [];
  const min = Math.min(minSec, maxSec / 2);
  const timed = timedLines(lines, end);
  const blocks = sectionBlocks(sections, end);
  const pieces = blocks
    ? blocks.flatMap((b) => splitBlock(b, timed, { maxSec }))
    : splitBlock({ ...NO_SECTION, start: 0, end }, timed, { maxSec, targetSec });
  const merged = mergeShort(pieces, { minSec: min, maxSec });

  // Shared boundaries rounded once, so each scene starts exactly where the one before ends.
  const bounds = [0, ...merged.map((p) => p.end)].map((t) => Math.round(t * 1000));
  bounds[bounds.length - 1] = Math.round(end * 1000);
  const scenes = [];
  merged.forEach((p, i) => {
    const startMs = bounds[i];
    const endMs = bounds[i + 1];
    // A piece rounded to nothing is dropped; its neighbours already share the boundary.
    if (endMs <= startMs) return;
    const sung = linesIn(p, timed);
    scenes.push({
      startMs, endMs,
      kind: sung.length ? p.kind : "instrumental",
      label: p.label,
      text: sung.map((l) => l.text).filter(Boolean).join(" / "),
    });
  });
  return scenes;
}
