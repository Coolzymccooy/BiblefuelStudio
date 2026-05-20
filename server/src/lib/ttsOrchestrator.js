import { synthesize, describeProviders } from "./voice/index.js";

/**
 * Legacy TTS orchestrator — preserved for backward compatibility.
 *
 * Internally this just delegates to the voice/ engine. The shape of both
 * `opts` and the returned value is unchanged from the pre-refactor API:
 *
 *   opts:    { text, voiceId, elevenLabsVoiceId?, edgeVoiceId?,
 *              voiceSettings?, modelId?, withTimestamps? }
 *
 *   result:  { ok, file, provider, voice, alignment? }
 *
 * Callers (server/src/routes/jobs.js — kineticCaptions and campaign renders)
 * depend on this shape. Do not change it. New code should import from
 * ./voice/index.js directly.
 *
 * @param {{
 *   text: string,
 *   voiceId?: string,
 *   elevenLabsVoiceId?: string,
 *   edgeVoiceId?: string,
 *   voiceSettings?: any,
 *   modelId?: string,
 *   withTimestamps?: boolean,
 * }} opts
 */
export async function synthesizeTts(opts = {}) {
  const {
    text,
    voiceId,
    elevenLabsVoiceId,
    edgeVoiceId,
    voiceSettings,
    modelId,
    withTimestamps,
  } = opts;

  // Build the per-provider voiceIds map. The legacy semantics: if
  // elevenLabsVoiceId was set, treat the generic voiceId as ElevenLabs-only
  // and do NOT use it for Edge. The edgeProvider handles that asymmetry
  // (see explicitlyForOtherProvider in edgeProvider.js).
  /** @type {Record<string, string>} */
  const voiceIds = {};
  if (elevenLabsVoiceId) voiceIds.elevenlabs = elevenLabsVoiceId;
  if (edgeVoiceId) voiceIds.edge = edgeVoiceId;

  return synthesize({
    text,
    voiceId,
    voiceIds: Object.keys(voiceIds).length > 0 ? voiceIds : undefined,
    voiceSettings,
    modelId,
    withTimestamps,
  });
}

export function describeTtsProviders() {
  return describeProviders();
}
