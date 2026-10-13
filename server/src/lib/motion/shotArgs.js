import path from "node:path";
import { getEffect } from "./effects/index.js";
import { frameCount, CLIP_TAGS } from "./effects/common.js";

/**
 * One shot's filtergraph: the move from the working image (input 0, a single
 * frame), video overlays, then the entrance (input 1 is the previous shot's
 * last frame, for a crossfade), then trimmed to the shot's exact frame count.
 * ASS overlays have no graph and are skipped here: the finish stage draws
 * them all in one pass.
 *
 * Each effect gets its own tag, so labels such as [s${tag}0] cannot collide
 * between the move, the entrance and the overlays of one shot.
 */
export function shotGraph({ shot, w, h, fps, hasPrev }) {
  const frames = frameCount(shot, fps);
  const ctx = { w, h, fps, frames, dur: frames / fps, prev: hasPrev ? "[1:v]" : null };
  const lines = [];
  lines.push(...getEffect(shot.move.id).graph({ input: "[0:v]", output: "[mv]", shot, ctx, tag: "m" }));
  let last = "[mv]";
  shot.overlays.forEach((o, k) => {
    const fx = getEffect(o.id);
    if (!fx.graph) return;
    const out = `[ov${k}]`;
    lines.push(...fx.graph({ input: last, output: out, shot, ctx, tag: `o${k}` }));
    last = out;
  });
  lines.push(...getEffect(shot.entrance.id).graph({ input: last, output: "[en]", shot, ctx, tag: "e" }));
  // Every shot ends the same way, so clips can be joined with the concat demuxer and -c copy.
  // JPEG working images are full range (yuvj420p) and format=yuv420p alone keeps that flag, which
  // would make a clip that starts from a JPEG differ from one that went through RGB (an overlay).
  // scale=out_range=tv converts the range itself, so every clip is limited-range yuv420p.
  // setparams tags every clip limited-range BT.601 in its frames (no conversion): ffmpeg 5.1 does
  // not carry these tags through every move, and clips that differ cannot be joined safely.
  lines.push(`[en]scale=in_range=auto:out_range=tv,format=yuv420p,${CLIP_TAGS},trim=end_frame=${frames},setpts=N/${fps}/TB[v]`);
  return lines.join(";\n");
}

export function shotArgs({ shot, index, workImage, prevFrame, out, w, h, fps, workDir }) {
  const hasPrev = shot.entrance.id === "crossfade" && Boolean(prevFrame);
  const script = path.join(workDir, `shot-${index}.txt`);
  const frames = frameCount(shot, fps);
  const args = [
    "-hide_banner", "-v", "error", "-y",
    "-i", workImage,
    ...(hasPrev ? ["-i", prevFrame] : []),
    "-filter_complex_script", script,
    "-map", "[v]",
    "-frames:v", String(frames),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-an",
    out,
  ];
  return { args, sideFiles: [{ path: script, text: shotGraph({ shot, w, h, fps, hasPrev }) }] };
}

/**
 * The clip's final frame as a still, for the next shot's crossfade. -sseof
 * only seeks near the end, and the first frame after the seek is not the
 * last one. So every frame after it is written to the same file (-update 1)
 * and the last write wins. No -frames:v: that would stop at the first.
 */
export function lastFrameArgs(clip, png) {
  return ["-hide_banner", "-v", "error", "-y", "-sseof", "-0.2", "-i", clip, "-update", "1", png];
}
