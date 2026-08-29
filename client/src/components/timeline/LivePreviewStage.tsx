import { useEffect, useRef, useState } from 'react';
import { CaptionPreview, type CaptionStyle } from './CaptionPreview';
import type { TimelineProject } from '../../lib/timelineProject';
import {
  resolvePreviewFrame,
  GRADE_CSS,
  type PreviewBackground,
} from '../../lib/livePreview';
import { api } from '../../lib/api';

/**
 * Live preview of the cut, composited in the browser.
 *
 * Before this, the stage showed "Preview appears here after a render" until
 * ffmpeg produced a file — so adding a clip, background or caption changed
 * nothing on screen and the operator was editing blind.
 *
 * This is an APPROXIMATION and says so in the UI. Transitions, glow and light
 * leaks are ffmpeg's job; what this shows is the right clip, background,
 * caption and colour look at a moment in time — enough to judge the cut.
 */

export interface LivePreviewStageProps {
  project: TimelineProject | null;
  backgrounds: PreviewBackground[];
  captionLines?: string[];
  /** Playhead position, seconds. */
  timeSec: number;
  onTimeChange: (sec: number) => void;
  aspect?: '16:9' | '9:16' | '1:1';
  /** How captions LOOK (preset / motion / highlight / layout) - previewed live. */
  captionStyle?: CaptionStyle;
}

// Width / height of each frame. The canvas is sized in JS to FIT the stage
// area on both axes: a Tailwind aspect class alone let the flex column
// squash a 1:1 or 9:16 frame back into a wide box (measured 720x409 for
// every frame), so Square and Portrait never looked square or portrait.
const ASPECT_RATIO: Record<string, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
};
// Slider row + note under the canvas.
const CONTROLS_PX = typeof window !== 'undefined' && window.matchMedia?.('(max-height: 500px)').matches ? 34 : 56;

export function LivePreviewStage({
  project,
  backgrounds,
  captionLines = [],
  timeSec,
  onTimeChange,
  aspect = '16:9',
  captionStyle,
}: LivePreviewStageProps) {
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostBox, setHostBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = hostRef.current?.parentElement ?? hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setHostBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [Boolean(project)]);
  const ratio = ASPECT_RATIO[aspect] ?? 16 / 9;
  // Fit: as wide as the host allows, unless the height would not fit - then
  // the height rules and the width follows the ratio.
  // Phones: the canvas takes the full width the stage band offers and the
  // height follows the frame - the previous fit left dead margins left and
  // right on a 390px screen (the operator marked them in red).
  const fitWidth = hostBox.w > 0
    ? Math.max(120, Math.min(hostBox.w, Math.max(120, hostBox.h - CONTROLS_PX) * ratio))
    : undefined;

  const totalSec = Math.max(1, project?.targetDurationSec ?? 60);
  const frame = project
    ? resolvePreviewFrame(project, {
        timeSec, backgrounds, captionLines, totalSec,
        // Stored paths are often bare storage keys (`uploads/bg.jpg`), which a
        // browser cannot load - that is what produced the broken image.
        resolveUrl: (p) => api.mediaUrl(p),
      })
    : { layers: [], isEmpty: true, caption: undefined, grade: undefined };

  // Seek each video layer to its offset. Done in an effect, not during render:
  // setting currentTime is a side effect on a DOM node.
  useEffect(() => {
    for (const layer of frame.layers) {
      if (layer.kind !== 'video') continue;
      const el = videoRefs.current[layer.key];
      if (!el) continue;
      // Only seek on a real difference — assigning currentTime every frame
      // restarts decoding and makes the preview stutter.
      if (Math.abs(el.currentTime - layer.seekSec) > 0.25) {
        try { el.currentTime = layer.seekSec; } catch { /* not seekable yet */ }
      }
    }
  }, [frame.layers]);

  if (!project) {
    return (
      <p className="text-[12px] text-editor-faint">Create a documentary timeline first.</p>
    );
  }

  const gradeFilter = frame.grade ? GRADE_CSS[frame.grade] : undefined;
  const lineCount = (captionLines || []).length;
  const slot = lineCount > 0 ? Math.max(1, totalSec) / lineCount : 1;
  const captionProgress = lineCount > 0 ? (timeSec % slot) / slot : 0;

  return (
    <div ref={hostRef} className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div
        className="stage-ground relative max-w-full shrink-0 overflow-hidden rounded-lg"
        style={{ aspectRatio: String(ratio), width: fitWidth ?? '100%', ...(gradeFilter ? { filter: gradeFilter } : undefined) }}
        data-testid="live-preview-canvas"
      >
        {frame.isEmpty && !frame.caption ? (
          <div className="absolute inset-0 grid place-items-center px-4 text-center">
            <p className="text-[12px] text-editor-faint">
              Add media, a background or captions — they appear here as you build.
            </p>
          </div>
        ) : (
          frame.layers.map((layer) =>
            layer.kind === 'image' ? (
              <img
                key={layer.key}
                src={layer.src}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <video
                key={layer.key}
                ref={(el) => { videoRefs.current[layer.key] = el; }}
                src={layer.src}
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ),
          )
        )}

        {frame.caption && (
          <CaptionPreview text={frame.caption} style={captionStyle} progress={captionProgress} />
        )}
      </div>

      <div className="flex items-center gap-2" style={{ width: fitWidth ?? '100%' }}>
        <input
          type="range"
          min={0}
          max={totalSec}
          step={0.5}
          value={Math.min(timeSec, totalSec)}
          onChange={(e) => onTimeChange(Number(e.target.value))}
          aria-label="Preview playhead"
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-primary-400"
        />
        <span className="w-20 text-right text-[11px] tabular-nums text-editor-faint">
          {Math.floor(timeSec / 60)}:{String(Math.floor(timeSec % 60)).padStart(2, '0')} / {Math.floor(totalSec / 60)}:{String(Math.floor(totalSec % 60)).padStart(2, '0')}
        </span>
      </div>

      {/* Honest about what this is. The render is the source of truth. */}
      <p className="text-[10px] text-editor-faint short:hidden">
        Live preview · approximate. Transitions and glow appear in the render.
      </p>
    </div>
  );
}
