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
