/**
 * Bible-safe prompt builder for generative image providers.
 *
 * Constraints baked in (per research synthesized 2026-05):
 *  - NEVER depict biblical figures (Jesus, apostles, Moses, etc.). AI
 *    consistently mangles iconography (anachronisms, missing halos, modern
 *    clothing) and church audiences reject AI-generated faces of figures.
 *  - Stick to landscapes + symbolic imagery: olive groves, scrolls, doves,
 *    bread/wine, hands in prayer, ancient stone, golden-hour Middle-Eastern
 *    vistas, light through clouds.
 *  - Painterly / Renaissance / stained-glass styling — avoid photorealism of
 *    people; photorealism is fine for landscapes.
 *  - Style anchor string + fixed seed = visual consistency across all parts
 *    of a series.
 *
 * The prompt is provider-agnostic. SDXL on Cloudflare understands negative
 * prompts; Flux on Cloudflare ignores them (provider adapter handles).
 */

/**
 * Curated style anchors. One is picked deterministically per series so the
 * artwork of every part shares a visual language. Each entry intentionally
 * avoids any reference to people or faces.
 */
const STYLE_ANCHORS = Object.freeze([
  "cinematic golden hour, soft volumetric light, ancient olive grove, warm amber tones, painterly diffusion, shallow depth of field",
  "Renaissance sacred-art oil painting, deep chiaroscuro, warm candlelight, parchment textures, ornate gold leaf, baroque composition",
  "luminous stained-glass illustration, cobalt and crimson panels, leaded glass linework, sunbeams through cathedral arches, sacred geometry",
  "majestic Middle-Eastern desert sunrise, vast dunes, distant rocky outcrops, soft haze, biblical landscape painting, cinematic widescreen",
  "moody storm-lit sky over ancient stone ruins, dramatic god-rays piercing clouds, deep azure and burnt sienna palette, oil painting, epic scale",
  "serene mountain dawn with morning mist, distant cedar trees, soft pastel sky, watercolor and ink wash, contemplative atmosphere",
  "antique illuminated manuscript style, hand-lettered borders, gold ink ornament, deep wine and forest green, vellum texture, sacred geometry",
  "quiet starfield over Galilee at night, lantern-warm glow on a distant shore, oil painting, contemplative, deep indigo and ember tones",
]);

const NEGATIVE_PROMPT = "people, faces, human figures, portrait, jesus, modern objects, cars, phones, contemporary clothing, signage, watermark, text, logo, signature, ai artifacts, deformed, low quality";

const UNIVERSAL_QUALITY_TAGS = "masterpiece, highly detailed, 8k, sharp focus, cinematic composition";

/**
 * Themes derived loosely from beat type. Hook = curiosity/atmosphere,
 * verse = the scriptural setting, reflection = quiet contemplation.
 * @typedef {"hook" | "verse" | "reflection"} BeatType
 */

/** @type {Record<BeatType, string>} */
const BEAT_HINTS = Object.freeze({
  hook: "moment of revelation, light breaking through, expectant atmosphere",
  verse: "biblical scene, sacred landscape, ancient setting, no people",
  reflection: "quiet contemplative scene, soft fading light, peaceful aftermath",
});

/**
 * Deterministically pick a style anchor for a series. Same input → same
 * anchor, so every part of a series stays visually consistent. The seed is
 * folded by simple modulo over the curated list.
 *
 * @param {number | string} seriesSeed
 * @returns {string}
 */
export function chooseStyleAnchor(seriesSeed) {
  const n = normalizeSeed(seriesSeed);
  return STYLE_ANCHORS[n % STYLE_ANCHORS.length];
}

/**
 * Derive an atmosphere hint from verse text without leaking proper nouns
 * into the prompt. We scan for common biblical-figure tokens and quietly
 * skip them; the goal is to keep imagery on landscape/symbolic ground.
 *
 * @param {string} verseText
 * @returns {string}
 */
export function distillAtmosphere(verseText) {
  const raw = String(verseText || "").toLowerCase();
  if (!raw.trim()) return "";
  if (/(light|sun|dawn|morning|day|bright|shine|glory)/.test(raw)) return "warm golden light";
  if (/(night|dark|shadow|fear)/.test(raw)) return "moonlit nocturne, soft lantern glow";
  if (/(storm|rain|wind|cloud|thunder)/.test(raw)) return "stormy sky, dramatic clouds";
  if (/(mountain|hill|wilderness|desert)/.test(raw)) return "vast wilderness landscape";
  if (/(sea|water|river|stream|wave)/.test(raw)) return "calm sea at golden hour, gentle ripples";
  if (/(fire|flame|burn|altar)/.test(raw)) return "ember glow, embers and sparks rising";
  if (/(garden|tree|fruit|harvest)/.test(raw)) return "verdant grove, fruit-laden branches";
  if (/(love|peace|hope|comfort|joy)/.test(raw)) return "soft warm tones, quiet morning";
  return "";
}

/**
 * Build the final positive prompt for a single beat of a series segment.
 *
 * Note we never inject the verse text directly — that would tempt the model
 * to render literal scenes including biblical figures. We extract only the
 * atmosphere and combine with a deterministic style anchor.
 *
 * @param {object} args
 * @param {BeatType} [args.beatType="verse"]
 * @param {string} [args.verseText=""]
 * @param {string} [args.styleAnchor]      override; otherwise derived from seriesSeed
 * @param {number | string} [args.seriesSeed]
 * @returns {string}
 */
export function buildBiblePrompt({ beatType = "verse", verseText = "", styleAnchor, seriesSeed }) {
  const anchor = String(styleAnchor || (seriesSeed != null ? chooseStyleAnchor(seriesSeed) : STYLE_ANCHORS[0])).trim();
  const beat = BEAT_HINTS[beatType] || BEAT_HINTS.verse;
  const atmosphere = distillAtmosphere(verseText);
  const parts = [
    beat,
    atmosphere,
    anchor,
    UNIVERSAL_QUALITY_TAGS,
    "no people, no faces",
  ].filter(Boolean);
  return parts.join(", ").replace(/\s+/g, " ").trim();
}

/**
 * Provider-agnostic negative prompt. SDXL/Imagen can consume it; Flux
 * adapters should drop it (Flux ignores negatives — the no-people directive
 * is duplicated into the positive prompt above to compensate).
 *
 * @returns {string}
 */
export function buildBibleNegativePrompt() {
  return NEGATIVE_PROMPT;
}

/**
 * Derive a deterministic 32-bit integer seed from a string. Used so the
 * same seriesId+partNumber always produces the same imagery if the model
 * supports seed control.
 *
 * @param {number | string} value
 * @returns {number}
 */
export function normalizeSeed(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(Math.floor(value)) % 0x7fffffff;
  }
  const s = String(value || "default-seed");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 0x7fffffff;
}

export const STYLE_ANCHORS_LIST = STYLE_ANCHORS;
