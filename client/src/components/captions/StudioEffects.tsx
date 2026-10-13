import { useEffect, useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { mixFor, recordShuffle, type ShuffleSeed } from '../../lib/shuffleMixes';
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
  /** The caller's saved caption seed. Shuffle feedback appears once this changes. */
  seed?: ShuffleSeed;
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
/** How long a Shuffle waits for the saved seed to change before giving up quietly. */
const SHUFFLE_PENDING_MS = 8000;

/** Shown once a Studio look is picked: its sample clip, Energy, and Shuffle. */
export function StudioEffectsControls({
  look, energy, seed, energies, onEnergyChange, onShuffle, disabled = false, unavailable = false,
}: StudioEffectsControlsProps) {
  // A look whose sample clip failed to load: hide the player rather than show a broken one.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  // Shuffle feedback follows the saved seed, not the click: a press is "pending" until
  // the caller's seed changes, and is dropped quietly if it never does (the page toasts the error).
  const [pending, setPending] = useState<{ look: string; seed: ShuffleSeed } | null>(null);
  const [tick, setTick] = useState<{ look: string } | null>(null);
  const activePending = pending && pending.look === look ? pending : null;
  if (activePending && !Object.is(seed, activePending.seed)) {
    // The seed moved, so the shuffle was saved. Recording is idempotent, so a repeated render is safe.
    recordShuffle(look, activePending.seed, seed);
    setPending(null);
    setTick({ look });
  }
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), SHUFFLE_PENDING_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (!tick) return;
    const timer = setTimeout(() => setTick(null), SHUFFLE_TICK_MS);
    return () => clearTimeout(timer);
  }, [tick]);
  const ticked = tick?.look === look;
  const mix = mixFor(look, seed);
  const handleShuffle = () => {
    onShuffle?.();
    setPending({ look, seed });
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
              {activePending ? 'Shuffling…' : ticked ? '✓ Shuffled' : 'Shuffle effects'}
            </button>
          )}
        </div>
      </Field>
      {mix > 1 && (
        <p role="status" aria-live="polite" className="text-xs text-content-secondary">
          New effect mix (mix {mix}) — you'll see it on your next render.
        </p>
      )}
    </>
  );
}
