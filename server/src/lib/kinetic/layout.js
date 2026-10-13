/**
 * Where phrases sit. Positions are fractions of the frame. Wide video
 * scatters phrases round the subject; tall video stacks them in bands that
 * keep clear of the TikTok/Reels controls (bottom 18%, right 12%).
 */
const SIDE = 0.06;
const TALL_BOTTOM = 0.82;
const TALL_X = 0.47; // centre of the band left after the right-hand 12%
// YouTube Shorts covers the top ~11% (status bar, back/search) and the bottom
// ~25% (channel, title, Share): measured from the operator's screenshots.
const SHORTS_TOP = 0.11;
const SHORTS_BOTTOM = 0.75;

const SLOTS = Object.freeze({
  wide: [
    { x: 0.27, y: 0.30, side: true },
    { x: 0.73, y: 0.55, side: true },
    { x: 0.50, y: 0.78, side: false },
    { x: 0.73, y: 0.28, side: true },
    { x: 0.27, y: 0.60, side: true },
  ],
  tall: [
    { x: TALL_X, y: 0.20, side: false },
    { x: TALL_X, y: 0.40, side: false },
    { x: TALL_X, y: 0.62, side: false },
  ],
  shorts: [
    { x: TALL_X, y: 0.24, side: false },
    { x: TALL_X, y: 0.42, side: false },
    { x: TALL_X, y: 0.60, side: false },
  ],
});

export const LOWER = Object.freeze({ wide: { x: 0.5, y: 0.80 }, tall: { x: TALL_X, y: 0.70 }, shorts: { x: TALL_X, y: 0.66 } });
export const CENTRE = Object.freeze({ wide: { x: 0.5, y: 0.45 }, tall: { x: TALL_X, y: 0.42 }, shorts: { x: TALL_X, y: 0.42 } });

export function aspectOf(w, h) {
  return Number(w) >= Number(h) ? "wide" : "tall";
}

/** Portrait frames: "tall", or "shorts" (tall with the Shorts/TikTok safe band). */
export function isTall(aspect) {
  return aspect === "tall" || aspect === "shorts";
}

export function slotsFor(aspect) {
  return SLOTS[aspect] || SLOTS.wide;
}

export function maxWidthFor(slot, w, aspect) {
  if (isTall(aspect)) return w * (1 - SIDE - 0.12);
  return slot?.side ? w * 0.42 : w * (1 - 2 * SIDE);
}

export function clampBlockY(cy, blockHeight, h, aspect) {
  // Round the top bound up and the bottom bound down so rounding never pushes
  // the block past the safe area (Math.round lifted the bottom edge 0.4 px over).
  const topFrac = aspect === "shorts" ? SHORTS_TOP : SIDE;
  const bottomFrac = aspect === "shorts" ? SHORTS_BOTTOM : aspect === "tall" ? TALL_BOTTOM : 1 - SIDE;
  const top = Math.ceil(h * topFrac + blockHeight / 2);
  const bottom = Math.floor(h * bottomFrac - blockHeight / 2);
  return Math.round(Math.min(Math.max(cy, top), Math.max(top, bottom)));
}

/**
 * The arc a curved phrase sits on, like a rainbow over the subject: apex
 * (x, y) as frame fractions, radius `r` as a share of the width, and `half`,
 * how far either side of the apex the text may reach (share of the width).
 * Tall frames keep the arc inside 6%..88% of the width.
 */
export const ARC = Object.freeze({
  wide: { x: 0.5, y: 0.17, r: 0.45, half: 0.40 },
  tall: { x: TALL_X, y: 0.15, r: 0.55, half: 0.38 },
  shorts: { x: TALL_X, y: 0.19, r: 0.55, half: 0.38 },
});
