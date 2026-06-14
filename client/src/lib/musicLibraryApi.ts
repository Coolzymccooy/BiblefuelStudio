import { api } from './api';

export interface MusicTrack { id: string; label: string; mood: string; previewUrl: string; default: boolean }

export async function fetchMusicLibrary(): Promise<MusicTrack[]> {
  const res = await api.get('/api/music/library');
  if (!res.ok) throw new Error(res.error || 'Failed to load music library');
  return (res.data?.tracks ?? []) as MusicTrack[];
}
