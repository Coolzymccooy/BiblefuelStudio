import { buildR2ObjectKey, getR2Config, putR2Object } from '../../storage/r2.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function isVeoConfigured() {
  if (String(process.env.VEO_API_URL || '').trim() && String(process.env.VEO_API_KEY || '').trim()) return true;
  if (String(process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '').trim()) return true;
  if (String(process.env.GOOGLE_VERTEX_PROJECT || '').trim()) return true;
  if (String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) return true;
  return false;
}

function apiKey() {
  return String(process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

const DEFAULT_VEO_MODEL = 'veo-3.1-generate-preview';

/**
 * Model ids for a preview API move, and a hardcoded default silently rots:
 * this shipped pinned to veo-3.0-generate-preview, which Google no longer
 * serves, so every single request died on
 *   "models/veo-3.0-generate-preview is not found for API version v1beta"
 * while /status still cheerfully reported enabled:true.
 *
 * VEO_MODEL still wins when set — an operator pinning a specific model is a
 * deliberate choice. Otherwise we ASK the API which veo models this key can
 * actually drive, and prefer the newest non-lite one. The lookup is cached for
 * the process: it costs one request, and a wrong guess costs every request.
 */
let modelCachePromise = null;

async function discoverVeoModel(fetcher, key) {
  const response = await fetcher(`${GEMINI_API_BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const json = await parseJsonResponse(response);
  const usable = (json?.models || [])
    .filter((m) => /veo/i.test(m?.name || ''))
    .filter((m) => (m?.supportedGenerationMethods || []).includes('predictLongRunning'))
    .map((m) => String(m.name).replace(/^models\//, ''));
  if (usable.length === 0) return null;
  // Newest first, and a full model ahead of fast/lite: this is the default for
  // someone who did not choose, so quality beats latency.
  const rank = (id) => (/lite/i.test(id) ? 2 : /fast/i.test(id) ? 1 : 0);
  usable.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
  return usable[0];
}

async function veoModel(fetcher) {
  const pinned = String(process.env.VEO_MODEL || '').trim();
  if (pinned) return pinned;
  if (!modelCachePromise) {
    modelCachePromise = discoverVeoModel(fetcher, apiKey())
      .catch(() => null)
      .then((found) => found || DEFAULT_VEO_MODEL);
  }
  return modelCachePromise;
}

function clampDuration(value) {
  return Math.max(4, Math.min(8, Number(value) || 8));
}

function normalizeAspect(aspect) {
  return ['16:9', '9:16', '1:1'].includes(String(aspect)) ? String(aspect) : '16:9';
}

async function parseJsonResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { text }; }
}

function extractOperationName(payload) {
  return payload?.name || payload?.operation?.name || payload?.operationName || '';
}

function extractVideoUri(payload) {
  const candidates = [
    payload?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri,
    payload?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.url,
    payload?.response?.generatedVideos?.[0]?.video?.uri,
    payload?.response?.generatedVideos?.[0]?.video?.url,
    payload?.response?.videos?.[0]?.uri,
    payload?.response?.videos?.[0]?.url,
    payload?.response?.video?.uri,
    payload?.response?.video?.url,
    payload?.video?.uri,
    payload?.video?.url,
    payload?.uri,
    payload?.url,
  ];
  return candidates.find(Boolean) || '';
}

async function downloadGeneratedVideo(uri, key, fetcher) {
  const joiner = uri.includes('?') ? '&' : '?';
  const url = uri.startsWith('http') && key ? `${uri}${joiner}key=${encodeURIComponent(key)}` : uri;
  const response = await fetcher(url, { headers: { Accept: 'video/mp4,application/octet-stream,*/*' } });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Veo download failed: ${response.status} ${detail}`.slice(0, 240));
  }
  return Buffer.from(await response.arrayBuffer());
}

async function generateViaGeminiApi(request, { fetcher, r2Config } = {}) {
  const key = apiKey();
  if (!key) return { ok: false, provider: 'veo', code: 'NOT_CONFIGURED', error: 'Missing GOOGLE_AI_API_KEY/GEMINI_API_KEY/VEO_API_KEY' };

  const model = await veoModel(fetcher);
  const predictUrl = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(key)}`;
  const predictBody = {
    instances: [{ prompt: request.prompt }],
    parameters: {
      aspectRatio: request.aspect,
      durationSeconds: request.durationSec,
      // Veo 3.1 rejects both 'allow_adult' and 'dont_allow' outright
      // ("...is currently not supported"), so the 3.0-era value here failed
      // every request with a 400 even once the model id was right. 'allow_all'
      // is what this model accepts. Overridable because the accepted set is
      // clearly still moving between preview releases.
      personGeneration: String(process.env.VEO_PERSON_GENERATION || 'allow_all').trim(),
    },
  };
  const predict = await fetcher(predictUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(predictBody),
  });
  const predictJson = await parseJsonResponse(predict);
  if (!predict.ok) return { ok: false, provider: 'veo', code: 'VEO_HTTP_ERROR', error: predictJson?.error?.message || `Veo HTTP ${predict.status}` };

  const operationName = extractOperationName(predictJson);
  if (!operationName) return { ok: false, provider: 'veo', code: 'VEO_OPERATION_MISSING', error: 'Veo did not return an operation name' };

  const maxPolls = Math.max(1, Math.min(120, Number(process.env.VEO_MAX_POLLS) || 60));
  const pollMs = Math.max(250, Math.min(10000, Number(process.env.VEO_POLL_MS) || 5000));
  let finalPayload = predictJson;
  for (let i = 0; i < maxPolls; i += 1) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
    const opUrl = `${GEMINI_API_BASE}/${operationName}?key=${encodeURIComponent(key)}`;
    const op = await fetcher(opUrl, { headers: { Accept: 'application/json' } });
    const opJson = await parseJsonResponse(op);
    if (!op.ok) return { ok: false, provider: 'veo', code: 'VEO_OPERATION_HTTP_ERROR', error: opJson?.error?.message || `Veo operation HTTP ${op.status}` };
    finalPayload = opJson;
    if (opJson?.error) return { ok: false, provider: 'veo', code: 'VEO_OPERATION_FAILED', error: opJson.error.message || 'Veo operation failed', raw: opJson };
    if (opJson?.done) break;
  }

  if (!finalPayload?.done) return { ok: false, provider: 'veo', code: 'VEO_TIMEOUT', error: 'Veo operation did not complete before timeout', operationName };
  const videoUri = extractVideoUri(finalPayload);
  if (!videoUri) return { ok: false, provider: 'veo', code: 'VEO_VIDEO_MISSING', error: 'Veo operation completed but no video URI was returned', operationName, raw: finalPayload };

  const cfg = r2Config || getR2Config();
  if (!cfg.configured) {
    return { ok: true, provider: 'veo', operationName, videoUri, publicUrl: videoUri, storage: { provider: 'google-temporary', r2Configured: false } };
  }

  const video = await downloadGeneratedVideo(videoUri, key, fetcher);
  const objectKey = buildR2ObjectKey({ projectId: request.projectId, prefix: 'veo', extension: 'mp4' });
  const uploaded = await putR2Object({ key: objectKey, body: video, contentType: 'video/mp4', config: cfg, fetchImpl: fetcher });
  return { ok: true, provider: 'veo', operationName, publicUrl: uploaded.publicUrl || videoUri, path: uploaded.path, storage: { provider: 'r2', key: uploaded.key, publicUrl: uploaded.publicUrl } };
}

export async function generateVideoVeo({ projectId, prompt, aspect = '16:9', durationSec = 8, fetchImpl, r2Config } = {}) {
  if (!isVeoConfigured()) {
    return { ok: false, skipped: true, error: 'Veo is not configured' };
  }

  const request = {
    projectId: projectId || null,
    prompt: String(prompt || '').trim(),
    aspect: normalizeAspect(aspect),
    durationSec: clampDuration(durationSec),
  };

  const fetcher = fetchImpl || fetch;
  const endpoint = String(process.env.VEO_API_URL || '').trim();
  const key = apiKey();
  if (endpoint && key) {
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, provider: 'veo', code: 'VEO_HTTP_ERROR', error: json.error || `Veo HTTP ${response.status}` };
      return { ok: true, provider: 'veo', publicUrl: json.publicUrl || json.url || json.videoUrl, path: json.path || json.gcsUri, raw: json };
    } catch (error) {
      return { ok: false, provider: 'veo', code: 'VEO_REQUEST_FAILED', error: String(error?.message || error) };
    }
  }

  try {
    return await generateViaGeminiApi(request, { fetcher, r2Config });
  } catch (error) {
    return { ok: false, provider: 'veo', code: error?.code || 'VEO_REQUEST_FAILED', error: String(error?.message || error) };
  }
}
