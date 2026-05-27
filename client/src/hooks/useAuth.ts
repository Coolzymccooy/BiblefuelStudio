import { create } from 'zustand';
import { api } from '../lib/api';
import { firebaseEmailLogin, firebaseEmailSignup, firebaseGoogleLogin, firebaseRefreshIdTokenAfterVerify, firebaseResendEmailVerification, getFirebaseAuthErrorMessage } from '../lib/firebase';

const readStoredToken = (): string | null => {
    const token = localStorage.getItem('BF_TOKEN');
    if (!token || token === 'null' || token === 'undefined') return null;
    return token;
};

interface AuthState {
    token: string | null;
    hasUser: boolean;
    firebaseEnabled: boolean;
    emailVerified: boolean;
    email: string | null;
    isLoading: boolean;
    error: string | null;

    checkStatus: () => Promise<void>;
    setup: (email: string, password: string, setupKey: string) => Promise<boolean>;
    login: (email: string, password: string) => Promise<boolean>;
    signupWithFirebaseEmail: (email: string, password: string) => Promise<boolean>;
    loginWithFirebaseEmail: (email: string, password: string) => Promise<boolean>;
    loginWithFirebaseGoogle: () => Promise<boolean>;
    resendVerificationEmail: () => Promise<boolean>;
    refreshAfterVerify: () => Promise<boolean>;
    logout: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
    token: readStoredToken(),
    hasUser: false,
    firebaseEnabled: false,
    emailVerified: false,
    email: null,
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
                    emailVerified: false,
                    email: null,
                    isLoading: false,
                    error: meResponse.status === 401 ? 'Session expired. Please login again.' : (meResponse.error || 'Failed to validate session'),
                });
                return;
            }
            const me = (meResponse.data as { user?: { email?: string; emailVerified?: boolean; role?: string } })?.user || {};
            // Super-admin role implicitly bypasses verification gate so the
            // operator can never lock themselves out of their own deploy.
            const verified = Boolean(me.emailVerified) || me.role === 'super_admin';
            set({
                token,
                hasUser,
                firebaseEnabled,
                emailVerified: verified,
                email: me.email || null,
                isLoading: false,
                error: null,
            });
        } else {
            set({
                hasUser,
                firebaseEnabled,
                emailVerified: false,
                email: null,
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

    resendVerificationEmail: async () => {
        try {
            await firebaseResendEmailVerification();
            return true;
        } catch (err) {
            set({ error: getFirebaseAuthErrorMessage(err, 'Could not send the verification email. Try again in a moment.') });
            return false;
        }
    },

    refreshAfterVerify: async () => {
        set({ isLoading: true, error: null });
        try {
            const { idToken, emailVerified } = await firebaseRefreshIdTokenAfterVerify();
            if (!emailVerified) {
                set({ isLoading: false, error: 'Still unverified. Open the link in the email we sent, then try again.' });
                return false;
            }
            // Exchange the fresh Firebase id token (now carrying email_verified=true)
            // for a new Biblefuel JWT so server-side claims line up.
            const response = await api.post('/api/auth/firebase', { idToken });
            if (response.ok && response.data?.token) {
                api.setToken(response.data.token);
                set({ token: response.data.token, hasUser: true, emailVerified: true, isLoading: false, error: null });
                return true;
            }
            set({ isLoading: false, error: response.error || 'Verified, but could not refresh your session. Try logging out and back in.' });
            return false;
        } catch (err) {
            set({
                isLoading: false,
                error: getFirebaseAuthErrorMessage(err, 'Could not refresh your verification status.'),
            });
            return false;
        }
    },

    logout: () => {
        api.setToken(null);
        set({ token: null, hasUser: false, emailVerified: false, email: null, error: null });
    },
}));
