import type { CSSProperties } from 'react';
import type { GradeName, ShotRefine } from '../../lib/sceneScriptTypes';

/**
 * The preview's twin of the server's refine (server/src/lib/sceneScript/refine.js):
 * keep the grade filters and the playback maths in step with it, so what the
 * dialog shows is what the render makes.
 */

export const GRADES: Record<GradeName, string> = {
  none: '',
  warm: 'sepia(0.22) saturate(1.12) hue-rotate(-6deg)',
  cool: 'saturate(0.92) hue-rotate(12deg) brightness(1.03)',
  golden: 'sepia(0.35) saturate(1.25) brightness(1.04) contrast(1.04)',
  faded: 'contrast(0.86) brightness(1.06) saturate(0.78)',
  vivid: 'saturate(1.3) contrast(1.08)',
  mono: 'grayscale(1) contrast(1.12)',
};

export const GRADE_LABELS: Record<GradeName, string> = {
  none: 'None', warm: 'Warm', cool: 'Cool', golden: 'Golden', faded: 'Faded', vivid: 'Vivid', mono: 'Mono',
};

/** null is "fit the shot": slowed just enough to fill its place, never sped up. */
export const RATES: (number | null)[] = [null, 0.5, 0.75, 1, 1.25, 1.5, 2];

export const UNREFINED: ShotRefine = { in: 0, out: null, rate: null, flip: false, zoom: 1, x: 0, y: 0, grade: 'none' };

const RATE_MIN = 0.5;
const END_GUARD_SEC = 0.08;

export function isUnrefined(r: ShotRefine): boolean {
  return r.in === 0 && r.out === null && r.rate === null && !r.flip && r.zoom === 1 && r.x === 0 && r.y === 0 && r.grade === 'none';
}

/**
 * Mirror, zoom, framing and grade, as CSS on the preview video. The render
 * frames the same way, then adds its slow push-in on top of the framed picture.
 */
export function previewStyle(r: ShotRefine | null): CSSProperties {
  const zoom = r?.zoom ?? 1;
  // A frame zoomed by z overflows by (z - 1) / 2 of its size on each side; framing pans within that.
  const pan = (v: number) => -v * ((zoom - 1) / 2) * 100;
  return {
    filter: r && GRADES[r.grade] ? GRADES[r.grade] : undefined,
    transform: `translate(${pan(r?.x ?? 0)}%, ${pan(r?.y ?? 0)}%) scale(${r?.flip ? -zoom : zoom}, ${zoom})`,
  };
}

/** The speed the render will use and how long it holds the last frame, for a place placeSec long. */
export function playbackFor(r: ShotRefine | null, clipDur: number, placeSec: number) {
  const from = r?.in ?? 0;
  const to = r?.out ?? clipDur;
  const clipSec = Math.max(0, to - from);
  const usable = Math.max(0, clipSec - END_GUARD_SEC);
  const fit = usable / placeSec;
  const rate = Math.max(RATE_MIN, Math.min(r?.rate ?? 1, fit));
  const hold = Math.max(0, placeSec - usable / rate);
  return { rate, hold: hold > 1e-9 ? hold : 0, clipSec };
}

/**
 * The part of the clip the preview loops: from the in point to where the render
 * cuts away to the next shot (or runs out of clip), then any held last frame.
 * Without a known place (not voiced yet) it loops the whole trim.
 */
export function previewLoop(r: ShotRefine | null, clipDur: number, placeSec: number) {
  const from = r?.in ?? 0;
  const out = r?.out ?? clipDur;
  if (!placeSec) return { from, end: out, hold: 0 };
  const { rate, hold } = playbackFor(r, clipDur, placeSec);
  return { from, end: Math.min(out, from + (placeSec - hold) * rate), hold };
}
