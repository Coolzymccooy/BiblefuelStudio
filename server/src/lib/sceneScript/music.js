import { MUSIC_LIBRARY, resolveLibraryTrack } from "../musicLibrary.js";
import { resolveTenantTrack } from "../musicLibraryStore.js";

/**
 * Pick a music bed for each cue from its mood words, and resolve a bed ref
 * ("library:<id>" bundled, "mylib:<id>" the user's own) to a file. Vocal
 * songs are never suggested: they fight the narration.
 */

const RULES = Object.freeze([
  { re: /\b(victor|triumph|declar|crescendo|brass|drums|anthem|glory|bold)/i, ids: ["ascend-to-glory", "epic-anthem", "inspirational-epic"] },
  { re: /\b(grace|reveal|warm|strings|gospel|hope|rising|lift)/i, ids: ["cinematic-inspirational", "hopeful", "inspiring-cinematic"] },
  { re: /\b(soft|piano|gentle|intimate|resolve|final|peace|still)/i, ids: ["prayer-piano", "gentle-peace", "gentle-calm"] },
  { re: /\b(reflect|emotional|night|struggl|lament|alone|heartbeat|dark)/i, ids: ["reflective-acoustic", "sentimental-acoustic", "prayer-piano"] },
  { re: /\b(drama|tension|storm|battle)/i, ids: ["dramatic", "cinematic-epic"] },
]);
const FALLBACK = "cinematic-inspirational";
const isVocal = (id) => /\(vocal\)/.test(MUSIC_LIBRARY.find((t) => t.id === id)?.label || "");

/** A bundled bed for one cue; differs from the previous cue's when another fits. */
export function suggestBed(cue, previousRef = null) {
  // The cue's mood names it; its notes only break a tie.
  const rule = RULES.find((r) => r.re.test(cue.mood || "")) || RULES.find((r) => r.re.test(cue.notes || ""));
  const ids = (rule ? rule.ids : [FALLBACK]).filter((id) => !isVocal(id));
  const pick = ids.find((id) => `library:${id}` !== previousRef) || ids[0];
  return `library:${pick}`;
}

/** Fill in a bed for every cue that has none. Returns new cues. */
export function withSuggestedBeds(cues) {
  let prev = null;
  return cues.map((c) => {
    const bed = c.bed || suggestBed(c, prev);
    prev = bed;
    return { ...c, bed, bedSuggested: c.bed ? Boolean(c.bedSuggested) : true };
  });
}

export function isBedRef(ref) {
  return typeof ref === "string" && /^(library|mylib):[A-Za-z0-9_-]{1,80}$/.test(ref);
}

export function resolveBed(dataDir, ref) {
  if (!isBedRef(ref)) return null;
  return resolveLibraryTrack(ref) || resolveTenantTrack(dataDir, ref);
}
