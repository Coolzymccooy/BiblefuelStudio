/**
 * Numbers for a music list: how long it runs, and how it fits the video.
 * Pure, so the picker's header and rows can share them and tests can pin them.
 */

/** "4:30" under an hour, "1:02:05" from an hour; a dash when unknown. */
export function formatDuration(sec: number | null | undefined): string {
  const n = Math.round(Number(sec));
  if (!(n > 0)) return '—';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = String(n % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "1 h 42 min", "2 h", "12 min" — for sentences, rounded to the minute. */
export function humanDuration(sec: number): string {
  const mins = Math.round(Number(sec) / 60);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export interface SoundtrackStats {
  /** One pass through the list, crossfade overlaps removed. */
  totalSec: number;
  /** Tracks with no known length (left out of the total). */
  unknownCount: number;
  /** How many passes it takes to fill the video; null without a target. */
  repeats: number | null;
  /** More music needed so nothing repeats; null without a target. */
  shortfallSec: number | null;
}

export function soundtrackStats({ durations, crossfadeSec, targetSec }: {
  durations: ReadonlyArray<number | null | undefined>;
  crossfadeSec: number;
  targetSec?: number | null;
}): SoundtrackStats {
  const known = durations.map(Number).filter((d) => d > 0);
  const overlap = Math.max(0, Number(crossfadeSec) || 0) * Math.max(0, known.length - 1);
  const totalSec = Math.max(0, known.reduce((a, b) => a + b, 0) - overlap);
  const target = Number(targetSec) > 0 ? Number(targetSec) : null;
  return {
    totalSec,
    unknownCount: durations.length - known.length,
    repeats: target && totalSec > 0 ? target / totalSec : null,
    shortfallSec: target && totalSec > 0 ? Math.max(0, target - totalSec) : null,
  };
}

/** Warm, muted tones that sit on the cream and the dark themes alike. */
export const TRACK_PALETTE = ['#755c2a', '#8a7a5a', '#6f7d86', '#8d6f5c', '#5f7a70', '#7b6a8a', '#8a6a4a', '#5c6f8a'] as const;

/** A tile colour that stays the same for a title between visits. */
export function trackColour(label: string): string {
  let h = 0;
  for (const ch of String(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TRACK_PALETTE[h % TRACK_PALETTE.length];
}
