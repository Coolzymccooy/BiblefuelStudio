import { describe, it, expect } from 'vitest';
import { computeScale, formatTick, MIN_ZOOM, MAX_ZOOM, clampZoom, fitZoom } from './timelineScale';

// The ruler, the clips and the waveforms must all derive their geometry from
// ONE scale. There is a comment in VisualTimelineCanvas recording that the
// ruler and the lanes previously sat on different grids on a 390px phone —
// that happened because the offset was computed twice. These tests pin the
// single source of truth.

describe('computeScale', () => {
  it('fits the whole project in the container at zoom 1', () => {
    const s = computeScale({ durationSec: 270, containerWidth: 1080, zoom: 1 });
    expect(s.contentWidth).toBeCloseTo(1080, 0);
    expect(s.pxPerSecond).toBeCloseTo(4, 3);
  });

  it('scales content width linearly with zoom', () => {
    const a = computeScale({ durationSec: 270, containerWidth: 1080, zoom: 1 });
    const b = computeScale({ durationSec: 270, containerWidth: 1080, zoom: 2 });
    expect(b.contentWidth).toBeCloseTo(a.contentWidth * 2, 0);
  });

  it('never divides by zero on an empty project', () => {
    const s = computeScale({ durationSec: 0, containerWidth: 1080, zoom: 1 });
    expect(Number.isFinite(s.pxPerSecond)).toBe(true);
    expect(s.pxPerSecond).toBeGreaterThan(0);
    expect(s.ticks.length).toBeGreaterThan(0);
  });

  it('survives a zero-width container (first paint, before measure)', () => {
    const s = computeScale({ durationSec: 270, containerWidth: 0, zoom: 1 });
    expect(Number.isFinite(s.pxPerSecond)).toBe(true);
    expect(s.pxPerSecond).toBeGreaterThan(0);
  });

  it('starts ticks at 0 and never passes the duration', () => {
    const s = computeScale({ durationSec: 270, containerWidth: 1080, zoom: 1 });
    expect(s.ticks[0].sec).toBe(0);
    for (const t of s.ticks) expect(t.sec).toBeLessThanOrEqual(270);
  });

  it('places every tick at sec * pxPerSecond — the ruler cannot drift', () => {
    const s = computeScale({ durationSec: 270, containerWidth: 1080, zoom: 3 });
    for (const t of s.ticks) {
      expect(t.x).toBeCloseTo(t.sec * s.pxPerSecond, 6);
    }
  });

  // The ladder exists so labels never collide. A tick every 1s on a 4-minute
  // project would be unreadable; a tick every 5 minutes on a 30s one useless.
  it('keeps ticks at least MIN_TICK_PX apart, or emits a single tick', () => {
    // The invariant is "labels never collide", NOT "the gap always clears
    // 56px" — those differ when the whole project is narrower than two
    // labels (90 minutes at zoom 0.25 on a 320px screen is 80px of content).
    // There the only honest ruler is the origin tick by itself.
    for (const width of [320, 390, 768, 1080, 1440, 2560]) {
      for (const duration of [15, 60, 270, 1800, 5400]) {
        for (const zoom of [0.25, 1, 4, 8]) {
          const s = computeScale({ durationSec: duration, containerWidth: width, zoom });
          if (s.ticks.length <= 1) continue;
          const gap = s.ticks[1].x - s.ticks[0].x;
          expect(gap).toBeGreaterThanOrEqual(56);
        }
      }
    }
  });

  it('degrades to a single tick when the content is narrower than two labels', () => {
    const s = computeScale({ durationSec: 5400, containerWidth: 320, zoom: 0.25 });
    expect(s.contentWidth).toBeLessThan(112);
    expect(s.ticks).toHaveLength(1);
    expect(s.ticks[0].label).toBe('0:00');
  });

  it('chooses a finer interval as zoom increases', () => {
    const wide = computeScale({ durationSec: 1800, containerWidth: 1080, zoom: 1 });
    const close = computeScale({ durationSec: 1800, containerWidth: 1080, zoom: 8 });
    expect(close.tickEverySec).toBeLessThanOrEqual(wide.tickEverySec);
  });
});

describe('clampZoom', () => {
  it('holds the zoom inside its bounds', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('falls back to 1 for a non-number', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(undefined as unknown as number)).toBe(1);
  });
});

describe('fitZoom', () => {
  it('is 1 — fit is the definition of zoom 1', () => {
    expect(fitZoom()).toBe(1);
  });
});

describe('formatTick', () => {
  it('renders m:ss', () => {
    expect(formatTick(0)).toBe('0:00');
    expect(formatTick(30)).toBe('0:30');
    expect(formatTick(90)).toBe('1:30');
    expect(formatTick(270)).toBe('4:30');
  });

  it('carries hours only once they exist', () => {
    expect(formatTick(3600)).toBe('1:00:00');
    expect(formatTick(3661)).toBe('1:01:01');
  });

  it('does not emit negative or fractional labels', () => {
    expect(formatTick(-5)).toBe('0:00');
    expect(formatTick(30.7)).toBe('0:30');
  });
});
