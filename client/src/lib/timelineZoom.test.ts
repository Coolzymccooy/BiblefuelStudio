import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ZOOM_STEPS,
  nextZoomIn,
  nextZoomOut,
  scrollLeftPreservingAnchor,
  loadZoom,
  saveZoom,
  zoomStorageKey,
} from './timelineZoom';
import { MIN_ZOOM, MAX_ZOOM } from './timelineScale';

// Zoom is a multiplier on the ONE scale (computeScale), so the arithmetic is
// already proven. What needs pinning here is the behaviour around it: the
// steps a button walks through, keeping the playhead put while the content
// grows underneath it, and persistence per project.

describe('zoom steps', () => {
  it('walks up the ladder and stops at MAX_ZOOM', () => {
    expect(nextZoomIn(1)).toBeGreaterThan(1);
    expect(nextZoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it('walks down the ladder and stops at MIN_ZOOM', () => {
    expect(nextZoomOut(1)).toBeLessThan(1);
    expect(nextZoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it('is reversible — in then out returns to where it started', () => {
    for (const z of ZOOM_STEPS) {
      if (z === MAX_ZOOM) continue;
      expect(nextZoomOut(nextZoomIn(z))).toBeCloseTo(z, 6);
    }
  });

  it('snaps a value from between steps onto the ladder', () => {
    // A persisted 1.7 (from an older build, or a hand-edited store) must not
    // strand the buttons: stepping has to land on a real rung.
    expect(ZOOM_STEPS).toContain(nextZoomIn(1.7));
    expect(ZOOM_STEPS).toContain(nextZoomOut(1.7));
  });

  it('every step is inside the clamp', () => {
    for (const z of ZOOM_STEPS) {
      expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(z).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('includes 1 — fit must be reachable by stepping, not just by Fit', () => {
    expect(ZOOM_STEPS).toContain(1);
  });
});

describe('scrollLeftPreservingAnchor', () => {
  // Zooming must keep the moment you are looking at under the cursor. Scaling
  // the scroll origin instead is what makes an NLE feel like it jumps.
  it('keeps the anchored second in the same place on screen', () => {
    // 60s in view at 4px/s, anchor at 30s sitting 40px from the left edge.
    const next = scrollLeftPreservingAnchor({
      anchorSec: 30,
      anchorOffsetPx: 40,
      nextPxPerSecond: 8,
    });
    // At 8px/s the anchor is 240px into the content, so the viewport must
    // start 40px before it.
    expect(next).toBe(200);
  });

  it('never scrolls past the left edge', () => {
    expect(scrollLeftPreservingAnchor({ anchorSec: 1, anchorOffsetPx: 400, nextPxPerSecond: 8 })).toBe(0);
  });

  it('is a no-op at the origin', () => {
    expect(scrollLeftPreservingAnchor({ anchorSec: 0, anchorOffsetPx: 0, nextPxPerSecond: 8 })).toBe(0);
  });

  it('survives a non-finite scale', () => {
    expect(scrollLeftPreservingAnchor({ anchorSec: 30, anchorOffsetPx: 40, nextPxPerSecond: Number.NaN })).toBe(0);
  });
});

describe('zoom persistence', () => {
  beforeEach(() => localStorage.clear());

  it('is scoped per project, like the existing strip height', () => {
    expect(zoomStorageKey('proj-a')).not.toBe(zoomStorageKey('proj-b'));
    expect(zoomStorageKey('proj-a')).toContain('proj-a');
  });

  it('round-trips a saved zoom', () => {
    saveZoom('proj-a', 2);
    expect(loadZoom('proj-a')).toBe(2);
  });

  it('defaults to 1 for a project never zoomed', () => {
    expect(loadZoom('unknown')).toBe(1);
  });

  it('clamps a stored value that is out of range', () => {
    localStorage.setItem(zoomStorageKey('p'), '999');
    expect(loadZoom('p')).toBe(MAX_ZOOM);
  });

  it('ignores stored junk rather than breaking the timeline', () => {
    localStorage.setItem(zoomStorageKey('p'), 'not-a-number');
    expect(loadZoom('p')).toBe(1);
  });

  it('survives storage being unavailable (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => saveZoom('p', 2)).not.toThrow();
    spy.mockRestore();
  });
});
