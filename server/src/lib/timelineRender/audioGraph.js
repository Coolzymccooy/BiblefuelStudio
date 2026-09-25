/**
 * Audio-graph decisions for the proof renderer.
 *
 * The renderer used to emit `[0:a]volume=...` unconditionally. Input 0 is the
 * main clip, which is the first VIDEO clip — or, when the Real footage lane is
 * empty, the first B-ROLL clip. B-roll is usually a still image, and an image
 * has no audio stream, so ffmpeg rejected the whole filtergraph with
 *
 *   Stream specifier ':a' in filtergraph description ... matches no streams
 *
 * and the render produced nothing. This module decides which audio sources are
 * real before a filter references them.
 */

/** Extensions that never carry an audio stream. */
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i;

/**
 * Can this path contribute an audio stream?
 * Images cannot. Anything else is assumed to until ffmpeg says otherwise.
 * @param {string} p
 */
export function pathCanHaveAudio(p) {
  const s = String(p || '').split('?')[0];
  if (!s) return false;
  return !IMAGE_EXT.test(s);
}

/**
 * Which audio sources the graph may reference.
 *
 * @param {object} input
 * @param {string} input.mainPath Resolved path of ffmpeg input 0.
 * @param {Array<{resolvedPath?:string}>} [input.voiceovers]
 * @param {{resolvedPath?:string}|null} [input.music]
 * @returns {{useBaseAudio:boolean, hasAnyAudio:boolean}}
 */
export function planAudioSources({ mainPath, voiceovers = [], music = null }) {
  const useBaseAudio = pathCanHaveAudio(mainPath);
  const hasAnyAudio = useBaseAudio || voiceovers.length > 0 || Boolean(music);
  return { useBaseAudio, hasAnyAudio };
}
