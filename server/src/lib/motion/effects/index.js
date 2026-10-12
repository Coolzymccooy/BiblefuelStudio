import * as moves from "./moves.js";
import * as entrances from "./entrances.js";

/**
 * Every motion effect by id. The director picks from here by kind; the plan
 * validator and renderer look effects up by id.
 */
export const EFFECTS = Object.freeze(
  Object.fromEntries([...Object.values(moves), ...Object.values(entrances)].map((e) => [e.id, Object.freeze(e)])),
);

export function getEffect(id) {
  return typeof id === "string" && Object.hasOwn(EFFECTS, id) ? EFFECTS[id] : null;
}

export function effectsOfKind(kind) {
  return Object.values(EFFECTS).filter((e) => e.kind === kind);
}

/**
 * Filters the engine may use: all present in ffmpeg 5.1 (prod runs 5.1.9).
 * A test checks every effect's graph against this list. Add a filter here
 * only after checking it exists in 5.1's filter list.
 */
export const FFMPEG_51_FILTERS = new Set([
  "zoompan", "loop", "setpts", "settb", "crop", "scale", "setsar", "fps", "split", "hflip", "color", "overlay",
  "format", "null", "fade", "gblur", "rgbashift", "noise", "eq", "xfade", "geq", "blend",
  "drawbox", "drawtext", "vignette", "trim", "ass", "colorbalance", "concat",
]);
