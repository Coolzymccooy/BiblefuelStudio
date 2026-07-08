import { api, TRANSCRIBE_TIMEOUT_MS } from './api';
import { uploadMedia } from './mediaUpload';
import type { StoryProject, StoryProjectSummary, StoryScene } from './storyTypes';

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
    // Small files use the fast one-shot path; large files (which Cloudflare
    // would reject) go resumable → storage. uploadMedia handles the branch.
    const result = await uploadMedia(file, filename, 'audio', onProgress);
    return result.file;
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
