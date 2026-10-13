import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { LYRIC_STEPS, reachableSteps, type LyricStepId } from '../../lib/lyricSteps';
import type { LyricProject } from '../../lib/lyricVideoTypes';

const LABELS: Record<LyricStepId, string> = {
  song: 'Song', lyrics: 'Lyrics', timing: 'Timing', look: 'Look', render: 'Render',
};

interface Props { project: LyricProject; step: LyricStepId; onStep: (step: LyricStepId) => void }

/** The five steps across the top. A step is open once the one before it has made what it needs. */
export function LyricStepper({ project, step, onStep }: Props) {
  const reachable = reachableSteps(project);
  const current = LYRIC_STEPS.indexOf(step);
  return (
    <nav aria-label="Steps" className="flex items-start">
      {LYRIC_STEPS.map((id, i) => {
        const done = i < current && reachable[id];
        const active = id === step;
        return (
          <Fragment key={id}>
            <button
              type="button"
              disabled={!reachable[id]}
              aria-current={active ? 'step' : undefined}
              onClick={() => onStep(id)}
              className="flex flex-col items-center gap-2 disabled:cursor-not-allowed"
            >
              <span
                className={`relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
                  done
                    ? 'bg-[rgba(111,207,151,0.14)] text-bf-success ring-1 ring-[rgba(111,207,151,0.5)]'
                    : active
                      ? 'bg-[rgba(216,184,120,0.10)] text-bf-gold ring-1 ring-bf-gold'
                      : 'text-bf-faint ring-1 ring-[rgba(216,184,120,0.18)]'
                }`}
              >
                {done ? <Check size={15} strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${
                done ? 'text-bf-success' : active ? 'text-bf-gold' : 'text-bf-faint'
              }`}
              >
                {LABELS[id]}
              </span>
            </button>
            {i < LYRIC_STEPS.length - 1 && (
              <div className={`mt-[15px] h-px flex-1 ${done ? 'bg-[rgba(111,207,151,0.4)]' : 'bg-[rgba(216,184,120,0.14)]'}`} />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
