import { synthesizeElevenLabs, synthesizeElevenLabsWithTimestamps, isElevenLabsConfigured } from "./elevenLabsTts.js";
import { synthesizeEdgeTts, isEdgeTtsEnabled } from "./edgeTts.js";

/**
 * TTS provider preference (highest first):
 * 1. ElevenLabs — paid, premium quality, used when the user has supplied a key.
 * 2. Edge-TTS   — free Microsoft "Read Aloud", used as automatic fallback.
 *
 * Returns the same shape as both providers: { ok, file, provider, voice }.
 * When `withTimestamps: true` is requested AND ElevenLabs answers, an extra
 * `alignment: { characters, starts, ends }` field is included.
 *
 * Falls back automatically on provider errors (rate limit, billing failure,
 * invalid voice, network blip). If both providers fail, the original error
 * from the FIRST provider is thrown so logs make it clear where the chain
 * started failing.
 *
 * @param {{ text: string, voiceId?: string, elevenLabsVoiceId?: string, edgeVoiceId?: string, voiceSettings?: any, modelId?: string, withTimestamps?: boolean }} opts
 */
export async function synthesizeTts(opts = {}) {
  const { text, voiceId, withTimestamps } = opts;
  if (!text || String(text).trim().length < 3) {
    throw new Error("text required (min 3 chars)");
  }

  const errors = [];

  if (isElevenLabsConfigured()) {
    try {
      const fn = withTimestamps ? synthesizeElevenLabsWithTimestamps : synthesizeElevenLabs;
      return await fn({
        text,
        voiceId: opts.elevenLabsVoiceId || voiceId,
        voiceSettings: opts.voiceSettings,
        modelId: opts.modelId,
      });
    } catch (err) {
      const msg = String(err?.message || err);
      console.warn(`[TTS] ElevenLabs failed, falling back to Edge-TTS: ${msg}`);
      errors.push({ provider: "elevenlabs", error: msg });
    }
  }

  if (isEdgeTtsEnabled()) {
    try {
      return await synthesizeEdgeTts({
        text,
        voiceId: opts.edgeVoiceId || (opts.elevenLabsVoiceId ? undefined : voiceId),
      });
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`[TTS] Edge-TTS also failed: ${msg}`);
      errors.push({ provider: "edge", error: msg });
    }
  }

  if (errors.length === 0) {
    throw new Error("No TTS provider available — set ELEVENLABS_API_KEY or enable Edge-TTS (EDGE_TTS_ENABLED=true)");
  }
  const first = errors[0];
  throw new Error(`TTS pipeline failed. First failure (${first.provider}): ${first.error}`);
}

export function describeTtsProviders() {
  return {
    elevenlabs: { available: isElevenLabsConfigured(), priority: 1 },
    edge: { available: isEdgeTtsEnabled(), priority: 2 },
  };
}
