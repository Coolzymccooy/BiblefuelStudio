export function isVeoConfigured() {
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

  return {
    ok: false,
    provider: 'veo',
    code: 'PROVIDER_NOT_IMPLEMENTED',
    error:
      'Veo provider seam is configured but the production Google Veo API call/poll/download path is not wired yet.',
    request: {
      projectId: projectId || null,
      prompt: String(prompt || '').trim(),
      aspect,
      durationSec: Math.max(4, Math.min(8, Number(durationSec) || 8)),
    },
  };
}
