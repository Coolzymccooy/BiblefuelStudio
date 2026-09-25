import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeScale, type Scale } from './timelineScale';

/**
 * Measures the lane container and turns it into a timeline Scale.
 *
 * computeScale() owns the arithmetic and is tested on its own; this hook owns
 * only the measurement — which is the part that has to survive a first paint
 * with no layout yet, a user dragging the strip taller, and an environment
 * with no ResizeObserver at all.
 */

export interface UseTimelineScaleInput {
  durationSec: number;
  zoom: number;
}

export interface UseTimelineScaleResult {
  /** Attach to the element whose width defines "the whole project fits". */
  ref: React.RefObject<HTMLDivElement | null>;
  scale: Scale;
  /** Measured width, or 0 before the first measurement. */
  containerWidth: number;
}

export function useTimelineScale({ durationSec, zoom }: UseTimelineScaleInput): UseTimelineScaleResult {
  const ref = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Width only ever comes from here, so the ruler and the lanes cannot end up
  // measuring different things — the drift this module exists to prevent.
  const measure = useCallback((width: number) => {
    setContainerWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Measure once immediately: the observer fires asynchronously, and on a
    // fast paint the first frame would otherwise show the fallback width.
    measure(el.getBoundingClientRect().width);

    // Older Safari and the SSR path have no ResizeObserver. The timeline still
    // renders — it just keeps the width it measured above.
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const scale = useMemo(
    () => computeScale({ durationSec, containerWidth, zoom }),
    [durationSec, containerWidth, zoom],
  );

  return { ref, scale, containerWidth };
}
