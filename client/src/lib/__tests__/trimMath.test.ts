import { describe, it, expect } from 'vitest';
import { clampTime, snap, pxToTime, timeToPct, enforceHandles, moveSelection } from '../trimMath';

describe('trimMath', () => {
  it('clampTime keeps t within [0, duration]', () => {
    expect(clampTime(-2, 10)).toBe(0);
    expect(clampTime(12, 10)).toBe(10);
    expect(clampTime(4, 10)).toBe(4);
  });

  it('snap rounds to 0.1s', () => {
    expect(snap(1.234)).toBe(1.2);
    expect(snap(1.27)).toBe(1.3);
  });

  it('pxToTime maps pixel offset to time across a width', () => {
    expect(pxToTime(0, 200, 10)).toBe(0);
    expect(pxToTime(200, 200, 10)).toBe(10);
    expect(pxToTime(100, 200, 10)).toBe(5);
    expect(pxToTime(-50, 200, 10)).toBe(0);
    expect(pxToTime(999, 200, 10)).toBe(10);
  });

  it('timeToPct returns 0..100', () => {
    expect(timeToPct(0, 10)).toBe(0);
    expect(timeToPct(5, 10)).toBe(50);
    expect(timeToPct(10, 10)).toBe(100);
    expect(timeToPct(5, 0)).toBe(0);
  });

  it('enforceHandles keeps start < end with a minimum gap when moving start', () => {
    const r = enforceHandles('start', 9.9, { start: 2, end: 10 }, 10, 0.5);
    expect(r.end).toBe(10);
    expect(r.start).toBeLessThanOrEqual(9.5);
  });

  it('enforceHandles keeps end > start with a minimum gap when moving end', () => {
    const r = enforceHandles('end', 2.1, { start: 2, end: 10 }, 10, 0.5);
    expect(r.start).toBe(2);
    expect(r.end).toBeGreaterThanOrEqual(2.5);
  });

  it('enforceHandles clamps to [0, duration]', () => {
    const r = enforceHandles('end', 99, { start: 2, end: 10 }, 10, 0.5);
    expect(r.end).toBe(10);
  });

  it('enforceHandles preserves start+minGap<=end for normal clips', () => {
    const dur = 10, gap = 0.5;
    for (const move of ['start', 'end'] as const) {
      for (const proposed of [-5, 0, 1.3, 4.9, 5.0, 5.4, 9.9, 15]) {
        const r = enforceHandles(move, proposed, { start: 2, end: 8 }, dur, gap);
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.end).toBeLessThanOrEqual(dur);
        expect(r.start + gap).toBeLessThanOrEqual(r.end + 1e-9);
      }
    }
  });

  it('enforceHandles selects whole clip when duration <= minGap', () => {
    const r = enforceHandles('start', 0.2, { start: 0, end: 0.3 }, 0.3, 0.5);
    expect(r).toEqual({ start: 0, end: 0.3 });
  });

  describe('moveSelection', () => {
    it('slides the window forward preserving its width', () => {
      // 1:00–1:15 (15s) dragged forward 20s → 1:20–1:35 in a 120s clip.
      const r = moveSelection({ start: 60, end: 75 }, 20, 120);
      expect(r).toEqual({ start: 80, end: 95 });
    });

    it('slides the window backward preserving its width', () => {
      const r = moveSelection({ start: 60, end: 75 }, -20, 120);
      expect(r).toEqual({ start: 40, end: 55 });
    });

    it('clamps at the start edge without shrinking the window', () => {
      const r = moveSelection({ start: 5, end: 20 }, -50, 120);
      expect(r).toEqual({ start: 0, end: 15 });
    });

    it('clamps at the end edge without shrinking the window', () => {
      const r = moveSelection({ start: 100, end: 115 }, 50, 120);
      expect(r).toEqual({ start: 105, end: 120 });
    });

    it('preserves width for any delta', () => {
      const width = 12;
      for (const delta of [-200, -7.3, 0, 3.1, 200]) {
        const r = moveSelection({ start: 30, end: 30 + width }, delta, 120);
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.end).toBeLessThanOrEqual(120);
        expect(r.end - r.start).toBeCloseTo(width, 5);
      }
    });
  });
});
