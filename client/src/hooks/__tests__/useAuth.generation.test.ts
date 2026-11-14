import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
vi.mock('../../lib/firebase', () => ({ firebaseEmailLogin: vi.fn(), firebaseEmailSignup: vi.fn(), firebaseGoogleLogin: vi.fn(), firebaseRefreshIdTokenAfterVerify: vi.fn(), firebaseResendEmailVerification: vi.fn(), getFirebaseAuthErrorMessage: () => 'Synthetic provider failure' }));
import * as firebase from '../../lib/firebase';
import { useAuth } from '../useAuth';
import { api, AUTH_INVALID_EVENT } from '../../lib/api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
type Reply = { status?: number; data?: unknown };
type Request = { config: InternalAxiosRequestConfig; reply: ReturnType<typeof deferred<Reply>> };
let pending: Request[];
const originalAdapter = axios.defaults.adapter;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); useAuth.getState().logout();
  useAuth.setState({ firebaseEnabled: false });
  pending = [];
  axios.defaults.adapter = async config => {
    const reply = deferred<Reply>(); pending.push({ config, reply });
    const result = await reply.promise;
    const response = { status: result.status ?? 200, data: result.data, statusText: '', headers: new AxiosHeaders(), config };
    if (response.status >= 400) throw new AxiosError('Synthetic transport failure', 'ERR_BAD_REQUEST', config, undefined, response);
    return response;
  };
});
afterEach(() => { axios.defaults.adapter = originalAdapter; useAuth.getState().logout(); });
async function take(url: string) {
  await vi.waitFor(() => expect(pending.some(r => r.config.url === url)).toBe(true));
  const index = pending.findIndex(r => r.config.url === url);
  return pending.splice(index, 1)[0];
}
async function login(token = 'fixture-B') {
  const task = useAuth.getState().login('fixture@example.invalid', 'fixture-password');
  (await take('/api/auth/login')).reply.resolve({ data: { token } });
  expect(await task).toBe(true);
}
async function startMe() {
  const task = useAuth.getState().checkStatus();
  (await take('/api/auth/status')).reply.resolve({ data: { hasUser: true, firebaseEnabled: true } });
  return { task, me: await take('/api/auth/me') };
}
async function hydrate(owner = 'owner-B') {
  const check = await startMe();
  check.me.reply.resolve({ data: { user: { sub: owner, emailVerified: true } } });
  await check.task;
}
async function assertB(token = 'fixture-B', owner = 'owner-B') {
  expect(useAuth.getState()).toMatchObject({ token, userId: owner, emailVerified: true, isLoading: false, error: null });
  expect(api.getToken()).toBe(token);
  const request = api.get('/synthetic-header-probe');
  const probe = await take('/synthetic-header-probe');
  expect(probe.config.headers.Authorization).toBe(`Bearer ${token}`);
  probe.reply.resolve({ data: {} }); await request;
}

it.each([200, 401])('late A /me %s cannot change B store, persisted bearer, owner, cache or invalid event', async status => {
  await login('fixture-A');
  const old = await startMe();
  expect(old.me.config.headers.Authorization).toBe('Bearer fixture-A');
  useAuth.getState().logout(); await login();
  // B must issue its own check while A is still unresolved.
  await hydrate();
  const invalid = vi.fn(); window.addEventListener(AUTH_INVALID_EVENT, invalid);
  old.me.reply.resolve({ status, data: { user: { sub: 'owner-A', emailVerified: false } } });
  await old.task;
  await assertB(); expect(localStorage.getItem('BF_EMAIL_VERIFIED')).toBe('true');
  expect(invalid).not.toHaveBeenCalled(); window.removeEventListener(AUTH_INVALID_EVENT, invalid);
});

it('logout prevents a late /me success from resurrecting a session', async () => {
  await login('fixture-A'); const old = await startMe();
  useAuth.getState().logout();
  old.me.reply.resolve({ data: { user: { sub: 'owner-A', emailVerified: true } } }); await old.task;
  expect(useAuth.getState()).toMatchObject({ token: null, userId: null, emailVerified: false, isLoading: false });
  expect(api.getToken()).toBeNull();
});

it('generation rejects token ABA rather than comparing only token strings', async () => {
  await login('fixture-A'); const old = await startMe();
  useAuth.getState().logout(); await login(); useAuth.getState().logout();
  await login('fixture-A'); await hydrate('new-owner-A');
  old.me.reply.resolve({ data: { user: { sub: 'obsolete-owner-A', emailVerified: false } } }); await old.task;
  await assertB('fixture-A', 'new-owner-A');
});

it('late bootstrap status does not start /me or overwrite newer caches', async () => {
  await login('fixture-A'); const old = useAuth.getState().checkStatus();
  const status = await take('/api/auth/status');
  useAuth.getState().logout(); await login(); await hydrate();
  status.reply.resolve({ data: { hasUser: false, firebaseEnabled: false } }); await old;
  await assertB(); expect(localStorage.getItem('BF_HAS_USER')).toBe('true');
  expect(localStorage.getItem('BF_FIREBASE_ENABLED')).toBe('true');
  expect(pending).toHaveLength(0);
});

