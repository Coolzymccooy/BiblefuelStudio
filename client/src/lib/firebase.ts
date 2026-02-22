import { initializeApp, getApps } from 'firebase/app';
import {
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    getAuth,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signInWithPopup,
} from 'firebase/auth';

const firebaseConfig = {
    apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
    authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};

export function isFirebaseClientEnabled() {
    return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

function getFirebaseAuth() {
    if (!isFirebaseClientEnabled()) {
        throw new Error('Firebase client is not configured');
    }
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    return getAuth(app);
}

export async function firebaseEmailLogin(email: string, password: string) {
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user.getIdToken();
}

export async function firebaseEmailSignup(email: string, password: string) {
    const auth = getFirebaseAuth();
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    return cred.user.getIdToken();
}

export async function firebaseGoogleLogin() {
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    return cred.user.getIdToken();
}

export async function firebaseRequestPasswordReset(email: string) {
    const auth = getFirebaseAuth();
    await sendPasswordResetEmail(auth, String(email || '').trim());
}

const FIREBASE_AUTH_MESSAGES: Record<string, string> = {
    'auth/email-already-in-use': 'This email already has an account. Sign in or reset your password.',
    'auth/invalid-credential': 'Email or password is incorrect. Try again or reset your password.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-not-found': 'No account exists with this email. Create an account first.',
    'auth/wrong-password': 'Email or password is incorrect. Please try again.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was canceled before completion.',
    'auth/popup-blocked': 'Popup was blocked by your browser. Allow popups and try again.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled yet in Firebase.',
    'auth/unauthorized-domain': 'This domain is not authorized for Firebase sign-in.',
    'auth/weak-password': 'Password is too weak. Use at least 8 characters with a mix of letters and numbers.',
};

function extractFirebaseAuthCode(error: unknown): string | null {
    if (!error) return null;

    if (typeof error === 'object') {
        const rawCode = String((error as { code?: string })?.code || '').trim().toLowerCase();
        if (rawCode.startsWith('auth/')) return rawCode;
    }

    if (error instanceof Error) {
        const message = String(error.message || '').toLowerCase();
        const match = message.match(/auth\/[a-z0-9-]+/);
        if (match?.[0]) return match[0];
    }

    return null;
}

export function getFirebaseAuthErrorMessage(error: unknown, fallback = 'Unable to complete authentication. Please try again.') {
    const code = extractFirebaseAuthCode(error);
    if (code && FIREBASE_AUTH_MESSAGES[code]) {
        return FIREBASE_AUTH_MESSAGES[code];
    }

    if (error instanceof Error) {
        const msg = String(error.message || '').trim();
        if (msg.toLowerCase().includes('firebase auth not configured on server')) {
            return 'Server Firebase authentication is not configured yet.';
        }
        if (msg.toLowerCase().includes('missing or insufficient permissions')) {
            return 'Your account does not have permission for this operation.';
        }
    }

    return fallback;
}
