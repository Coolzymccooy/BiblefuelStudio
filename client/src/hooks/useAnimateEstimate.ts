import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import type { AnimateEstimate, AnimateQuality, StoryProject } from '../lib/storyTypes';

/**
 * The price of animating this project's scenes, and the month's spend.
 * Re-asked whenever a scene's picture or clip state changes (your own clip
 * on a scene takes it out of the batch).
 */
export function useAnimateEstimate(project: StoryProject | undefined, quality: AnimateQuality, enabled: boolean) {
  const signature = project ? project.scenes.map((s) => `${s.id}:${s.imageStatus}:${s.aiVideoStatus ?? 'none'}:${s.mediaKind ?? 'image'}:${s.aiVideoClip ? 1 : 0}`).join('|') : '';
  return useQuery<AnimateEstimate>({
    queryKey: ['story-animate-estimate', project?.projectId, quality, signature],
    queryFn: () => storyApi.estimateAnimation((project as StoryProject).projectId, quality),
    enabled: enabled && Boolean(project?.projectId),
    staleTime: 30_000,
    // The key changes on every quality toggle and scene status change; keep the last
    // figures on screen while the new ones load, but never another project's.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === project?.projectId ? prev : undefined),
  });
}
