/**
 * The cartoon journey's steps and which of them can be opened. A step opens
 * only once every step before it is satisfied, so the admin can never jump to
 * filming before the cast is approved. The rule reads only fields the server
 * already sends on the project view; it holds no state of its own.
 */
import type { CartoonProject } from '../../lib/cartoonTypes';
import { portraitReady } from './cast';

export type CartoonStepId = 'script' | 'cast' | 'style' | 'shots' | 'film' | 'finish';

export interface CartoonStepInfo {
  id: CartoonStepId;
  label: string;
  /** One sentence on what the step is for, shown under its heading. */
  summary: string;
}

export const CARTOON_STEPS: readonly CartoonStepInfo[] = [
  { id: 'script', label: 'Script', summary: 'Who speaks, what they say and where. Spoken exactly as written.' },
  { id: 'cast', label: 'Cast', summary: 'A look, a voice and an approved portrait for each character.' },
  { id: 'style', label: 'Style', summary: 'One art style for the whole film.' },
  { id: 'shots', label: 'Shots', summary: 'Every shot\'s line, note and length, approved in one go.' },
  { id: 'film', label: 'Film', summary: 'Order the clips. Each character speaks their own line.' },
  { id: 'finish', label: 'Finish', summary: 'Captions, music and the end card, then the finished film.' },
];

/** Whether a clip was ever ordered for any shot: then the lines are locked. Mirrors `isLocked` in server/src/lib/cartoon/edits.js. */
export function isLocked(project: Pick<CartoonProject, 'shots'> | null): boolean {
  return Boolean(project?.shots.some((s) => s.clip && (s.clip.taskId || s.clip.libraryId || s.clip.previous?.taskId)));
}

/** Where a saved cartoon lives in the app. */
export const cartoonPath = (id: string) => `/app/scene-script/cartoon/${encodeURIComponent(id)}`;

type StepFacts =Pick<CartoonProject, 'cast' | 'meta' | 'shots' | 'shotListApproved'>;

/** Whether each step's own condition holds, ignoring the steps before it. */
function satisfied(p: StepFacts): Record<CartoonStepId, boolean> {
  const cast = Object.values(p.cast ?? {});
  const shots = p.shots ?? [];
  return {
    script: true,
    cast: true,
    // A portrait drawn in an older style is not ready, approved or not (server CAST_NOT_READY).
    style: cast.every((m) => portraitReady(m, p.meta?.style)),
    shots: Boolean(p.meta?.style),
    film: p.shotListApproved === true,
    finish: shots.length > 0 && shots.every((s) => s.clip?.status === 'done'),
  };
}

/**
 * The steps that can be opened, in order. Without a project only Script opens;
 * with one, each later step needs its own condition and every earlier one.
 */
export function reachableSteps(project: StepFacts | null): CartoonStepId[] {
  if (!project) return ['script'];
  const ok = satisfied(project);
  const open: CartoonStepId[] = [];
  for (const step of CARTOON_STEPS) {
    if (!ok[step.id]) break;
    open.push(step.id);
  }
  return open;
}

/** Where a project opens: the furthest step the admin can reach. */
export function furthestStep(project: StepFacts | null): CartoonStepId {
  const open = reachableSteps(project);
  return open[open.length - 1];
}
