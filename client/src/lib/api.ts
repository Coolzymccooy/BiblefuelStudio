import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'BF_TOKEN';

export interface ApiResponse<T = any> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

class ApiClient {
    public readonly baseUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `http://${window.location.hostname}:10000`
        : '';

    private getToken(): string | null {
        return localStorage.getItem(TOKEN_KEY);
    }

    setToken(token: string | null) {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
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
        const fullUrl = token ? `${url}?token=${token}` : url;
        window.open(fullUrl, '_blank');
    }

    private handleError(error: unknown): ApiResponse {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<any>;
            return {
                ok: false,
                status: axiosError.response?.status || 500,
                error: axiosError.response?.data?.error || axiosError.message || 'Network error',
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
