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
