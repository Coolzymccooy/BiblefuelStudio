import { useEffect, useRef } from 'react';
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
}

const ASPECT_CLASS: Record<string, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
};

export function LivePreviewStage({
  project,
  backgrounds,
  captionLines = [],
  timeSec,
  onTimeChange,
  aspect = '16:9',
}: LivePreviewStageProps) {
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

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

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div
        className={`stage-ground relative w-full max-w-3xl overflow-hidden rounded-lg ${ASPECT_CLASS[aspect]}`}
        style={gradeFilter ? { filter: gradeFilter } : undefined}
        data-testid="live-preview-canvas"
      >
        {frame.isEmpty ? (
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
          <div className="absolute inset-x-0 bottom-0 p-4 text-center">
            <span className="inline-block rounded bg-black/60 px-2 py-1 text-sm font-semibold text-white">
              {frame.caption}
            </span>
          </div>
        )}
      </div>

      <div className="flex w-full max-w-3xl items-center gap-2">
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
      <p className="text-[10px] text-editor-faint">
        Live preview · approximate. Transitions and glow appear in the render.
      </p>
    </div>
  );
}
