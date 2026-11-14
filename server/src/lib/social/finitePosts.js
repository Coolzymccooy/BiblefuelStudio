import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { finiteMediaReadPath } from './finiteMedia.js';

const FILE = 'scheduled-posts.json';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function hashFile(file) {
  const fd = fs.openSync(file, 'r'), digest = crypto.createHash('sha256'), buf = Buffer.alloc(64 * 1024);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null))) digest.update(buf.subarray(0,n)); return digest.digest('hex'); }
  finally { fs.closeSync(fd); }
}
const inside = (root, file) => { const r = path.relative(root, file); return r && !r.startsWith('..') && !path.isAbsolute(r); };

// Synchronous, bounded metadata operations are serialized with an exclusive
// cross-process lock. Never steal a stale lock: an operator must reconcile it.
function locked(ctx, fn) {
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  const lock = path.join(ctx.dataDir, 'scheduled-posts.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw fail('Queue is locked; retry later. A crash-held lock requires operator review.', 409); throw e; }
  try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function read(ctx) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, FILE), 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.posts)) throw new Error('Invalid scheduled-post store');
    return data.posts;
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
export function writeFinitePosts(ctx, posts) {
  const target = path.join(ctx.dataDir, FILE);
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ version: 1, posts }));
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, target);
    // Directory fsync is not supported by Windows. File contents were synced
    // before the same-directory atomic rename; no delete-and-replace fallback.
    if (process.platform !== 'win32') { const d = fs.openSync(ctx.dataDir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

/** Only original MP4s from upload-source-video, never proxies/URLs/shared files. */
export function inspectFiniteMedia(ctx, ref) {
  if (typeof ref !== 'string' || !ref || /[?#\0]/.test(ref) || /^https?:|^file:|^data:/i.test(ref)) throw fail('videoUrl must be an owned original uploaded MP4');
  const normalized = ref.replace(/\\/g, '/');
  if (normalized.split('/').includes('..') || normalized.includes('%')) throw fail('Invalid media path');
  const root = path.resolve(ctx.outputDir);
  const file = normalized.startsWith('/outputs/') ? path.join(root, normalized.slice(9)) : path.resolve(ref);
  if (!inside(root, file) || path.dirname(file) !== root || !/^source-video-[0-9a-f-]{36}\.mp4$/i.test(path.basename(file))) throw fail('Only owned original source-video MP4 files can be scheduled');
  if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) throw fail('Symlink media is not allowed');
  const realRoot = fs.realpathSync(root), realFile = fs.realpathSync(file);
  if (!inside(realRoot, realFile) || path.dirname(realFile) !== realRoot) throw fail('Media is outside owned outputs');
  const stat = fs.statSync(realFile);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 12 || stat.size > 200 * 1024 * 1024) throw fail('Invalid MP4 size or linked file');
  const fd = fs.openSync(realFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const header = Buffer.alloc(12); fs.readSync(fd, header, 0, 12, 0);
    if (header.toString('ascii', 4, 8) !== 'ftyp' || !['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(header.toString('ascii', 8, 12))) throw fail('File signature is not supported MP4');
    const digest = crypto.createHash('sha256'); const buf = Buffer.alloc(64 * 1024); let n;

    let pos = 0; while ((n = fs.readSync(fd, buf, 0, buf.length, pos))) { digest.update(buf.subarray(0, n)); pos += n; }
    const probe = spawnSync(process.env.FFPROBE_PATH?.trim() || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', realFile], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
    let meta; try { meta = JSON.parse(probe.stdout); } catch { throw fail('MP4 could not be validated'); }
    if (probe.status !== 0 || !meta.streams?.some(s => s.codec_type === 'video') || !(Number(meta.format?.duration) > 0)) throw fail('MP4 must contain a finished playable video');
    return { filePath: realFile, mediaSha256: digest.digest('hex'), bytes: stat.size, mime: 'video/mp4' };
  } finally { fs.closeSync(fd); }
}
function input(p) {
  if (!p || typeof p !== 'object') throw fail('Invalid post');
  const out = {};
  for (const [key, max, required] of [['clientId', 128, true], ['title', 100, true], ['caption', 2200, true], ['videoUrl', 2048, true], ['scheduledAt', 30, true], ['timezone', 100, true], ['destination', 20, true], ['privacyStatus', 30, true]]) {
    if (typeof p[key] !== 'string' || p[key].length > max || (required && !p[key].trim())) throw fail(`Invalid ${key}`);
    out[key] = p[key];
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(out.clientId)) throw fail('Invalid clientId');
  if (typeof p.expectedSha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(p.expectedSha256)) throw fail('Invalid expectedSha256');
  if (!Number.isSafeInteger(p.expectedBytes) || p.expectedBytes <= 0) throw fail('Invalid expectedBytes');
  out.expectedSha256 = p.expectedSha256;
  out.expectedBytes = p.expectedBytes;
  if (!['youtube', 'tiktok'].includes(out.destination)) throw fail('Unsupported destination');
  if (out.privacyStatus !== (out.destination === 'youtube' ? 'public' : 'PUBLIC_TO_EVERYONE')) throw fail('Explicit public privacyStatus is required');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(out.scheduledAt) || !Number.isFinite(Date.parse(out.scheduledAt)) || new Date(out.scheduledAt).toISOString().replace('.000Z', 'Z') !== out.scheduledAt.replace('.000Z', 'Z')) throw fail('scheduledAt must be a valid UTC ISO timestamp');
  try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }); } catch { throw fail('Invalid IANA timezone'); }
  return out;
}
function publicPost(p, active) {
  const { ownerId, fingerprint, filePath, frozenName, mediaReadPath, ...view } = p;
  if (view.status === 'publishing' && !active.has(p.id)) return { ...view, status: 'needs_review', error: 'A previous publish may have reached the provider. No automatic retry.' };
  return view;
}

/** Injectable provider boundary, actual durable repository, no import-time jobs. */
export function createFinitePostQueue({ dispatch, preflight = () => {}, now = Date.now, persist = writeFinitePosts, maxLatenessMs = 15 * 60_000 }) {
  const active = new Set(); let running = false, timer = null, inFlight = Promise.resolve();
  function list(ctx) { return read(ctx).filter(p => p.ownerId === ctx.userId).map(p => publicPost(p, active)); }
  function enqueue(ctx, batch) {
    if (!Array.isArray(batch) || !batch.length || batch.length > 20) throw fail('posts must contain 1 to 20 entries');
    return locked(ctx, () => {
      const posts = read(ctx); const result = [], staged = []; const ids = new Set();
      for (const raw of batch) {
        const payload = input(raw), fingerprint = hash(JSON.stringify(payload));
        if (ids.has(payload.clientId)) throw fail('Duplicate clientId in batch'); ids.add(payload.clientId);
        const old = posts.find(p => p.ownerId === ctx.userId && p.clientId === payload.clientId);
        if (old) { if (old.fingerprint !== fingerprint) throw fail('clientId already used with different payload', 409); result.push(old); continue; }
        if (Date.parse(payload.scheduledAt) <= now()) throw fail('scheduledAt must be in the future');
        const media = inspectFiniteMedia(ctx, payload.videoUrl);
        if (media.mediaSha256 !== payload.expectedSha256.toLowerCase() || media.bytes !== payload.expectedBytes) throw fail('Selected original integrity does not match owned media');
        const post = { ...payload, ...media, id: crypto.randomUUID(), ownerId: ctx.userId, fingerprint, status: 'queued', receipt: null, error: null, createdAt: new Date(now()).toISOString() };
        staged.push(post); result.push(post);
      }
      if (staged.length) persist(ctx, [...posts, ...staged]);
      return result.map(p => publicPost(p, active));
    });
  }
  function cancel(ctx, id) {
    return locked(ctx, () => {
      const posts = read(ctx), post = posts.find(p => p.id === id && p.ownerId === ctx.userId);
      if (!post) throw fail('Post not found', 404);
      if (post.status !== 'queued' || fs.existsSync(path.join(ctx.dataDir, `scheduled-claim-${post.id}`))) throw fail('Only queued, unclaimed posts can be cancelled', 409);
      post.status = 'cancelled'; persist(ctx, posts); return publicPost(post, active);
    });
  }
  async function process(ctx, id) {
    let post, snapshot;
    locked(ctx, () => {
      const posts = read(ctx); post = posts.find(p => p.id === id && p.ownerId === ctx.userId);
      if (!post || post.status !== 'queued' || Date.parse(post.scheduledAt) > now()) { post = null; return; }
      const claim = path.join(ctx.dataDir, `scheduled-claim-${post.id}`);
      let fd; try { fd = fs.openSync(claim, 'wx', 0o600); fs.writeFileSync(fd, 'Do not remove: publish claim may have reached provider.'); fs.fsyncSync(fd); } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        post.status = 'needs_review'; post.error = 'Publish claim already exists. No automatic retry.'; persist(ctx, posts); post = null; return;
      } finally { if (fd !== undefined) fs.closeSync(fd); }
      try {
        if (now() - Date.parse(post.scheduledAt) > maxLatenessMs) throw fail('Scheduled time was missed; expired without posting');
        const media = inspectFiniteMedia(ctx, post.videoUrl);
        if (media.filePath !== post.filePath || media.mediaSha256 !== post.mediaSha256 || media.bytes !== post.bytes) throw fail('Original MP4 changed since scheduling');
        preflight({ destination: post.destination, title: post.title, caption: post.caption, videoUrl: post.videoUrl, privacyStatus: post.privacyStatus }, { ctx });
        // Freeze dispatch bytes in a unique unguessable owned output; never
        // give a provider a path which the caller may replace during upload.
        snapshot = path.join(ctx.outputDir, `finite-post-${post.id}.mp4`);
        fs.copyFileSync(media.filePath, snapshot, fs.constants.COPYFILE_EXCL);
        if (hashFile(snapshot) !== post.mediaSha256) throw fail('MP4 changed while preparing publish');
        post.frozenName = path.basename(snapshot);
        if (post.destination === 'tiktok') post.mediaReadPath = finiteMediaReadPath(ctx, post, now());
        post.status = 'publishing'; post.error = null;
      } catch (e) { post.status = 'failed'; post.error = e.message; }
      persist(ctx, posts); // MUST succeed before any provider I/O.
      if (post.status !== 'publishing') post = null;
    });
    if (!post) return;
    active.add(post.id);
    let receipt = null, status = 'needs_review', error = null;
    try {
      const outcome = await dispatch({ destination: post.destination, title: post.title, caption: post.caption, videoUrl: post.destination === 'tiktok' ? post.mediaReadPath : `/outputs/${path.basename(snapshot)}`, privacyStatus: post.privacyStatus }, { ctx });
      receipt = outcome.receipt ?? null;
      status = ['published', 'accepted', 'draft', 'failed', 'needs_review'].includes(outcome.status) ? outcome.status : 'needs_review';
      error = outcome.error || (status === 'needs_review' ? 'Provider outcome is uncertain. No automatic retry.' : null);
    } catch { error = 'Provider request failed or its outcome is uncertain. Review the connected platform before taking further action. No automatic retry.'; }
    try {
      locked(ctx, () => {
        const posts = read(ctx), current = posts.find(p => p.id === post.id && p.ownerId === ctx.userId);
        if (!current || current.status !== 'publishing') throw new Error('Publish record changed');
        Object.assign(current, { status, receipt, error, finishedAt: new Date(now()).toISOString() }); persist(ctx, posts);
      });
    } finally { active.delete(post.id); }
    // Snapshot intentionally retained: accepted TikTok requests may fetch later.
  }
  async function tick(contexts) {
    if (running) return; running = true;
    try {
      let processed = 0;
      for (const ctx of contexts) {
        if (!fs.existsSync(path.join(ctx.dataDir, FILE))) continue;
        // A second process cannot run a second provider call for this owner.
        // Crash-held execution locks are never stolen automatically.
        const executionLock = path.join(ctx.dataDir, 'scheduled-worker.lock');
        let fd;
        try { fd = fs.openSync(executionLock, 'wx', 0o600); }
        catch (e) { if (e.code === 'EEXIST') continue; throw e; }
        try {
          for (const p of read(ctx).filter(p => p.ownerId === ctx.userId && p.status === 'queued' && Date.parse(p.scheduledAt) <= now()).sort((a,b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
            if (processed++ >= 20) return;
            try { await process(ctx, p.id); } catch (e) { console.warn('[finite-posts] held safely:', e.message); }
          }
        } finally {
          fs.closeSync(fd); fs.unlinkSync(executionLock);
        }
      }
    } finally { running = false; }
  }
  return { list, enqueue, cancel, tick,
    start(contexts, intervalMs = 30_000) { if (timer) return; const run = () => { inFlight = tick(contexts()).catch(e => console.warn('[finite-posts]', e.message)); }; timer = setInterval(run, intervalMs); timer.unref?.(); run(); },
    async stop() { if (timer) clearInterval(timer); timer = null; await inFlight; },
  };
}

export function createFinitePostsRouter({ Router, queue }) {
  const router = Router();
  router.use((req, res, next) => {
    if (!req.user || !req.ctx?.userId || !req.ctx?.dataDir || !req.ctx?.outputDir) return res.status(401).json({ error: 'Authentication required' });
    if (['mcp', 'agent-key'].includes(req.user.via)) return res.status(403).json({ error: 'AGENT_FORBIDDEN' });
    next();
  });
  const answer = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 400).json({ error: e.status ? e.message : 'Queue operation failed; check media or ask an operator to review storage.' }); } };
  router.get('/', answer(req => ({ posts: queue.list(req.ctx) })));
  router.post('/', answer(req => ({ posts: queue.enqueue(req.ctx, req.body?.posts) })));
  router.post('/:id/cancel', answer(req => queue.cancel(req.ctx, req.params.id)));
  return router;
}


