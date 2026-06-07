import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import type { StoryProjectSummary } from '../lib/storyTypes';

/** List the user's Story Video projects (newest first). */
export function useStoryProjects() {
  return useQuery<StoryProjectSummary[]>({
    queryKey: ['story-projects'],
    queryFn: () => storyApi.listProjects(),
  });
}
