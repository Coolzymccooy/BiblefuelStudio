import { MIN_ZOOM, MAX_ZOOM, clampZoom } from './timelineScale';

/**
 * Zoom: the steps, the scroll maths, and where the choice is remembered.
 *
 * The arithmetic of turning seconds into pixels belongs to computeScale();
 * zoom is only a multiplier handed to it. What lives here is everything
 * around that — the ladder the −/+ buttons walk, keeping the moment you are
 * looking at still while the content grows underneath it, and persistence.
 */

/**
 * The rungs the −/+ buttons step through. Powers of two either side of 1 so
 * each press is a clearly felt change rather than a nudge, and 1 is on the
 * ladder because "the whole project fits" has to be reachable by stepping,
 * not only by a separate Fit button.
 */
export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8] as const;

/** The next rung up, snapping onto the ladder from any value in between. */
export function nextZoomIn(zoom: number): number {
  const z = clampZoom(zoom);
  return ZOOM_STEPS.find((step) => step > z + 1e-9) ?? MAX_ZOOM;
}

/** The next rung down, snapping onto the ladder from any value in between. */
export function nextZoomOut(zoom: number): number {
  const z = clampZoom(zoom);
  const below = ZOOM_STEPS.filter((step) => step < z - 1e-9);
  return below.length > 0 ? below[below.length - 1] : MIN_ZOOM;
}

export interface AnchorInput {
  /** The second that should stay put. */
  anchorSec: number;
  /** How far from the viewport's left edge it currently sits, in px. */
  anchorOffsetPx: number;
  /** px/second AFTER the zoom change. */
  nextPxPerSecond: number;
}

/**
 * Where to scroll so the anchored second stays under the same pixel.
 *
 * Scaling the scroll ORIGIN instead is what makes a timeline feel like it
 * jumps away from you: the operator is looking at 2:15, presses +, and ends
 * up somewhere else entirely.
 */
export function scrollLeftPreservingAnchor({ anchorSec, anchorOffsetPx, nextPxPerSecond }: AnchorInput): number {
  if (!Number.isFinite(nextPxPerSecond) || !Number.isFinite(anchorSec)) return 0;
  const anchorX = Math.max(0, anchorSec) * nextPxPerSecond;
  const offset = Number.isFinite(anchorOffsetPx) ? anchorOffsetPx : 0;
  return Math.max(0, anchorX - offset);
}

/** Per project, like the existing bf.editor.stripPct. */
export function zoomStorageKey(projectId: string): string {
  return `bf.timeline.zoom.${projectId}`;
}

/** The remembered zoom, or 1. Never throws, never returns something unusable. */
export function loadZoom(projectId: string): number {
  try {
    const raw = localStorage.getItem(zoomStorageKey(projectId));
    if (raw === null) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampZoom(parsed) : 1;
  } catch {
    return 1;
  }
}

/** Remember the zoom. Failure is non-fatal — the timeline still works. */
export function saveZoom(projectId: string, zoom: number): void {
  try {
    localStorage.setItem(zoomStorageKey(projectId), String(clampZoom(zoom)));
  } catch {
    /* private mode, or quota */
  }
}
