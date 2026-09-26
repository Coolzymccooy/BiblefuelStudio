import { useState } from 'react';
import { LENGTH_PRESETS, lengthSummary } from '../../lib/ambientLength';
import { fieldLabelCls } from '../story/formStyles';

export interface AmbientLengthFieldProps {
  /** Minutes, as the string the form holds. */
  minutes: string;
  onChange: (minutes: string) => void;
}

const chipCls = (active: boolean): string =>
  `rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? 'border-bf-gold bg-bf-gold text-bf-bg shadow-sm'
      : 'border-[rgba(216,184,120,0.22)] bg-bf-card2/70 text-bf-sub hover:text-bf-cream'
  }`;

/**
 * Presets plus a live plain-English line, in place of a bare minutes box.
 *
 * The line is always on screen rather than in a tooltip: a tooltip needs a
 * hover the phone does not have, and it hides the one thing worth knowing.
 */
export function AmbientLengthField({ minutes, onChange }: AmbientLengthFieldProps) {
  const isPreset = LENGTH_PRESETS.some((p) => String(p.minutes) === minutes);
  const [custom, setCustom] = useState(!isPreset);
  const summary = lengthSummary(Number(minutes));

  return (
    <div>
      <div className={fieldLabelCls}>How long should it play?</div>
      <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Length">
        {LENGTH_PRESETS.map((p) => {
          const active = !custom && String(p.minutes) === minutes;
          return (
            <button
              key={p.minutes}
              type="button"
              aria-pressed={active}
              onClick={() => { setCustom(false); onChange(String(p.minutes)); }}
              className={chipCls(active)}
            >
              {p.label}
              {p.hint && <span className="ml-1.5 text-[11px] font-normal opacity-75">{p.hint}</span>}
            </button>
          );
        })}
        <button type="button" aria-pressed={custom} onClick={() => setCustom(true)} className={chipCls(custom)}>
          Custom
        </button>
      </div>

      {custom && (
        <label className="mt-2 flex items-center gap-2 text-sm text-content-secondary">
          <input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Custom length in minutes"
            className="input w-28"
          />
          minutes
        </label>
      )}

      {summary && (
        <p className="mt-2 text-sm text-content-tertiary" aria-live="polite">{summary}</p>
      )}
    </div>
  );
}
