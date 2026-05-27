/**
 * Voice synthesis engine — shared typedefs.
 *
 * JSDoc only. No runtime code. Imported via `@type` references elsewhere
 * in the voice/ package so IDE tooling can surface the interface contracts.
 *
 * Runtime validation lives in voice/schemas.js (Zod).
 */

/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} wordTimestamps      Provider returns word-level alignment natively.
 * @property {boolean} charTimestamps      Provider returns character-level alignment natively.
 * @property {boolean} emotionControls     Provider accepts emotion/style parameters.
 * @property {boolean} ssml                Provider accepts SSML markup as input.
 * @property {boolean} streaming           Provider supports streaming audio output.
 * @property {boolean} [voiceClone]        Provider supports voice cloning (optional; cloud/local expansion).
 * @property {boolean} [multilingual]      Provider supports multiple languages (optional; cloud/local expansion).
 */

/**
 * @typedef {Object} ProsodyHint
 * @property {string} [rate]               e.g. "-10%", "+0%". Edge-TTS SSML rate.
 * @property {string} [pitch]              e.g. "-2st", "+0Hz". Edge-TTS SSML pitch.
 * @property {string} [volume]             e.g. "+0%". Edge-TTS SSML volume.
 */

/**
 * @typedef {Object} VoiceSettings
 * @property {number} [stability]          0..1. ElevenLabs.
 * @property {number} [similarity_boost]   0..1. ElevenLabs.
 * @property {number} [style]              0..1. ElevenLabs (style exaggeration).
 * @property {boolean} [use_speaker_boost] ElevenLabs.
 */

/**
 * @typedef {Object} SpeechRequest
 * @property {string} text
 * @property {string} [voiceId]                Generic voice id — used by whichever provider runs.
 * @property {Record<string,string>} [voiceIds] Per-provider voice ids keyed by provider id. Takes precedence over voiceId for that provider.
 * @property {boolean} [withTimestamps]        Request alignment metadata when supported.
 * @property {VoiceSettings} [voiceSettings]
 * @property {string} [modelId]                Provider-specific model id (ElevenLabs).
 * @property {ProsodyHint} [prosody]           Optional prosody hints (provider may ignore).
 * @property {string} [preferredProvider]      Soft hint — orchestrator may override on failure.
 */

/**
 * @typedef {Object} CharAlignment
 * @property {string[]} characters
 * @property {number[]} starts             Seconds. Aligned 1:1 with characters[].
 * @property {number[]} ends               Seconds. Aligned 1:1 with characters[].
 */

/**
 * @typedef {Object} SpeechResult
 * @property {true} ok
 * @property {string} file                 Forward-slashed absolute path to audio file.
 * @property {string} provider             Provider id used (e.g. 'elevenlabs', 'edge').
 * @property {string} voice                Voice identifier used.
 * @property {CharAlignment} [alignment]   Present only when provider supports + caller requested.
 */

/**
 * @typedef {Object} TTSProvider
 * @property {string} id                                      Stable provider identifier.
 * @property {() => boolean} isAvailable                      Cheap check (env var, config presence).
 * @property {() => ProviderCapabilities} capabilities        Static capability declaration.
 * @property {(req: SpeechRequest) => Promise<SpeechResult>} synthesize
 */

export {};
