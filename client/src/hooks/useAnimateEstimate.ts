import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import type { AnimateEstimate, AnimateQuality, StoryProject } from '../lib/storyTypes';

/**
 * The price of animating this project's scenes, and the month's spend.
 * Re-asked whenever a scene's picture or clip state changes.
 */
export function useAnimateEstimate(project: StoryProject | undefined, quality: AnimateQuality, enabled: boolean) {
  const signature = project ? project.scenes.map((s) => `${s.id}:${s.imageStatus}:${s.aiVideoStatus ?? 'none'}`).join('|') : '';
  return useQuery<AnimateEstimate>({
    queryKey: ['story-animate-estimate', project?.projectId, quality, signature],
    queryFn: () => storyApi.estimateAnimation((project as StoryProject).projectId, quality),
    enabled: enabled && Boolean(project?.projectId),
    staleTime: 30_000,
  });
}
