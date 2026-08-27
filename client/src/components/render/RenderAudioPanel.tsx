import { Scissors } from 'lucide-react';
import { Input } from '../ui/Input';
import { Field } from '../ui/Field';
import { MusicPicker } from '../MusicPicker';

/**
 * Voice track + music bed for the Render screen.
 *
 * Extracted from RenderPage so the editor shell and the classic layout render
 * the SAME controls. Props-driven: the page keeps the state.
 */

export interface AudioHistoryItem {
  id: string;
  path: string;
  kind: string;
}

export interface RenderAudioPanelProps {
  audioPath: string;
  onAudioPathChange: (next: string) => void;
  /** Recent takes, offered as one-tap shortcuts. */
  audioHistory?: AudioHistoryItem[];
  onTrim: (path: string) => void;
  musicPath: string;
  musicVolume: number;
  autoDuck: boolean;
  onMusicChange: (next: { path: string; volume: number; autoDuck: boolean }) => void;
}

export function RenderAudioPanel({
  audioPath,
  onAudioPathChange,
  audioHistory = [],
  onTrim,
  musicPath,
  musicVolume,
  autoDuck,
  onMusicChange,
}: RenderAudioPanelProps) {
  return (
    <div className="space-y-4">
      <Field
        label="Voice track"
        badge="Required for waveform"
        tooltip="Your narration track. Generate one in Voice & Audio, or upload your own. Required for waveform videos; optional when you supply a background video."
      >
        <Input
          value={audioPath}
          onChange={(e) => onAudioPathChange(e.target.value)}
          placeholder="Pick a narration track or generate one in Voice & Audio"
          className="bg-black/20"
        />
        {audioPath.trim() && (
          <button
            type="button"
            onClick={() => onTrim(audioPath.trim())}
            className="mt-2 inline-flex items-center gap-1.5 text-[0.6875rem] px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
          >
            <Scissors size={12} /> Trim
          </button>
        )}
        {audioHistory.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {audioHistory.slice(0, 4).map((item) => (
              <button
                key={item.id}
                onClick={() => onAudioPathChange(item.path)}
                className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-white/[0.06] text-gray-300 hover:bg-white/[0.12] hover:text-white transition-colors"
              >
                {item.kind}
              </button>
            ))}
          </div>
        )}
      </Field>

      {/* aria-label so the control is identifiable - to the inventory, and to
          anyone using a screen reader. */}
      <div role="group" aria-label="Music bed">
      <MusicPicker
        aria-label="Music bed"
        value={{ path: musicPath || null, volume: musicVolume, autoDuck }}
        onChange={(m) => onMusicChange({
          path: m.path || '',
          volume: m.volume,
          autoDuck: m.autoDuck ?? true,
        })}
        busy={false}
      />
      </div>
    </div>
  );
}
