export function isVeoConfigured() {
  if (String(process.env.VEO_API_URL || '').trim() && String(process.env.VEO_API_KEY || '').trim()) return true;
  if (String(process.env.VEO_API_KEY || '').trim()) return true;
  if (String(process.env.GOOGLE_VERTEX_PROJECT || '').trim()) return true;
  if (String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) return true;
  return false;
}

export async function generateVideoVeo({ projectId, prompt, aspect = '16:9', durationSec = 8 } = {}) {
  if (!isVeoConfigured()) {
    return {
      ok: false,
      skipped: true,
      error: 'Veo is not configured',
    };
  }

  const request = {
    projectId: projectId || null,
    prompt: String(prompt || '').trim(),
    aspect,
    durationSec: Math.max(4, Math.min(8, Number(durationSec) || 8)),
  };

  const endpoint = String(process.env.VEO_API_URL || '').trim();
  const apiKey = String(process.env.VEO_API_KEY || '').trim();
  if (endpoint && apiKey) {
    try {
      const fetcher = arguments[0]?.fetchImpl || fetch;
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, provider: 'veo', code: 'VEO_HTTP_ERROR', error: json.error || `Veo HTTP ${response.status}` };
      return { ok: true, provider: 'veo', publicUrl: json.publicUrl || json.url || json.videoUrl, path: json.path || json.gcsUri, raw: json };
    } catch (error) {
      return { ok: false, provider: 'veo', code: 'VEO_REQUEST_FAILED', error: String(error?.message || error) };
    }
  }

  return {
    ok: false,
    provider: 'veo',
    code: 'PROVIDER_NOT_IMPLEMENTED',
    error:
      'Veo provider seam is configured but no official VEO_API_URL + VEO_API_KEY endpoint is set yet.',
    request,
  };
}
