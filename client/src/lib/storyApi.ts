import {
  api,
  TRANSCRIBE_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  MEDIA_OP_TIMEOUT_MS,
  DIRECT_UPLOAD_MAX_BYTES,
  RESUMABLE_UPLOAD_MAX_BYTES,
} from './api';
import { resumableUploadToSession } from './resumableUpload';
import type { StoryProject, StoryProjectSummary, StoryScene } from './storyTypes';

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}

/**
 * Upload a large audio file (> Cloudflare's safe one-shot size) straight to
 * storage via a server-minted resumable session, then have the server pull it
 * down to a local path. Returns the same local path shape as a direct upload,
 * so the Story pipeline is unchanged.
 */
async function uploadAudioResumable(file: Blob, filename: string, onProgress?: (pct: number) => void): Promise<string> {
  const contentType = (file as File).type || 'application/octet-stream';
  const session = await api.post<{ sessionUrl: string; objectPath: string }>(
    '/api/media/upload-session',
    { filename, contentType, size: file.size },
  );
  if (!session.ok || !session.data?.sessionUrl || !session.data?.objectPath) {
    throw new Error(session.error || 'Large uploads are not available on this server right now.');
  }

  await resumableUploadToSession(session.data.sessionUrl, file, { onProgress });

  const finalized = await api.post<{ file: string }>(
    '/api/media/upload-finalize',
    { objectPath: session.data.objectPath, filename, contentType },
    undefined,
    { timeout: MEDIA_OP_TIMEOUT_MS },
  );
  if (!finalized.ok || !finalized.data?.file) throw new Error(finalized.error || 'Finalizing upload failed');
  return finalized.data.file;
}

// Generating ~30 images can run for minutes; reuse a generous ceiling.
const GENERATE_IMAGES_TIMEOUT_MS = 15 * 60_000;
const SCRIPT_TO_AUDIO_TIMEOUT_MS = 2 * 60_000;
const PROCESS_TIMEOUT_MS = 60_000;

function unwrapProject(res: { ok: boolean; data?: any; error?: string }): StoryProject {
  if (!res.ok || !res.data?.project) throw new Error(res.error || res.data?.error || 'Request failed');
  return res.data.project as StoryProject;
}

export const storyApi = {
  async createProject(title: string, style: string): Promise<StoryProject> {
    return unwrapProject(await api.post('/api/story', { title, style }));
  },

  async listProjects(): Promise<StoryProjectSummary[]> {
    const res = await api.get('/api/story');
    if (!res.ok) throw new Error(res.error || 'Failed to list projects');
    return (res.data?.projects ?? []) as StoryProjectSummary[];
  },

  async getProject(id: string): Promise<StoryProject> {
    return unwrapProject(await api.get(`/api/story/${id}`));
  },

  async transcribe(id: string, mediaPath: string): Promise<StoryProject> {
    return unwrapProject(
      await api.post(`/api/story/${id}/transcribe`, { mediaPath }, undefined, { timeout: TRANSCRIBE_TIMEOUT_MS }),
    );
  },

  async segment(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/segment`, {}));
  },

  // Retry only failed/pending images. Runs in the background server-side and
  // returns the project's in-flight state immediately; poll for progress.
  async generateImages(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/images`, {}));
  },

  // Regenerate EVERY image from scratch (purges the cache server-side).
  async regenerateAllImages(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/images`, { force: true }));
  },

  // Stop an in-flight pipeline/render that's running long or has gone rogue.
  async cancel(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/cancel`, {}));
  },

  async regenerateScene(id: string, sceneId: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/scenes/${sceneId}/regenerate`, {}, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }));
  },

  async patchScene(id: string, sceneId: string, patch: Partial<Pick<StoryScene, 'text' | 'imagePrompt'>>): Promise<StoryProject> {
    return unwrapProject(await api.patch(`/api/story/${id}/scenes/${sceneId}`, patch));
  },

  async setMusic(id: string, music: { path: string | null; volume: number; autoDuck: boolean }): Promise<StoryProject> {
    const res = await api.patch(`/api/story/${id}/music`, music);
    if (!res.ok || !res.data?.project) throw new Error(res.error || 'Failed to set music');
    return res.data.project as StoryProject;
  },

  async render(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/render`, {}));
  },

  async deleteProject(id: string): Promise<void> {
    const res = await api.delete(`/api/story/${id}`);
    if (!res.ok) throw new Error(res.error || 'Failed to delete project');
  },

  async uploadAudio(file: Blob, filename: string, onProgress?: (pct: number) => void): Promise<string> {
    // Files above Cloudflare's safe one-shot size go straight to storage,
    // resumably (survives mobile drops). Small files keep the fast direct path.
    if (file.size > RESUMABLE_UPLOAD_MAX_BYTES) {
      throw new Error(`File is ${mb(file.size)} MB. The maximum is ${mb(RESUMABLE_UPLOAD_MAX_BYTES)} MB.`);
    }
    if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
      return uploadAudioResumable(file, filename, onProgress);
    }
    const res = await api.uploadRaw('/api/media/upload-audio', file, {
      filename,
      timeout: UPLOAD_TIMEOUT_MS,
      onUploadProgress: onProgress,
    });
    if (!res.ok || !res.data?.file) throw new Error(res.error || 'Audio upload failed');
    return res.data.file as string;
  },

  async scriptToAudio(idea: string, templateId: string, voiceId?: string): Promise<string> {
    const res = await api.post('/api/story/script-to-audio', { idea, templateId, voiceId }, undefined, { timeout: SCRIPT_TO_AUDIO_TIMEOUT_MS });
    if (!res.ok || !res.data?.file) throw new Error(res.error || 'Voice generation failed');
    return res.data.file as string;
  },

  async process(id: string, mediaPath: string): Promise<void> {
    const res = await api.post(`/api/story/${id}/process`, { mediaPath }, undefined, { timeout: PROCESS_TIMEOUT_MS });
    if (!res.ok) throw new Error(res.error || 'Failed to start processing');
  },

  // Discard the current scenes and rebuild them (fewer, longer scenes) from the
  // existing transcript — recovers a project that over-segmented into hundreds
  // of scenes and never finished generating images.
  async resegment(id: string): Promise<void> {
    const res = await api.post(`/api/story/${id}/resegment`, {}, undefined, { timeout: PROCESS_TIMEOUT_MS });
    if (!res.ok) throw new Error(res.error || 'Failed to re-segment');
  },
};
