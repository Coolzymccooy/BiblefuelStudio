import { api, TRANSCRIBE_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './api';
import type { StoryProject, StoryProjectSummary, StoryScene } from './storyTypes';

// Generating ~30 images can run for minutes; reuse a generous ceiling.
const GENERATE_IMAGES_TIMEOUT_MS = 15 * 60_000;
const SCRIPT_TO_AUDIO_TIMEOUT_MS = 2 * 60_000;

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

  async generateImages(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/images`, {}, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }));
  },

  async regenerateScene(id: string, sceneId: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/scenes/${sceneId}/regenerate`, {}, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }));
  },

  async patchScene(id: string, sceneId: string, patch: Partial<Pick<StoryScene, 'text' | 'imagePrompt'>>): Promise<StoryProject> {
    return unwrapProject(await api.patch(`/api/story/${id}/scenes/${sceneId}`, patch));
  },

  async render(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/render`, {}));
  },

  async deleteProject(id: string): Promise<void> {
    const res = await api.delete(`/api/story/${id}`);
    if (!res.ok) throw new Error(res.error || 'Failed to delete project');
  },

  async uploadAudio(dataUrl: string, filename: string, onProgress?: (pct: number) => void): Promise<string> {
    const res = await api.post('/api/media/upload-audio', { dataUrl, filename }, undefined, {
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
};
