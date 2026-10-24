/**
 * The visual styles a cartoon can be drawn in. Each has a stable id (stored on
 * the project), a label for the editor and a prompt fragment that opens every
 * portrait and shot prompt, so the whole film shares one look.
 */

export const STYLES = Object.freeze({
  family3d: {
    id: "family3d",
    label: "3D family film",
    prompt: "3D animated family film style, soft global illumination, rounded appealing shapes, expressive large eyes, rich warm colour, cinematic depth of field",
  },
  storybook: {
    id: "storybook",
    label: "Storybook",
    prompt: "hand-painted storybook illustration style, soft gouache textures, warm paper tones, gentle light",
  },
  clay: {
    id: "clay",
    label: "Claymation",
    prompt: "handmade claymation style, visible clay texture and fingerprints, miniature set, soft studio light",
  },
});

export const DEFAULT_STYLE = "family3d";

// Short names an admin is likely to type that are not an id or a full label.
const ALIASES = Object.freeze({ "3d": "family3d", "3d family film": "family3d", clay: "clay" });

/**
 * The style id an id, label or short name (any case) names, or null. Own keys
 * only: "constructor" or "__proto__" must never reach Object.prototype.
 */
function namedStyle(text) {
  const key = typeof text === "string" ? text.trim().toLowerCase() : "";
  if (key === "") return null;
  if (Object.hasOwn(STYLES, key)) return key;
  const byLabel = Object.values(STYLES).find((style) => style.label.toLowerCase() === key);
  if (byLabel) return byLabel.id;
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : null;
}

/** Whether the text names a real style (by id, label or short name). */
export function isStyleName(text) {
  return namedStyle(text) !== null;
}

/** Maps an id, a label or a short name (any case) to a style id; anything else gets the default. */
export function styleId(text) {
  return namedStyle(text) ?? DEFAULT_STYLE;
}
