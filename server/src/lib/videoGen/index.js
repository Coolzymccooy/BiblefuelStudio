import { generateVideoVeo, isVeoConfigured } from './providers/veo.js';

/**
 * Video-generation orchestrator for timeline assets.
 *
 * This deliberately mirrors imageGen's shape but returns MP4-capable assets.
 * Today it provides a safe Veo adapter seam; the provider reports configured
 * state but returns PROVIDER_NOT_IMPLEMENTED until the real Google API call and
 * polling/download path are wired.
 */

export function isVideoGenEnabled() {
  const flag = String(process.env.VIDEO_GEN_ENABLED || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') return listVideoProviderChain({ ignoreMasterFlag: true }).length > 0;
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  return listVideoProviderChain({ ignoreMasterFlag: true }).length > 0;
}

export function listVideoProviderChain(opts = {}) {
  const flag = String(process.env.VIDEO_GEN_ENABLED || '').trim().toLowerCase();
  if (!opts.ignoreMasterFlag && ['false', '0', 'no'].includes(flag)) return [];

  const requested = String(process.env.VIDEO_GEN_PROVIDER || 'auto').trim().toLowerCase();
  const all = [];
  if (isVeoConfigured()) all.push('veo');

  if (requested === 'auto') return all;
  if (requested === 'none') return [];
  if (requested === 'veo') return all.filter((provider) => provider === 'veo');
  return all;
}

export async function generateTimelineVideo({
  projectId,
  prompt,
  aspect = '16:9',
  durationSec = 8,
  style,
  seedImagePath,
} = {}) {
  const safePrompt = String(prompt || '').trim();
  if (!safePrompt) {
    return { ok: false, error: 'prompt required', code: 'BAD_REQUEST' };
  }

  const chain = listVideoProviderChain();
  if (chain.length === 0) {
    return {
      ok: false,
      skipped: true,
      error: 'No video-gen providers configured',
    };
  }

  const errors = [];
  for (const provider of chain) {
    const result = provider === 'veo'
      ? await generateVideoVeo({ projectId, prompt: safePrompt, aspect, durationSec, style, seedImagePath })
      : null;
    if (result?.ok) return result;
    if (result) {
      errors.push(`${provider}: ${result.error || 'unknown error'}`);
      // While Veo is the only configured provider, surface its structured
      // placeholder/error directly so the UI can say exactly what's missing.
      return result;
    }
  }

  return { ok: false, error: errors.join(' | ') || 'all video providers failed' };
}
