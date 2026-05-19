// FFmpeg filter-graph builders for the new word-level captions and
// scene-splitter pipelines. Pure functions — no fs/spawn/network. Each
// returns plain strings (or arrays of strings) the caller assembles into
// the final ffmpeg invocation.

const DEFAULT_XFADE_SECONDS = 0.5;
const EMPHASIS_COLOR = "#F59E0B";
const BASE_TEXT_COLOR = "white";

export function escapeDrawText(s) {
  return String(s || "").replace(/[:\\'\[\]]/g, "\\$&").replace(/\n/g, " ");
}

/**
 * Build a `drawtext=...,drawtext=...` chain that shows one word at a time,
 * each gated by `enable='between(t,start,end)'`. Emphasized words render
 * larger and in amber.
 *
 * @param {{ words: Array<{ text: string, start: number, end: number, emphasize?: boolean }>, w: number, h: number }} opts
 * @returns {string | null}
 */
export function buildWordDrawtext({ words, w, h }) {
  if (!Array.isArray(words) || words.length === 0) return null;
  const baseSize = Math.max(48, Math.round(h * 0.07));
  const emphSize = Math.round(baseSize * 1.25);
  // Default-font glyphs occupy ~0.55× their fontsize in width on average.
  // Clamp per-word so the longest token never overflows 85% of frame width.
  const maxWidthPx = w * 0.85;
  const filters = [];
  for (const word of words) {
    const text = escapeDrawText(word.text);
    if (!text) continue;
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const requested = word.emphasize ? emphSize : baseSize;
    const fitSize = Math.floor(maxWidthPx / Math.max(1, text.length) / 0.55);
    const size = Math.max(40, Math.min(requested, fitSize));
    const color = word.emphasize ? EMPHASIS_COLOR : BASE_TEXT_COLOR;
    filters.push(
      `drawtext=text='${text}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=${size}:fontcolor=${color}:borderw=5:bordercolor=black@0.85:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`
    );
  }
  if (filters.length === 0) return null;
  return filters.join(",");
}

/**
 * Build a sliding-stack `drawtext=...,drawtext=...` chain for legacy line
 * captions (no per-word timing). Mirrors the original renderVideoCore
 * behaviour so the same helper can drive either path.
 *
 * @param {{ lines: string[], w: number, h: number }} opts
 * @returns {string | null}
 */
export function buildLineDrawtext({ lines, w, h }) {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (safeLines.length === 0) return null;
  const startY = Math.round(h * 0.22);
  const lineGap = Math.round(h * 0.06);
  const fontSize = Math.max(28, Math.round(h * 0.033));
  return safeLines.map((t, i) => {
    const y = startY + i * lineGap;
    const escaped = escapeDrawText(t);
    return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
  }).join(",");
}

/**
 * Build the multi-scene video filter graph. Each scene is its own ffmpeg
 * input (looped to ensure it never runs short) and crossfaded into the
 * previous chain output via `xfade`.
 *
 * Returns:
 *   - inputs: list of { path } for the ffmpeg input list (in order)
 *   - filterParts: filter-complex chunks to append (joined with `;` by caller)
 *   - videoLabel: name of the final video stream (`xfinal` or `v0`)
 *   - totalDuration: number of seconds the composed video lasts
 *
 * @param {{ scenes: Array<{ backgroundPath: string, duration: number }>, w: number, h: number, xfadeDuration?: number }} opts
 */
export function buildSceneGraph({ scenes, w, h, xfadeDuration }) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("buildSceneGraph: scenes[] required");
  }
  const X = Number.isFinite(xfadeDuration) ? Number(xfadeDuration) : DEFAULT_XFADE_SECONDS;
  const inputs = scenes.map((s) => ({ path: s.backgroundPath, loop: true }));
  const filterParts = [];

  // Each scene is normalized to 30fps + yuv420p + a shared timebase before
  // xfade — clips can come from sources with different framerates/timebases,
  // and xfade refuses to mix mismatched inputs.
  for (let i = 0; i < scenes.length; i++) {
    const dur = Math.max(0.5, Number(scenes[i].duration) || 0);
    filterParts.push(
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`
    );
  }

  if (scenes.length === 1) {
    return {
      inputs,
      filterParts,
      videoLabel: "v0",
      totalDuration: Math.max(0.5, Number(scenes[0].duration) || 0),
    };
  }

  let prevLabel = "v0";
  let accumulated = Math.max(0.5, Number(scenes[0].duration) || 0);
  for (let i = 1; i < scenes.length; i++) {
    const dur = Math.max(0.5, Number(scenes[i].duration) || 0);
    const offset = Math.max(0, accumulated - X);
    const nextLabel = i === scenes.length - 1 ? "xfinal" : `x${i}`;
    filterParts.push(
      `[${prevLabel}][v${i}]xfade=transition=fade:duration=${X.toFixed(3)}:offset=${offset.toFixed(3)}[${nextLabel}]`
    );
    accumulated = accumulated + dur - X;
    prevLabel = nextLabel;
  }

  return {
    inputs,
    filterParts,
    videoLabel: prevLabel,
    totalDuration: accumulated,
  };
}
