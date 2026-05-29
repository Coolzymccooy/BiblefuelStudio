import { create } from 'zustand';
import { api } from '../lib/api';
import { firebaseEmailLogin, firebaseEmailSignup, firebaseGoogleLogin, firebaseRefreshIdTokenAfterVerify, firebaseResendEmailVerification, getFirebaseAuthErrorMessage } from '../lib/firebase';

const readStoredToken = (): string | null => {
    const token = localStorage.getItem('BF_TOKEN');
    if (!token || token === 'null' || token === 'undefined') return null;
    return token;
};

const FIREBASE_ENABLED_CACHE_KEY = 'BF_FIREBASE_ENABLED';
const HAS_USER_CACHE_KEY = 'BF_HAS_USER';

const readCachedBool = (key: string, fallback: boolean): boolean => {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return raw === 'true';
    } catch {
        return fallback;
    }
};

const writeCachedBool = (key: string, value: boolean): void => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(key, String(value)); } catch { /* localStorage full / disabled */ }
};

// Single-flight guard. Without this, every Layout / HomePage mount cycle
// (including StrictMode double-mounts in dev) and every transient re-render
// fires a new checkStatus, which can stack 20+ in-flight /auth/me requests
// against a busy proxy and leave the UI stuck on "isLoading=true" forever.
let inflightCheckStatus: Promise<void> | null = null;

interface AuthState {
    token: string | null;
    hasUser: boolean;
    firebaseEnabled: boolean;
    emailVerified: boolean;
    email: string | null;
    role: string | null;
    isSuperAdmin: boolean;
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
    // Hydrate from the last-known-good cache instead of defaulting to false.
    // Without this, every fresh page load shows the setup-key screen until
    // /auth/status resolves — and if the proxy is hung, that "until" is
    // forever, which is exactly the bug we hit.
    hasUser: readCachedBool(HAS_USER_CACHE_KEY, false),
    firebaseEnabled: readCachedBool(FIREBASE_ENABLED_CACHE_KEY, false),
    emailVerified: false,
    email: null,
    role: null,
    isSuperAdmin: false,
    // Truthful initial state: checkStatus() hasn't run yet, so consumers
    // that gate behavior on isLoading (e.g. HomePage's default-view picker)
    // hold off until /auth/status resolves instead of firing with stale
    // false defaults.
    isLoading: true,
    error: null,

