import { api } from './api';

export interface MusicTrack {
  id: string;
  label: string;
  mood: string;
  previewUrl: string | null;
  default: boolean;
  /** Bundled tracks ship with the app; uploads belong to this account. */
  source: 'bundled' | 'upload';
  /** 'pixabay-cleared' for bundled; 'unknown' until the operator says otherwise. */
  licence: string;
  durationSec: number | null;
  /** The ref a build stores: `library:<id>` for bundled, `mylib:<id>` for uploads. */
  ref: string;
}

export async function fetchMusicLibrary(): Promise<MusicTrack[]> {
  const res = await api.get('/api/music/library');
  if (!res.ok) throw new Error(res.error || 'Failed to load music library');
  return (res.data?.tracks ?? []) as MusicTrack[];
}

/** Remember an already-uploaded file as a reusable track. */
export async function saveTrackToLibrary(
  file: string,
  meta: { label?: string; mood?: string; licence?: string } = {},
): Promise<MusicTrack> {
  const res = await api.post('/api/music/upload', { file, ...meta });
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to save track');
  return res.data.track as MusicTrack;
}

export async function updateTrack(
  id: string,
  patch: { label?: string; mood?: string; licence?: string },
): Promise<MusicTrack> {
  const res = await api.patch(`/api/music/${id}`, patch);
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to update track');
  return res.data.track as MusicTrack;
}

export async function deleteTrack(id: string): Promise<void> {
  const res = await api.delete(`/api/music/${id}`);
  if (!res.ok) throw new Error(res.error || 'Failed to remove track');
}
