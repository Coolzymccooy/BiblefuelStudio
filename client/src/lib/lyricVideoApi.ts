import { api } from './api';
import type { ApiResponse } from './api';
import { uploadMedia } from './mediaUpload';
import type { UploadKind } from './mediaUpload';
import { AUDIO_EXTENSIONS } from './audioAccept';
import type {
  BackgroundFit, LyricEffect, LyricProject, LyricProjectSummary, LyricPublishDraft, LyricRenderJob, RenderAspect, RenderQuality,
} from './lyricVideoTypes';

const BASE = '/api/lyric-video';

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const NETWORK_ERROR = "Couldn't reach the server — check your connection and try again.";
const TOO_BIG_ERROR = 'That file is too big to upload.';
const QUOTA_ERROR = "You've used today's free renders — upgrade to Premium or come back tomorrow.";

/** The song and background calls wait on server-side file probes that can run past the 15 s default. */
const SLOW_CALL = { timeout: 60_000 } as const;

/** Raw axios messages (not sentences) that the api client passes through when the server said nothing. */
const RAW_NETWORK = /^(network error|timeout of \d+ms exceeded)$/i;
const RAW_STATUS = /^request failed with status code (\d+)/i;

/** Throws Error(message) with a sentence fit for the user when the call failed. */
function check(res: ApiResponse): void {
  if (res.ok) return;
  // The quota middleware answers 429 with the code "QUOTA_EXCEEDED", not a sentence.
  if (res.error === 'QUOTA_EXCEEDED') throw new Error(QUOTA_ERROR);
  throw new Error(plainMessage(res.error));
}

/**
 * A sentence fit for the user from whatever message a failed call carried: raw axios text
 * ("Network Error", a timeout, "Request failed with status code ...") becomes plain words, and
 * anything else is the server's own sentence (it answers 429 for more than the daily limit).
 */
export function plainMessage(raw: string | undefined | null): string {
  const message = raw?.trim();
  if (!message) return GENERIC_ERROR;
  if (RAW_NETWORK.test(message)) return NETWORK_ERROR;
  const status = RAW_STATUS.exec(message);
  if (status) return status[1] === '413' ? TOO_BIG_ERROR : GENERIC_ERROR;
  return message;
}

/** uploadMedia throws the api client's raw messages; give them the same plain wording as every other call. */
async function upload(...args: Parameters<typeof uploadMedia>): ReturnType<typeof uploadMedia> {
  try {
    return await uploadMedia(...args);
  } catch (e) {
    throw new Error(plainMessage(e instanceof Error ? e.message : undefined));
  }
}

/** `api` already unwraps axios, so `data` is the server's body itself. */
function unwrap<T>(res: ApiResponse<T>): T {
  check(res);
  if (res.data === undefined) throw new Error(GENERIC_ERROR);
  return res.data;
}

const project = async (call: Promise<ApiResponse<{ project: LyricProject }>>) => unwrap(await call).project;

/**
 * A sound file goes up as audio, so the server keeps its own format and makes no video copy of it;
 * anything else is a video. An `audio/` or `video/` type is trusted; a file with no type or a
 * generic one (some phones send `application/octet-stream` for a .caf or .flac) is judged by its name.
 */
export function songUploadKind(file: File): UploadKind {
  const type = file.type.toLowerCase();
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'source-video';
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  // A video name (.mp4, .mov, .m4v, .webm, .mkv) and anything unrecognised go up as a video, as before.
  return 'source-video';
}

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
    const up = await upload(file, file.name, songUploadKind(file), onProgress);
    if (!up.file) throw new Error('The song did not upload. Please try again.');
    return project(api.post(`${BASE}/${id}/song`, { path: up.file }, undefined, SLOW_CALL));
  },
  setSheet: (id: string, sheet: string) => project(api.put(`${BASE}/${id}/sheet`, { sheet })),
  align: (id: string) => project(api.post(`${BASE}/${id}/align`, {})),
  patchLine: (id: string, lineId: string, patch: { start?: number; effect?: LyricEffect }) =>
    project(api.patch(`${BASE}/${id}/lines/${lineId}`, patch)),
  /** The effect each timed line will really get (a line set to Auto shows the one the video picks), by line id. */
  async publishDraft(id: string): Promise<LyricPublishDraft> {
    return unwrap(await api.get<{ draft: LyricPublishDraft }>(`${BASE}/${id}/publish-draft`)).draft;
  },
  async effects(id: string): Promise<Record<string, LyricEffect>> {
    return unwrap(await api.get<{ effects: Record<string, LyricEffect> }>(`${BASE}/${id}/effects`)).effects;
  },
  setLook: (id: string, look: Partial<LyricProject['look']>) => project(api.put(`${BASE}/${id}/look`, look)),
  setBackground: (id: string, path: string | null, fit?: BackgroundFit) =>
    project(api.put(`${BASE}/${id}/background`, { path, ...(fit ? { fit } : {}) }, undefined, SLOW_CALL)),
  async uploadBackground(id: string, file: File, onProgress?: (pct: number) => void): Promise<LyricProject> {
    const up = await upload(file, file.name, 'background', onProgress);
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
