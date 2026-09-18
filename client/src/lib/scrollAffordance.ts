/**
 * "There is more this way" — the state behind a scroll hint.
 *
 * The editor's tool rail holds 12 tools. On a 800px-tall window only 6 fit,
 * and the rail scrolls silently: nothing on screen said the other six existed,
 * so Voice, Scenes, Backgrounds, Renders and Output were simply undiscoverable
 * for anyone who had not been told. This computes whether a hint belongs at
 * each end, for either axis.
 *
 * Pure, so the arithmetic is testable without a browser: the component feeds it
 * scroll metrics and renders from the result.
 */

export interface ScrollMetrics {
  /** scrollTop for a column, scrollLeft for a row. */
  scrollPos: number;
  /** clientHeight for a column, clientWidth for a row. */
  viewport: number;
  /** scrollHeight for a column, scrollWidth for a row. */
  content: number;
}

export interface ScrollAffordance {
  /** More content above (column) / to the left (row). */
  atStart: boolean;
  /** More content below (column) / to the right (row). */
  atEnd: boolean;
  /** Is the content longer than its viewport at all? */
  overflows: boolean;
}

/**
 * A pixel of slack. Sub-pixel layout means scrollPos rarely lands exactly on
 * the maximum, and a hint that never turns off at the bottom is worse than no
 * hint — it stops meaning anything.
 */
const EPSILON = 2;

export function scrollAffordance({ scrollPos, viewport, content }: ScrollMetrics): ScrollAffordance {
  const safePos = Number.isFinite(scrollPos) ? Math.max(0, scrollPos) : 0;
  const safeViewport = Number.isFinite(viewport) ? Math.max(0, viewport) : 0;
  const safeContent = Number.isFinite(content) ? Math.max(0, content) : 0;

  const overflows = safeContent > safeViewport + EPSILON;
  if (!overflows) return { atStart: false, atEnd: false, overflows: false };

  return {
    atStart: safePos > EPSILON,
    atEnd: safePos + safeViewport < safeContent - EPSILON,
    overflows: true,
  };
}

/**
 * How far one nudge of the hint should move things.
 *
 * Most of a viewport, never all of it: leaving a row or two on screen keeps
 * the reader's place, which a full-page jump destroys.
 */
export function scrollStep(viewport: number): number {
  const safe = Number.isFinite(viewport) ? Math.max(0, viewport) : 0;
  return Math.max(48, Math.round(safe * 0.8));
}
