/**
 * AI music videos: the scene plan for a timed song, for the clip count and
 * price the lyric page shows before anything is made.
 *
 * A copy of server/src/lib/musicVideo/scenePlan.js (the server's plan is the
 * one that is built): scenes cut on the song's sections, long ones split at
 * line starts to at most 12 s, short ones merged to at least 4 s, the intro and
 * any instrumental gap given scenes of their own. A change there must be made
 * here too; both test files hold the same cases.
 */
import type { LyricLine, LyricSection } from './lyricVideoTypes';
import { clipSeconds } from './storyWizard';
import { aiMotionEstimateText, type AiMotionEstimate } from './seriesAiMotion';

const MAX_SEC = 12;
const MIN_SEC = 4;
const FALLBACK_SEC = 8;
/** At most this many scenes (one picture each), as the server caps it. */
export const MAX_SCENES = 60;
const EPS = 1e-6;

export interface MusicScene {
  startMs: number;
  endMs: number;
  kind: string;
  label: string;
  text: string;
}

interface Piece { start: number; end: number; kind: string; label: string }
interface Timed { start: number; end: number; text: string }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const lengthOf = (p: { start: number; end: number }) => p.end - p.start;

/** The song file's full length: the lyric render plays all of it, so the AI video covers all of it. */
function songEnd(durationSec: number): number {
  return finite(durationSec) && durationSec > 0 ? durationSec : 0;
}

function timedLines(lines: LyricLine[], end: number): Timed[] {
  return lines
    .filter((l) => finite(l.start) && finite(l.end) && l.end > l.start && l.start < end)
    .map((l) => ({ start: Math.max(0, l.start as number), end: Math.min(end, l.end as number), text: String(l.text ?? '').trim() }))
    .sort((a, b) => a.start - b.start);
}

function sectionBlocks(sections: LyricSection[], end: number): Piece[] | null {
  const started = sections
    .filter((s) => finite(s.start) && (s.start as number) < end)
    .map((s) => ({ start: Math.max(0, s.start as number), kind: String(s.kind || 'other'), label: String(s.label ?? '') }))
    .sort((a, b) => a.start - b.start);
  if (!started.length) return null;
  const blocks: Piece[] = started[0].start > EPS ? [{ kind: 'intro', label: 'Intro', start: 0, end: started[0].start }] : [];
  started.forEach((s, i) => {
    const blockEnd = i + 1 < started.length ? started[i + 1].start : end;
    if (blockEnd - s.start > EPS) blocks.push({ ...s, end: blockEnd });
  });
  if (blocks.length) blocks[0] = { ...blocks[0], start: 0 };
  return blocks;
}

function atomsOf(block: Piece, lines: Timed[], maxSec: number): Array<{ start: number; end: number }> {
  const cuts = [...new Set(lines.map((l) => l.start).filter((t) => t > block.start + EPS && t < block.end - EPS))];
  const points = [block.start, ...cuts.sort((a, b) => a - b), block.end];
  const atoms: Array<{ start: number; end: number }> = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const n = Math.max(1, Math.ceil((b - a) / maxSec - EPS));
    for (let k = 0; k < n; k++) atoms.push({ start: k === 0 ? a : a + ((b - a) * k) / n, end: k === n - 1 ? b : a + ((b - a) * (k + 1)) / n });
  }
  return atoms;
}

