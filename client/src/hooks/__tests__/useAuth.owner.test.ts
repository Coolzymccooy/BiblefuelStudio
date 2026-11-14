import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../lib/firebase', () => ({ firebaseEmailLogin: vi.fn(), firebaseEmailSignup: vi.fn(), firebaseGoogleLogin: vi.fn(), firebaseRefreshIdTokenAfterVerify: vi.fn(), firebaseResendEmailVerification: vi.fn(), getFirebaseAuthErrorMessage: vi.fn() }));
import { useAuth } from '../useAuth';
import { api } from '../../lib/api';
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear();
  useAuth.setState({ token: 'synthetic-session-fixture', userId: null, isLoading: false });
});
it('takes owner identity from the normal authenticated /me response sub, not email or a decoded token', async () => {
  vi.spyOn(api, 'get').mockImplementation(async url => url === '/api/auth/me'
    ? { ok: true, status: 200, data: { user: { sub: 'synthetic-owner-uid', email: 'fixture@example.invalid', emailVerified: true } } }
    : { ok: true, status: 200, data: { hasUser: true, firebaseEnabled: true } });
  await useAuth.getState().checkStatus();
  expect(useAuth.getState().userId).toBe('synthetic-owner-uid');
  useAuth.getState().logout(); expect(useAuth.getState().userId).toBeNull();
});
it('a failed identity refresh cannot expose the previous owner journal', async () => {
  useAuth.setState({ userId: 'old-owner' });
  vi.spyOn(api, 'get').mockResolvedValue({ ok: false, status: 503, error: 'Synthetic offline' });
  await useAuth.getState().checkStatus();
  expect(useAuth.getState().userId).toBeNull(); expect(useAuth.getState().isLoading).toBe(false);
});
