import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'BF_TOKEN';
export const AUTH_INVALID_EVENT = 'BF_AUTH_INVALID';

// Hard ceiling on any single request. Without this, a hung Vite proxy
// (server still booting, network blip) leaves axios calls pending forever.
// Pages that gate render on `isLoading` then stay blank, and any polling
// hook can pile up hundreds of in-flight requests against an unreachable
// backend. 15s is comfortably above ffmpeg-render endpoints which return
// fast (the heavy work is queued); long-running jobs go through SSE which
// uses EventSource, not axios.
const DEFAULT_TIMEOUT_MS = 15_000;

// File uploads (base64 data URLs up to ~270 MB) can't possibly finish inside
// the 15s default. Give them a generous ceiling; progress is surfaced via
// onUploadProgress so a stalled upload is still visible to the user.
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

// Files at/under this go through the fast one-shot upload (comfortably under
// Cloudflare's 100 MB request-body cap on prod). Larger ones must use the
// resumable direct-to-storage path (see storyApi.uploadAudio / resumableUpload).
// Mirror of the server's `directMaxMb` in routes/media.js.
export const DIRECT_UPLOAD_MAX_BYTES = 90 * 1024 * 1024;
export const RESUMABLE_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

// Server-side FFmpeg media ops (trim re-encode, master) are synchronous and
// run far past the 15s default — accurately re-encoding a 25-minute selection
// takes tens of seconds. Without this the request aborts with "timeout of
// 15000ms exceeded" and the trim never lands. 10 minutes is a safe ceiling.
export const MEDIA_OP_TIMEOUT_MS = 10 * 60_000;

// Transcription (OpenAI whisper-1) runs server-side and Whisper's own latency
// scales with audio length — a ~27-min sermon can take a couple of minutes.
// Sit comfortably above the server's per-chunk Whisper timeout (5 min) so the
// client doesn't abort a call the server would have completed.
// NOTE: on the live site, a synchronous request still can't outlast the CDN/
// proxy edge timeout (~100s) — very long audio there needs the async/background
// path. This ceiling only helps same-origin/local (no edge proxy).
export const TRANSCRIBE_TIMEOUT_MS = 8 * 60_000;

// Server-side generation (TTS synthesis, audio mastering, voice compare) runs
// far longer than the 15s default — a self-hosted Chatterbox synth of a full
// sermon can take minutes. Without this, those POSTs abort at 15s with a
// "timeout of 15000ms exceeded" and the user can't generate audio at all.
export const GENERATE_TIMEOUT_MS = 15 * 60_000;

export interface PostOptions {
    /** Override the default 15s request timeout (e.g. UPLOAD_TIMEOUT_MS). */
    timeout?: number;
    /** Called with 0..100 as the request body uploads. */
    onUploadProgress?: (percent: number) => void;
}

export interface ApiResponse<T = any> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

class ApiClient {
    // Always use relative URLs so requests target the same origin that served
    // the page. In single-process mode Express serves both the bundle and the
    // API on one port; in dual-process dev mode Vite proxies /api and /outputs
    // through to Express. Setting VITE_API_BASE_URL at build time still wins
    // when the API genuinely lives on a different origin.
    public readonly baseUrl = (() => {
        const envBase = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
        if (envBase) return envBase;
        return '';
    })();

    // Base origin for media under /outputs (rendered video, sermon audio,
    // thumbnails). In production these are served from a grey-cloud subdomain
    // that bypasses Cloudflare: Cloudflare's proxy strips HTTP byte-range
    // support (answers Range requests with a chunked 200 instead of 206), which
    // makes iOS Safari/QuickTime refuse to play the file (broken-play icon)
    // while desktop/Android still play. The origin honours Range correctly, so
    // pointing media straight at it fixes iOS. Configurable via
    // VITE_MEDIA_BASE_URL; otherwise derived for the known prod host; otherwise
    // same-origin (dev / single-process).
    public readonly mediaBaseUrl = (() => {
        const envBase = String(import.meta.env.VITE_MEDIA_BASE_URL || '').trim().replace(/\/+$/, '');
        if (envBase) return envBase;
        if (typeof window !== 'undefined' && window.location.hostname === 'biblefuel.tiwaton.co.uk') {
            return 'https://media.tiwaton.co.uk';
        }
        return this.baseUrl;
    })();

    /** Absolute URL for a file under /outputs, served from the media origin. */
    mediaUrl(fileNameOrPath: string | undefined | null): string {
        const name = String(fileNameOrPath || '').split(/[\\/]/).pop() || '';
        if (!name) return '';
        return `${this.mediaBaseUrl}/outputs/${name}`;
    }

