import { useQuery } from '@tanstack/react-query';
import { fetchMusicLibrary } from '../lib/musicLibraryApi';

export function useMusicLibrary() {
  return useQuery({ queryKey: ['music-library'], queryFn: fetchMusicLibrary, staleTime: Infinity });
}
