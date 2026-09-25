/**
 * Plain-English answers for the ambient length field.
 *
 * "120" is a number you have to do arithmetic on. What the operator actually
 * wants to know is how long it plays, how many verses it holds, and how long
 * they will wait for it — so the form says those three things instead.
 */

export interface LengthPreset {
  minutes: number;
  label: string;
  hint?: string;
}

export const LENGTH_PRESETS: readonly LengthPreset[] = [
  { minutes: 10, label: '10 min', hint: 'Quick test' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
];

/** Mirrors server/src/lib/ambient/drops.js — keep the two in step. */
const VERSE_CADENCE_SEC = 900;
const TAIL_GUARD_SEC = 60;

/** How many verses "Suggest verses" places by default. */
export function versesFor(targetSec: number): number {
  const total = Number(targetSec) || 0;
  const step = Math.min(VERSE_CADENCE_SEC, total / 2);
  if (!(step > 0)) return 0;
  let n = 0;
  for (let t = step; t <= total - TAIL_GUARD_SEC; t += step) n += 1;
  return n;
}

/**
 * Measured on a real render, then confirmed on prod's ffmpeg 5.1 within 1.5%:
 * the video pass runs at ~3.4x realtime, the bed assembly at ~40x. This is for
 * the default still-image motion; drift is slower and not yet measured.
 */
const ENCODE_SPEED = 3.4;
const BED_SPEED = 40;

export function renderEstimateMinutes(targetSec: number): number {
  const sec = (Number(targetSec) || 0) / ENCODE_SPEED + (Number(targetSec) || 0) / BED_SPEED;
  const minutes = sec / 60;
  if (minutes < 1) return 1;
  // Round long waits to five minutes: "38" claims a precision this doesn't have.
  return minutes < 15 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
}

export function formatLength(minutes: number): string {
  const m = Math.round(minutes);
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (hours === 0) return plural(rest, 'minute');
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
}

/** e.g. "2 hours · 7 verses · ready in roughly 40 minutes". Empty for invalid input. */
export function lengthSummary(minutes: number): string {
  if (!(Number(minutes) > 0)) return '';
  const targetSec = Math.round(minutes * 60);
  const verses = versesFor(targetSec);
  const versePart = verses === 0
    ? 'too short for a verse'
    : `${verses} verse${verses === 1 ? '' : 's'}`;
  return `${formatLength(minutes)} · ${versePart} · ready in roughly ${formatLength(renderEstimateMinutes(targetSec))}`;
}