it('only the owning check can clear single-flight; same-session checks still coalesce', async () => {
  await login('fixture-A'); const old = await startMe();
  useAuth.getState().logout(); await login(); const current = await startMe();
  old.me.reply.resolve({ data: { user: { sub: 'owner-A' } } }); await old.task;
  const sibling = useAuth.getState().checkStatus();
  await Promise.resolve(); expect(pending).toHaveLength(0);
  current.me.reply.resolve({ data: { user: { sub: 'owner-B', emailVerified: true } } });
  await Promise.all([current.task, sibling]); await assertB();
});

it.each(['login', 'setup'] as const)('out-of-order %s success cannot replace B', async method => {
  const task = method === 'login' ? useAuth.getState().login('old@example.invalid', 'fixture') : useAuth.getState().setup('old@example.invalid', 'fixture', 'fixture-setup');
  const old = await take(`/api/auth/${method}`);
  await login(); await hydrate();
  old.reply.resolve({ data: { token: 'fixture-A' } }); expect(await task).toBe(false); await assertB();
});

it.each(['loginWithFirebaseEmail', 'signupWithFirebaseEmail', 'loginWithFirebaseGoogle', 'refreshAfterVerify'] as const)('late provider completion in %s never exchanges or persists old credentials', async method => {
  const provider = deferred<any>();
  vi.mocked(firebase.firebaseEmailLogin).mockReturnValue(provider.promise);
  vi.mocked(firebase.firebaseEmailSignup).mockReturnValue(provider.promise);
  vi.mocked(firebase.firebaseGoogleLogin).mockReturnValue(provider.promise);
  vi.mocked(firebase.firebaseRefreshIdTokenAfterVerify).mockReturnValue(provider.promise);
  const task = method === 'loginWithFirebaseGoogle' || method === 'refreshAfterVerify' ? useAuth.getState()[method]() : useAuth.getState()[method]('old@example.invalid', 'fixture');
  if (method === 'signupWithFirebaseEmail') {
    (await take('/api/auth/check-signup-eligibility')).reply.resolve({ data: { eligible: true } });
    await vi.waitFor(() => expect(firebase.firebaseEmailSignup).toHaveBeenCalled());
  }
  useAuth.getState().logout(); await login(); await hydrate();
  provider.resolve(method === 'refreshAfterVerify' ? { idToken: 'synthetic-provider-A', emailVerified: true } : 'synthetic-provider-A');
  expect(await task).toBe(false); expect(pending).toHaveLength(0); await assertB();
});

it('current 401 still expires the session; transient failure preserves verification and token', async () => {
  await login(); await hydrate();
  const offline = await startMe(); offline.me.reply.resolve({ status: 503 }); await offline.task;
  expect(useAuth.getState()).toMatchObject({ token: 'fixture-B', emailVerified: true, userId: null, isLoading: false });
  const expired = await startMe(); expired.me.reply.resolve({ status: 401 }); await expired.task;
  expect(useAuth.getState()).toMatchObject({ token: null, userId: null, emailVerified: false, isLoading: false });
  expect(api.getToken()).toBeNull(); expect(localStorage.getItem('BF_EMAIL_VERIFIED')).toBe('false');
});

it.each([200, 401])('late Firebase exchange %s cannot overwrite or invalidate B', async status => {
  vi.mocked(firebase.firebaseEmailLogin).mockResolvedValue('synthetic-provider-A');
  const task = useAuth.getState().loginWithFirebaseEmail('old@example.invalid', 'fixture');
  const exchange = await take('/api/auth/firebase');
  useAuth.getState().logout(); await login(); await hydrate();
  exchange.reply.resolve({ status, data: { token: 'fixture-A' } });
  expect(await task).toBe(false); await assertB();
});

it('logout also invalidates pending login and setup requests', async () => {
  const task = useAuth.getState().setup('old@example.invalid', 'fixture', 'fixture-key');
  const setup = await take('/api/auth/setup'); useAuth.getState().logout();
  setup.reply.resolve({ data: { token: 'fixture-A' } });
  expect(await task).toBe(false);
  expect(useAuth.getState()).toMatchObject({ token: null, userId: null, isLoading: false });
  expect(api.getToken()).toBeNull();
});

it('credential installation invalidates a check started during the same login intent, even for equal token values', async () => {
  await login('fixture-A');
  const task = useAuth.getState().login('new@example.invalid', 'fixture');
  const request = await take('/api/auth/login');
  const old = await startMe();
  request.reply.resolve({ data: { token: 'fixture-A' } }); expect(await task).toBe(true);
  await hydrate('current-owner');
  old.me.reply.resolve({ status: 401 }); await old.task;
  await assertB('fixture-A', 'current-owner');
});

it('current Firebase sign-in still hydrates verified super-admin identity', async () => {
  vi.mocked(firebase.firebaseGoogleLogin).mockResolvedValue('synthetic-provider-B');
  const task = useAuth.getState().loginWithFirebaseGoogle();
  (await take('/api/auth/firebase')).reply.resolve({ data: { token: 'fixture-B' } });
  (await take('/api/auth/status')).reply.resolve({ data: { hasUser: true, firebaseEnabled: true } });
  (await take('/api/auth/me')).reply.resolve({ data: { user: { sub: 'owner-B', emailVerified: false, role: 'super_admin' } } });
  expect(await task).toBe(true); await assertB(); expect(useAuth.getState().isSuperAdmin).toBe(true);
});

