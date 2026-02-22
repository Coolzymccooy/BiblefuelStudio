import { create } from 'zustand';
import { api } from '../lib/api';
import { firebaseEmailLogin, firebaseEmailSignup, firebaseGoogleLogin, getFirebaseAuthErrorMessage } from '../lib/firebase';

const readStoredToken = (): string | null => {
    const token = localStorage.getItem('BF_TOKEN');
    if (!token || token === 'null' || token === 'undefined') return null;
    return token;
};

interface AuthState {
    token: string | null;
    hasUser: boolean;
    firebaseEnabled: boolean;
    isLoading: boolean;
    error: string | null;

    checkStatus: () => Promise<void>;
    setup: (email: string, password: string, setupKey: string) => Promise<boolean>;
    login: (email: string, password: string) => Promise<boolean>;
    signupWithFirebaseEmail: (email: string, password: string) => Promise<boolean>;
    loginWithFirebaseEmail: (email: string, password: string) => Promise<boolean>;
    loginWithFirebaseGoogle: () => Promise<boolean>;
    logout: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
    token: readStoredToken(),
    hasUser: false,
    firebaseEnabled: false,
    isLoading: false,
    error: null,

    checkStatus: async () => {
        set({ isLoading: true, error: null });
        const statusResponse = await api.get('/api/auth/status');
        const firebaseEnabled = Boolean(statusResponse.ok && statusResponse.data?.firebaseEnabled);
        const hasUser = Boolean(statusResponse.ok && statusResponse.data?.hasUser);
        const token = get().token || readStoredToken();

        if (token) {
            const meResponse = await api.get('/api/auth/me');
            if (!meResponse.ok) {
                api.setToken(null);
                set({
                    token: null,
                    hasUser,
                    firebaseEnabled,
                    isLoading: false,
                    error: meResponse.status === 401 ? 'Session expired. Please login again.' : (meResponse.error || 'Failed to validate session'),
                });
                return;
            }
            set({ token, hasUser, firebaseEnabled, isLoading: false, error: null });
        } else {
            set({
                hasUser,
                firebaseEnabled,
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

    signupWithFirebaseEmail: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
            const idToken = await firebaseEmailSignup(email, password);
            const response = await api.post('/api/auth/firebase', { idToken });
            if (response.ok && response.data?.token) {
                api.setToken(response.data.token);
                set({ token: response.data.token, hasUser: true, isLoading: false });
                return true;
            }
            set({ isLoading: false, error: response.error || 'Unable to create your account right now.' });
            return false;
        } catch (err) {
            set({
                isLoading: false,
                error: getFirebaseAuthErrorMessage(err, 'Unable to create your account right now.'),
            });
            return false;
        }
    },

    loginWithFirebaseEmail: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
            const idToken = await firebaseEmailLogin(email, password);
            const response = await api.post('/api/auth/firebase', { idToken });
            if (response.ok && response.data?.token) {
                api.setToken(response.data.token);
                set({ token: response.data.token, hasUser: true, isLoading: false });
                return true;
            }
            set({ isLoading: false, error: response.error || 'Unable to sign in right now.' });
            return false;
        } catch (err) {
            set({
                isLoading: false,
                error: getFirebaseAuthErrorMessage(err, 'Unable to sign in right now.'),
            });
            return false;
        }
    },

    loginWithFirebaseGoogle: async () => {
        set({ isLoading: true, error: null });
        try {
            const idToken = await firebaseGoogleLogin();
            const response = await api.post('/api/auth/firebase', { idToken });
            if (response.ok && response.data?.token) {
                api.setToken(response.data.token);
                set({ token: response.data.token, hasUser: true, isLoading: false });
                return true;
            }
            set({ isLoading: false, error: response.error || 'Google sign-in failed. Please try again.' });
            return false;
        } catch (err) {
            set({
                isLoading: false,
                error: getFirebaseAuthErrorMessage(err, 'Google sign-in failed. Please try again.'),
            });
            return false;
        }
    },

    logout: () => {
        api.setToken(null);
        set({ token: null, hasUser: false, error: null });
    },
}));
