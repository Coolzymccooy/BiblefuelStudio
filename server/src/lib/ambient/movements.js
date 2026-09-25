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
      imagePrompt: promptFor(theme, ""),
    })];
  }

  const bounds = [0];
  for (let i = 1; i < drops.length; i += 1) {
    bounds.push(Math.round((drops[i - 1].atMs + drops[i].atMs) / 2));
  }
  bounds.push(targetMs);

  return drops.map((drop, i) => reuse(existing[i], {
    startMs: bounds[i],
    endMs: bounds[i + 1],
    imagePrompt: promptFor(theme, drop.reference),
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

function promptFor(theme, reference) {
  const subject = [theme, reference].filter(Boolean).join(", ");
  return [
    subject || "still water at night",
    "calm contemplative landscape, soft diffused light, wide empty composition,",
    "cinematic, peaceful, no people, no text, no lettering",
  ].join(" ");
}