function splitBlock(block: Piece, lines: Timed[], maxSec: number, targetSec?: number): Piece[] {
  const len = lengthOf(block);
  if (targetSec === undefined && len <= maxSec + EPS) return [block];
  const target = targetSec ?? len / Math.ceil(len / maxSec - EPS);
  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  for (const atom of atomsOf(block, lines, maxSec)) {
    if (!cur) { cur = { ...block, start: atom.start, end: atom.end }; continue; }
    if (atom.end - cur.start > maxSec + EPS || lengthOf(cur) >= target - EPS) {
      pieces.push(cur);
      cur = { ...block, start: atom.start, end: atom.end };
    } else {
      cur = { ...cur, end: atom.end };
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

function mergeShort(pieces: Piece[], minSec: number, maxSec: number): Piece[] {
  let list = pieces;
  for (;;) {
    if (list.length < 2) return list;
    const i = list.findIndex((p) => lengthOf(p) < minSec - EPS);
    if (i < 0) return list;
    const fits = (span: number) => (span <= maxSec + EPS ? 0 : 1);
    const options = [i - 1, i + 1]
      .filter((j) => j >= 0 && j < list.length)
      .map((j) => ({ j, span: list[Math.max(i, j)].end - list[Math.min(i, j)].start, len: lengthOf(list[j]) }))
      .sort((x, y) => fits(x.span) - fits(y.span) || x.len - y.len);
    const { j, span } = options[0];
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const first = list[a];
    const second = list[b];
    let joined: Piece[];
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

function capCount(pieces: Piece[], count: number): Piece[] {
  let list = pieces;
  while (list.length > Math.max(1, count)) {
    let best = 0;
    for (let i = 1; i + 1 < list.length; i++) {
      if (list[i + 1].end - list[i].start < list[best + 1].end - list[best].start) best = i;
    }
    const first = list[best];
    const second = list[best + 1];
    const keeper = lengthOf(first) >= lengthOf(second) ? first : second;
    list = [...list.slice(0, best), { ...keeper, start: first.start, end: second.end }, ...list.slice(best + 2)];
  }
  return list;
}

function linesIn(piece: Piece, lines: Timed[]): Timed[] {
  return lines.filter((l) => {
    const overlap = Math.min(l.end, piece.end) - Math.max(l.start, piece.start);
    if (overlap <= EPS) return false;
    const mid = (l.start + l.end) / 2;
    return (mid >= piece.start && mid < piece.end) || overlap >= lengthOf(piece) / 2 - EPS;
  });
}

export function planMusicScenes({ sections, lines, durationSec }: {
  sections: LyricSection[];
  lines: LyricLine[];
  durationSec: number;
}): MusicScene[] {
  const end = songEnd(durationSec);
  if (!(end > 0)) return [];
  const timed = timedLines(lines, end);
  const blocks = sectionBlocks(sections, end);
  const piecesAt = (max: number, target: number) => {
    const pieces = blocks
      ? blocks.flatMap((b) => splitBlock(b, timed, max))
      : splitBlock({ kind: 'other', label: '', start: 0, end }, timed, max, target);
    return mergeShort(pieces, Math.min(MIN_SEC, max / 2), max);
  };
  let merged = piecesAt(MAX_SEC, FALLBACK_SEC);
  if (merged.length > MAX_SCENES) {
    const wider = Math.ceil(end / MAX_SCENES);
    merged = capCount(piecesAt(Math.max(MAX_SEC, wider), Math.max(FALLBACK_SEC, wider)), MAX_SCENES);
  }
  const bounds = [0, ...merged.map((p) => p.end)].map((t) => Math.round(t * 1000));
  bounds[bounds.length - 1] = Math.round(end * 1000);
  const scenes: MusicScene[] = [];
  merged.forEach((p, i) => {
    const startMs = bounds[i];
    const endMs = bounds[i + 1];
    if (endMs <= startMs) return;
    const sung = linesIn(p, timed);
    scenes.push({
      startMs, endMs,
      kind: sung.length ? p.kind : 'instrumental',
      label: p.label,
      text: sung.map((l) => l.text).filter(Boolean).join(' / '),
    });
  });
  return scenes;
}

/** One clip per scene, each billed at its clip length, at `usdPerSecond` (portrait, the chosen quality). */
export function musicVideoEstimate(scenes: Array<{ startMs: number; endMs: number }>, usdPerSecond: number): AiMotionEstimate {
  const seconds = scenes.reduce((sum, s) => sum + clipSeconds(s), 0);
  return { clips: scenes.length, seconds, usd: seconds * usdPerSecond };
}

/** "about 3 clips · ≈ $2.60" */
export const musicVideoEstimateText = (estimate: AiMotionEstimate): string => aiMotionEstimateText(estimate);
