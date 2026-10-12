import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { FALLBACK_ENERGIES, isStudioLook, lookSlug, readableLook, type CaptionEnergy, type StudioOption } from '../../lib/studioCaptions';

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
  /**
   * The server's ffmpeg has no libass: Energy and Shuffle are disabled and a
   * line says renders use the look's standard style. The sample still plays.
   */
  unavailable?: boolean;
}

const STUDIO_UNAVAILABLE_TEXT = "Studio effects unavailable on this server — renders use the look's standard style.";
/** How long the Shuffle button shows its tick before going back to its label. */
const SHUFFLE_TICK_MS = 1200;

/** Shown once a Studio look is picked: its sample clip, Energy, and Shuffle. */
export function StudioEffectsControls({
  look, energy, energies, onEnergyChange, onShuffle, disabled = false, unavailable = false,
}: StudioEffectsControlsProps) {
  // A look whose sample clip failed to load: hide the player rather than show a broken one.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  // Shuffle feedback, both keyed to the look so a different look starts afresh.
  const [shuffle, setShuffle] = useState({ look, presses: 0 });
  const [tickedLook, setTickedLook] = useState<string | null>(null);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (tickTimer.current) clearTimeout(tickTimer.current);
  }, []);
  const presses = shuffle.look === look ? shuffle.presses : 0;
  const ticked = tickedLook === look;
  const handleShuffle = () => {
    onShuffle?.();
    setShuffle({ look, presses: presses + 1 });
    setTickedLook(look);
    if (tickTimer.current) clearTimeout(tickTimer.current);
    tickTimer.current = setTimeout(() => setTickedLook(null), SHUFFLE_TICK_MS);
  };
  const options = energies && energies.length > 0 ? energies : FALLBACK_ENERGIES;
  const off = disabled || unavailable;
  return (
    <>
      {failedPreview !== look && (
        <video
          key={look}
          src={`/studio-looks/${lookSlug(look)}.mp4`}
          autoPlay
          muted
          loop
          playsInline
          aria-label="Studio look sample"
          onError={() => setFailedPreview(look)}
          className="w-full max-w-xs rounded-lg border border-white/10"
        />
      )}
      {unavailable && <p className="text-xs text-content-secondary">{STUDIO_UNAVAILABLE_TEXT}</p>}
      <Field
        label="Energy"
        tooltip="How wild the effects get. Calm pops and stacks words; Lively adds big brush slams on lines that repeat; Wild slams everywhere, made for songs."
      >
        <div className="flex items-center gap-2">
          <Select
            aria-label="Energy"
            value={energy}
            disabled={off}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onEnergyChange(e.target.value as CaptionEnergy)}
          >
            {options.map((en) => (
              <option key={en.id} value={en.id}>{en.label}</option>
            ))}
          </Select>
          {onShuffle && (
            <button
              type="button"
              onClick={handleShuffle}
              disabled={off}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-2.5 text-xs text-content-secondary hover:text-bf-cream disabled:opacity-50"
              title="Re-roll which effect each line gets"
            >
              {ticked ? '✓ Shuffled' : 'Shuffle effects'}
            </button>
          )}
        </div>
      </Field>
      {presses > 0 && (
        // Mix 1 is the original, so the first press lands on mix 2.
        <p role="status" aria-live="polite" className="text-xs text-content-secondary">
          New effect mix (mix {presses + 1}) — you'll see it on your next render.
        </p>
      )}
    </>
  );
}
