import { synthesizeEdgeTts, isEdgeTtsEnabled } from "../../edgeTts.js";

/**
 * Edge-TTS provider — wraps the existing lib/edgeTts.js module behind the
 * voice/ TTSProvider interface.
 *
 * @type {import("../types.js").TTSProvider}
 */
export const edgeProvider = {
  id: "edge",

  isAvailable() {
    return isEdgeTtsEnabled();
  },

  capabilities() {
    return {
      wordTimestamps: false,
      charTimestamps: false,
      emotionControls: false,
      ssml: true,
      streaming: true,
    };
  },

  async synthesize(req) {
    const { text, prosody } = req;
    // Edge voices use a different namespace (e.g. "en-US-AriaNeural") than
    // ElevenLabs ids. Only honor a generic voiceId here if it was not
    // explicitly directed at another provider via voiceIds.
    const explicitlyForOtherProvider = req.voiceIds && Object.keys(req.voiceIds).some((k) => k !== "edge");
    const voiceId = req.voiceIds?.edge ?? (explicitlyForOtherProvider ? undefined : req.voiceId);
    return synthesizeEdgeTts({
      text,
      voiceId,
      rate: prosody?.rate,
      pitch: prosody?.pitch,
      volume: prosody?.volume,
    });
  },
};
