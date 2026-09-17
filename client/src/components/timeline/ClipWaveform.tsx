import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

/**
 * The peak trace inside an audio clip.
 *
 * Drawn to a canvas from peaks JSON rather than shown as a server-rendered
 * PNG, for two reasons: zoom costs nothing (a raster would need re-fetching
 * at every step of F2, and a stretched one looks wrong), and the trace takes
 * its colour from `currentColor` — so it is the lane's own ink and follows the
 * theme without a second request.
 *
 * A clip with no waveform is not an error state: it degrades to the flat clip
 * it was before, silently.
 */

type Peaks = [number, number][];

/** In-memory, per asset path. The disk cache is server-side; this avoids a
 *  refetch when the same asset appears in several clips or the lane rerenders. */
const cache = new Map<string, Peaks>();
const inflight = new Map<string, Promise<Peaks | null>>();

async function fetchPeaks(assetPath: string): Promise<Peaks | null> {
  const hit = cache.get(assetPath);
  if (hit) return hit;

  const running = inflight.get(assetPath);
  if (running) return running;

  const request = (async () => {
    try {
      const res = await api.get<{ ok: boolean; peaks: Peaks }>(
        `/api/timeline/peaks?path=${encodeURIComponent(assetPath)}`,
      );
      const peaks = res.ok && res.data?.ok ? res.data.peaks : null;
      if (peaks) cache.set(assetPath, peaks);
      return peaks;
    } catch {
      return null; // never block the clip on a waveform
    } finally {
      inflight.delete(assetPath);
    }
  })();

  inflight.set(assetPath, request);
  return request;
}

interface ClipWaveformProps {
  assetPath: string;
  className?: string;
}

export function ClipWaveform({ assetPath, className }: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(() => cache.get(assetPath) ?? null);

  useEffect(() => {
    let alive = true;
    const cached = cache.get(assetPath);
    if (cached) { setPeaks(cached); return; }
    setPeaks(null);
    fetchPeaks(assetPath).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [assetPath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0) return;

    // Draw at device resolution: a 1x canvas upscaled on a retina screen
    // makes the trace look like a smear.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // currentColor, so the trace IS the lane's ink and follows the theme.
    ctx.fillStyle = getComputedStyle(canvas).color;

    const mid = h / 2;
    // One column per pixel: sampling the peaks to the available width rather
    // than drawing all 1024 keeps a narrow clip from turning into a solid bar.
    for (let x = 0; x < w; x += 1) {
      const idx = Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length));
      const [min, max] = peaks[idx];
      const top = mid - Math.max(0, max) * mid;
      const bottom = mid - Math.min(0, min) * mid;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks]);

  // Nothing yet, or nothing available: the clip stays exactly as it was.
  if (!peaks) return null;

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
