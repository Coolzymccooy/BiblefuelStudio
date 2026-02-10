import { create } from 'zustand';
import { api } from '../lib/api';

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

export const useAuth = create<AuthState>((set) => ({
    token: localStorage.getItem('BF_TOKEN'),
    hasUser: false,
    isLoading: false,
    error: null,

    checkStatus: async () => {
        set({ isLoading: true, error: null });
        const response = await api.get('/api/auth/status');

        if (response.ok && response.data) {
            set({ hasUser: response.data.hasUser, isLoading: false });
        } else {
            set({ isLoading: false, error: response.error || 'Failed to check auth status' });
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
