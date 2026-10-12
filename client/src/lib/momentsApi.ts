import { api } from './api';
import { ApiError } from './apiError';
import type {
  LibraryImage, MomentMeta, MomentPatch, MomentProject, MomentSuggestion, MomentSummary, SongWindow,
} from './momentsTypes';

// The AI writes statements and voiceovers in a few seconds, but the server
// allows it 15 s, plus speech synthesis for a voiceover.
const AI_TIMEOUT_MS = 60_000;

type Res = { ok: boolean; status?: number; data?: any; error?: string };

// Server error codes are upper snake case (QUOTA_EXCEEDED); human messages are sentences.
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Turn a failed response into an ApiError. The message is the server's human
 * sentence (the quota hint, or the error text) so it reads well in a toast; the
 * code and the full body are kept so toastError can render coded errors.
 */
function failure(res: Res, fallback: string): ApiError {
  const body = res.data ?? {};
  const bodyError = typeof body.error === 'string' ? body.error : undefined;
  const code = [bodyError, res.error].find((v): v is string => typeof v === 'string' && CODE_PATTERN.test(v)) ?? '';
  const human = [body.hint, res.error, bodyError]
    .find((v): v is string => typeof v === 'string' && v.length > 0 && v !== code);
  return new ApiError(human || fallback, code, body);
}

function unwrap<T>(res: Res, key: string): T {
  if (!res.ok || res.data?.[key] === undefined) throw failure(res, 'Request failed');
  return res.data[key] as T;
}

export const momentsApi = {
  async meta(): Promise<MomentMeta> {
    const res = await api.get('/api/moments/meta');
    if (!res.ok || !res.data) throw failure(res, 'Could not load Moments');
    return res.data as MomentMeta;
  },
  async list(): Promise<MomentSummary[]> {
    return unwrap<MomentSummary[]>(await api.get('/api/moments'), 'projects');
  },
  async create(occasion: string): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.post('/api/moments', { occasion }), 'project');
  },
  async get(id: string): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.get(`/api/moments/${id}`), 'project');
  },
  async update(id: string, patch: MomentPatch): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.put(`/api/moments/${id}`, patch), 'project');
  },
  async remove(id: string): Promise<void> {
    const res = await api.delete(`/api/moments/${id}`);
    if (!res.ok) throw failure(res, 'Could not delete this Moment');
  },
  async suggest(id: string): Promise<MomentSuggestion> {
    return unwrap<MomentSuggestion>(await api.post(`/api/moments/${id}/statements`, {}, undefined, { timeout: AI_TIMEOUT_MS }), 'suggestion');
  },
  async voiceover(id: string, body: { script?: string; idea?: string; voiceId?: string }): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.post(`/api/moments/${id}/voiceover`, body, undefined, { timeout: AI_TIMEOUT_MS }), 'project');
  },
  async render(id: string, seed?: number): Promise<string> {
    return unwrap<string>(await api.post(`/api/moments/${id}/render`, seed === undefined ? {} : { seed }), 'jobId');
  },
  async cancel(id: string): Promise<void> {
    const res = await api.post(`/api/moments/${id}/cancel`, {});
    if (!res.ok) throw failure(res, 'Could not cancel');
  },
  async libraryImages(): Promise<LibraryImage[]> {
    return unwrap<LibraryImage[]>(await api.get('/api/moments/library-images'), 'images');
  },
  async songWindow(id: string): Promise<SongWindow> {
    const res = await api.get(`/api/moments/${id}/song-window`);
    if (!res.ok || !res.data) throw failure(res, 'Could not read the song');
    return res.data as SongWindow;
  },
};
