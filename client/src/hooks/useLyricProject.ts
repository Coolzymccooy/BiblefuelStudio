import { useQuery } from '@tanstack/react-query';
import { lyricVideoApi } from '../lib/lyricVideoApi';
import type { LyricProject } from '../lib/lyricVideoTypes';

export const LYRIC_POLL_MS = 2000;

/** Fetch a lyric-video project; refetch every 2 seconds while its timing job runs. */
export function useLyricProject(projectId: string | null) {
  return useQuery<LyricProject>({
    queryKey: ['lyric-project', projectId],
    queryFn: () => lyricVideoApi.get(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => (query.state.data?.timing?.status === 'running' ? LYRIC_POLL_MS : false),
  });
}