    checkStatus: async () => {
        // Coalesce concurrent calls. Layout + HomePage both fire checkStatus
        // on mount; StrictMode double-mounts double that; any HMR cycle
        // re-fires. Without coalescing, a slow first request can have a
        // dozen siblings stacked behind it that all eventually time out
        // and clear the auth state to the same "logged out" view 12 times
        // in a row.
        if (inflightCheckStatus) return inflightCheckStatus;
        inflightCheckStatus = (async () => {
        set({ isLoading: true, error: null });
        const statusResponse = await api.get('/api/auth/status');
        // Preserve last-known-good when the request fails (network blip,
        // proxy backed up). Flipping firebaseEnabled to `false` on a
        // transient failure is what drops the user into the setup-key
        // screen — we'd rather show a stale-but-useful login form.
        const prev = get();
        const firebaseEnabled = statusResponse.ok
            ? Boolean(statusResponse.data?.firebaseEnabled)
            : prev.firebaseEnabled;
        const hasUser = statusResponse.ok
            ? Boolean(statusResponse.data?.hasUser)
            : prev.hasUser;
        if (statusResponse.ok) {
            writeCachedBool(FIREBASE_ENABLED_CACHE_KEY, firebaseEnabled);
            writeCachedBool(HAS_USER_CACHE_KEY, hasUser);
        }
        const token = get().token || readStoredToken();

        if (token) {
            const meResponse = await api.get('/api/auth/me');
            // 401 = real auth failure → clear token. Any other failure
            // (network error, 5xx, timeout) is transient — keep the token
            // and surface an error so the user can retry, instead of
            // logging them out on a flaky connection.
            if (!meResponse.ok) {
                if (meResponse.status === 401) {
                    api.setToken(null);
                    set({
                        token: null,
                        hasUser,
                        firebaseEnabled,
                        emailVerified: false,
                        email: null,
                        role: null,
                        isSuperAdmin: false,
                        isLoading: false,
                        error: 'Session expired. Please login again.',
                    });
                } else {
                    set({
                        hasUser,
                        firebaseEnabled,
                        isLoading: false,
                        error: meResponse.error || 'Failed to validate session',
                    });
                }
                return;
            }
            const me = (meResponse.data as { user?: { email?: string; emailVerified?: boolean; role?: string; isSuperAdmin?: boolean } })?.user || {};
            // Super-admin (identified by SUPER_ADMIN_EMAIL env match on the
            // server) bypasses the verify-email gate so the operator can
            // never lock themselves out of their own deploy. /me returns an
            // explicit `isSuperAdmin` flag derived from env, so we don't
            // have to infer it from the `role` column in users.json
            // (which is purely informational and stays "user" for
            // Firebase-created accounts even when they match the env).
            const admin = Boolean(me.isSuperAdmin) || me.role === 'super_admin';
            const verified = Boolean(me.emailVerified) || admin;
            set({
                token,
                hasUser,
                firebaseEnabled,
                emailVerified: verified,
                email: me.email || null,
                role: me.role || null,
                isSuperAdmin: admin,
                isLoading: false,
                error: null,
            });
        } else {
            set({
                hasUser,
                firebaseEnabled,
                emailVerified: false,
                email: null,
                role: null,
                isSuperAdmin: false,
                isLoading: false,
                error: statusResponse.ok ? null : (statusResponse.error || 'Failed to check auth status'),
            });
        }
        })();
        try { await inflightCheckStatus; } finally { inflightCheckStatus = null; }
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
            // Pre-check approval BEFORE invoking Firebase. Without this,
            // Firebase silently creates an orphan account and ships a
            // verification email even when our server gate would reject —
            // user ends up confused, holding a verification link for an
            // account that can never actually sign in.
            const probe = await api.post<{ eligible: boolean; reason?: string }>(
                '/api/auth/check-signup-eligibility',
                { email },
            );
            if (probe.ok && probe.data && probe.data.eligible === false) {
                const reason = probe.data.reason || 'NOT_APPROVED';
                const message = reason === 'ALREADY_REGISTERED'
                    ? 'This email already has a Biblefuel Studio account. Sign in or reset your password.'
                    : "This email hasn't been approved for Biblefuel Studio yet. Request access from the landing page and wait for an approval reply.";
                set({ isLoading: false, error: message });
                return false;
            }

            const idToken = await firebaseEmailSignup(email, password);
            const response = await api.post('/api/auth/firebase', { idToken });
            if (response.ok && response.data?.token) {
                api.setToken(response.data.token);
                // Re-sync the full auth state (email, role, emailVerified,
                // isSuperAdmin) from /api/auth/me so the verify-email gate
                // and other UI affordances respect the freshly signed-in
                // identity. Without this, emailVerified stays at the
                // default `false` and verified users are stuck on the gate.
                set({ token: response.data.token, hasUser: true });
                await get().checkStatus();
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
                // Re-sync the full auth state (email, role, emailVerified,
                // isSuperAdmin) from /api/auth/me so the verify-email gate
                // and other UI affordances respect the freshly signed-in
                // identity. Without this, emailVerified stays at the
                // default `false` and verified users are stuck on the gate.
                set({ token: response.data.token, hasUser: true });
                await get().checkStatus();
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
                // Re-sync the full auth state (email, role, emailVerified,
                // isSuperAdmin) from /api/auth/me so the verify-email gate
                // and other UI affordances respect the freshly signed-in
                // identity. Without this, emailVerified stays at the
                // default `false` and verified users are stuck on the gate.
                set({ token: response.data.token, hasUser: true });
                await get().checkStatus();
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
            if (emailVerified) {
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
            }
            // Firebase client-side reload sometimes returns stale state even
            // after the user clicked the verify link. Ask the server to check
            // Firebase Admin directly — if it confirms verification, refresh
            // /me so the gate clears without forcing a sign-out/sign-in.
            const serverCheck = await api.post<{ emailVerified: boolean }>('/api/auth/refresh-verify');
            if (serverCheck.ok && serverCheck.data?.emailVerified) {
                await get().checkStatus();
                set({ isLoading: false, error: null });
                return true;
            }
            set({ isLoading: false, error: 'Still unverified. Open the link in the email we sent, then try again.' });
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
        set({ token: null, hasUser: false, emailVerified: false, email: null, role: null, isSuperAdmin: false, error: null });
    },
}));
