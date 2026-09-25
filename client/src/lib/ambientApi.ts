import { api } from './api';
import type { StoryCaptionSettings } from './storyTypes';
import type { AmbientScripturePatch } from '../components/ambient/AmbientCaptionsPanel';
import type {
  AmbientAspect, AmbientBedMode, AmbientBedOrder, AmbientDrop, AmbientMotion, AmbientProject, AmbientProjectSummary, AmbientStatus, AmbientWords,
} from './ambientTypes';

// Generating movement images can run for minutes, same order of magnitude as
// Story's image pass; reuse a generous ceiling rather than the 15s default.
const GENERATE_IMAGES_TIMEOUT_MS = 15 * 60_000;
// Voicing every pending drop synthesizes several clips in one request.
const VOICE_DROPS_TIMEOUT_MS = 5 * 60_000;

function unwrapProject(res: { ok: boolean; data?: any; error?: string }): AmbientProject {
  if (!res.ok || !res.data?.project) throw new Error(res.error || res.data?.error || 'Request failed');
  return res.data.project as AmbientProject;
}

/** A track the licence gate rejected — surfaced so the operator can review before overriding. */
export interface UnclearedTrack {
  id: string;
  label: string;
  [key: string]: unknown;
}

/**
 * PATCH /:id/bed returns 409 with the offending tracks when the bed includes
 * an unknown-licence track and the caller didn't pass allowUncleared. That is
 * not a failure to throw away — the caller needs the list to render the
 * warning banner and offer "use anyway" — so this is a discriminated result,
 * not an exception.
 */
export type SetBedResult =
  | { ok: true; project: AmbientProject }
  | { ok: false; uncleared: UnclearedTrack[] };

export interface AmbientBedPatch {
  mode?: AmbientBedMode;
  trackRefs?: string[];
  filePath?: string | null;
  volume?: number;
  crossfadeSec?: number;
  allowUncleared?: boolean;
  order?: AmbientBedOrder;
}

export interface PatchDropInput {
  id?: string;
  atMs: number;
  reference: string;
  translation?: string;
}

/** A picture you can put on a movement: never a server path, only a URL. */
export interface LibraryImage {
  id: string;
  url: string;
  aspect: string;
  source: 'upload' | 'generated';
  createdAt: number;
}

/** Either the path an upload returned, or a library image's id. */
export type MovementImageSource = { uploadPath: string } | { libraryId: string };

