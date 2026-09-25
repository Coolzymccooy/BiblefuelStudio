import { describe, it, expect } from 'vitest';
import { scrollAffordance, scrollStep } from './scrollAffordance';

// The tool rail holds 12 tools and shows 6 on a 800px window. Nothing said the
// other 6 existed, so Voice, Scenes, Backgrounds, Renders and Output were
// undiscoverable. These pin when a hint appears — and, just as importantly,
// when it goes away, because a hint that is always on stops meaning anything.

describe('scrollAffordance', () => {
  it('shows nothing when everything fits', () => {
    expect(scrollAffordance({ scrollPos: 0, viewport: 400, content: 400 }))
      .toEqual({ atStart: false, atEnd: false, overflows: false });
  });

  it('points forward at the top of an overflowing list', () => {
    // The real case: 677px of tools in a 372px rail, scrolled to the top.
    const a = scrollAffordance({ scrollPos: 0, viewport: 372, content: 677 });
    expect(a.overflows).toBe(true);
    expect(a.atEnd).toBe(true);
    expect(a.atStart).toBe(false);
  });

  it('points both ways in the middle', () => {
    const a = scrollAffordance({ scrollPos: 150, viewport: 372, content: 677 });
    expect(a.atStart).toBe(true);
    expect(a.atEnd).toBe(true);
  });

  it('stops pointing forward once the end is reached', () => {
    const a = scrollAffordance({ scrollPos: 305, viewport: 372, content: 677 });
    expect(a.atEnd).toBe(false);
    expect(a.atStart).toBe(true);
  });

  it('tolerates sub-pixel scroll positions at the end', () => {
    // Fractional layout means scrollTop rarely lands exactly on the maximum.
    // Without slack the forward hint would never switch off.
    expect(scrollAffordance({ scrollPos: 304.6, viewport: 372, content: 677 }).atEnd).toBe(false);
  });

  it('tolerates sub-pixel positions at the start', () => {
    expect(scrollAffordance({ scrollPos: 0.4, viewport: 372, content: 677 }).atStart).toBe(false);
  });

  it('ignores an overflow of a pixel or two', () => {
    // A rail one pixel taller than its content is not scrollable in practice;
    // hinting there would be noise on every screen.
    expect(scrollAffordance({ scrollPos: 0, viewport: 372, content: 373 }).overflows).toBe(false);
  });

  it('survives a zero-size container — first paint, before layout', () => {
    const a = scrollAffordance({ scrollPos: 0, viewport: 0, content: 0 });
    expect(a).toEqual({ atStart: false, atEnd: false, overflows: false });
  });

  it('never throws on non-finite metrics', () => {
    const a = scrollAffordance({ scrollPos: Number.NaN, viewport: Number.NaN, content: Number.NaN });
    expect(a.overflows).toBe(false);
  });

  it('treats a negative scroll position as the start (elastic overscroll)', () => {
    expect(scrollAffordance({ scrollPos: -30, viewport: 372, content: 677 }).atStart).toBe(false);
  });

  it('works for a horizontal rail too — same arithmetic', () => {
    const a = scrollAffordance({ scrollPos: 0, viewport: 390, content: 900 });
    expect(a.atEnd).toBe(true);
    expect(a.atStart).toBe(false);
  });
});

describe('scrollStep', () => {
  it('moves most of a viewport, not all of it', () => {
    // Leaving a row or two on screen keeps the reader's place; a full-viewport
    // jump loses it.
    const step = scrollStep(372);
    expect(step).toBeLessThan(372);
    expect(step).toBeGreaterThan(372 * 0.5);
  });

  it('still moves something in a tiny container', () => {
    expect(scrollStep(10)).toBeGreaterThanOrEqual(48);
  });

  it('never returns a non-finite step', () => {
    expect(Number.isFinite(scrollStep(Number.NaN))).toBe(true);
    expect(scrollStep(Number.NaN)).toBeGreaterThan(0);
  });
});
