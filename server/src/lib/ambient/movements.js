import crypto from "crypto";

/**
 * Movements — the visual sections of an ambient session.
 *
 * One still per movement, and by default one movement per drop, so the picture
 * changes as the Word arrives rather than on an arbitrary clock. That is the
 * whole difference from Story's `expandScenesToBeats`, which cuts on a fixed
 * ~40s timer that knows nothing about what is being said.
 *
 * A movement spans from the midpoint before its drop to the midpoint after, so
 * the image is already on screen when the verse begins instead of cutting on it.
 */

/**
 * @param {object} project
 * @returns {Array<object>} movements, preserving existing image fields by index
 */
export function deriveMovements(project) {
  const targetMs = Math.round((Number(project?.targetSec) || 0) * 1000);
  const drops = (project?.drops || []).slice().sort((a, b) => a.atMs - b.atMs);
  const existing = project?.movements || [];
  const theme = String(project?.theme || "").trim();

  if (drops.length === 0) {
    // No drops still needs one picture, or the render has nothing to show.
    return [reuse(existing[0], {
      startMs: 0,
      endMs: targetMs,
      imagePrompt: imagePromptFor(theme, 0),
    })];
  }

  const bounds = [0];
  for (let i = 1; i < drops.length; i += 1) {
    bounds.push(Math.round((drops[i - 1].atMs + drops[i].atMs) / 2));
  }
  bounds.push(targetMs);

  return drops.map((_drop, i) => reuse(existing[i], {
    startMs: bounds[i],
    endMs: bounds[i + 1],
    imagePrompt: imagePromptFor(theme, i),
  }));
}

/**
 * Keep whatever image the movement already has. Re-deriving movements after a
 * retime must not throw away generated images — regenerating costs image quota,
 * and the daily free cap is low enough that it matters.
 */
function reuse(prev, next) {
  return {
    id: prev?.id || crypto.randomUUID(),
    ...next,
    imagePath: prev?.imagePath || null,
    imageUrl: prev?.imageUrl || null,
    imageStatus: prev?.imageStatus || "pending",
    imageError: prev?.imageError || null,
    imageSource: prev?.imageSource || null,
    imageLibraryId: prev?.imageLibraryId || null,
    imageReuseScore: prev?.imageReuseScore ?? null,
  };
}

/**
 * The library pool these pictures belong to. Reuse only ever matches the same
 * style, so the dark pictures made before this one are never picked for you
 * again (you can still choose them yourself from the library).
 */
export const AMBIENT_IMAGE_STYLE = "ambient-bright-v1";

// One per movement, in turn, so a long session travels through different
// places instead of asking for the same picture again.
const SCENES = [
  "a still mountain lake at sunrise with golden light on the water",
  "a sunlit meadow of wildflowers with gentle rolling hills",
  "a quiet river winding through a green valley in morning light",
  "a calm seashore at dawn with soft waves and a pastel sky",
  "a forest clearing with warm sunbeams through the trees",
  "wide golden fields under a big bright sky with gentle clouds",
  "misty green hills glowing in early morning sun",
  "a peaceful lakeside with reflections and a warm sunset glow",
];

/**
 * The prompt for a movement's picture.
 *
 * Light is the product: the theme sets the feeling, not the subject. Led by
 * the theme and asking for "cinematic, soft diffused light", "Peace in the
 * storm" came back as a night storm with lightning. Two more things it no
 * longer does: a verse reference (a model can't read "Psalm 23:1"; it only
 * invites lettering) and negations ("no people" is still "people" to the
 * model, which drew a man walking).
 */
export function imagePromptFor(theme, index) {
  const scene = SCENES[Math.abs(Number(index) || 0) % SCENES.length];
  const feeling = String(theme || "").trim();
  return [
    `Bright, luminous landscape photograph of ${scene}.`,
    feeling ? `The feeling of "${feeling}": peaceful, hopeful, full of light.` : "Peaceful, hopeful, full of light.",
    "Warm golden sunlight, clear soft blue sky, airy high-key pastel tones,",
    "serene untouched nature, wide open view.",
  ].join(" ");
}
