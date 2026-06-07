import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import { isTransientStatus } from '../lib/storyWizard';
import type { StoryProject } from '../lib/storyTypes';

const POLL_MS = 2500;

/** Fetch a story project; auto-poll while its status is transient. */
export function useStoryProject(projectId: string | null) {
  return useQuery<StoryProject>({
    queryKey: ['story-project', projectId],
    queryFn: () => storyApi.getProject(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTransientStatus(status) ? POLL_MS : false;
    },
  });
}
