import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import { isAnimatingScenes, isTransientStatus } from '../lib/storyWizard';
import type { StoryProject } from '../lib/storyTypes';

const POLL_MS = 2500;
// AI clips take minutes; a slower poll is plenty.
const ANIMATE_POLL_MS = 5000;

/** Fetch a story project; auto-poll while its status is transient or clips are being made. */
export function useStoryProject(projectId: string | null) {
  return useQuery<StoryProject>({
    queryKey: ['story-project', projectId],
    queryFn: () => storyApi.getProject(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const project = query.state.data;
      if (!project) return false;
      if (isTransientStatus(project.status)) return POLL_MS;
      return isAnimatingScenes(project) ? ANIMATE_POLL_MS : false;
    },
  });
}
