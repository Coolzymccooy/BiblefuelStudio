import type { AmbientCaptionSpan, AmbientCaptionPosition } from '../../lib/ambientTypes';
import { fieldLabelCls, panelCls, segmentCls, segmentedCls } from '../story/formStyles';

export interface AmbientScripturePatch {
  captions?: 'none' | 'static';
  captionSpan?: AmbientCaptionSpan;
  captionPosition?: AmbientCaptionPosition;
}

export interface AmbientCaptionsPanelProps {
  value: { captions?: string; captionSpan?: AmbientCaptionSpan; captionPosition?: AmbientCaptionPosition };
  onChange: (patch: AmbientScripturePatch) => void;
  busy: boolean;
}

type Choice = 'off' | AmbientCaptionSpan;

const CHOICES: Array<{ id: Choice; label: string; hint: string }> = [
  { id: 'off', label: 'Off', hint: 'Music and pictures only.' },
  { id: 'spoken', label: 'While spoken', hint: 'Each verse shows for the few seconds it is read.' },
  { id: 'section', label: 'Whole section', hint: 'Each verse stays up for as long as its picture does, fading with it.' },
];

/**
 * What the ambient render actually does with text — and nothing else.
 *
 * This replaces Story's caption panel, whose motion, stagger, word highlight
 * and animation settings the ambient renderer never read: four controls that
 * changed nothing. Two questions remain: how long a verse stays up, and where.
 */
export function AmbientCaptionsPanel({ value, onChange, busy }: AmbientCaptionsPanelProps) {
  const on = Boolean(value.captions) && value.captions !== 'none';
  // Saved before the choice existed: those render while-spoken, so say that.
  const current: Choice = on ? (value.captionSpan ?? 'spoken') : 'off';
  const position: AmbientCaptionPosition = value.captionPosition ?? 'lower';

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
