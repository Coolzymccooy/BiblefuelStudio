import { api } from './api';
import type { ApiResponse } from './api';
import { uploadMedia } from './mediaUpload';
import type {
  BackgroundFit, LyricEffect, LyricProject, LyricProjectSummary, LyricRenderJob, RenderAspect, RenderQuality,
} from './lyricVideoTypes';

const BASE = '/api/lyric-video';

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const QUOTA_ERROR = "You've used today's free renders — upgrade to Premium or come back tomorrow.";

/** Throws Error(message) with a sentence fit for the user when the call failed. */
function check(res: ApiResponse): void {
  if (res.ok) return;
  // The quota middleware answers 429 with the code "QUOTA_EXCEEDED", not a sentence.
  if (res.error === 'QUOTA_EXCEEDED') throw new Error(QUOTA_ERROR);
  throw new Error(res.error || GENERIC_ERROR);
}

/** `api` already unwraps axios, so `data` is the server's body itself. */
function unwrap<T>(res: ApiResponse<T>): T {
  check(res);
  if (res.data === undefined) throw new Error(GENERIC_ERROR);
  return res.data;
}

const project = async (call: Promise<ApiResponse<{ project: LyricProject }>>) => unwrap(await call).project;

export const lyricVideoApi = {
  async list(): Promise<LyricProjectSummary[]> {
    return unwrap(await api.get<{ projects: LyricProjectSummary[] }>(BASE)).projects;
  },
  create: (title: string, artist: string) => project(api.post(BASE, { title, artist })),
  get: (id: string) => project(api.get(`${BASE}/${id}`)),
  async remove(id: string): Promise<void> {
    check(await api.delete(`${BASE}/${id}`));
  },
  async prefs(): Promise<{ artist: string }> {
    return unwrap(await api.get<{ artist: string }>(`${BASE}/prefs`));
  },
  async setPrefs(artist: string): Promise<void> {
    check(await api.put(`${BASE}/prefs`, { artist }));
  },
  async uploadSong(id: string, file: File, onProgress?: (pct: number) => void): Promise<LyricProject> {
    const up = await uploadMedia(file, file.name, 'source-video', onProgress);
    if (!up.file) throw new Error('The song did not upload. Please try again.');
    return project(api.post(`${BASE}/${id}/song`, { path: up.file }));
  },
  setSheet: (id: string, sheet: string) => project(api.put(`${BASE}/${id}/sheet`, { sheet })),
  align: (id: string) => project(api.post(`${BASE}/${id}/align`, {})),
  patchLine: (id: string, lineId: string, patch: { start?: number; effect?: LyricEffect }) =>
    project(api.patch(`${BASE}/${id}/lines/${lineId}`, patch)),
  setLook: (id: string, look: Partial<LyricProject['look']>) => project(api.put(`${BASE}/${id}/look`, look)),
  setBackground: (id: string, path: string | null, fit?: BackgroundFit) =>
    project(api.put(`${BASE}/${id}/background`, { path, ...(fit ? { fit } : {}) })),
  async uploadBackground(id: string, file: File, onProgress?: (pct: number) => void): Promise<LyricProject> {
    const up = await uploadMedia(file, file.name, 'background', onProgress);
    if (!up.file) throw new Error('The background did not upload. Please try again.');
    return lyricVideoApi.setBackground(id, up.file);
  },
  captionsUrl: (id: string, w: number, h: number) => `${BASE}/${id}/captions.ass?w=${w}&h=${h}`,
  /** The timed words for the preview player; an empty string when no line has been timed yet. */
  captions: (id: string, w: number, h: number): Promise<string> => api.getText(lyricVideoApi.captionsUrl(id, w, h)),
  async render(id: string, aspect: RenderAspect, quality: RenderQuality): Promise<string> {
    return unwrap(await api.post<{ jobId: string }>(`${BASE}/${id}/render`, { aspect, quality })).jobId;
  },
  async renderStatus(id: string, jobId: string): Promise<LyricRenderJob> {
    return unwrap(await api.get<{ job: LyricRenderJob }>(`${BASE}/${id}/render/${jobId}`)).job;
  },
  async cancelRender(id: string, jobId: string): Promise<void> {
    check(await api.post(`${BASE}/${id}/render/${jobId}/cancel`, {}));
  },
};
