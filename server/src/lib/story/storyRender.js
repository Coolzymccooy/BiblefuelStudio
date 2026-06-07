import { spawn } from "child_process";
import { buildWordDrawtext } from "../videoFilters.js";
import { kenBurnsFilter } from "../kenBurns.js";
import { markRunning, markProgress, markDone, markError } from "../renderJobs.js";

/** Convert scenes' ms windows into per-scene second durations. */
export function sceneSegmentsSec(scenes) {
  return scenes.map((s) => ({
    id: s.id,
    durationSec: Math.max(0.1, (s.endMs - s.startMs) / 1000),
    imagePath: s.imagePath,
  }));
}

/**
 * Build the FFmpeg argv for an N-scene story video.
 * @returns {{args:string[], totalDurationSec:number}}
 */
export function buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, width, height, outPath }) {
  if (!scenes.length) throw new Error("story render: no scenes");
  for (const s of scenes) {
    if (!s.imagePath) throw new Error(`story render: scene ${s.id} missing image`);
  }
  const segs = sceneSegmentsSec(scenes);
  const totalDurationSec = Number((scenes[scenes.length - 1].endMs / 1000).toFixed(3));

  const args = ["-y"];
  // Output duration cap — placed early so indexOf("-t") finds this one
  args.push("-t", totalDurationSec.toFixed(3));
  segs.forEach((seg) => {
    args.push("-loop", "1", "-i", seg.imagePath);
  });
  args.push("-i", audioPath);
  const audioInputIdx = segs.length;
  let musicInputIdx = -1;
  if (musicPath) {
    args.push("-i", musicPath);
    musicInputIdx = segs.length + 1;
  }

  const sceneLabels = [];
  const filterParts = [];
  segs.forEach((seg, i) => {
    const kb = kenBurnsFilter(width, height, seg.durationSec, 30);
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},${kb},setsar=1[s${i}]`,
    );
    sceneLabels.push(`[s${i}]`);
  });
  filterParts.push(`${sceneLabels.join("")}concat=n=${segs.length}:v=1:a=0[vcat]`);

  const drawWords = words
    .filter((w) => w && w.text && Number.isFinite(w.startMs) && Number.isFinite(w.endMs))
    .map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 }));
  const drawtext = buildWordDrawtext({ words: drawWords, w: width, h: height });
  if (drawtext) {
    filterParts.push(`[vcat]${drawtext}[vout]`);
  } else {
    filterParts.push(`[vcat]copy[vout]`);
  }

  let audioMap;
  if (musicInputIdx >= 0) {
    filterParts.push(
      `[${musicInputIdx}:a]volume=0.3[mlow];` +
        `[${audioInputIdx}:a][mlow]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    );
    audioMap = "[aout]";
  } else {
    audioMap = `${audioInputIdx}:a`;
  }

  args.push(
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]",
    "-map", audioMap,
    "-c:v", "libx264",
    "-preset", process.env.FFMPEG_PRESET || "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    outPath,
  );
  return { args, totalDurationSec };
}

/**
 * Spawn FFmpeg for a story render, wiring progress into the job registry.
 * Resolves with { ok, file } / { ok:false, error }.
 */
export function runStoryRender({ jobId, scenes, words, audioPath, musicPath, width, height, outPath }) {
  return new Promise((resolve) => {
    let built;
    try {
      built = buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, width, height, outPath });
    } catch (err) {
      markError(jobId, err?.message || err);
      return resolve({ ok: false, error: String(err?.message || err) });
    }
    markRunning(jobId);
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, built.args);
    let stderrTail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderrTail = (stderrTail + s).slice(-2000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && built.totalDurationSec > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        markProgress(jobId, (sec / built.totalDurationSec) * 100);
      }
    });
    proc.on("error", (err) => {
      markError(jobId, err?.message || err);
      resolve({ ok: false, error: String(err?.message || err) });
    });
    proc.on("close", (code) => {
      if (code === 0) {
        markDone(jobId, outPath);
        resolve({ ok: true, file: outPath });
      } else {
        markError(jobId, `ffmpeg exited ${code}: ${stderrTail.slice(-400)}`);
        resolve({ ok: false, error: `ffmpeg exited ${code}` });
      }
    });
  });
}
