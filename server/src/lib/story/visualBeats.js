/**
 * Visual beats — keep a long, sparsely-illustrated video moving.
 *
 * A 30–60 min sleep session is capped at ~12 generated images, so each scene
 * would sit on screen for two or three minutes; a Ken Burns move stretched
 * over that long is imperceptible and the result reads as a static slide.
 * Instead of paying for more images, the render is re-cut into short beats
 * (`beatSec`, ~40 s) that cycle through the scene images in order, each beat
 * getting its own alternating move and a dissolve into the next (the renderer
 * already does both per "scene").
 *
 * Pure: returns a new array of scene-shaped beats, or the input array itself
 * when beats don't apply. Captions are unaffected (they are word-timed, not
 * scene-timed); sleep templates render without captions anyway.
 */

/**
 * @param {Array<{ id: string, text?: string, imagePath: string|null, imageUrl?: string|null, imageStatus?: string, startMs: number, endMs: number }>} scenes
 * @param {{ beatSec?: number }} [opts]
 */
export function expandScenesToBeats(scenes, { beatSec } = {}) {
  const beatMs = Number(beatSec) * 1000;
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;
  if (!Number.isFinite(beatMs) || beatMs <= 0) return scenes;

  const totalMs = scenes[scenes.length - 1].endMs;
  const count = Math.round(totalMs / beatMs);
  // Nothing to gain when the existing cut is already at least as fine.
  if (count <= scenes.length) return scenes;

  const len = totalMs / count;
  return Array.from({ length: count }, (_, i) => {
    const src = scenes[i % scenes.length];
    return {
      id: `${src.id}-b${i}`,
      text: src.text,
      imagePrompt: src.imagePrompt,
      imagePath: src.imagePath,
      imageUrl: src.imageUrl,
      imageStatus: "done",
      startMs: Math.round(i * len),
      endMs: i === count - 1 ? totalMs : Math.round((i + 1) * len),
    };
  });
}
