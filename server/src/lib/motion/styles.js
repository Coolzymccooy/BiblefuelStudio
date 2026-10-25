/**
 * Smart styles: which moves, entrances and overlays a Moment draws from
 * (weighted), its colour grade, and its Studio caption look. Energy then
 * sets intensity within the style; `energy` is the style's natural level,
 * which picking the style moves the slider to.
 *
 * Two families. Classic styles show one photo at a time through the ffmpeg
 * shot engine. Showcase styles show one to five photos per scene through
 * beat-cut templates drawn by the MomentShowcase Remotion composition; they
 * name templates (weighted) and a palette instead of moves and overlays, so a
 * new Showcase style is a new entry here, not new code.
 */
const CLASSIC = Object.freeze({
  glow: Object.freeze({
    id: "glow",
    family: "classic",
    energy: 0.2,
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
    family: "classic",
    energy: 0.6,
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
    family: "classic",
    energy: 0.85,
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
    family: "classic",
    energy: 0.45,
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

export const TEMPLATE_IDS = Object.freeze(["single", "polaroids", "split", "grid", "swipe", "triptych", "spotlight", "filmstrip"]);

const SHOWCASE = Object.freeze({
  fellowship: Object.freeze({
    id: "fellowship",
    family: "showcase",
    energy: 0.6,
    label: "Fellowship",
    description: "Many photos at once: polaroids, grids and splits on the beat, warm and golden.",
    look: "studio-gospel-gold",
    grade: "eq=saturation=1.08:contrast=1.04,colorbalance=rs=0.04:bs=-0.04",
    templates: Object.freeze({ single: 3, polaroids: 2, split: 2, grid: 2, swipe: 2, triptych: 2, spotlight: 1, filmstrip: 1 }),
    palette: Object.freeze({ backdrop: "blur", card: "#F7F1E3", accent: "#E8B04B", ink: "#1A1208" }),
    flashes: true,
    letterbox: false,
  }),
  scrapbook: Object.freeze({
    id: "scrapbook",
    family: "showcase",
    energy: 0.35,
    label: "Scrapbook",
    description: "Taped prints and polaroids on warm paper, soft and personal.",
    look: "studio-gospel-gold",
    grade: "eq=saturation=1.02:gamma=1.03,colorbalance=rs=0.03:bs=-0.02",
    templates: Object.freeze({ polaroids: 4, single: 2, split: 2, triptych: 1, grid: 1 }),
    palette: Object.freeze({ backdrop: "paper", card: "#FFFDF7", accent: "#C8553D", ink: "#2B2118" }),
    flashes: false,
    letterbox: false,
  }),
  partyPop: Object.freeze({
    id: "partyPop",
    family: "showcase",
    energy: 0.8,
    label: "Party pop",
    description: "Bright colour blocks, popping grids and swipes for parties and youth nights.",
    look: "studio-lagos-night",
    grade: "eq=saturation=1.2:contrast=1.06",
    templates: Object.freeze({ grid: 3, swipe: 3, spotlight: 2, split: 2, single: 1, polaroids: 1 }),
    palette: Object.freeze({
      backdrop: "colour", card: "#FFFFFF", accent: "#FFB400", ink: "#111111",
      blocks: Object.freeze(["#FF5A5F", "#FFB400", "#00A699", "#2E86DE", "#8E44AD"]),
    }),
    flashes: true,
    letterbox: false,
  }),
  premiere: Object.freeze({
    id: "premiere",
    family: "showcase",
    energy: 0.45,
    label: "Premiere",
    description: "Cinematic recap: letterbox, film strip and spotlight, made for the big screen.",
    look: "studio-clean-white",
    grade: "eq=contrast=1.08:saturation=0.95",
    templates: Object.freeze({ single: 3, filmstrip: 1, spotlight: 2, triptych: 3, split: 2 }),
    palette: Object.freeze({ backdrop: "dark", card: "#F5F5F0", accent: "#D4AF37", ink: "#0B0B0C" }),
    flashes: false,
    letterbox: true,
  }),
});

export const STYLES = Object.freeze({ ...CLASSIC, ...SHOWCASE });
export const CLASSIC_IDS = Object.freeze(Object.keys(CLASSIC));
export const SHOWCASE_IDS = Object.freeze(Object.keys(SHOWCASE));
export const STYLE_IDS = Object.freeze(Object.keys(STYLES));
export const CLASSIC_LENGTHS = Object.freeze([15, 30, 60]);
export const SHOWCASE_LENGTHS = Object.freeze([30, 60, 90, 120, 180]);

export const isShowcase = (id) => typeof id === "string" && Object.hasOwn(SHOWCASE, id);
export const familyOf = (id) => (isShowcase(id) ? "showcase" : "classic");
/** The lengths a style offers; anything unknown is treated as classic. */
export const lengthsFor = (id) => (isShowcase(id) ? SHOWCASE_LENGTHS : CLASSIC_LENGTHS);

export function resolveStyle(id) {
  return typeof id === "string" && Object.hasOwn(STYLES, id) ? STYLES[id] : STYLES.celebrate;
}

/** Moments Energy (0..1) as the caption engine's level. */
export function captionEnergyFor(energy) {
  if (energy < 0.34) return "calm";
  if (energy <= 0.66) return "lively";
  return "wild";
}
