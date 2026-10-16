import type { StoryProject, StoryScene } from './storyTypes';

/**
 * The Series "AI motion" line on the Story page, from the scenes as they are.
 *
 * The server writes aiMotion.note when it picks the scenes, before any clip
 * is ordered, so a clip that later fails on the month's cap would leave the
 * note claiming more than was animated. Once nothing is in flight and a clip
 * has failed on the cap, the line counts what was really animated instead.
 */

/** Part of the server's cap refusal (capMessage in server/src/lib/videoGen/spend.js). */
const CAP_ERROR = /AI video spend/;

const IN_FLIGHT = new Set(['queued', 'generating']);

/** The user's own uploaded clip: never animated over, so not a scene to count. */
function isOwnClip(s: StoryScene): boolean {
    return s.mediaKind === 'video' && !s.aiVideoClip && s.aiVideoStatus !== 'done';
}

export function storyAiMotionNote(project: Pick<StoryProject, 'aiMotion' | 'scenes'>): string | null {
    const ai = project.aiMotion;
    if (!ai) return null;
    const scenes = project.scenes || [];
    if (!ai.autoStartedAt || scenes.some((s) => IN_FLIGHT.has(s.aiVideoStatus ?? ''))) return ai.note;
    const capped = scenes.some((s) => s.aiVideoStatus === 'error' && CAP_ERROR.test(s.aiVideoError || ''));
    if (!capped) return ai.note;
    const done = scenes.filter((s) => s.aiVideoStatus === 'done').length;
    const total = scenes.filter((s) => s.imageStatus === 'done' && s.imagePath && !isOwnClip(s)).length;
    return `${done} of ${total} scenes animated: monthly AI budget reached`;
}
