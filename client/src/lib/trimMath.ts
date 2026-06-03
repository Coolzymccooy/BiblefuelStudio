/** Clamp a time value to [0, duration]. */
export function clampTime(t: number, duration: number): number {
  if (t < 0) return 0;
  if (t > duration) return duration;
  return t;
}

/** Snap to the nearest 0.1s for stable, readable handle positions. */
export function snap(t: number): number {
  return Math.round(t * 10) / 10;
}

/** Map a pixel offset within a track of `widthPx` to a time in [0, duration]. */
export function pxToTime(px: number, widthPx: number, duration: number): number {
  if (widthPx <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, px / widthPx));
  return snap(ratio * duration);
}

/** Map a time to a 0..100 percentage of the track width. */
export function timeToPct(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (t / duration) * 100));
}

export interface Selection { start: number; end: number; }

/**
 * Apply a proposed new value to one handle, keeping the invariant
 * start + minGap <= end and both within [0, duration].
 */
export function enforceHandles(
  which: 'start' | 'end',
  proposed: number,
  current: Selection,
  duration: number,
  minGap: number,
): Selection {
  const p = clampTime(snap(proposed), duration);
  if (which === 'start') {
    const start = Math.min(p, clampTime(current.end - minGap, duration));
    return { start: Math.max(0, start), end: current.end };
  }
  const end = Math.max(p, clampTime(current.start + minGap, duration));
  return { start: current.start, end: Math.min(duration, end) };
}
