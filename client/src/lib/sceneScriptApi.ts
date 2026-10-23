import { api } from './api';
import { ApiError } from './apiError';
import type {
  LibraryClip, LibraryFilters, LibraryLead, MonthSpend, RerollJob, RerollPrice, SceneScriptProject, ShotRefine, SceneScriptSummary, ShotEstimate, VoiceOption,
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
  shots?: { id: string; prompt?: string | null; offsetSec?: number; accept?: boolean; refine?: ShotRefine | null }[];
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

// Above the server worst case for one clip (probe 20 s + H.264 conversion 90 s
// + poster 30 s), so a conversion that finishes is never reported as failed.
export const IMPORT_TIMEOUT_MS = 180_000;

export const visualLibraryApi = {
  async search(q: string, aspect?: string, more: Omit<LibraryFilters, 'q' | 'aspect'> = {}): Promise<LibraryClip[]> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (aspect) params.set('aspect', aspect);
    if (more.lead) params.set('lead', more.lead);
    if (more.tag) params.set('tag', more.tag);
    if (more.rating) params.set('rating', String(more.rating));
    if (more.limit) params.set('limit', String(more.limit));
    const res = await api.get(`/api/visual-library?${params.toString()}`);
    if (!res.ok) throw failure(res, 'Could not load the visual library');
    return res.data.clips as LibraryClip[];
  },
  async leads(): Promise<LibraryLead[]> {
    const res = await api.get('/api/visual-library/leads');
    if (!res.ok) throw failure(res, 'Could not load the lead characters');
    return res.data.leads as LibraryLead[];
  },
  async update(id: string, patch: { tags?: string[]; rating?: number | null }): Promise<LibraryClip> {
    const res = await api.patch(`/api/visual-library/${id}`, patch);
    if (!res.ok) throw failure(res, 'Could not save that clip');
    return res.data.clip as LibraryClip;
  },
  /** force deletes a clip that scene scripts still use; without it the server answers IN_USE. */
  async remove(id: string, force = false): Promise<void> {
    const res = await api.delete(`/api/visual-library/${id}${force ? '?force=1' : ''}`);
    if (!res.ok) throw failure(res, 'Could not delete that clip');
  },
  /** Makes a batch of posters; ask again while remaining is above 0 and the last batch did something. */
  async makePosters(): Promise<{ made: number; failed: number; remaining: number }> {
    const res = await api.post('/api/visual-library/posters', {}, undefined, { timeout: IMPORT_TIMEOUT_MS });
    if (!res.ok) throw failure(res, 'Could not make posters');
    return { made: res.data.made, failed: res.data.failed, remaining: res.data.remaining ?? 0 };
  },
  /** Adds a batch of older Story clips; ask again while remaining is above 0. */
  async backfillStory(): Promise<{ added: number; remaining: number }> {
    const res = await api.post('/api/visual-library/backfill-story', {}, undefined, { timeout: IMPORT_TIMEOUT_MS });
    if (!res.ok) throw failure(res, 'Could not add older Story clips');
    return { added: res.data.added, remaining: res.data.remaining ?? 0 };
  },
  /** What re-rolling a clip costs, with this month's spend, before anything is ordered. */
  async rerollPrice(id: string): Promise<{ price: RerollPrice; month: MonthSpend; seedance: boolean }> {
    const res = await api.get(`/api/visual-library/${encodeURIComponent(id)}/reroll-price`);
    if (!res.ok) throw failure(res, 'Could not get the price');
    return { price: res.data.price, month: res.data.month, seedance: Boolean(res.data.seedance) };
  },
  /** Order a new clip from this clip's prompt (or the one given) at the price the user saw. */
  async reroll(id: string, input: { prompt: string; expectUsd: number }): Promise<RerollJob> {
    const res = await api.post(`/api/visual-library/${encodeURIComponent(id)}/reroll`, input);
    if (!res.ok) throw failure(res, 'Could not re-roll this clip');
    return res.data.job as RerollJob;
  },
  /** Fetch a paid clip that could not be saved, at no cost. */
  async refetchReroll(jobId: string): Promise<RerollJob> {
    const res = await api.post(`/api/visual-library/rerolls/${encodeURIComponent(jobId)}/refetch`, {});
    if (!res.ok) throw failure(res, 'Could not fetch the clip again');
    return res.data.job as RerollJob;
  },
  async rerolls(): Promise<{ jobs: RerollJob[]; month: MonthSpend }> {
    const res = await api.get('/api/visual-library/rerolls');
    if (!res.ok) throw failure(res, 'Could not load re-rolls');
    return { jobs: res.data.jobs as RerollJob[], month: res.data.month as MonthSpend };
  },
  /** Add a clip made elsewhere. uploadPath is what uploadMedia(file, name, 'background') returned. */
  async importClip(input: { uploadPath: string; prompt?: string; tags?: string[] }): Promise<LibraryClip> {
    const res = await api.post('/api/visual-library/import', input, undefined, { timeout: IMPORT_TIMEOUT_MS });
    if (!res.ok) throw failure(res, 'Could not import that clip');
    return res.data.clip as LibraryClip;
  },
};
