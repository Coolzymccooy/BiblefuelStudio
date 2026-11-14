import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import express from 'express';

// Real loopback HTTP + actual middleware/routers/files/FFmpeg. Only provider
// transports are mocked. The runner additionally blocks all outbound sockets.
const root = fs.mkdtempSync(path.join(process.env.FINITE_TEST_SCRATCH || os.tmpdir(), 'bf-upload-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.OUTPUT_DIR = path.join(root, 'outputs');
process.env.JWT_SECRET = 'synthetic-upload-integration-secret-not-a-credential';
process.env.MULTITENANT = 'true';
process.env.SUPER_ADMIN_EMAIL = 'owner@upload.invalid';
process.env.REQUIRE_EMAIL_VERIFIED = 'true';
process.env.ZERNIO_API_KEY = 'synthetic-upload-provider-key';
process.env.ZERNIO_TIKTOK_ACCOUNT_ID = 'synthetic-tiktok';
process.env.ZERNIO_TIKTOK_PRIVACY_LEVEL = 'SELF_ONLY';
process.env.PUBLIC_BASE_URL = 'https://upload.invalid';
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT', 'SENTRY_DSN', 'YOUTUBE_CLIENT_SECRET']) delete process.env[key];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identities = Object.fromEntries(['owner', 'alice', 'bob'].map(id => [id, { id, email: `${id}@upload.invalid`, role: 'user', emailVerified: true }]));
const context = id => id === 'owner'
  ? { userId: id, dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true }
  : { userId: id, dataDir: path.join(process.env.DATA_DIR, 'users', id), outputDir: path.join(process.env.DATA_DIR, 'users', id, 'outputs'), isOwner: false };
const nativeSpawn = childProcess.spawn;
const children = [];
// Observe, never substitute, the actual proxy encoder. Match only task paths.
childProcess.spawn = function(command, args, options) {
  const proc = nativeSpawn.call(this, command, args, options);
  if (args.some(arg => typeof arg === 'string' && path.resolve(arg).startsWith(root + path.sep))) {
    const record = { proc, closed: false, code: null, done: null };
    record.done = new Promise(resolve => {
      proc.once('error', error => { record.error = error.message; });
      proc.once('close', code => { record.closed = true; record.code = code; resolve(); });
    });
    children.push(record);
  }
  return proc;
};
syncBuiltinESMExports();

let server, base, social, resetGoogle, setZernio;
const calls = [];
let tiktokCapacity = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'No non-loopback fetch');
  return originalFetch(input, ...args);
};
async function waitForChildren() {
  for (const child of children) {
    let timer;
    try {
      await Promise.race([child.done, new Promise((_, reject) => {
        timer = setTimeout(() => { child.proc.kill('SIGKILL'); reject(new Error('Task proxy FFmpeg timeout')); }, 20000);
      })]);
      assert.equal(child.code, 0, child.error || 'Actual proxy FFmpeg failed');
    } finally { clearTimeout(timer); }
  }
}

