import { api } from './api';
import { ApiError } from './apiError';
import type {
  LibraryClip, SceneScriptProject, SceneScriptSummary, ShotEstimate, VoiceOption,
} from './sceneScriptTypes';

type Res = { ok: boolean; status?: number; data?: any; error?: string };

/** A failed response as an ApiError carrying the server's sentence and code. */
function failure(res: Res, fallback: string): ApiError {
  const body = res.data ?? {};
  const human = typeof body.error === 'string' && body.error ? body.error : res.error;
  return new ApiError(human || fallback, typeof body.code === 'string' ? body.code : '', body, res.status);
}

function project(res: Res, fallback: string): SceneScriptProject {
  if (!res.ok || !res.data?.project) throw failure(res, fallback);
  return res.data.project as SceneScriptProject;
}

const base = '/api/scene-script';
const SLOW_MS = 60_000;

export interface ProjectEdit {
  title?: string;
  cast?: Record<string, unknown>;
  look?: Partial<SceneScriptProject['look']>;
  captions?: { enabled: boolean };
  endCard?: { reference: string; text: string };
  lines?: { id: string; text?: string; voice?: string | null; gapAfter?: number | null; retake?: boolean }[];
  shots?: { id: string; prompt?: string | null; offsetSec?: number; accept?: boolean }[];
  cues?: { id: string; bed?: string; offsetSec?: number }[];
}

export const sceneScriptApi = {
  async voices(): Promise<{ voices: VoiceOption[]; rooms: string[] }> {
    const res = await api.get(`${base}/voices`);
    if (!res.ok) throw failure(res, 'Could not load voices');
    return { voices: res.data.voices, rooms: res.data.rooms };
  },
  async list(): Promise<SceneScriptSummary[]> {
    const res = await api.get(base);
    if (!res.ok) throw failure(res, 'Could not load scene scripts');
    return res.data.projects as SceneScriptSummary[];
  },
  async parse(markdown: string): Promise<{ preview: SceneScriptProject; estimate: ShotEstimate }> {
    const res = await api.post(`${base}/parse`, { markdown });
    if (!res.ok) throw failure(res, 'Could not read the script');
    return { preview: res.data.preview, estimate: res.data.estimate };
  },
  async create(markdown: string) {
    return project(await api.post(base, { markdown }), 'Could not save the script');
  },
  async get(id: string): Promise<{ project: SceneScriptProject; month: { spentUsd: number; capUsd: number }; seedance: boolean }> {
    const res = await api.get(`${base}/${id}`);
    if (!res.ok) throw failure(res, 'Could not load the scene script');
    return res.data;
  },
  async update(id: string, edit: ProjectEdit) {
    return project(await api.patch(`${base}/${id}`, edit), 'Could not save the change');
  },
  async remove(id: string) {
    const res = await api.delete(`${base}/${id}`);
    if (!res.ok) throw failure(res, 'Could not delete the scene script');
  },
  async voice(id: string) {
    return project(await api.post(`${base}/${id}/voice`, {}), 'Could not start voicing');
  },
  async suggestShots(id: string, shotIds?: string[]) {
    return project(await api.post(`${base}/${id}/suggest-shots`, { shotIds }, undefined, { timeout: SLOW_MS }), 'Could not suggest shot prompts');
  },
  async orderShots(id: string, opts: { only?: string[]; confirmOverBenchmark?: boolean } = {}) {
    return project(await api.post(`${base}/${id}/shots`, opts), 'Could not order clips');
  },
  async cancelShots(id: string) {
    const res = await api.post(`${base}/${id}/shots/cancel`, {});
    if (!res.ok) throw failure(res, 'Could not stop ordering');
  },
  async useLibraryClip(id: string, shotId: string, clipId: string) {
    return project(await api.post(`${base}/${id}/shots/${shotId}/library`, { clipId }), 'Could not use that clip');
  },
  async render(id: string) {
    return project(await api.post(`${base}/${id}/render`, {}), 'Could not start the render');
  },
  async cancelRender(id: string) {
    const res = await api.post(`${base}/${id}/render/cancel`, {});
    if (!res.ok) throw failure(res, 'Could not stop the render');
  },
};

export const visualLibraryApi = {
  async search(q: string, aspect?: string): Promise<LibraryClip[]> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (aspect) params.set('aspect', aspect);
    const res = await api.get(`/api/visual-library?${params.toString()}`);
    if (!res.ok) throw failure(res, 'Could not load the visual library');
    return res.data.clips as LibraryClip[];
  },
  /** Add a clip made elsewhere. uploadPath is what uploadMedia(file, name, 'background') returned. */
  async importClip(input: { uploadPath: string; prompt?: string; tags?: string[] }): Promise<LibraryClip> {
    const res = await api.post('/api/visual-library/import', input);
    if (!res.ok) throw failure(res, 'Could not import that clip');
    return res.data.clip as LibraryClip;
  },
};
