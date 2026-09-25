// Suffix appended to every scene image prompt so all 25-40 images in one video
// share a coherent look. "no text" keeps generated art clean for caption overlay.
export const STYLE_ANCHORS = {
  "cinematic-bible":
    "cinematic biblical scene, dramatic warm lighting, film still, photorealistic, vertical 9:16, no text, no watermark",
  "modern-devotional":
    "modern devotional aesthetic, soft natural light, minimal clean composition, calm tones, vertical 9:16, no text, no watermark",
  "heavenly-atmosphere":
    "heavenly atmosphere, glowing light rays, soft clouds, ethereal and serene, vertical 9:16, no text, no watermark",
  "ancient-scripture":
    "ancient near-eastern setting, weathered textures, golden-hour desert light, historical, vertical 9:16, no text, no watermark",
};

const DEFAULT_STYLE = "cinematic-bible";

export function listStyles() {
  return Object.keys(STYLE_ANCHORS);
}

export function anchorFor(style) {
  return STYLE_ANCHORS[style] || STYLE_ANCHORS[DEFAULT_STYLE];
}

// ---------------------------------------------------------------------------
// Character anchors
//
// STYLE_ANCHORS keep the LOOK consistent (palette, lighting, medium) but say
// nothing about WHO is in the frame. Generate "David" across 30 scenes and you
// get 30 different men, which is what makes AI-assembled stories read as
// incoherent. Appending a fixed physical description whenever a figure appears
// is the image-generation equivalent of casting an actor.
//
// Descriptions are deliberately about STABLE, VISIBLE traits — age band, build,
// hair, beard, clothing — because those are what a diffusion model can actually
// hold steady between generations. Skin tone is described in historically
// appropriate terms for the ancient Near East rather than defaulted to the
// European conventions stock models tend to produce unprompted.

export const CHARACTER_ANCHORS = {
  david_young:
    "a young shepherd boy in his teens, olive-brown skin, dark curly shoulder-length hair, no beard, simple undyed wool tunic, leather sling at his belt",
  david_king:
    "a middle-aged king, olive-brown skin, dark hair greying at the temples, full beard, deep blue and gold robes, simple gold circlet",
  moses:
    "an elderly man, weathered olive-brown skin, long white hair and full white beard, coarse brown robe, wooden staff",
  jesus:
    "a man in his early thirties, olive-brown Middle Eastern skin, shoulder-length dark brown hair, short beard, simple undyed linen robe with a rope belt",
  mary:
    "a young Middle Eastern woman, olive-brown skin, dark hair covered by a deep blue head covering, simple modest robe",
  peter:
    "a broad-shouldered fisherman in his forties, sun-weathered olive skin, thick dark curly hair, full beard, rough working tunic",
  paul:
    "a short wiry man in his fifties, olive-brown skin, balding with a dark beard, plain travelling cloak",
  goliath:
    "an enormous armoured warrior over nine feet tall, bronze scale armour, bronze helmet, heavy spear, dark beard",
  angel:
    "a towering luminous figure in flowing white, radiant light emanating outward, wings folded, face serene and awe-inspiring",
};

/**
 * Look up a character anchor by key.
 * @param {string} key
 * @returns {string} the description, or "" when unknown
 */
export function characterAnchorFor(key) {
  const k = String(key || "").trim().toLowerCase();
  return CHARACTER_ANCHORS[k] || "";
}

/**
 * Detect which known characters a scene's narration mentions.
 *
 * Matching is whole-word on the character's NAME so "davidic" or a substring in
 * another word does not trigger. Ambiguous keys (david_young vs david_king) are
 * never auto-detected — the caller must choose, because only they know which
 * part of the story this is.
 *
 * @param {string} text scene narration
 * @returns {string[]} matched anchor keys
 */
export function detectCharacters(text) {
  const haystack = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  const NAME_TO_KEY = {
    moses: "moses",
    jesus: "jesus",
    christ: "jesus",
    mary: "mary",
    peter: "peter",
    paul: "paul",
    goliath: "goliath",
    angel: "angel",
  };
  const found = [];
  for (const [name, key] of Object.entries(NAME_TO_KEY)) {
    if (haystack.includes(` ${name} `) && !found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * Compose a scene image prompt: subject + character anchors + style anchor.
 *
 * Order matters. The subject leads (diffusion models weight early tokens most),
 * character descriptions follow so the figures stay consistent, and the style
 * anchor closes so it colours the whole scene.
 *
 * @param {string} subject scene description
 * @param {{style?: string, characters?: string[]}} [opts]
 * @returns {string}
 */
export function composeScenePrompt(subject, { style, characters = [] } = {}) {
  const parts = [String(subject || "").trim()].filter(Boolean);
  for (const key of characters) {
    const desc = characterAnchorFor(key);
    if (desc && !parts.includes(desc)) parts.push(desc);
  }
  parts.push(anchorFor(style));
  return parts.join(", ");
}
