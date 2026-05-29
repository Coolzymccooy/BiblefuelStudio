import { synthesize } from "./orchestrator.js";
import { resolveProfile, DEFAULT_CATEGORY } from "./profiles.js";

/**
 * @typedef {Object} CategorySynthesisRequest
 * @property {string} text
 * @property {string} [category]                 Narration category. Defaults to "devotional".
 * @property {boolean} [withTimestamps]
 * @property {boolean} [scriptureMode]           Expand Bible references + pacing for spoken narration.
 * @property {string} [preferredProvider]        Hard override for provider selection.
 * @property {Object} [overrides]                Overrides applied on top of profile.
 * @property {string} [overrides.voiceId]
 * @property {Record<string,string>} [overrides.voiceIds]
 * @property {Object} [overrides.voiceSettings]
 * @property {string} [overrides.modelId]
 * @property {Object} [overrides.prosody]
 *
 * @typedef {import("./types.js").SpeechResult & {
 *   category: string,
 *   profileLabel: string,
 *   recommendedTypographyPreset: string,
 * }} CategorySynthesisResult
 */

/**
 * Synthesize text using a named narration category. Profile-derived defaults
 * are applied first; any explicit `overrides` win.
 *
 * The returned SpeechResult is enriched with `category`, `profileLabel`, and
 * `recommendedTypographyPreset` so the downstream typography renderer can
 * pick a matching preset without knowing the profile system.
 *
 * @param {CategorySynthesisRequest} req
 * @returns {Promise<CategorySynthesisResult>}
 */
export async function synthesizeForCategory(req) {
  const category = (req?.category || DEFAULT_CATEGORY).toString();
  const profile = resolveProfile(category);
  const overrides = req?.overrides || {};

  // Build a per-provider voiceIds map from the profile so whichever provider
  // ends up handling the call gets the right voice. Caller overrides win.
  /** @type {Record<string, string>} */
  const voiceIds = {};
  if (profile.elevenlabs?.voiceId) voiceIds.elevenlabs = profile.elevenlabs.voiceId;
  if (profile.edge?.voiceId) voiceIds.edge = profile.edge.voiceId;
  if (overrides.voiceIds) Object.assign(voiceIds, overrides.voiceIds);

  // preferredProvider: explicit override wins; else first entry of the
  // profile's providerPreference list.
  const preferredProvider =
    req?.preferredProvider ||
    (Array.isArray(profile.providerPreference) ? profile.providerPreference[0] : undefined);

  const voiceSettings = {
    ...(profile.elevenlabs?.voiceSettings || {}),
    ...(overrides.voiceSettings || {}),
  };

  const prosody = {
    ...(profile.edge?.prosody || {}),
    ...(overrides.prosody || {}),
  };

  // Scripture-aware preparation is now handled in the orchestrator (default
  // ON unless scriptureMode:false). We just propagate the caller's intent.
  const speechReq = {
    text: req.text,
    voiceId: overrides.voiceId,
    voiceIds: Object.keys(voiceIds).length > 0 ? voiceIds : undefined,
    voiceSettings: Object.keys(voiceSettings).length > 0 ? voiceSettings : undefined,
    modelId: overrides.modelId || profile.elevenlabs?.modelId,
    prosody: Object.keys(prosody).length > 0 ? prosody : undefined,
    preferredProvider,
    withTimestamps: req?.withTimestamps,
    scriptureMode: req?.scriptureMode,
    // Category-aware synthesis is intended for cinematic content where word
    // timings drive the typography renderer. Default to ON; caller can flip
    // it off explicitly via overrides.forcedAlignmentFallback = false.
    forcedAlignmentFallback:
      overrides.forcedAlignmentFallback ?? req?.forcedAlignmentFallback ?? true,
  };

  const result = await synthesize(speechReq);

  return {
    ...result,
    category: profile.category,
    profileLabel: profile.label,
    recommendedTypographyPreset: profile.recommendedTypographyPreset,
  };
}
