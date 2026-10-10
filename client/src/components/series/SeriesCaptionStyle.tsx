import { useEffect, useState, type ChangeEvent } from 'react';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { StudioLookOptions, StudioEffectsControls } from '../captions/StudioEffects';
import { isStudioLook, type CaptionEnergy, type StudioOption } from '../../lib/studioCaptions';

export interface SeriesCaptionStyleProps {
  /** '' = the series default (scripture emphasis), else a Studio look id. */
  value: string;
  onChange: (next: string) => void;
  energy: CaptionEnergy;
  onEnergyChange: (next: CaptionEnergy) => void;
}

/**
 * Caption style for a Series. Every part is scripture, so the default stays
 * the scripture style; a Studio look swaps in the kinetic engine. There is no
 * Shuffle: each part is rendered with its own mix of effects.
 */
export function SeriesCaptionStyle({ value, onChange, energy, onEnergyChange }: SeriesCaptionStyleProps) {
  const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
  const [energies, setEnergies] = useState<StudioOption[]>([]);
  const [libass, setLibass] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<{ ok: boolean; studioLooks?: StudioOption[]; energies?: StudioOption[]; libass?: boolean }>('/api/tts/animations');
      if (cancelled || !res.ok) return; // Optional: the default style still works.
      setStudioLooks(res.data?.studioLooks ?? []);
      setEnergies(res.data?.energies ?? []);
      setLibass(res.data?.libass !== false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption">Caption style</span>
      <Select aria-label="Caption style" value={value} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
        <option value="">Scripture (default)</option>
        <StudioLookOptions looks={studioLooks} libass={libass} value={value} />
      </Select>
      {isStudioLook(value) && (
        <StudioEffectsControls look={value} energy={energy} energies={energies} onEnergyChange={onEnergyChange} unavailable={!libass} />
      )}
    </div>
  );
}
