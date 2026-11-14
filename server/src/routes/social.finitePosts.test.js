import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { createFinitePostQueue, createFinitePostsRouter, writeFinitePosts } from '../lib/social/finitePosts.js';
import { createFiniteDispatcher } from '../lib/social/finiteProvider.js';
import { createFiniteMediaRouter, finiteMediaReadPath } from '../lib/social/finiteMedia.js';

// No provider credentials or live data are used, even when run from a real checkout.
const root = fs.mkdtempSync(path.join(process.env.FINITE_TEST_SCRATCH || os.tmpdir(), 'bf-finite-test-'));
process.env.DATA_DIR = path.join(root, 'data'); process.env.OUTPUT_DIR = path.join(root, 'outputs');
process.env.JWT_SECRET = 'synthetic-finite-http-test-secret-only';
process.env.MULTITENANT = 'true'; process.env.SUPER_ADMIN_EMAIL = 'owner@finite.invalid';
process.env.REQUIRE_EMAIL_VERIFIED = 'true';
process.env.ZERNIO_API_KEY = 'synthetic-not-a-real-provider-key';
process.env.ZERNIO_TIKTOK_ACCOUNT_ID = 'synthetic-tiktok';
process.env.ZERNIO_TIKTOK_PRIVACY_LEVEL = 'SELF_ONLY';
process.env.PUBLIC_BASE_URL = 'https://finite.invalid';
for (const key of ['YOUTUBE_CLIENT_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT', 'SENTRY_DSN']) delete process.env[key];
const originalFetch = globalThis.fetch;
const nativeHttpRequest = http.request, nativeHttpsRequest = https.request;
function loopback(input) {
  const hostname = input instanceof URL ? input.hostname : typeof input === 'string' ? new URL(input).hostname : input?.hostname || input?.host;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) throw new Error('OUTBOUND NETWORK BLOCKED');
}
globalThis.fetch = (input, ...args) => { loopback(input instanceof Request ? input.url : input); return originalFetch(input, ...args); };
http.request = function(input, ...args) { loopback(input); return nativeHttpRequest.call(this, input, ...args); };
https.request = function() { throw new Error('OUTBOUND HTTPS BLOCKED'); };
const { requireAuth, signToken, signInternalToken } = await import('../auth.js');
const { withUserScope } = await import('../middleware/userScope.js');
const { requireVerifiedEmail } = await import('../middleware/requireVerifiedEmail.js');
const social = await import('./social.js');
const { _setGoogleImpl, _resetGoogleImpl } = await import('../lib/social/youtubeUpload.js');
const { _setZernioFetch } = await import('../lib/social/zernioConnect.js');
let now = Date.parse('2035-01-01T00:00:00Z'), calls = [], customDispatch;
let youtubeResponse = { id: 'fixture-yt1', status: { privacyStatus: 'public', uploadStatus: 'processed' } };
let tiktokResponse = { post: { _id: 'fixture-tiktok', status: 'publishing', platforms: [{ platform: 'tiktok', status: 'publishing' }] } };
_setGoogleImpl({ auth: { OAuth2: class { setCredentials() {} } }, youtube: () => ({ videos: { insert: async request => {
  const chunks = []; for await (const chunk of request.media.body) chunks.push(chunk);
  calls.push({ destination: 'youtube', requestBody: request.requestBody, bytes: Buffer.concat(chunks) });
  return { data: youtubeResponse };
} } }) });
_setZernioFetch(async (url, opts) => { calls.push({ destination: 'tiktok', payload: JSON.parse(opts.body) }); return { status: 200, text: async () => JSON.stringify(tiktokResponse) }; });
const actualDispatch = createFiniteDispatcher(social.dispatchPost, () => 'https://finite.invalid');
const dispatch = (...args) => customDispatch ? customDispatch(...args) : actualDispatch(...args);
const queue = (options = {}) => createFinitePostQueue({ dispatch, preflight: social.preflightFinitePost, now: () => now, ...options });
const identities = Object.fromEntries(['owner','alice','bob'].map(id => [id, { id, email: `${id}@finite.invalid`, role: 'user', emailVerified: true }]));
const token = id => signToken(identities[id]);
let server, base, q;
async function open(queueInstance = queue(), actualRouter = false, productionMedia = false) {
  q = queueInstance;
  const app = express(); app.use(express.json());
  app.use('/api/finite-media', productionMedia ? social.finiteMediaRouter : createFiniteMediaRouter({ Router: express.Router, resolveOwner: id => identities[id] ? ctx(id) : null, now: () => now }));
  app.use('/api/social', requireAuth, withUserScope, requireVerifiedEmail,
    actualRouter ? social.default : createFinitePostsRouter({ Router: express.Router, queue: q }));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/social${actualRouter ? '/scheduled-posts' : ''}`;
}
async function close() { await q?.stop(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); server = null; } }
async function request(method = 'GET', body, id = 'alice', suffix = '') {
  const response = await fetch(base + suffix, { method, headers: { 'content-type': 'application/json', ...(id ? { authorization: `Bearer ${token(id)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
function ctx(id = 'alice') { return id === 'owner' ? { userId: id, dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true } : { userId: id, dataDir: path.join(process.env.DATA_DIR, 'users', id), outputDir: path.join(process.env.DATA_DIR, 'users', id, 'outputs'), isOwner: false }; }
const fixture = path.join(root, 'fixture.mp4');
const ff = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=32x32:r=2','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart','-y',fixture], { encoding: 'utf8', timeout: 15000, windowsHide: true });
assert.equal(ff.status, 0, ff.stderr);
const fixtureBytes = fs.readFileSync(fixture);
function file(id = 'alice') { const c = ctx(id); fs.mkdirSync(c.outputDir, { recursive: true }); const f = path.join(c.outputDir, `source-video-${crypto.randomUUID()}.mp4`); fs.copyFileSync(fixture, f); return f.replace(/\\/g, '/'); }
function post(overrides = {}, id = 'alice') { return { clientId: crypto.randomUUID(), title: 'Finite post', caption: 'Synthetic caption', videoUrl: file(id), expectedSha256: crypto.createHash('sha256').update(fixtureBytes).digest('hex'), expectedBytes: fixtureBytes.length, scheduledAt: new Date(now + 60000).toISOString(), timezone: 'Europe/London', destination: 'youtube', privacyStatus: 'public', ...overrides }; }
function credentials(id = 'alice') {
  const c = ctx(id); fs.mkdirSync(c.dataDir, { recursive: true });
  fs.writeFileSync(path.join(c.dataDir, 'social.json'), JSON.stringify({ direct: { youtube: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh' } }, zernio: { profileId: 'synthetic-profile', tiktokAccountId: 'synthetic-tiktok', tiktok: { accountId: 'synthetic-tiktok' } } }));
}
async function reset() { await close(); calls = []; customDispatch = null; now = Date.parse('2035-01-01T00:00:00Z'); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); credentials(); await open(); }
const submit = p => request('POST', { posts: Array.isArray(p) ? p : [p] });
const readback = async () => (await request()).body.posts;

test('finite scheduled posts: real authenticated HTTP, disk and provider boundaries', { concurrency: false }, async t => {
  try {
    await t.test('actual social mount is authenticated, verified and refuses MCP agents', async () => {
      await open(queue(), true);
      assert.equal((await request('GET', null, null)).status, 401);
      assert.equal((await request()).status, 200);
      const unverified = { ...identities.alice, emailVerified: false };
      const r = await fetch(base, { headers: { authorization: `Bearer ${signToken(unverified)}` } }); assert.equal(r.status, 403);
      const agent = await fetch(base, { headers: { authorization: `Bearer ${signInternalToken({ ...identities.alice, sub: 'alice' })}` } }); assert.equal(agent.status, 403);
      const p = post({ scheduledAt: new Date(Date.now() + 3600000).toISOString() });
      assert.equal((await submit(p)).status, 200);
      assert.equal((await request()).body.posts[0].clientId, p.clientId);
    });
    await t.test('server-computed original digest survives route recreation and child-process restart', async () => {
      await reset(); const p = post({ mediaSha256: 'forged', bytes: 1 });
      const created = await submit(p); assert.equal(created.status, 200);
      const saved = created.body.posts[0]; assert.equal(saved.mediaSha256, crypto.createHash('sha256').update(fixtureBytes).digest('hex')); assert.equal(saved.bytes, fixtureBytes.length);
      assert.equal(saved.filePath, undefined); assert.equal(saved.ownerId, undefined);
      await close(); await open(queue()); assert.deepEqual((await readback())[0], saved);
      const moduleUrl = pathToFileURL(path.resolve('src/lib/social/finitePosts.js')).href;
      const child = spawnSync(process.execPath, ['--input-type=module','-e', `const {createFinitePostQueue}=await import(${JSON.stringify(moduleUrl)});const q=createFinitePostQueue({dispatch:()=>{throw Error('NO PROVIDER')}});console.log(JSON.stringify(q.list(${JSON.stringify(ctx())})));`], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout)[0], saved);
    });
    await t.test('owner isolation: list, forged write identity, foreign original and cancel', async () => {
      await reset(); const p = post({ ownerId: 'bob', status: 'published' }); const created = (await submit(p)).body.posts[0];
      assert.equal((await request('GET', null, 'bob')).body.posts.length, 0);
      assert.equal((await request('POST', null, 'bob', `/${created.id}/cancel`)).status, 404);
      assert.equal((await request('POST', { posts: [post({}, 'alice')] }, 'bob')).status, 400);
      assert.equal((await readback())[0].status, 'queued');
    });
    await t.test('all-or-none validation, 20 entry cap, timezone/time/privacy/destination refusal', async () => {
      await reset(); const good = post();
      for (const bad of [{ timezone: 'Mars/Nowhere' }, { scheduledAt: new Date(now).toISOString() }, { scheduledAt: '2035-02-30T00:00:00Z' }, { scheduledAt: '2035-01-01T01:00:00+01:00' }, { privacyStatus: 'private' }, { privacyStatus: '' }, { destination: 'webhook' }, { destination: 'tiktok', privacyStatus: 'public' }]) {
        assert.equal((await submit([good, { ...post(), ...bad }])).status, 400); assert.equal((await readback()).length, 0);
      }
      assert.equal((await submit(Array.from({ length: 21 }, () => good))).status, 400);
      assert.equal((await submit([good, good])).status, 400);
      assert.equal((await submit([])).status, 400);
    });
    await t.test('durable idempotency exact payload retry, conflict and retry after due/changed original', async () => {
      await reset(); const p = post(); const first = (await submit(p)).body.posts[0];
      assert.equal((await submit(p)).body.posts[0].id, first.id);
      assert.equal((await submit({ ...p, caption: 'different' })).status, 409);
      fs.unlinkSync(p.videoUrl); now += 120000; await close(); await open(queue());
      assert.equal((await submit(p)).body.posts[0].id, first.id); assert.equal((await readback()).length, 1);
    });
    await t.test('SSRF, path traversal, proxy/extension/MIME/truncated MP4/hardlink/symlink rejection', async () => {
      await reset(); const original = file();
      const badFile = file(); fs.writeFileSync(badFile, 'not an MP4 at all');
      const truncated = file(); fs.writeFileSync(truncated, Buffer.from('0000ftypisom'));
      const link = path.join(ctx().outputDir, `source-video-${crypto.randomUUID()}.mp4`); fs.linkSync(original, link);
      const symlinkRoot = path.join(root, 'linked-output'); fs.symlinkSync(ctx().outputDir, symlinkRoot, 'junction');
      const refs = ['https://127.0.0.1/a.mp4', 'https://finite.invalid/outputs/' + path.basename(original), '/outputs/../' + path.basename(original), '/outputs/%2e%2e/a.mp4', original.replace('.mp4', '.webm'), original.replace('.mp4', '-proxy.mp4'), badFile, truncated, link];
      for (const videoUrl of refs) assert.equal((await submit(post({ videoUrl }))).status, 400, videoUrl);
      assert.throws(() => q.enqueue({ ...ctx(), outputDir: symlinkRoot }, [post({ videoUrl: path.join(symlinkRoot, path.basename(original)) })]), /Symlink/);
      fs.unlinkSync(link); assert.equal(calls.length, 0);
    });
    await t.test('future stays queued; public YouTube request at due time once, frozen bytes and no publishAt', async () => {
      await reset(); const created = (await submit(post())).body.posts[0]; await q.tick([ctx()]); assert.equal(calls.length, 0);
      now += 60000; await q.tick([ctx()]);
      assert.equal(calls.length, 1); assert.equal(calls[0].requestBody.status.privacyStatus, 'public'); assert.equal(calls[0].requestBody.status.publishAt, undefined); assert.deepEqual(calls[0].bytes, fixtureBytes);
      const done = (await readback())[0]; assert.equal(done.id, created.id); assert.equal(done.status, 'published'); assert.equal(done.receipt.videoId, 'fixture-yt1');
      await q.tick([ctx()]); await close(); await open(queue()); now += 366 * 86400000; await q.tick([ctx()]); assert.equal(calls.length, 1);
    });
    await t.test('many due entries: concurrent ticks and independent queue instances never duplicate; concurrency one', async () => {
      await reset(); await submit([post(), post(), post()]); let active = 0, peak = 0, count = 0;
      customDispatch = async () => { count++; active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; return { status: 'accepted', receipt: { id: count } }; };
      const other = queue(); now += 60000; await Promise.all([q.tick([ctx()]), q.tick([ctx()]), other.tick([ctx()])]); assert.equal(count, 3); assert.equal(peak, 1);
      await Promise.all([q.tick([ctx()]), other.tick([ctx()])]); assert.equal(count, 3);
    });
    await t.test('separate process cannot claim during provider I/O; tick work is bounded to twenty', async () => {
      await reset(); await submit(Array.from({length:20},()=>post())); await submit(post());
      let count=0, checked=false, childProof=false;
      customDispatch = async () => {
        count++;
        if (!checked) {
          checked=true;
          const url=pathToFileURL(path.resolve('src/lib/social/finitePosts.js')).href;
          const code=`const {createFinitePostQueue}=await import(${JSON.stringify(url)});let calls=0;const q=createFinitePostQueue({dispatch:async()=>{calls++;return {status:'accepted'}},now:()=>${now}});await q.tick([${JSON.stringify(ctx())}]);console.log(JSON.stringify({calls}));`;
          const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000,windowsHide:true});
          assert.equal(child.status,0,child.stderr); assert.equal(JSON.parse(child.stdout).calls,0); childProof=true;
        }
        return {status:'accepted',receipt:{id:count}};
      };
      now+=60000; await q.tick([ctx()]); assert.equal(childProof,true); assert.equal(count,20); assert.equal((await readback()).filter(p=>p.status==='queued').length,1);
      await q.tick([ctx()]); assert.equal(count,21);
    });
    await t.test('cancellation is durable and race with claimed publishing cannot cancel', async () => {
      await reset(); const p = (await submit(post())).body.posts[0];
      assert.equal((await request('POST', null, 'alice', `/${p.id}/cancel`)).body.status, 'cancelled');
      assert.equal((await request('POST', null, 'alice', `/${p.id}/cancel`)).status, 409);
      now += 60000; await q.tick([ctx()]); assert.equal(calls.length, 0);
      const b = (await submit(post())).body.posts[0]; let release; customDispatch = () => new Promise(r => { release = r; }); now += 60000;
      const running = q.tick([ctx()]); assert.equal((await request('POST', null, 'alice', `/${b.id}/cancel`)).status, 409);
      release({ status: 'accepted', receipt: { id: 'accepted' } }); await running;
    });
    await t.test('deleted, changed, foreign/symlink originals and expired due entries never call providers', async () => {
      await reset(); const a = post(), b = post(), c = post(); await submit([a,b,c]); fs.unlinkSync(a.videoUrl); fs.appendFileSync(b.videoUrl, 'changed');
      fs.unlinkSync(c.videoUrl); fs.linkSync(file('bob'), c.videoUrl);
      now += 60000; await q.tick([ctx()]); assert.deepEqual((await readback()).map(p => p.status), ['failed','failed','failed']); assert.equal(calls.length, 0);
      await submit(post()); now += 20 * 60000; await q.tick([ctx()]); assert.match((await readback()).at(-1).error, /missed/); assert.equal(calls.length, 0);
    });
    await t.test('provider failures become held, no automatic retry after recreation', async () => {
      await reset(); await submit(post()); let count = 0; customDispatch = async () => { count++; throw new Error('timeout possibly after write'); }; now += 60000;
      await q.tick([ctx()]); assert.equal((await readback())[0].status, 'needs_review');
      await close(); await open(queue()); await q.tick([ctx()]); assert.equal(count, 1);
    });
    await t.test('missing connection is a safe pre-I/O failure, and existing webhook schedule is unchanged', async () => {
      await reset(); const legacy = { schedules: [{ id:'sunday-existing', enabled:true, cron:'0 9 * * 0', destination:'webhook', caption:'keep me', videoUrl:'/outputs/old.mp4' }] };
      const socialFile = path.join(ctx().dataDir,'social.json'); fs.writeFileSync(socialFile,JSON.stringify(legacy)); const before = fs.readFileSync(socialFile);
      await submit(post()); now += 60000; await q.tick([ctx()]); assert.equal(calls.length,0); assert.equal((await readback())[0].status,'failed'); assert.deepEqual(fs.readFileSync(socialFile),before);
    });
    await t.test('persist-before-I/O refusal and claim-before-state crash are fail-closed', async () => {
      await reset(); await submit(post()); let count = 0; customDispatch = async () => { count++; return { status: 'published' }; };
      await close(); const broken = queue({ persist: () => { throw new Error('disk unavailable'); } }); await open(broken); now += 60000; await q.tick([ctx()]); assert.equal(count, 0);
      await close(); await open(queue()); await q.tick([ctx()]); assert.equal(count, 0); assert.equal((await readback())[0].status, 'needs_review');
    });
    await t.test('crash after provider I/O before receipt persistence never republishes on restart', async () => {
      await reset(); await submit(post()); let writes = 0, count = 0;
      customDispatch = async () => { count++; return { status: 'published', receipt: { id: 'provider-accepted' } }; };
      await close(); await open(queue({ persist: (c,p) => { if (++writes === 2) throw new Error('simulated crash after I/O'); writeFinitePosts(c,p); } }));
      now += 60000; await q.tick([ctx()]); assert.equal(count, 1); assert.equal((await readback())[0].status, 'needs_review');
      assert.equal(JSON.parse(fs.readFileSync(path.join(ctx().dataDir,'scheduled-posts.json'))).posts[0].status, 'publishing');
      await close(); await open(queue()); await q.tick([ctx()]); assert.equal(count, 1); assert.equal((await readback())[0].status, 'needs_review');
    });
    await t.test('TikTok only and explicit public defeats private env; accepted is not public, drafts are not success', async () => {
      await reset(); await close(); await open(queue());
      // Owner target uses only synthetic env; webhook exists but must never fire.
      credentials('owner'); const c = ctx('owner'); const s = JSON.parse(fs.readFileSync(path.join(c.dataDir,'social.json'))); s.webhooks = [{ id:'never', enabled:true, url:'https://should-never-fire.invalid' }]; fs.writeFileSync(path.join(c.dataDir,'social.json'),JSON.stringify(s));
      const p = post({ destination:'tiktok', privacyStatus:'PUBLIC_TO_EVERYONE' }, 'owner');
      assert.equal((await request('POST',{ posts:[p] },'owner')).status,200); now += 60000; await q.tick([c]);
      assert.equal(calls.length,1); assert.equal(calls[0].destination,'tiktok'); assert.deepEqual(calls[0].payload.platforms,[{ platform:'tiktok', accountId:'synthetic-tiktok' }]); assert.equal(calls[0].payload.tiktokSettings.privacy_level,'PUBLIC_TO_EVERYONE'); assert.equal(calls[0].payload.publishNow,true);
      assert.equal((await request('GET',null,'owner')).body.posts[0].status,'accepted');
      const draftResult = await createFiniteDispatcher(async () => ({ zernio: { postId:'draft', deliveredAsDraft:true, data:{post:{status:'draft'}} } }), () => 'https://finite.invalid')({destination:'tiktok'}, {ctx:c}); assert.equal(draftResult.status,'draft');
      tiktokResponse = { post: { _id:'capacity', status:'failed', platforms:[{platform:'tiktok',status:'failed',errorMessage:'at capacity'}] } };
      assert.equal((await request('POST',{posts:[post({destination:'tiktok',privacyStatus:'PUBLIC_TO_EVERYONE'},'owner')]},'owner')).status,200); now += 60000; await q.tick([c]); assert.equal(calls.length,2); assert.equal((await request('GET',null,'owner')).body.posts.at(-1).status,'failed');
    });
    await t.test('expected selected-original identity is mandatory, atomic and fingerprinted', async () => {
      await reset();
      const good = post();
      for (const fields of [{expectedSha256:undefined}, {expectedBytes:undefined}, {expectedSha256:'x'.repeat(64)}, {expectedBytes:0}, {expectedBytes:1.5}, {expectedSha256:'0'.repeat(64)}, {expectedBytes:fixtureBytes.length+1}]) {
        assert.equal((await submit([good, post(fields)])).status,400);
        assert.equal((await readback()).length,0); assert.equal(calls.length,0);
        assert.equal(fs.existsSync(path.join(ctx().dataDir,'scheduled-posts.json')),false);
      }
      // A selected, but an owned B path was substituted in the upload response.
      const b = file(); fs.appendFileSync(b, 'different-owned-B');
      assert.equal((await submit([good, post({videoUrl:b})])).status,400);
      assert.equal((await readback()).length,0); assert.equal(calls.length,0);
      const saved = (await submit(good)).body.posts[0];
      assert.equal(saved.expectedSha256,good.expectedSha256); assert.equal(saved.expectedBytes,good.expectedBytes);
      now += 120000; fs.unlinkSync(good.videoUrl);
      assert.equal((await submit(good)).body.posts[0].id,saved.id);
      assert.equal((await submit({...good,expectedSha256:'0'.repeat(64)})).status,409);
      assert.equal((await submit({...good,expectedBytes:good.expectedBytes+1})).status,409);
    });
    await t.test('YouTube public privacy alone is never publication: exact upload statuses and explicit errors', async () => {
      for (const [uploadStatus, expected] of [['processed','published'],['uploaded','accepted'],['failed','failed'],['rejected','failed']]) {
        await reset(); youtubeResponse = {id:'fixture-yt1',status:{privacyStatus:'public',uploadStatus}};
        await submit(post()); now += 60000; await q.tick([ctx()]);
        const done = (await readback())[0]; assert.equal(done.status,expected); assert.equal(done.receipt.uploadStatus,uploadStatus);
        if (expected === 'failed') assert.match(done.error,/failed|rejected/i);
      }
      const normalized = createFiniteDispatcher(async()=>({videoId:'fixture',data:{error:{message:'SECRET MUST NOT LEAK'},status:{privacyStatus:'public',uploadStatus:'processed'}}}),()=> 'https://finite.invalid');
      const outcome = await normalized({destination:'youtube'},{});
      assert.equal(outcome.status,'failed'); assert.doesNotMatch(JSON.stringify(outcome),/SECRET MUST NOT LEAK/);
      for (const httpStatus of [400,403,500]) {
        const dispatch = createFiniteDispatcher(async()=> { throw Object.assign(new Error('SECRET MUST NOT LEAK'),{response:{status:httpStatus}}); },()=> 'https://finite.invalid');
        if (httpStatus === 500) await assert.rejects(dispatch({destination:'youtube'},{}));
        else { const failure = await dispatch({destination:'youtube'},{}); assert.equal(failure.status,'failed'); assert.doesNotMatch(JSON.stringify(failure),/SECRET MUST NOT LEAK/); }
      }
      youtubeResponse = {id:'fixture-yt1',status:{privacyStatus:'public',uploadStatus:'processed'}};
    });
    await t.test('TikTok capability serves exact frozen bytes for owner and tenant, restart/range/security fail closed', async () => {
      for (const id of ['owner','alice']) {
        await reset(); credentials(id);
        fs.writeFileSync(path.join(process.env.DATA_DIR,'users.json'),JSON.stringify({users:Object.values(identities)}));
        await close(); await open(queue(),false,true);
        tiktokResponse = {post:{_id:'fixture-tiktok',status:'publishing',platforms:[{platform:'tiktok',status:'publishing'}]}};
        const p = post({destination:'tiktok',privacyStatus:'PUBLIC_TO_EVERYONE'},id);
        const result = await request('POST',{posts:[p]},id); assert.equal(result.status,200);
        now += 60000; await q.tick([ctx(id)]); assert.equal(calls.length,1,JSON.stringify((await request('GET',null,id)).body.posts));
        const publicPath = new URL(calls[0].payload.mediaItems[0].url).pathname;
        assert.ok(publicPath.startsWith('/api/finite-media/'));
        const get = (suffix=publicPath, options={}) => fetch(new URL(base).origin+suffix,options);
        let response = await get(); assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'video/mp4');
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixtureBytes);
        await close(); await open(queue(),false,true);
        response = await get(); assert.equal(response.status,200); assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixtureBytes);
        const moduleUrl = pathToFileURL(path.resolve('src/lib/social/finiteMedia.js')).href;
        const loaderIndex = process.execArgv.indexOf('--experimental-loader');
        const childArgs = loaderIndex >= 0 ? ['--experimental-loader',process.execArgv[loaderIndex+1]] : [];
        const guardIndex = process.execArgv.indexOf('--import');
        if (guardIndex >= 0) childArgs.push('--import',process.execArgv[guardIndex+1]);
        const childCode = `import express from 'express';import crypto from 'node:crypto';import {createFiniteMediaRouter} from ${JSON.stringify(moduleUrl)};const app=express();const ctx=${JSON.stringify(ctx(id))};app.use('/api/finite-media',createFiniteMediaRouter({Router:express.Router,resolveOwner:id=>id===ctx.userId?ctx:null,now:()=>${now}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const r=await fetch('http://127.0.0.1:'+server.address().port+process.env.FINITE_CAPABILITY_PATH);const bytes=Buffer.from(await r.arrayBuffer());console.log(JSON.stringify({status:r.status,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}`;
        const child = spawnSync(process.execPath,[...childArgs,'--input-type=module','-e',childCode],{cwd:process.cwd(),env:{...process.env,FINITE_CAPABILITY_PATH:publicPath},encoding:'utf8',timeout:15000,windowsHide:true});
        assert.equal(child.status,0,'Independent capability reader must exit cleanly');
        assert.deepEqual(JSON.parse(child.stdout),{status:200,bytes:fixtureBytes.length,sha256:p.expectedSha256});
        response = await get(publicPath,{method:'HEAD'}); assert.equal(response.status,200); assert.equal(response.headers.get('content-length'),String(fixtureBytes.length));
        response = await get(publicPath,{headers:{range:'bytes=4-19'}}); assert.equal(response.status,206); assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixtureBytes.subarray(4,20));
        assert.equal((await get(publicPath,{headers:{range:'bytes=99999999-'}})).status,416);
        assert.equal((await get(publicPath,{method:'POST'})).status,404);
        assert.equal((await get(publicPath.slice(0,-1)+(publicPath.endsWith('A')?'B':'A'))).status,404);
        const stored = JSON.parse(fs.readFileSync(path.join(ctx(id).dataDir,'scheduled-posts.json'))).posts[0];
        const wrongOwner = finiteMediaReadPath(ctx('bob'),stored,now); assert.equal((await get(wrongOwner)).status,404);
        const expired = finiteMediaReadPath(ctx(id),stored,Date.now()-8*86400000); assert.equal((await get(expired)).status,404);
        const jwtPath = '/api/finite-media/'+token(id); assert.equal((await get(jwtPath)).status,404);
        const cap = publicPath.split('/').at(-1);
        assert.equal((await fetch(base,{headers:{authorization:`Bearer ${cap}`}})).status,401);
        const otherPurposeBody = Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(cap.split('.')[0],'base64url').toString()),purpose:'oauth-state'})).toString('base64url');
        const domainKey = crypto.createHmac('sha256',process.env.JWT_SECRET).update('biblefuel-finite-media-read-v1').digest();
        const otherPurposeSig = crypto.createHmac('sha256',domainKey).update(otherPurposeBody).digest('base64url');
        assert.equal((await get('/api/finite-media/'+otherPurposeBody+'.'+otherPurposeSig)).status,404);
        const secret = process.env.JWT_SECRET;
        try { delete process.env.JWT_SECRET; assert.equal((await get()).status,404); assert.throws(()=>finiteMediaReadPath(ctx(id),stored,now),/unavailable/); }
        finally { process.env.JWT_SECRET=secret; }
        const publicView = (await request('GET',null,id)).body.posts[0]; assert.equal(publicView.mediaReadPath,undefined); assert.equal(publicView.frozenName,undefined);
        const changed = Buffer.from(fixtureBytes); changed[changed.length-1] ^= 1;
        fs.writeFileSync(path.join(ctx(id).outputDir,stored.frozenName),changed); assert.equal((await get()).status,404);
      }
    });
    await t.test('startup worker discovers queue without HTTP visit, stop clears timer', async () => {
      await reset(); await close(); await open(queue(),true);
      const p = post({scheduledAt:new Date(Date.now()+1500).toISOString()}); assert.equal((await submit(p)).status,200); await close();
      fs.writeFileSync(path.join(process.env.DATA_DIR,'users.json'),JSON.stringify({users:Object.values(identities)}));
      await new Promise(r => setTimeout(r,1600)); social.startFinitePostWorker(); await social.stopFinitePostWorker(); assert.equal(calls.length,1);
      await new Promise(r => setTimeout(r,60)); assert.equal(calls.length,1);
    });
  } finally {
    await close(); await social.stopFinitePostWorker(); _resetGoogleImpl(); _setZernioFetch(null);
    globalThis.fetch = originalFetch; http.request = nativeHttpRequest; https.request = nativeHttpsRequest;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
