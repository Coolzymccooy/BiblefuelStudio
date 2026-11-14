import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PURPOSE = 'biblefuel-finite-media-read-v1';
const UUID = /^[0-9a-f-]{36}$/i;
function key() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('Finite media signing is unavailable');
  return crypto.createHmac('sha256', secret).update(PURPOSE).digest();
}
function signature(body) { return crypto.createHmac('sha256', key()).update(body).digest('base64url'); }
/** Deny unsigned snapshot aliases before BOTH global and tenant /outputs serving. */
export function denyFiniteSnapshotAliases(req, res, next) {
  let relative;
  try { relative = decodeURIComponent(req.path).replace(/\\/g, '/'); }
  catch { return res.status(404).end(); }
  if (relative.split('/').some(segment => /^finite-post-/i.test(segment))) {
    return res.status(404).set('Cache-Control', 'private, no-store').end();
  }
  return next();
}

/** Non-login capability, scoped to one immutable job; survives process restart. */
export function finiteMediaReadPath(ctx, post, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ purpose: PURPOSE, owner: ctx.userId, job: post.id,
    sha256: post.mediaSha256, bytes: post.bytes, exp: now + 7 * 86400000 })).toString('base64url');
  return `/api/finite-media/${body}.${signature(body)}`;
}

/** resolveOwner MUST resolve a persisted known actor, never a caller-supplied root. */
export function createFiniteMediaRouter({ Router, resolveOwner, now = Date.now }) {
  const router = Router();
  router.all('/:capability', (req, res) => {
    let fd;
    const deny = () => res.status(404).end();
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return deny();
      const token = req.params.capability;
      if (token.length > 2048) return deny();
      const parts = token.split('.'); if (parts.length !== 2) return deny();
      const [body, sig] = parts, expected = signature(body);
      if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return deny();
      const c = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (c.purpose !== PURPOSE || typeof c.owner !== 'string' || !UUID.test(c.job) || !/^[a-f0-9]{64}$/.test(c.sha256) || !Number.isSafeInteger(c.bytes) || c.bytes <= 0 || !Number.isSafeInteger(c.exp) || c.exp <= now()) return deny();
      const ctx = resolveOwner(c.owner); if (!ctx || ctx.userId !== c.owner) return deny();
      const store = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'scheduled-posts.json'), 'utf8'));
      const post = store.posts?.find(p => p.id === c.job && p.ownerId === c.owner);
      if (!post || post.destination !== 'tiktok' || !['publishing','accepted','published','draft','needs_review'].includes(post.status) || post.mediaSha256 !== c.sha256 || post.bytes !== c.bytes || post.frozenName !== `finite-post-${c.job}.mp4`) return deny();
      const root = path.resolve(ctx.outputDir), file = path.join(root, post.frozenName);
      if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink() || fs.realpathSync(root) !== root || path.dirname(fs.realpathSync(file)) !== root) return deny();
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== c.bytes) return deny();
      const digest = crypto.createHash('sha256'), buf = Buffer.alloc(65536); let n, pos = 0;
      while ((n = fs.readSync(fd, buf, 0, buf.length, pos))) { digest.update(buf.subarray(0,n)); pos += n; }
      if (digest.digest('hex') !== c.sha256) return deny();
      let start = 0, end = stat.size - 1;
      if (req.headers.range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!m || (!m[1] && !m[2])) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
        else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      res.set({ 'Content-Type': 'video/mp4', 'Content-Length': String(end-start+1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file, { fd, autoClose: true, start, end }); fd = undefined;
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { if (!res.headersSent) deny(); else res.destroy(); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  });
  return router;
}
