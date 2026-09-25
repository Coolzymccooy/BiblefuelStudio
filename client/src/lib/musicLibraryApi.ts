import { api, MUSIC_SAVE_TIMEOUT_MS } from './api';

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
  /** Who created or sourced the track. */
  credit?: string;
  /** When present, this track is the vocal-removed version of another track. */
  derivedFrom?: string | null;
  /** An upload's file name under /outputs, for playback. */
  mediaFile?: string | null;
}

export async function fetchMusicLibrary(): Promise<MusicTrack[]> {
  const res = await api.get('/api/music/library');
  if (!res.ok) throw new Error(res.error || 'Failed to load music library');
  return (res.data?.tracks ?? []) as MusicTrack[];
}

/**
 * Remember an already-uploaded file as a reusable track. The server awaits an
 * ffprobe duration probe synchronously before responding, so this needs more
 * headroom than the 15s default (see MUSIC_SAVE_TIMEOUT_MS).
 */
export async function saveTrackToLibrary(
  file: string,
  meta: { label?: string; mood?: string; licence?: string } = {},
): Promise<MusicTrack> {
  const res = await api.post('/api/music/upload', { file, ...meta }, undefined, { timeout: MUSIC_SAVE_TIMEOUT_MS });
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to save track');
  return res.data.track as MusicTrack;
}

export async function updateTrack(
  id: string,
  patch: { label?: string; mood?: string; licence?: string; credit?: string },
): Promise<MusicTrack> {
  const res = await api.patch(`/api/music/${id}`, patch);
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to update track');
  return res.data.track as MusicTrack;
}

export async function deleteTrack(id: string): Promise<void> {
  const res = await api.delete(`/api/music/${id}`);
  if (!res.ok) throw new Error(res.error || 'Failed to remove track');
}

export interface Capabilities { vocalRemoval: boolean; amfEncoder: boolean }

export async function fetchCapabilities(): Promise<Capabilities> {
  const res = await api.get('/api/music/capabilities');
  if (!res.ok) return { vocalRemoval: false, amfEncoder: false };
  return { vocalRemoval: Boolean(res.data?.vocalRemoval), amfEncoder: Boolean(res.data?.amfEncoder) };
}

export type InstrumentalQuality = 'best' | 'fast';
export interface InstrumentalJob {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  percent: number;
  error: string | null;
  sourceRef: string;
  sourcePreview: string | null;
  resultFile: string | null;
  /** The library track it was saved as — set once the job is done. */
  track: MusicTrack | null;
}

export async function startInstrumental(trackId: string, quality: InstrumentalQuality): Promise<string> {
  const res = await api.post(`/api/music/${trackId}/instrumental`, { quality });
  if (!res.ok || !res.data?.jobId) throw new Error(res.error || 'Failed to start vocal removal');
  return res.data.jobId as string;
}

export async function getInstrumental(jobId: string): Promise<InstrumentalJob> {
  const res = await api.get(`/api/music/instrumental/${jobId}`);
  if (!res.ok || !res.data?.job) throw new Error(res.error || 'Vocal removal job not found');
  return res.data.job as InstrumentalJob;
}

export async function cancelInstrumental(jobId: string): Promise<void> {
  const res = await api.post(`/api/music/instrumental/${jobId}/cancel`, {});
  if (!res.ok) throw new Error(res.error || 'Failed to cancel vocal removal');
}

export async function discardInstrumental(jobId: string): Promise<void> {
  const res = await api.post(`/api/music/instrumental/${jobId}/discard`, {});
  if (!res.ok) throw new Error(res.error || 'Failed to discard the instrumental');
}
