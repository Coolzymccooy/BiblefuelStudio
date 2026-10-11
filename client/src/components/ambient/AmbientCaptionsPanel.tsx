import { useEffect, useState, type ChangeEvent } from 'react';
import type { AmbientCaptionSpan, AmbientCaptionPosition } from '../../lib/ambientTypes';
import { api } from '../../lib/api';
import { isStudioLook, nextSeed, normaliseEnergy, randomSeed, type StudioOption } from '../../lib/studioCaptions';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { StudioEffectsControls, StudioLookOptions } from '../captions/StudioEffects';
import { fieldLabelCls, panelCls, segmentCls, segmentedCls } from '../story/formStyles';

export interface AmbientScripturePatch {
  captions?: 'none' | 'static';
  captionSpan?: AmbientCaptionSpan;
  captionPosition?: AmbientCaptionPosition;
  /** 'default' is the classic serif; a `studio-*` id is a Studio look. */
  captionPreset?: string;
  captionEnergy?: string;
  captionSeed?: number;
}

export interface AmbientCaptionsPanelProps {
  value: {
    captions?: string;
    captionSpan?: AmbientCaptionSpan;
    captionPosition?: AmbientCaptionPosition;
    captionPreset?: string;
    captionEnergy?: string;
    captionSeed?: number;
  };
  onChange: (patch: AmbientScripturePatch) => void;
  busy: boolean;
}

type Choice = 'off' | AmbientCaptionSpan;

const CLASSIC = 'default';

const CHOICES: Array<{ id: Choice; label: string; hint: string }> = [
  { id: 'off', label: 'Off', hint: 'Music and pictures only.' },
  { id: 'spoken', label: 'While spoken', hint: 'Each verse shows for the few seconds it is read.' },
  { id: 'section', label: 'Whole section', hint: 'Scripture stays up for as long as its picture does — a passage one verse at a time, fading between them.' },
];

/**
 * What the ambient render actually does with text — and nothing else.
 *
 * This replaces Story's caption panel, whose motion, stagger, word highlight
 * and animation settings the ambient renderer never read: four controls that
 * changed nothing. What remains is what the renderer honours: how long a verse
 * stays up, the look (classic serif, or a Studio look with Energy and Shuffle),
 * and — for the classic serif only — where it sits. Studio looks place and
 * animate themselves, so Position gives way to Energy and Shuffle.
 */
export function AmbientCaptionsPanel({ value, onChange, busy }: AmbientCaptionsPanelProps) {
  const on = Boolean(value.captions) && value.captions !== 'none';
  // Saved before the choice existed: those render while-spoken, so say that.
  const current: Choice = on ? (value.captionSpan ?? 'spoken') : 'off';
  const position: AmbientCaptionPosition = value.captionPosition ?? 'lower';

  // The catalogue is optional: without it the saved look and the three
  // fallback energies still work. Its failure never blocks the panel.
  const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
  const [energies, setEnergies] = useState<StudioOption[]>([]);
  const [libass, setLibass] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<{ studioLooks?: StudioOption[]; energies?: StudioOption[]; libass?: boolean }>('/api/tts/animations');
      if (cancelled || !res.ok) return;
      setStudioLooks(res.data?.studioLooks ?? []);
      setEnergies(res.data?.energies ?? []);
      setLibass(res.data?.libass !== false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Any stored preset that is not a Studio look renders as the classic serif.
  const studio = isStudioLook(value.captionPreset);
  const shownLook = studio ? value.captionPreset! : CLASSIC;
  const chooseLook = (id: string) => {
    if (id === shownLook) return;
    // First Studio look on a project with no seed: pick one now, so the lines
    // keep the same effects from render to render until Shuffle is pressed.
    const needsSeed = isStudioLook(id) && value.captionSeed == null;
    onChange(needsSeed ? { captionPreset: id, captionSeed: randomSeed() } : { captionPreset: id });
  };

  const choose = (c: Choice) => {
    if (c === current) return;
    onChange(c === 'off' ? { captions: 'none' } : { captions: 'static', captionSpan: c });
  };

  return (
    <div className={`${panelCls} space-y-3`}>
      <div>
        <div className={fieldLabelCls}>Scripture on screen</div>
        <div className={`${segmentedCls} mt-1.5`} role="group" aria-label="Scripture on screen">
          {CHOICES.map((c) => (
            <button key={c.id} type="button" disabled={busy} aria-pressed={current === c.id}
              onClick={() => choose(c.id)} className={segmentCls(current === c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-content-tertiary">{CHOICES.find((c) => c.id === current)?.hint}</p>
      </div>

      {on && (
        <Field
          label="Caption look"
          tooltip="Classic serif is the plain scripture caption. Studio looks animate each line with brush hits, slams and pops."
        >
          <Select
            aria-label="Caption look"
            value={shownLook}
            disabled={busy}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => chooseLook(e.target.value)}
          >
            <option value={CLASSIC}>Classic serif</option>
            <StudioLookOptions looks={studioLooks} libass={libass} value={value.captionPreset} />
          </Select>
        </Field>
      )}

      {on && studio && (
        <StudioEffectsControls
          look={value.captionPreset!}
          energy={normaliseEnergy(value.captionEnergy, 'calm')}
          energies={energies}
          onEnergyChange={(next) => onChange({ captionEnergy: next })}
          onShuffle={() => onChange({ captionSeed: nextSeed(value.captionSeed) })}
          disabled={busy}
          unavailable={!libass}
        />
      )}

      {on && !studio && (
        <div>
          <div className={fieldLabelCls}>Position</div>
          <div className={`${segmentedCls} mt-1.5`} role="group" aria-label="Position">
            {([['lower', 'Lower third'], ['centre', 'Centre']] as const).map(([id, label]) => (
              <button key={id} type="button" disabled={busy} aria-pressed={position === id}
                onClick={() => { if (position !== id) onChange({ captionPosition: id }); }}
                className={segmentCls(position === id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
