import {
  synthesizeElevenLabs,
  synthesizeElevenLabsWithTimestamps,
  isElevenLabsConfigured,
} from "../../elevenLabsTts.js";

/**
 * ElevenLabs TTS provider — wraps the existing lib/elevenLabsTts.js module
 * behind the voice/ TTSProvider interface.
 *
 * @type {import("../types.js").TTSProvider}
 */
export const elevenLabsProvider = {
  id: "elevenlabs",

  isAvailable() {
    return isElevenLabsConfigured();
  },

  capabilities() {
    return {
      wordTimestamps: false,
      charTimestamps: true,
      emotionControls: true,
      ssml: false,
      streaming: false,
    };
  },

  async synthesize(req) {
    const { text, voiceSettings, modelId, withTimestamps } = req;
    const voiceId = req.voiceIds?.elevenlabs ?? req.voiceId;
    if (withTimestamps) {
      return synthesizeElevenLabsWithTimestamps({
        text,
        voiceId,
        voiceSettings,
        modelId,
      });
    }
    return synthesizeElevenLabs({ text, voiceId, voiceSettings, modelId });
  },
};
