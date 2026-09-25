import { useRef, type KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { ambientApi } from '../../lib/ambientApi';
import { formatLength, renderEstimateMinutes } from '../../lib/ambientLength';
import type { AmbientMotion, AmbientProject } from '../../lib/ambientTypes';
import { fieldLabelCls, panelCls } from '../story/formStyles';

export interface AmbientMotionPanelProps {
  project: AmbientProject;
  locked: boolean;
  refresh: () => void;
}

const CHOICES: ReadonlyArray<{ id: AmbientMotion; label: string; hint: string }> = [
  { id: 'still', label: 'Still', hint: 'The pictures hold perfectly still.' },
  {
    id: 'drift',
    label: 'Gentle drift',
    hint: 'Each picture eases slowly in and back out, about once a minute, so a long video never looks frozen.',
  },
];

/** Still pictures or a slow breathing zoom, with what each costs to render. */
export function AmbientMotionPanel({ project, locked, refresh }: AmbientMotionPanelProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const choose = async (motion: AmbientMotion) => {
    if (motion === project.motion) return;
    try {
      await ambientApi.setMotion(project.projectId, motion);
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to change the motion');
    }
  };

  // A radio group is one tab stop; the arrow keys move the choice.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + CHOICES.length) % CHOICES.length;
    buttons.current[next]?.focus();
    void choose(CHOICES[next].id);
  };
  const tabStop = Math.max(0, CHOICES.findIndex((c) => c.id === project.motion));

  return (
    <div className={`${panelCls} space-y-2`}>
      <div id="ambient-motion-label" className={fieldLabelCls}>Motion</div>
      <div role="radiogroup" aria-labelledby="ambient-motion-label" className="grid gap-2 sm:grid-cols-2">
        {CHOICES.map((c, i) => {
          const checked = project.motion === c.id;
          const hintId = `ambient-motion-${c.id}-hint`;
          const ready = formatLength(renderEstimateMinutes(project.targetSec, c.id));
          return (
            <button
              key={c.id}
              ref={(el) => { buttons.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-describedby={hintId}
              tabIndex={i === tabStop ? 0 : -1}
              onKeyDown={(e) => onKeyDown(e, i)}
              disabled={locked}
              onClick={() => choose(c.id)}
              className={`min-h-[44px] rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                checked
                  ? 'border-bf-goldDeep bg-[rgba(216,184,120,0.12)] text-bf-cream'
                  : 'border-[rgba(216,184,120,0.22)] text-bf-sub hover:border-bf-goldDeep'
              }`}
            >
              <span className="block text-sm font-medium">{c.label}</span>
              <span id={hintId} className="mt-0.5 block text-xs text-bf-sub">
                {c.hint} Ready in roughly {ready}.
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
