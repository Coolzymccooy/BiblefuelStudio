// client/src/lib/__tests__/lyricTiming.test.ts
import { describe, it, expect } from 'vitest';
import { nudgeLine, lineAt, formatTime, flaggedCount } from '../lyricTiming';
import type { LyricLine } from '../lyricVideoTypes';

const line = (start: number, end: number, flag: 'check' | null = null): LyricLine =>
  ({ id: `l${start}`, sectionId: 's', kind: 'lead', text: 'x', effect: 'auto', start, end, flag, words: [{ text: 'x', start, end }] });
const lines = [line(1, 2), line(3, 4, 'check'), line(6, 7)];

// A line the timing step has not placed: no words, no start, no end.
const untimed = (id: string): LyricLine =>
  ({ id, sectionId: 's', kind: 'lead', text: 'unplaced', effect: 'auto', flag: null });

describe('nudgeLine', () => {
  it('moves by the delta', () => expect(nudgeLine(lines, 1, 0.1, 10)).toBeCloseTo(3.1));
  it('never crosses the line before', () => expect(nudgeLine(lines, 1, -5, 10)).toBeCloseTo(2.05));
  it('never crosses the line after', () => expect(nudgeLine(lines, 1, 5, 10)).toBeCloseTo(4.95));
  it('never runs past the song', () => expect(nudgeLine(lines, 2, 9, 7.5)).toBeCloseTo(6.5));

  it('skips an untimed neighbour and clamps to the nearest timed line', () => {
    const gappy = [line(1, 2), untimed('u'), line(3, 4)];
    expect(nudgeLine(gappy, 2, -10, 10)).toBe(2.05);
    // Line 0 is 1 s long and must end 0.05 s before the timed line at 3 s.
    expect(nudgeLine(gappy, 0, 10, 10)).toBe(1.95);
  });

  it('does not make a cramped line worse', () => {
    // Lines touch end to start with no gap: the line can only stay put or move
    // into room that exists, never be pushed out of order.
    const touching = [line(1, 2), line(2, 3), line(3, 4)];
    expect(nudgeLine(touching, 1, 4, 10)).toBe(2);
    expect(nudgeLine(touching, 1, -1, 10)).toBe(2);
    const squeezed = [line(0, 1), line(1.02, 2), line(5, 6)];
    expect(nudgeLine(squeezed, 1, -0.5, 10)).toBe(1.02);
  });

  it('rounds to thousandths, as the server does', () => {
    expect(nudgeLine(lines, 1, 0.1234, 10)).toBe(3.123);
  });

  it('refuses a line that has no timing yet', () => {
    expect(() => nudgeLine([untimed('u')], 0, 1, 10)).toThrow(/no timing/);
  });

  // Ported from server/src/routes/lyricVideo.test.js (PATCH /:id/lines/:lineId).
  it('matches the server: a nudge is clamped between neighbours and inside the song', () => {
    expect(nudgeLine(lines, 1, 0.2 - 3, 10)).toBeCloseTo(2.05, 9);
    expect(nudgeLine(lines, 2, 99 - 6, 10)).toBe(9);
  });

  it('matches the server: random nudges keep order and stay inside the song', () => {
    let seed = 20261013;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const songEnd = 40;
    // Eight placed lines, one second long, four seconds apart.
    const timeline = Array.from({ length: 8 }, (_, i) => line(i * 4 + 1, i * 4 + 2));
    for (let k = 0; k < 200; k++) {
      const i = Math.floor(rnd() * 8);
      const delta = Math.round((rnd() * 60 - 30) * 100) / 100;
      const start = nudgeLine(timeline, i, delta, songEnd);
      const len = timeline[i].end! - timeline[i].start!;
      const prev = timeline[i - 1];
      const next = timeline[i + 1];
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start + len).toBeLessThanOrEqual(songEnd + 1e-6);
      if (prev) expect(start).toBeGreaterThanOrEqual(prev.end! + 0.05 - 1e-6);
      if (next) expect(start + len).toBeLessThanOrEqual(next.start! - 0.05 + 1e-6);
    }
  });
});

describe('lineAt', () => {
  it('finds the line on screen', () => {
    expect(lineAt(lines, 3.5)).toBe(1);
    expect(lineAt(lines, 5)).toBe(-1);
  });
});

it('formats times', () => {
  expect(formatTime(67.42)).toBe('1:07.4');
  expect(formatTime(0)).toBe('0:00.0');
});

it('does not round a minute up into "0:60.0"', () => {
  expect(formatTime(59.96)).toBe('1:00.0');
});

it('counts flagged lines', () => expect(flaggedCount(lines)).toBe(1));
