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
/** Where a crowd reply sits: under the call, in the lower band (spec §6.2). */
export const ECHO = Object.freeze({ wide: { x: 0.5, y: 0.72 }, tall: { x: TALL_X, y: 0.645 }, shorts: { x: TALL_X, y: 0.645 } });

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

/** The top of the safe area, in pixels: 11% down on Shorts, 6% on every other layout. */
export function safeTop(h, aspect) {
  return h * (aspect === "shorts" ? SHORTS_TOP : SIDE);
}

/**
 * The highest and lowest centre a block may take. `clearBelow` (a pixel y, optional) is a lower
 * edge the block must stay above, such as a crowd echo under its call; without it the bottom is
 * the safe area's.
 */
function blockBounds(blockHeight, h, aspect, clearBelow) {
  // Round the top bound up and the bottom bound down so rounding never pushes
  // the block past the safe area (Math.round lifted the bottom edge 0.4 px over).
  const bottomFrac = aspect === "shorts" ? SHORTS_BOTTOM : aspect === "tall" ? TALL_BOTTOM : 1 - SIDE;
  const floorY = Number.isFinite(clearBelow) ? Math.min(h * bottomFrac, clearBelow) : h * bottomFrac;
  return {
    top: Math.ceil(safeTop(h, aspect) + blockHeight / 2),
    bottom: Math.floor(floorY - blockHeight / 2),
  };
}

export function clampBlockY(cy, blockHeight, h, aspect, clearBelow) {
  const { top, bottom } = blockBounds(blockHeight, h, aspect, clearBelow);
  return Math.round(Math.min(Math.max(cy, top), Math.max(top, bottom)));
}

/** Whether a block this tall fits between the safe top and its bottom edge (see clampBlockY). */
export function blockFits(blockHeight, h, aspect, clearBelow) {
  const { top, bottom } = blockBounds(blockHeight, h, aspect, clearBelow);
  return top <= bottom;
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
  shorts: { x: TALL_X, y: 0.19, r: 0.55, half: 0.35 },
});