    // Exposed (not private) because EventSource can't send custom headers, so
    // SSE consumers need to append the token as a query string. Server's
    // requireAuth accepts both `Authorization: Bearer` and `?token=`.
    getToken(): string | null {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token || token === 'null' || token === 'undefined') return null;
        return token;
    }

    setToken(token: string | null) {
        const normalized = String(token || '').trim();
        if (normalized && normalized !== 'null' && normalized !== 'undefined') {
            localStorage.setItem(TOKEN_KEY, normalized);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }
    }

    private getHeaders(customHeaders?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders,
        };

        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return headers;
    }

    async get<T = any>(url: string, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
        try {
            const response = await axios.get(url, {
                headers: this.getHeaders(customHeaders),
                timeout: DEFAULT_TIMEOUT_MS,
            });
            return {
                ok: true,
                status: response.status,
                data: response.data,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async post<T = any>(
        url: string,
        body?: any,
        customHeaders?: Record<string, string>,
        options?: PostOptions
    ): Promise<ApiResponse<T>> {
        try {
            const response = await axios.post(url, body, {
                headers: this.getHeaders(customHeaders),
                timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
                onUploadProgress: options?.onUploadProgress
                    ? (e) => {
                          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
                          options.onUploadProgress!(pct);
                      }
                    : undefined,
            });
            return {
                ok: true,
                status: response.status,
                data: response.data,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Upload a File/Blob as a RAW binary request body (no base64, no JSON).
     * The browser streams the bytes directly — ~1.37x smaller on the wire than
     * a base64 data URL and constant-memory on the server (it pipes to disk).
     * The original filename rides on the `?filename=` query so the server can
     * pick the right extension; the Content-Type carries the MIME.
     *
     * Mirrors `post()`'s return contract so call sites swap in cleanly.
     */
    async uploadRaw<T = any>(
        url: string,
        file: Blob,
        options?: PostOptions & { filename?: string }
    ): Promise<ApiResponse<T>> {
        try {
            const filename = options?.filename || (file as File).name || 'upload.bin';
            const headers: Record<string, string> = {
                'Content-Type': file.type || 'application/octet-stream',
            };
            const token = this.getToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const sep = url.includes('?') ? '&' : '?';
            const response = await axios.post(`${url}${sep}filename=${encodeURIComponent(filename)}`, file, {
                headers,
                timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
                onUploadProgress: options?.onUploadProgress
                    ? (e) => {
                          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
                          options.onUploadProgress!(pct);
                      }
                    : undefined,
            });
            return { ok: true, status: response.status, data: response.data };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async delete<T = any>(
        url: string,
        customHeaders?: Record<string, string>
    ): Promise<ApiResponse<T>> {
        try {
            const response = await axios.delete(url, {
                headers: this.getHeaders(customHeaders),
                timeout: DEFAULT_TIMEOUT_MS,
            });
            return {
                ok: true,
                status: response.status,
                data: response.data,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async patch<T = any>(
        url: string,
        body?: any,
        customHeaders?: Record<string, string>
    ): Promise<ApiResponse<T>> {
        try {
            const response = await axios.patch(url, body, {
                headers: this.getHeaders(customHeaders),
                timeout: DEFAULT_TIMEOUT_MS,
            });
            return {
                ok: true,
                status: response.status,
                data: response.data,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async put<T = any>(
        url: string,
        body?: any,
        customHeaders?: Record<string, string>
    ): Promise<ApiResponse<T>> {
        try {
            const response = await axios.put(url, body, {
                headers: this.getHeaders(customHeaders),
                timeout: DEFAULT_TIMEOUT_MS,
            });
            return {
                ok: true,
                status: response.status,
                data: response.data,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Force a real file download for a public /outputs media URL — reliably, on
     * iOS too. Two browser facts make the "obvious" approaches fail on iPhone:
     *   1. The HTML `download` attribute is IGNORED for cross-origin links
     *      (media lives on media.tiwaton.co.uk), so the browser just navigates.
     *   2. iOS Safari serves an inline-Content-Type MP4 by OPENING AND PLAYING
     *      it — even from a blob: URL — instead of saving. That's the reported
     *      "Download just opens and plays the video" bug.
     *
     * The only reliable cross-platform path is to let the SERVER force the
     * download: we hit the same URL with `?dl=<filename>`, which makes /outputs
     * respond with `Content-Disposition: attachment`. The browser then saves
     * the file (iOS offers "Save to Files"/Photos) instead of playing it. No
     * fetch/blob/CORS dance, so no user-gesture or memory limits to trip over.
     *
     * Returns true (kept for call-site compatibility).
     */
    downloadMedia(url: string, filename?: string): boolean {
        const name = (() => {
            const base = (filename || url.split(/[\\/?#]/).pop() || 'download').trim();
            return /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.mp4`;
        })();
        const dlUrl = `${url}${url.includes('?') ? '&' : '?'}dl=${encodeURIComponent(name)}`;
        const link = document.createElement('a');
        link.href = dlUrl;
        // Harmless on iOS/cross-origin (ignored there); helps desktop name the file.
        link.download = name;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        return true;
    }

    async download(url: string): Promise<void> {
        const token = this.getToken();
        try {
            const response = await axios.get(url, {
                headers: this.getHeaders(),
                responseType: 'blob',
            });
            const blob = new Blob([response.data]);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            const fallbackName = url.split('/').pop() || 'download';
            link.download = fallbackName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            const fullUrl = token ? `${url}?token=${token}` : url;
            window.open(fullUrl, '_blank');
        }
    }

    private handleError(error: unknown): ApiResponse {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<any>;
            const status = axiosError.response?.status || 500;
            const responseBody = axiosError.response?.data;
            const errorMessage = responseBody?.error || axiosError.message || 'Network error';
            if (status === 401) {
                this.setToken(null);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, {
                        detail: { status, error: errorMessage },
                    }));
                }
            }
            return {
                ok: false,
                status,
                error: status === 401 ? 'Session expired. Please login again.' : errorMessage,
                // Preserve the full server payload so callers can read
                // structured fields (bucket, used, limit, hint, etc.)
                // instead of just the top-level error code.
                data: responseBody,
            };
        }
        return {
            ok: false,
            status: 500,
            error: String(error),
        };
    }
}

export const api = new ApiClient();

export interface GenerateTimelineVideoRequest {
    projectId?: string;
    prompt: string;
    aspect?: '16:9' | '9:16' | '1:1';
    durationSec?: number;
    style?: string;
    seedImagePath?: string;
}

export interface GenerateTimelineVideoResponse {
    ok: boolean;
    provider?: string;
    publicUrl?: string;
    path?: string;
    error?: string;
    code?: string;
    skipped?: boolean;
}

export const videoGenApi = {
    status: () => api.get<{ ok: boolean; enabled: boolean }>('/api/video-gen/status'),
    generate: (body: GenerateTimelineVideoRequest) => api.post<GenerateTimelineVideoResponse>('/api/video-gen/generate', body, undefined, { timeout: GENERATE_TIMEOUT_MS }),
};

export interface TimelineRenderResponse {
    ok: boolean;
    jobId?: string;
    status?: 'queued' | 'running' | 'completed' | 'failed' | string;
    progress?: number;
    phase?: string;
    plan?: any;
    publicUrl?: string;
    file?: string;
    ignoredPlaceholders?: number;
    /** Which tracks the renderer composed, and which it left out. */
    coverage?: {
        included: Array<{ kind: string; label: string; used: number; total: number }>;
        omitted: Array<{ kind: string; label: string; count: number; reason: string }>;
        warnings: string[];
    } | null;
    /** Human-readable omissions, ready to show without further formatting. */
    warnings?: string[];
    generatedVoiceovers?: Array<{ clipId?: string; path?: string; outputPath?: string; provider?: string; fallbacks?: Array<{ provider: string; error: string }> }>;
    voiceProvidersUsed?: string[];
    voiceFallbacks?: Array<{ provider: string; error: string }>;
    note?: string;
    error?: string;
}

export const timelineApi = {
    render: (project: any, quality = 'proof_720p') => api.post<TimelineRenderResponse>('/api/timeline/render', { project, quality }, undefined, { timeout: DEFAULT_TIMEOUT_MS }),
    getRenderJob: (jobId: string) => api.get<TimelineRenderResponse>(`/api/timeline/render/${encodeURIComponent(jobId)}`),
    saveProject: (project: any) => api.put<{ ok: boolean; project: any }>(`/api/timeline/projects/${encodeURIComponent(project.id)}`, { project }),
    getProject: (projectId: string) => api.get<{ ok: boolean; project: any }>(`/api/timeline/projects/${encodeURIComponent(projectId)}`),
    listProjects: () => api.get<{ ok: boolean; projects: any[] }>('/api/timeline/projects'),
};