test('actual raw upload to finite queue preserves original MP4 through authenticated HTTP and provider mocks', { concurrency: false }, async t => {
  try {
    const { requireAuth, signToken, signInternalToken } = await import('../auth.js');
    const { withUserScope } = await import('../middleware/userScope.js');
    const { requireVerifiedEmail } = await import('../middleware/requireVerifiedEmail.js');
    social = await import('./social.js');
    const media = await import('./media.js');
    const youtube = await import('../lib/social/youtubeUpload.js');
    const zernio = await import('../lib/social/zernioConnect.js');
    resetGoogle = youtube._resetGoogleImpl; setZernio = zernio._setZernioFetch;
    youtube._setGoogleImpl({ auth: { OAuth2: class { setCredentials() {} } }, youtube: () => ({ videos: { insert: async request => {
      const chunks = []; for await (const chunk of request.media.body) chunks.push(chunk);
      calls.push({ destination: 'youtube', requestBody: request.requestBody, bytes: Buffer.concat(chunks), source: request.media.body.path });
      return { data: { id: 'synthetic-upload-yt', status: { privacyStatus: 'public', uploadStatus: 'processed' } } };
    } } }) });
    setZernio(async (url, options) => {
      assert.equal(url, 'https://zernio.com/api/v1/posts');
      const payload = JSON.parse(options.body);
      assert.equal(new URL(payload.mediaItems[0].url).protocol, 'https:');
      // Locate the actual in-flight snapshot from durable state, not the
      // provider URL layout (non-owner delivery may use a signed media route).
      // This byte check does not claim HTTP acceptance of that public route.
      const candidates = ['owner', 'alice'].flatMap(id => {
        const c = context(id), store = path.join(c.dataDir, 'scheduled-posts.json');
        if (!fs.existsSync(store)) return [];
        return JSON.parse(fs.readFileSync(store)).posts.filter(p => p.status === 'publishing').map(p => path.join(c.outputDir, `finite-post-${p.id}.mp4`));
      }).filter(file => fs.existsSync(file));
      assert.equal(candidates.length, 1);
      calls.push({ destination: 'tiktok', payload, source: candidates[0], bytes: fs.readFileSync(candidates[0]) });
      const platform = tiktokCapacity
        ? { platform: 'tiktok', status: 'failed', errorMessage: 'at capacity' }
        : { platform: 'tiktok', status: 'published', platformSpecificData: { privacy_level: 'PUBLIC_TO_EVERYONE' } };
      return { status: 200, text: async () => JSON.stringify({ post: { _id: 'synthetic-upload-tiktok', status: platform.status, platforms: [platform] } }) };
    });
    const app = express(); app.use(express.json());
    app.use('/api/media', requireAuth, withUserScope, requireVerifiedEmail, media.default);
    app.use('/api/social', requireAuth, withUserScope, requireVerifiedEmail, social.default);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const auth = id => id ? { authorization: `Bearer ${signToken(identities[id])}` } : {};
    const request = async (route, { id = 'alice', method = 'GET', body, headers = {} } = {}) => {
      const response = await fetch(base + route, { method, headers: { ...auth(id), ...headers }, ...(body !== undefined ? { body } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const queueRoute = '/api/social/scheduled-posts';
    const uploadRoute = '/api/media/upload-source-video?filename=polished%20original.mp4';
    const fixture = path.join(root, 'polished-original.mp4');
    const ff = childProcess.spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=5', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', fixture], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(ff.status, 0, ff.stderr); assert.ok(fs.existsSync(fixture));
    const original = fs.readFileSync(fixture), sha256 = digest(original);
    const upload = async (id, bytes = original, filename = 'polished original.mp4', mime = 'video/mp4') => {
      const result = await request('/api/media/upload-source-video?filename=' + encodeURIComponent(filename), { id, method: 'POST', body: bytes, headers: { 'content-type': mime } });
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.ok, true);
      await waitForChildren(); return result.body;
    };
    const post = (file, destination = 'youtube', extra = {}) => ({ expectedSha256: digest(fs.readFileSync(file)), expectedBytes: fs.statSync(file).size, clientId: crypto.randomUUID(), title: 'Synthetic polished clip', caption: 'Synthetic upload integration only', videoUrl: file, scheduledAt: new Date(Date.now() + 5000).toISOString(), timezone: 'Europe/London', destination, privacyStatus: destination === 'youtube' ? 'public' : 'PUBLIC_TO_EVERYONE', ...extra });
    const submit = (id, posts) => request(queueRoute, { id, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ posts }) });
    const list = async id => { const result = await request(queueRoute, { id }); assert.equal(result.status, 200); return result.body.posts; };
    const due = async posts => { await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.max(...posts.map(p => Date.parse(p.scheduledAt))) - Date.now() + 30))); };
    const configure = id => {
      const c = context(id); fs.mkdirSync(c.dataDir, { recursive: true });
      fs.writeFileSync(path.join(c.dataDir, 'social.json'), JSON.stringify({ direct: { youtube: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh' } }, zernio: { profileId: 'synthetic-profile', tiktok: { accountId: 'synthetic-tiktok' } } }));
    };
    await t.test('signed-out and unverified requests cannot upload or schedule; agent cannot queue', async () => {
      for (const [route, body, type] of [[uploadRoute, original, 'video/mp4'], [queueRoute, JSON.stringify({ posts: [] }), 'application/json']]) {
        assert.equal((await request(route, { id: null, method: 'POST', body, headers: { 'content-type': type } })).status, 401);
        const unverified = signToken({ ...identities.alice, emailVerified: false });
        assert.equal((await request(route, { id: null, method: 'POST', body, headers: { 'content-type': type, authorization: `Bearer ${unverified}` } })).status, 403);
      }
      const agent = signInternalToken({ ...identities.alice, sub: 'alice' });
      assert.equal((await request(queueRoute, { id: null, headers: { authorization: `Bearer ${agent}` } })).status, 403);
      assert.equal(children.length, 0); assert.equal(calls.length, 0);
    });
    for (const id of ['alice', 'owner']) await t.test(`${id}: real binary upload, separate proxy, durable hash, due public YouTube/TikTok frozen original bytes`, async () => {
      configure(id); const uploaded = await upload(id);
      assert.equal(uploaded.mime, 'video/mp4'); assert.notEqual(uploaded.file, uploaded.proxyPath);
      assert.equal(path.dirname(path.resolve(uploaded.file)), path.resolve(context(id).outputDir));
      assert.deepEqual(fs.readFileSync(uploaded.file), original); assert.equal(digest(fs.readFileSync(uploaded.file)), sha256);
      assert.ok(media.isPlayableVideo(uploaded.file)); assert.ok(media.isPlayableVideo(uploaded.proxyPath));
      assert.notEqual(digest(fs.readFileSync(uploaded.proxyPath)), sha256);
      const proxy = await request('/api/media/proxy-status?proxyPath=' + encodeURIComponent(uploaded.proxyPath), { id });
      assert.equal(proxy.body.status, 'ready');
      const before = calls.length;
      // A different owned original returned by the real upload route cannot
      // replace selected A, even though B is playable and owned by this user.
      const other = await upload(id, Buffer.concat([original, Buffer.from('synthetic-other-original')]));
      assert.ok(media.isPlayableVideo(other.file)); assert.notEqual(digest(fs.readFileSync(other.file)), sha256);
      for (const mismatch of [
        { expectedSha256: sha256, expectedBytes: fs.statSync(other.file).size },
        { expectedSha256: digest(fs.readFileSync(other.file)), expectedBytes: original.length },
      ]) {
        assert.equal((await submit(id, [post(uploaded.file), post(other.file, 'youtube', mismatch)])).status, 400);
        assert.equal((await list(id)).length, 0); assert.equal(calls.length, before);
      }
      const posts = ['youtube', 'tiktok'].map(destination => post(uploaded.file, destination, { mediaSha256: 'forged-client-digest', bytes: 1 }));
      const created = await submit(id, posts); assert.equal(created.status, 200, JSON.stringify(created.body));
      const readback = await list(id);
      for (const p of created.body.posts) {
        assert.deepEqual(readback.find(record => record.id === p.id), p);
        assert.equal(p.expectedSha256, sha256); assert.equal(p.expectedBytes, original.length); assert.equal(p.mediaSha256, sha256); assert.equal(p.bytes, original.length); assert.equal(p.videoUrl, uploaded.file); assert.equal(p.status, 'queued');
      }
      const disk = JSON.parse(fs.readFileSync(path.join(context(id).dataDir, 'scheduled-posts.json'))).posts;
      assert.ok(created.body.posts.every(p => disk.some(d => d.id === p.id && d.mediaSha256 === sha256 && d.bytes === original.length)));
      await social.finitePostQueue.tick([context(id)]); assert.equal(calls.length, before);
      await due(posts); await social.finitePostQueue.tick([context(id)]);
      const dispatched = calls.slice(before); assert.deepEqual(dispatched.map(c => c.destination), ['youtube', 'tiktok']);
      for (const call of dispatched) {
        assert.deepEqual(call.bytes, original); assert.equal(digest(call.bytes), sha256);
        assert.notEqual(path.resolve(call.source), path.resolve(uploaded.file)); assert.notEqual(path.resolve(call.source), path.resolve(uploaded.proxyPath));
        assert.match(path.basename(call.source), /^finite-post-/);
      }
      assert.equal(dispatched[0].requestBody.status.privacyStatus, 'public');
      assert.equal(Object.hasOwn(dispatched[0].requestBody.status, 'publishAt'), false);
      const payload = dispatched[1].payload;
      assert.equal(payload.tiktokSettings.privacy_level, 'PUBLIC_TO_EVERYONE'); assert.equal(payload.publishNow, true); assert.equal(payload.isDraft, false); assert.notEqual(payload.tiktokSettings.draft, true);
      assert.deepEqual(payload.platforms, [{ platform: 'tiktok', accountId: 'synthetic-tiktok' }]);
      assert.ok((await list(id)).filter(p => created.body.posts.some(c => c.id === p.id)).every(p => p.status === 'published'));
      await social.finitePostQueue.tick([context(id)]); assert.equal(calls.length, before + 2);
      assert.equal((await list('bob')).length, 0);
      assert.equal((await submit('bob', [post(uploaded.file)])).status, 400);
      assert.equal((await submit(id, [post(uploaded.proxyPath)])).status, 400);
    });
    await t.test('uploaded playable WebM remains original format and cannot masquerade as queue MP4 via its valid proxy', async () => {
      const webm = path.join(root, 'original.webm');
      const ff = childProcess.spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=128x96:rate=10', '-t', '1', '-c:v', 'libvpx', '-threads', '1', '-pix_fmt', 'yuv420p', '-y', webm], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      assert.equal(ff.status, 0, ff.stderr);
      for (const id of ['alice', 'owner']) {
        const uploaded = await upload(id, fs.readFileSync(webm), 'original.webm', 'video/webm');
        assert.match(uploaded.file, /\.webm$/); assert.ok(media.isPlayableVideo(uploaded.file)); assert.ok(media.isPlayableVideo(uploaded.proxyPath));
        assert.deepEqual(fs.readFileSync(uploaded.file), fs.readFileSync(webm));
        assert.equal((await submit(id, [post(uploaded.file)])).status, 400);
        assert.equal((await submit(id, [post(uploaded.proxyPath)])).status, 400);
      }
      assert.equal(calls.length, 4);
    });
    await t.test('changed uploaded original fails before provider; TikTok capacity never falls back to draft', async () => {
      const uploaded = await upload('alice'); const changed = post(uploaded.file);
      const created = await submit('alice', [changed]); assert.equal(created.status, 200);
      fs.appendFileSync(uploaded.file, Buffer.from('synthetic-change'));
      await due([changed]); await social.finitePostQueue.tick([context('alice')]);
      const failed = (await list('alice')).find(p => p.id === created.body.posts[0].id);
      assert.equal(failed.status, 'failed'); assert.match(failed.error, /changed/); assert.equal(calls.length, 4);
      const fresh = await upload('owner'); const capacity = post(fresh.file, 'tiktok');
      assert.equal((await submit('owner', [capacity])).status, 200); tiktokCapacity = true;
      await due([capacity]); await social.finitePostQueue.tick([context('owner')]);
      assert.equal(calls.length, 5); assert.equal(calls.at(-1).payload.publishNow, true); assert.notEqual(calls.at(-1).payload.tiktokSettings.draft, true);
      assert.equal((await list('owner')).find(p => p.clientId === capacity.clientId).status, 'failed');
      await social.finitePostQueue.tick([context('owner')]); assert.equal(calls.length, 5);
    });
    await waitForChildren(); assert.equal(children.length, 8); assert.ok(children.every(child => child.closed && child.code === 0));
  } finally {
    await social?.stopFinitePostWorker();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(server.listening, false); }
    for (const child of children) if (!child.closed) child.proc.kill('SIGKILL');
    await Promise.all(children.map(child => child.done));
    resetGoogle?.(); setZernio?.(null); globalThis.fetch = originalFetch;
    childProcess.spawn = nativeSpawn; syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false);
  }
});
