import type { ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import type { StoryAspect } from '../../lib/storyTypes';

/**
 * Output frame for a Story video: the same three choices, labels and wording
 * as the Render tab's Output frame, so the two screens read alike.
 *
 * A picture of another shape than the frame (an uploaded landscape clip in a
 * portrait video) is shown whole over a blurred fill when rendered, never
 * cropped, so the frame can be chosen for where the video is going.
 */

export interface StoryOutputFramePanelProps {
  value: StoryAspect | undefined;
  onChange: (next: StoryAspect) => void;
  busy?: boolean;
}

export function StoryOutputFramePanel({ value, onChange, busy = false }: StoryOutputFramePanelProps) {
  return (
    <Field
      label="Output frame"
      htmlFor="story-output-frame"
      tooltip="Aspect ratio of the output video. A picture of another shape is shown whole over a blurred fill, never cropped."
    >
      <Select
        id="story-output-frame"
        value={value ?? 'portrait'}
        disabled={busy}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as StoryAspect)}
      >
        <option value="portrait">Portrait (9:16)</option>
        <option value="landscape">Landscape (16:9)</option>
        <option value="square">Square (1:1)</option>
      </Select>
    </Field>
  );
}
