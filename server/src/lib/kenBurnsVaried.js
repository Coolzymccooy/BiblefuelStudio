// Varied Ken Burns moves.
//
// kenBurnsFilter always pushes IN at the same rate. Across 25-40 scenes that
// uniformity is exactly what makes a sequence feel mechanical — real
// documentary editing alternates push-in, pull-out and lateral drift so
// successive shots breathe differently.
//
// Moves are chosen DETERMINISTICALLY from the scene index, not at random, so a
// re-render of the same project produces an identical video. That matters: the
// story pipeline supports per-scene regeneration, and a random move would make
// every re-render subtly different from the one the operator approved.

// Zoom depth stays gentle. The original 1.06 (6%) is well judged — beyond ~10%
// on a still image the movement starts to read as a zoom effect rather than as
// camera language.
const ZOOM_MAX = 1.06;
const ZOOM_MIN = 1.0;

/**
 * The move cycle. Kept to four so a viewer never sees the same move twice in a
 * row, while the pattern is long enough not to feel like an obvious loop.
 *
 * in    — classic slow push, builds intimacy
 * out   — pull back, reveals context; good for establishing shots
 * left  — lateral drift, suggests travel/searching
 * right — lateral drift the other way
 */
export const MOVES = Object.freeze(["in", "out", "left", "right"]);

/**
 * Pick a move for a scene index.
 * @param {number} index
 * @returns {"in"|"out"|"left"|"right"}
 */
export function moveForIndex(index) {
  const n = Number(index);
  if (!Number.isFinite(n)) return MOVES[0];
  return MOVES[Math.abs(Math.trunc(n)) % MOVES.length];
}

/**
 * Build a Ken Burns filter substring with a specific move.
 *
 * Mirrors kenBurnsFilter's contract (upscale first so zoompan has real pixels
 * to work with, avoiding shimmer) but varies zoom direction and pan.
 *
 * @param {number} width  output canvas width
 * @param {number} height output canvas height
 * @param {number} durSec scene duration in seconds
 * @param {number} [fps=30]
 * @param {string} [move] one of MOVES; defaults to "in"
 * @returns {string} ffmpeg filter substring
 */
export function kenBurnsVariedFilter(width, height, durSec, fps = 30, move = "in") {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  const rate = Math.max(1, Math.round(Number(fps) || 30));
  const frames = Math.max(1, Math.round((Number(durSec) || 0) * rate));
  const upW = w * 2;
  const upH = h * 2;

  // Per-frame zoom step that spans ZOOM_MIN..ZOOM_MAX across the whole scene,
  // so the move completes regardless of scene length instead of running out
  // early on long scenes or clipping on short ones.
  const step = ((ZOOM_MAX - ZOOM_MIN) / frames).toFixed(6);

  let zoomExpr;
  let xExpr = "iw/2-(iw/zoom/2)"; // centred
  let yExpr = "ih/2-(ih/zoom/2)";

  switch (move) {
    case "out":
      // Start zoomed in and ease out. max() floors it so it never dips below 1.
      zoomExpr = `'max(${ZOOM_MAX}-on*${step},${ZOOM_MIN})'`;
      break;
    case "left":
      // Hold a slight zoom (pan needs headroom) and drift the window leftwards.
      zoomExpr = `'${ZOOM_MAX}'`;
      xExpr = `'(iw-iw/zoom)*(1-on/${frames})'`;
      break;
    case "right":
      zoomExpr = `'${ZOOM_MAX}'`;
      xExpr = `'(iw-iw/zoom)*(on/${frames})'`;
      break;
    case "in":
    default:
      zoomExpr = `'min(${ZOOM_MIN}+on*${step},${ZOOM_MAX})'`;
      break;
  }

  return `scale=${upW}:${upH},zoompan=z=${zoomExpr}:x=${xExpr}:y=${yExpr}:d=${frames}:s=${w}x${h}:fps=${rate}`;
}
