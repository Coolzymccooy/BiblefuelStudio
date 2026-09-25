/**
 * The timeline's single source of geometric truth.
 *
 * The ruler, the clip blocks and (later) the waveforms must all agree on where
 * a given second sits. There is a comment in VisualTimelineCanvas recording
 * that the ruler and the lanes once sat on DIFFERENT grids on a 390px phone —
 * that happened because the offset was computed in two places. Everything that
 * needs to turn seconds into pixels goes through computeScale().
 */

/** Zoom bounds. 0.25 = a quarter of "fits the container"; 8 = eight times it. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/**
 * Minimum gap between two tick LABELS. Below this they touch and the ruler
 * becomes noise, so the interval ladder steps up until the gap clears it.
 * 56px comfortably fits "1:01:01" at 10px.
 */
export const MIN_TICK_PX = 56;

/**
 * Tick intervals, coarsest last. Every value is a number a person would
 * actually count in, so the labels read as timecode rather than arbitrary
 * arithmetic.
 *
 * The ladder runs all the way to an hour because this app edits SERMONS: a
 * 90-minute recording zoomed out on a 390px phone leaves 0.018 px/second, and
 * a ladder that stopped at 10 minutes had no interval coarse enough — it
 * emitted ticks 11px apart, i.e. a smear. Found by the property test that
 * sweeps widths x durations x zoom levels.
 */
const TICK_LADDER = [
  1, 2, 5, 10, 15, 30,        // seconds
  60, 120, 300, 600, 900,     // 1, 2, 5, 10, 15 minutes
  1800, 3600,                 // 30 minutes, 1 hour
] as const;

export interface ScaleInput {
  /** Project duration in seconds. */
  durationSec: number;
  /** Measured width of the scrolling area, in px. */
  containerWidth: number;
  /** Zoom multiplier; 1 means "the whole project fits the container". */
  zoom: number;
}

export interface Tick {
  sec: number;
  x: number;
  label: string;
}

export interface Scale {
  pxPerSecond: number;
  contentWidth: number;
  tickEverySec: number;
  ticks: Tick[];
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Fit IS zoom 1, by definition. Named so callers read as intent. */
export function fitZoom(): number {
  return 1;
}

/** m:ss, or h:mm:ss once there are hours. Never negative, never fractional. */
export function formatTick(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function computeScale({ durationSec, containerWidth, zoom }: ScaleInput): Scale {
  // A project with no duration still has to render a ruler, and the container
  // measures 0 on the first paint (before the ResizeObserver fires). Both
  // would produce Infinity or NaN and blank the timeline, so floor them.
  const duration = Math.max(1, Number.isFinite(durationSec) ? durationSec : 0);
  const width = Math.max(320, Number.isFinite(containerWidth) ? containerWidth : 0);
  const z = clampZoom(zoom);

  const pxPerSecond = (width / duration) * z;
  const contentWidth = duration * pxPerSecond;

  // Step up the ladder until two labels no longer collide.
  const fitting = TICK_LADDER.find((step) => step * pxPerSecond >= MIN_TICK_PX);
  const tickEverySec = fitting ?? TICK_LADDER[TICK_LADDER.length - 1];

  // When NOTHING on the ladder fits, the content itself is narrower than two
  // labels — a 90-minute project at zoom 0.25 on a 320px screen is 80px wide
  // in total, so a second label physically cannot be placed. Emit the origin
  // tick alone: one honest marker beats a smear of overlapping numbers.
  if (!fitting) {
    return {
      pxPerSecond,
      contentWidth,
      tickEverySec,
      ticks: [{ sec: 0, x: 0, label: formatTick(0) }],
    };
  }

  const ticks: Tick[] = [];
  for (let sec = 0; sec <= duration; sec += tickEverySec) {
    ticks.push({ sec, x: sec * pxPerSecond, label: formatTick(sec) });
  }

  return { pxPerSecond, contentWidth, tickEverySec, ticks };
}
