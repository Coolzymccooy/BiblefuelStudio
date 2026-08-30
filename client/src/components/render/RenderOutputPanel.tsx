import type { ChangeEvent } from 'react';
import { Select } from '../ui/Select';
import { Field } from '../ui/Field';

/**
 * Output frame, duration and caption width for the Render screen.
 *
 * Extracted from RenderPage so the editor shell and the classic layout render
 * the SAME controls. Props-driven: the page owns the state, this owns only the
 * presentation, so the two layouts cannot drift apart.
 */

export type RenderAspect = 'portrait' | 'landscape' | 'square';

export interface RenderOutputPanelProps {
  aspect: RenderAspect | string;
  onAspectChange: (next: string) => void;
  durationSec: number;
  onDurationChange: (next: number) => void;
  captionWidth: number;
  onCaptionWidthChange: (next: number) => void;
  /** True once the duration crosses the threshold that queues the render. */
  isLongRender: boolean;
}

export function RenderOutputPanel({
  aspect,
  onAspectChange,
  durationSec,
  onDurationChange,
  captionWidth,
  onCaptionWidthChange,
  isLongRender,
}: RenderOutputPanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Output frame"
          tooltip="Aspect ratio of the output video. Captions auto-wrap to the selected frame."
        >
          <Select
            value={aspect}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onAspectChange(e.target.value)}
          >
            <option value="portrait">Portrait (9:16)</option>
            <option value="landscape">Landscape (16:9)</option>
            <option value="square">Square (1:1)</option>
          </Select>
        </Field>

        <Field label="Duration">
          <Select
            value={String(durationSec)}
            // Number, not the select's string: the render payload does
            // arithmetic on this and a string would concatenate.
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onDurationChange(Number(e.target.value))}
          >
            <option value="20">20s (default)</option>
            <option value="60">60s</option>
            <option value="120">120s</option>
            <option value="180">180s</option>
          </Select>
          {isLongRender && (
            <div className="mt-2 text-[0.6875rem] text-content-secondary bg-white/[0.04] border border-white/10 rounded-md px-2 py-1 inline-block">
              Long renders run in the background
            </div>
          )}
        </Field>
      </div>

      <Field
        label={`Caption width (${captionWidth}%)`}
        tooltip="Width of the caption block relative to the frame. Lower values add more padding around the text and force tighter line wrapping."
      >
        <input
          type="range"
          aria-label="Caption width"
          min="60"
          max="100"
          step="2"
          value={captionWidth}
          onChange={(e) => onCaptionWidthChange(Number(e.target.value))}
          className="w-full accent-primary-500"
        />
      </Field>
    </div>
  );
}
