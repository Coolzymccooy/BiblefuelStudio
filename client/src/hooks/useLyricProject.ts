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
    // A failed fetch stops the polling: retrying every 2 s against a server that is down only piles up requests.
    refetchInterval: (query) => (query.state.status !== 'error' && query.state.data?.timing?.status === 'running' ? LYRIC_POLL_MS : false),
  });
}
