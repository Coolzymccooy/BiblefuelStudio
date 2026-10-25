/**
 * The Showcase scene templates: how many photos each shows and how many
 * beats it stays on screen at the base Energy. The MomentShowcase
 * composition draws each one (server/remotion/src/showcase/templates).
 * `finale` and `invite` only ever close a Moment.
 */
export const TEMPLATES = Object.freeze({
  single: Object.freeze({ photos: 1, beats: 3 }),
  spotlight: Object.freeze({ photos: 1, beats: 3 }),
  split: Object.freeze({ photos: 2, beats: 4 }),
  polaroids: Object.freeze({ photos: 3, beats: 5 }),
  swipe: Object.freeze({ photos: 3, beats: 5 }),
  triptych: Object.freeze({ photos: 3, beats: 4 }),
  grid: Object.freeze({ photos: 4, beats: 5 }),
  filmstrip: Object.freeze({ photos: 5, beats: 8 }),
  finale: Object.freeze({ photos: 1, beats: 0 }),
  invite: Object.freeze({ photos: 1, beats: 0 }),
});

/**
 * Templates that show the most photos per beat (grid 4 in 5, triptych 3 in 4), favoured when the photos
 * would not all fit. The film strip shows five but stays up eight beats, so it is not one of them.
 */
export const DENSE = Object.freeze(["grid", "triptych"]);
export const CLOSING = Object.freeze(["finale", "invite"]);
/** The closing scene stays up at least this long, so its words can be read before the fade. */
export const CLOSING_MIN_SEC = 3;

export const SHOWCASE_FPS = 30;
export const SHAPES = Object.freeze({
  tall: Object.freeze({ w: 1080, h: 1920 }),
  wide: Object.freeze({ w: 1920, h: 1080 }),
});
