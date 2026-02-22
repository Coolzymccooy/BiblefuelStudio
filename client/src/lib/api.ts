import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'BF_TOKEN';
export const AUTH_INVALID_EVENT = 'BF_AUTH_INVALID';

export interface ApiResponse<T = any> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

class ApiClient {
    public readonly baseUrl = (() => {
        const envBase = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
        if (envBase) return envBase;
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return `http://${window.location.hostname}:5051`;
        }
        return '';
    })();

    private getToken(): string | null {
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
        customHeaders?: Record<string, string>
    ): Promise<ApiResponse<T>> {
        try {
            const response = await axios.post(url, body, {
                headers: this.getHeaders(customHeaders),
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
            const errorMessage = axiosError.response?.data?.error || axiosError.message || 'Network error';
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
