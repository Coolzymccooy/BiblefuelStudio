import { Fragment } from 'react';
import { Check } from 'lucide-react';
import type { StoryProject, StoryStatus } from '../../lib/storyTypes';

type StepState = 'done' | 'active' | 'todo';

const STEP_LABELS = ['Source', 'Analyze', 'Scenes', 'Images', 'Render'] as const;

// How far the pipeline has progressed, so a step past the current one reads as done.
const RANK: Record<StoryStatus, number> = {
    draft: 0,
    transcribing: 1,
    segmenting: 2,
    generating_images: 3,
    ready_to_render: 4,
    rendering: 5,
    done: 6,
    error: 0,
};

/**
 * Maps the project's status + scenes onto the five visible stages. `active` is
 * the stage currently running; earlier stages are `done`, later ones `todo`.
 */
function computeStates(project: StoryProject): StepState[] {
    const s = project.status;
    const rank = RANK[s] ?? 0;
    const hasScenes = project.scenes.length > 0;
    const imagesDone = hasScenes && project.scenes.every((sc) => sc.imageStatus === 'done');

    const pick = (activeWhen: boolean, doneWhen: boolean): StepState =>
        activeWhen ? 'active' : doneWhen ? 'done' : 'todo';

    return [
        'done', // Source — a project only exists once its audio is in
        pick(s === 'transcribing', rank > 1),
        pick(s === 'segmenting', hasScenes),
        pick(s === 'generating_images', imagesDone),
        pick(s === 'rendering', s === 'done'),
    ];
}

export function StoryStepper({ project }: { project: StoryProject }) {
    const states = computeStates(project);

    return (
        <div className="flex items-start">
            {STEP_LABELS.map((label, i) => {
                const state = states[i];
                const num = i + 1;
                return (
                    <Fragment key={label}>
                        <div className="flex flex-col items-center gap-2">
                            <span
                                className={`relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
                                    state === 'done'
                                        ? 'bg-[rgba(111,207,151,0.14)] text-bf-success ring-1 ring-[rgba(111,207,151,0.5)]'
                                        : state === 'active'
                                            ? 'bg-[rgba(216,184,120,0.10)] text-bf-gold ring-1 ring-bf-gold animate-bfpulse'
                                            : 'text-bf-faint ring-1 ring-[rgba(216,184,120,0.18)]'
                                }`}
                            >
                                {state === 'done' ? <Check size={15} strokeWidth={3} /> : num}
                            </span>
                            <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${
                                state === 'done' ? 'text-bf-success' : state === 'active' ? 'text-bf-gold' : 'text-bf-faint'
                            }`}>
                                {label}
                            </span>
                        </div>
                        {i < STEP_LABELS.length - 1 && (
                            <div className={`mt-[15px] h-px flex-1 ${states[i] === 'done' ? 'bg-[rgba(111,207,151,0.4)]' : 'bg-[rgba(216,184,120,0.14)]'}`} />
                        )}
                    </Fragment>
                );
            })}
        </div>
    );
}