export const ambientApi = {
  async createProject(title: string, theme: string, targetSec?: number, aspect?: AmbientAspect): Promise<AmbientProject> {
    return unwrapProject(await api.post('/api/ambient', { title, theme, targetSec, aspect }));
  },

  async listProjects(): Promise<AmbientProjectSummary[]> {
    const res = await api.get('/api/ambient');
    if (!res.ok) throw new Error(res.error || 'Failed to list projects');
    return (res.data?.projects ?? []) as AmbientProjectSummary[];
  },

  async getProject(id: string): Promise<AmbientProject> {
    return unwrapProject(await api.get(`/api/ambient/${id}`));
  },

  // Remembers an upload so the history can show where the video went.
  async recordPublished(id: string, entry: { videoId: string; privacyStatus: string; publishAt?: string }): Promise<AmbientProject> {
    return unwrapProject(await api.post(`/api/ambient/${id}/published`, entry));
  },

  async deleteProject(id: string): Promise<void> {
    const res = await api.delete(`/api/ambient/${id}`);
    if (!res.ok) throw new Error(res.error || 'Failed to delete project');
  },

  // Suggests verse references for the theme, spaced across the runtime.
  async plan(id: string, count?: number): Promise<AmbientProject> {
    return unwrapProject(await api.post(`/api/ambient/${id}/plan`, count ? { count } : {}));
  },

  async patchDrops(id: string, drops: PatchDropInput[]): Promise<AmbientProject> {
    return unwrapProject(await api.patch(`/api/ambient/${id}/drops`, { drops }));
  },

  // Verbatim lookup + synthesis for every pending drop. A failed drop marks
  // itself status:'error' server-side and the rest continue.
  async voiceDrops(id: string): Promise<AmbientProject> {
    return unwrapProject(await api.post(`/api/ambient/${id}/voice`, {}, undefined, { timeout: VOICE_DROPS_TIMEOUT_MS }));
  },

  async setBed(id: string, patch: AmbientBedPatch): Promise<SetBedResult> {
    const res = await api.patch(`/api/ambient/${id}/bed`, patch);
    if (res.status === 409 && Array.isArray(res.data?.uncleared)) {
      return { ok: false, uncleared: res.data.uncleared as UnclearedTrack[] };
    }
    if (!res.ok || !res.data?.project) throw new Error(res.error || res.data?.error || 'Failed to update the music bed');
    return { ok: true, project: res.data.project as AmbientProject };
  },

  async generateImages(id: string, force = false): Promise<AmbientProject> {
    return unwrapProject(
      await api.post(`/api/ambient/${id}/images`, force ? { force: true } : {}, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }),
    );
  },

  // Redo one movement's picture and leave the ones you kept alone.
  async regenerateMovement(id: string, movementId: string): Promise<AmbientProject> {
    return unwrapProject(
      await api.post(`/api/ambient/${id}/images`, { movementId }, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }),
    );
  },

  async setMovementImage(id: string, movementId: string, source: MovementImageSource): Promise<AmbientProject> {
    return unwrapProject(await api.put(`/api/ambient/${id}/movements/${movementId}/image`, source));
  },

  async listLibraryImages(id: string): Promise<LibraryImage[]> {
    const res = await api.get(`/api/ambient/${id}/library-images`);
    if (!res.ok) throw new Error(res.error || 'Failed to load your pictures');
    return (res.data?.images ?? []) as LibraryImage[];
  },

  async setMotion(id: string, motion: AmbientMotion): Promise<AmbientProject> {
    return unwrapProject(await api.patch(`/api/ambient/${id}/motion`, { motion }));
  },

  // Scripture on screen: on/off, how long each verse stays, and where.
  async setScriptureDisplay(id: string, patch: AmbientScripturePatch): Promise<AmbientProject> {
    return unwrapProject(await api.patch(`/api/ambient/${id}/captions`, patch));
  },

  // Reuses normaliseCaptionSettings server-side: the server merges against
  // the stored project, so a partial update never clears settings it omits.
  async setCaptions(id: string, settings: StoryCaptionSettings): Promise<AmbientProject> {
    return unwrapProject(await api.patch(`/api/ambient/${id}/captions`, settings));
  },

  async setWords(id: string, words: AmbientWords): Promise<AmbientProject> {
    return unwrapProject(await api.patch(`/api/ambient/${id}/words`, { words }));
  },

  async render(id: string, encoder: 'cpu' | 'amf' = 'cpu'): Promise<{ ok: boolean; jobId?: string }> {
    const res = await api.post(`/api/ambient/${id}/render`, { encoder });
    if (!res.ok) throw new Error(res.error || 'Failed to start render');
    return res.data as { ok: boolean; jobId?: string };
  },

  async cancel(id: string): Promise<void> {
    const res = await api.post(`/api/ambient/${id}/cancel`, {});
    if (!res.ok) throw new Error(res.error || 'Failed to cancel');
  },
};

const TRANSIENT_STATUSES: ReadonlySet<AmbientStatus> = new Set([
  'voicing', 'assembling', 'generating_images', 'rendering',
]);

/** Whether the project is mid-pipeline and the page should keep polling. */
export function isAmbientTransient(status: AmbientStatus): boolean {
  return TRANSIENT_STATUSES.has(status);
}

/** A drop is "done" once it has verbatim text and audio, not merely present. */
export function dropIsVoiced(drop: AmbientDrop): boolean {
  return drop.status === 'done' && Boolean(drop.audioPath);
}
