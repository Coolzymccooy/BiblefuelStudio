import type { LyricProject } from './lyricVideoTypes';

export const LYRIC_STEPS = ['song', 'lyrics', 'timing', 'look', 'render'] as const;
export type LyricStepId = typeof LYRIC_STEPS[number];

/** Which steps the project is ready for: each needs what the one before it made. */
export function reachableSteps(project: LyricProject): Record<LyricStepId, boolean> {
  const hasSong = Boolean(project.song);
  const hasLines = project.lines.length > 0;
  const timed = project.timing.status === 'done';
  return { song: true, lyrics: hasSong, timing: hasSong && hasLines, look: hasSong && timed, render: hasSong && timed };
}

/** The step to open on: the first one that still needs something from the user. */
export function firstOpenStep(project: LyricProject): LyricStepId {
  if (!project.song) return 'song';
  if (project.lines.length === 0) return 'lyrics';
  switch (project.timing.status) {
    case 'running': case 'error': return 'timing';
    case 'done': return 'look';
    default: return 'lyrics';
  }
}
