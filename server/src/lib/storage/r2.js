import crypto from 'node:crypto';

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hmac = (key, str, encoding) => crypto.createHmac('sha256', key).update(str, 'utf8').digest(encoding);

function hmacBuffer(key, str) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest();
}

function clean(value) {
  return String(value || '').trim();
}

function envConfig(env = process.env) {
  const endpoint = clean(env.R2_ENDPOINT || env.S3_ENDPOINT || env.CLOUDFLARE_R2_ENDPOINT);
  const bucket = clean(env.R2_BUCKET || env.R2_MEDIA_BUCKET || env.MEDIA_R2_BUCKET || env.CLOUDFLARE_R2_BUCKET);
  const accessKeyId = clean(env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || env.CLOUDFLARE_R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || env.CLOUDFLARE_R2_SECRET_ACCESS_KEY);
  const publicBaseUrl = clean(env.R2_PUBLIC_BASE_URL || env.R2_PUBLIC_URL || env.MEDIA_PUBLIC_BASE_URL || env.CLOUDFLARE_R2_PUBLIC_BASE_URL);
  const region = clean(env.R2_REGION || env.AWS_REGION) || 'auto';
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl, region };
}

export function getR2Config(env = process.env) {
  const cfg = envConfig(env);
  return {
    ...cfg,
    configured: !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey),
    hasPublicBaseUrl: !!cfg.publicBaseUrl,
  };
}

export function publicUrlForKey(key, config = getR2Config()) {
  if (!config.publicBaseUrl) return null;
  return `${String(config.publicBaseUrl).replace(/\/+$/, '')}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
}

function canonicalUriFor(pathname) {
  return pathname.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
}

function signingKey(secretAccessKey, dateStamp, region) {
  let key = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
  key = hmacBuffer(key, region);
  key = hmacBuffer(key, 's3');
  key = hmacBuffer(key, 'aws4_request');
  return key;
}

export async function putR2Object({ key, body, contentType = 'application/octet-stream', config = getR2Config(), fetchImpl = fetch } = {}) {
  if (!config.configured) {
    const err = new Error('R2 is not configured');
    err.code = 'R2_NOT_CONFIGURED';
    throw err;
  }
  if (!key) throw new Error('R2 object key is required');
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const base = config.endpoint.replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(config.bucket)}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
  const u = new URL(url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(bytes);
  const canonicalHeaders = `content-type:${contentType}\nhost:${u.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', canonicalUriFor(u.pathname), '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.region || 'auto'}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(Buffer.from(canonicalRequest))].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(config.secretAccessKey, dateStamp, config.region || 'auto')).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`R2 upload failed: ${response.status} ${text}`.slice(0, 240));
    err.code = 'R2_UPLOAD_FAILED';
    err.status = response.status;
    throw err;
  }
  return { key, path: `r2://${config.bucket}/${key}`, publicUrl: publicUrlForKey(key, config) };
}

export function buildR2ObjectKey({ projectId = 'timeline', prefix = 'veo', extension = 'mp4' } = {}) {
  const safeProject = String(projectId || 'timeline').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'timeline';
  const id = crypto.randomUUID();
  return `${prefix}/${safeProject}/${id}.${extension.replace(/^\./, '')}`;
}
