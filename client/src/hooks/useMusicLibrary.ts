import { useQuery } from '@tanstack/react-query';
import { fetchMusicLibrary } from '../lib/musicLibraryApi';

/** Shared with code that needs the library outside a render (see MusicLibraryImport). */
export const musicLibraryQuery = {
  queryKey: ['music-library'],
  queryFn: () => fetchMusicLibrary(),
  staleTime: Infinity,
};

export function useMusicLibrary() {
  return useQuery(musicLibraryQuery);
}
