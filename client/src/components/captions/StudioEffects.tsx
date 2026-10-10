import { useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { FALLBACK_ENERGIES, isStudioLook, readableLook, type CaptionEnergy, type StudioOption } from '../../lib/studioCaptions';

/**
 * Studio effects controls shared by every caption picker (Story, Render,
 * Sermon clip, Series), so they cannot drift apart.
 */

export interface StudioLookOptionsProps {
  looks: StudioOption[];
  /** False when the server's ffmpeg has no libass: looks are listed but disabled. */
  libass: boolean;
  /** The current selection; a saved Studio look stays selectable before the catalogue loads. */
  value?: string;
}

/** The "Studio effects" group for a caption-style <select>. */
export function StudioLookOptions({ looks, libass, value }: StudioLookOptionsProps) {
  const savedMissing = isStudioLook(value) && !looks.some((l) => l.id === value);
  if (looks.length === 0 && !savedMissing) return null;
  return (
    <optgroup label="Studio effects">
      {savedMissing && <option value={value}>{readableLook(value!)}</option>}
      {looks.map((l) => (
        <option key={l.id} value={l.id} disabled={!libass}>
          {l.label}{libass ? '' : ' (unavailable on this server)'}
        </option>
      ))}
    </optgroup>
  );
}

export interface StudioEffectsControlsProps {
  /** The chosen Studio look id, e.g. "studio-lagos-night". */
  look: string;
  energy: string;
  /** The server's energy list; falls back to Calm / Lively / Wild. */
  energies?: StudioOption[];
  onEnergyChange: (next: CaptionEnergy) => void;
  /** Re-roll which effect each line gets. Omit where every render is shuffled anyway. */
  onShuffle?: () => void;
  disabled?: boolean;
}

/** Shown once a Studio look is picked: its sample clip, Energy, and Shuffle. */
export function StudioEffectsControls({ look, energy, energies, onEnergyChange, onShuffle, disabled = false }: StudioEffectsControlsProps) {
  // A look whose sample clip failed to load: hide the player rather than show a broken one.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const options = energies && energies.length > 0 ? energies : FALLBACK_ENERGIES;
  return (
    <>
      {failedPreview !== look && (
        <video
          key={look}
          src={`/studio-looks/${look.replace(/^studio-/, '')}.mp4`}
          autoPlay
          muted
          loop
          playsInline
          aria-label="Studio look sample"
          onError={() => setFailedPreview(look)}
          className="w-full max-w-xs rounded-lg border border-white/10"
        />
      )}
      <Field
        label="Energy"
        tooltip="How wild the effects get. Calm pops and stacks words; Lively adds big brush slams on lines that repeat; Wild slams everywhere, made for songs."
      >
        <div className="flex items-center gap-2">
          <Select
            aria-label="Energy"
            value={energy}
            disabled={disabled}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onEnergyChange(e.target.value as CaptionEnergy)}
          >
            {options.map((en) => (
              <option key={en.id} value={en.id}>{en.label}</option>
            ))}
          </Select>
          {onShuffle && (
            <button
              type="button"
              onClick={onShuffle}
              disabled={disabled}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-2.5 text-xs text-content-secondary hover:text-bf-cream disabled:opacity-50"
              title="Re-roll which effect each line gets"
            >
              Shuffle effects
            </button>
          )}
        </div>
      </Field>
    </>
  );
}
