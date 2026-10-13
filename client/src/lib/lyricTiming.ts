// client/src/lib/lyricTiming.ts
// Pure helpers for the lyric timing step. nudgeLine mirrors the PATCH clamp in
// server/src/routes/lyricVideo.js so the timing screen moves a line the same way
// the server will keep it.
import type { LyricLine } from './lyricVideoTypes';

const MIN_GAP = 0.05;

type PlacedLine = LyricLine & { start: number; end: number };

/** Same test as the server's `placed`: has words and a finite start and end. */
const isPlaced = (l: LyricLine | undefined): l is PlacedLine =>
  !!l && Array.isArray(l.words) && l.words.length > 0 && Number.isFinite(l.start) && Number.isFinite(l.end);

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The nearest timed line from `index` in direction `step`; untimed lines are skipped. */
function nearestPlaced(lines: LyricLine[], index: number, step: 1 | -1): PlacedLine | undefined {
  for (let i = index + step; i >= 0 && i < lines.length; i += step) {
    const candidate = lines[i];
    if (isPlaced(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The clamped new start for the line at `index` after moving it by `delta`
 * seconds. It never crosses the nearest timed neighbour (plus a small gap) or
 * the song's ends. A line already squeezed tighter than the gap stays where it
 * is rather than being pushed further out of order.
 */
export function nudgeLine(lines: LyricLine[], index: number, delta: number, songEnd: number): number {
  const line = lines[index];
  if (!isPlaced(line)) throw new Error('That line has no timing yet — run timing first.');
  const start = line.start;
  const len = line.end - start;
  const prev = nearestPlaced(lines, index, -1);
  const next = nearestPlaced(lines, index, 1);
  const cap = songEnd > 0 ? songEnd : Infinity;
  const lower = prev ? prev.end + MIN_GAP : 0;
  const upper = Math.min(next ? next.start - MIN_GAP : Infinity, cap) - len;
  const lo = Math.min(lower, start);
  const hi = Math.max(upper, start);
  return round3(Math.max(lo, Math.min(start + delta, hi)));
}

export function lineAt(lines: LyricLine[], t: number): number {
  return lines.findIndex((l) => l.start !== undefined && l.end !== undefined && t >= l.start && t < l.end);
}

/** "1:07.4" for 67.42 seconds. Works in tenths so 59.96 rounds to "1:00.0", not "0:60.0". */
export function formatTime(sec: number): string {
  const tenths = Math.max(0, Math.round(sec * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const seconds = Math.floor(rest / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${rest % 10}`;
}

export function flaggedCount(lines: LyricLine[]): number {
  return lines.filter((l) => l.flag === 'check').length;
}
