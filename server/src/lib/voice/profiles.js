/**
 * Voice profiles + narration-category mapping.
 *
 * A "narration category" is a piece of content the engine knows how to read
 * aloud in a recognisable style — devotional, prayer, scripture, kids,
 * worship. A "voice profile" turns that style into concrete provider
 * parameters (voice id, ElevenLabs voice settings, Edge SSML prosody, etc.).
 *
 * Categories here are NOT the visual-background categories in
 * lib/categorize.js (which drive Pexels search and library tagging). The two
 * taxonomies are intentionally separate — visual mood and narration tone
 * map differently.
 *
 * Adding a new category is a one-place change: add an entry to PROFILES.
 *
 * Profile resolution falls back to DEFAULT_CATEGORY ("devotional") when an
 * unknown category is requested, so callers never crash on a typo.
 */

/** @typedef {'devotional' | 'prayer' | 'scripture' | 'kids' | 'worship'} NarrationCategory */

/**
 * @typedef {Object} VoiceProfile
 * @property {NarrationCategory} category
 * @property {string} label
 * @property {string} description
 * @property {string[]} providerPreference   Ordered provider ids to try first.
 * @property {Object} elevenlabs
 * @property {string} [elevenlabs.voiceId]
 * @property {string} [elevenlabs.modelId]
 * @property {Object} [elevenlabs.voiceSettings]
 * @property {Object} edge
 * @property {string} edge.voiceId
 * @property {Object} [edge.prosody]
 * @property {string} edge.prosody.rate
 * @property {string} edge.prosody.pitch
 * @property {string} edge.prosody.volume
 * @property {string} recommendedTypographyPreset
 */

export const DEFAULT_CATEGORY = "devotional";

/** @type {Record<NarrationCategory, VoiceProfile>} */
export const PROFILES = Object.freeze({
  devotional: {
    category: "devotional",
    label: "Cinematic Pastor",
    description: "Balanced cinematic narration for everyday devotionals.",
    providerPreference: ["elevenlabs", "edge"],
    elevenlabs: {
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
    },
    edge: {
      voiceId: "en-US-GuyNeural",
      prosody: { rate: "-5%", pitch: "-1st", volume: "+0%" },
    },
    recommendedTypographyPreset: "cinematic-default",
  },

  prayer: {
    category: "prayer",
    label: "Gentle Prayer",
    description: "Soft, intimate, slower pacing for prayer and reflection.",
    providerPreference: ["elevenlabs", "edge"],
    elevenlabs: {
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.7, similarity_boost: 0.75, style: 0.15, use_speaker_boost: false },
    },
    edge: {
      voiceId: "en-US-AriaNeural",
      prosody: { rate: "-15%", pitch: "-2st", volume: "-2%" },
    },
    recommendedTypographyPreset: "intimate-fade",
  },

  scripture: {
    category: "scripture",
    label: "Scripture Narrator",
    description: "Clean, authoritative reading of biblical text.",
    providerPreference: ["elevenlabs", "edge"],
    elevenlabs: {
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.65, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    },
    edge: {
      voiceId: "en-US-DavisNeural",
      prosody: { rate: "-8%", pitch: "+0st", volume: "+0%" },
    },
    recommendedTypographyPreset: "scripture-emphasis",
  },

  kids: {
    category: "kids",
    label: "Youth Devotional",
    description: "Brighter, faster, more expressive — for kids' Bible stories.",
    providerPreference: ["elevenlabs", "edge"],
    elevenlabs: {
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.45, similarity_boost: 0.7, style: 0.55, use_speaker_boost: true },
    },
    edge: {
      voiceId: "en-US-JennyNeural",
      prosody: { rate: "+5%", pitch: "+1st", volume: "+2%" },
    },
    recommendedTypographyPreset: "playful-pop",
  },

  worship: {
    category: "worship",
    label: "Worship Reflection",
    description: "Atmospheric, emotional cinematic spacing for worship reels.",
    providerPreference: ["elevenlabs", "edge"],
    elevenlabs: {
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.55, similarity_boost: 0.78, style: 0.45, use_speaker_boost: true },
    },
    edge: {
      voiceId: "en-US-GuyNeural",
      prosody: { rate: "-12%", pitch: "-1st", volume: "+0%" },
    },
    recommendedTypographyPreset: "worship-cinematic",
  },
});

/**
 * @returns {NarrationCategory[]}
 */
export function listCategories() {
  return /** @type {NarrationCategory[]} */ (Object.keys(PROFILES));
}

/**
 * Resolve a category name to a profile. Falls back to DEFAULT_CATEGORY on
 * unknown input. Comparison is case-insensitive.
 *
 * @param {string | undefined | null} category
 * @returns {VoiceProfile}
 */
export function resolveProfile(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key && PROFILES[key]) return PROFILES[key];
  return PROFILES[DEFAULT_CATEGORY];
}
