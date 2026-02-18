import { create } from 'zustand';
import { api } from '../lib/api';

const readStoredToken = (): string | null => {
    const token = localStorage.getItem('BF_TOKEN');
    if (!token || token === 'null' || token === 'undefined') return null;
    return token;
};

interface AuthState {
    token: string | null;
    hasUser: boolean;
    isLoading: boolean;
    error: string | null;

    checkStatus: () => Promise<void>;
    setup: (email: string, password: string, setupKey: string) => Promise<boolean>;
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
    token: readStoredToken(),
    hasUser: false,
    isLoading: false,
    error: null,

    checkStatus: async () => {
        set({ isLoading: true, error: null });
        const statusResponse = await api.get('/api/auth/status');
        const hasUser = Boolean(statusResponse.ok && statusResponse.data?.hasUser);
        const token = get().token || readStoredToken();

        if (token) {
            const meResponse = await api.get('/api/auth/me');
            if (!meResponse.ok) {
                api.setToken(null);
                set({
                    token: null,
                    hasUser,
                    isLoading: false,
                    error: meResponse.status === 401 ? 'Session expired. Please login again.' : (meResponse.error || 'Failed to validate session'),
                });
                return;
            }
            set({ token, hasUser, isLoading: false, error: null });
        } else {
            set({
                hasUser,
                isLoading: false,
                error: statusResponse.ok ? null : (statusResponse.error || 'Failed to check auth status'),
            });
        }
    },

    setup: async (email: string, password: string, setupKey: string) => {
        set({ isLoading: true, error: null });
        const response = await api.post('/api/auth/setup',
            { email, password },
            { 'X-Setup-Key': setupKey }
        );

        if (response.ok && response.data?.token) {
            api.setToken(response.data.token);
            set({ token: response.data.token, hasUser: true, isLoading: false });
            return true;
        } else {
            set({ isLoading: false, error: response.error || 'Setup failed' });
            return false;
        }
    },

    login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        const response = await api.post('/api/auth/login', { email, password });

        if (response.ok && response.data?.token) {
            api.setToken(response.data.token);
            set({ token: response.data.token, hasUser: true, isLoading: false });
            return true;
        } else {
            set({ isLoading: false, error: response.error || 'Login failed' });
            return false;
        }
    },

    logout: () => {
        api.setToken(null);
        set({ token: null, hasUser: false, error: null });
    },
}));
