/**
 * Smart styles: which moves, entrances and overlays a Moment draws from
 * (weighted), its colour grade, and its Studio caption look. Energy then
 * sets intensity within the style.
 */
export const STYLES = Object.freeze({
  glow: Object.freeze({
    id: "glow",
    label: "Glow",
    description: "Calm and devotional: slow pushes, soft fades, warm light.",
    look: "studio-gospel-gold",
    grade: "eq=saturation=1.05:gamma=1.04,colorbalance=rs=0.04:bs=-0.04",
    moves: { push: 4, pan: 2, still: 1 },
    entrances: { crossfade: 4, cut: 1 },
    overlays: { lightLeak: 1 },
    overlayRate: 0.35,
    endOverlay: "sparkles",
  }),
  celebrate: Object.freeze({
    id: "celebrate",
    label: "Celebrate",
    description: "Birthdays and parties: punch-ins, flashes and sparkles.",
    look: "studio-lagos-night",
    grade: "eq=saturation=1.2:contrast=1.05",
    moves: { punch: 3, push: 2 },
    entrances: { flash: 3, cut: 2, whip: 2 },
    overlays: { sparkles: 3, doodles: 2 },
    overlayRate: 0.4,
    endOverlay: "rayBurst",
  }),
  hype: Object.freeze({
    id: "hype",
    label: "Hype",
    description: "TikTok energy: shakes, whips, glitches and splits.",
    look: "studio-lagos-night",
    grade: "eq=contrast=1.12:saturation=1.1",
    moves: { shake: 3, punch: 3, split2: 1, split3: 1 },
    entrances: { whip: 3, glitch: 2, flash: 2 },
    overlays: { doodles: 1 },
    overlayRate: 0.2,
    endOverlay: "rayBurst",
  }),
  gallery: Object.freeze({
    id: "gallery",
    label: "Gallery",
    description: "Clean and steady for events and sermon promos.",
    look: "studio-clean-white",
    grade: "eq=saturation=0.95:contrast=1.03",
    moves: { push: 3, pan: 2, split3: 1 },
    entrances: { cut: 3, crossfade: 2 },
    overlays: { viewfinder: 1 },
    overlayRate: 0.3,
    endOverlay: "sparkles",
  }),
});

export const STYLE_IDS = Object.freeze(Object.keys(STYLES));

export function resolveStyle(id) {
  return typeof id === "string" && Object.hasOwn(STYLES, id) ? STYLES[id] : STYLES.celebrate;
}

/** Moments Energy (0..1) as the caption engine's level. */
export function captionEnergyFor(energy) {
  if (energy < 0.34) return "calm";
  if (energy <= 0.66) return "lively";
  return "wild";
}
