import { spawn } from "child_process";
import { buildWordDrawtext } from "../videoFilters.js";
import { kenBurnsFilter } from "../kenBurns.js";
import { markRunning, markProgress, markDone, markError, attachProc } from "../renderJobs.js";

/**
 * Per-scene display durations. Scenes are made CONTIGUOUS: scene i shows from
 * its start until scene i+1 starts (scene 0 starts at 0), and the last scene
 * stretches to audioDurationSec — so the video timeline equals the audio
 * timeline and the absolute-timed captions stay in sync. Falls back to the last
 * scene's word-span end when audioDurationSec is absent.
 */
export function sceneSegmentsSec(scenes, audioDurationSec) {
  const total = Number(audioDurationSec);
  const useTotal = Number.isFinite(total) && total > 0;
  const lastEndMs = scenes.length ? scenes[scenes.length - 1].endMs : 0;
  const finalMs = useTotal ? total * 1000 : lastEndMs;
  return scenes.map((s, i) => {
    const startMs = i === 0 ? 0 : s.startMs;
    const nextMs = i < scenes.length - 1 ? scenes[i + 1].startMs : finalMs;
    return {
      id: s.id,
      durationSec: Math.max(0.1, (nextMs - startMs) / 1000),
      imagePath: s.imagePath,
    };
  });
}

/**
 * Build the FFmpeg argv for an N-scene story video.
 * @returns {{args:string[], totalDurationSec:number}}
 */
export function buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height, outPath, audioDurationSec }) {
  if (!scenes.length) throw new Error("story render: no scenes");
  for (const s of scenes) {
    if (!s.imagePath) throw new Error(`story render: scene ${s.id} missing image`);
  }
  const segs = sceneSegmentsSec(scenes, audioDurationSec);
  const totalDurationSec = (Number.isFinite(audioDurationSec) && audioDurationSec > 0)
    ? Number(Number(audioDurationSec).toFixed(3))
    : Number((scenes[scenes.length - 1].endMs / 1000).toFixed(3));

  const args = ["-y"];
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
    // trim=end_frame=1 collapses the looped still to a SINGLE frame before
    // zoompan. Without it, `-loop 1` feeds an endless frame stream into
    // zoompan (which emits d frames per input frame), causing a runaway encode
    // that never reaches EOF. Mirrors the proven single-image path in render.js.
    filterParts.push(
      `[${i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,` +
        `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
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
    const vol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
    if (autoDuck) {
      filterParts.push(
        `[${audioInputIdx}:a]asplit=2[v1][v2];` +
          `[${musicInputIdx}:a]volume=${vol}[m1];` +
          `[m1][v1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];` +
          `[v2][ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      );
    } else {
      filterParts.push(
        `[${audioInputIdx}:a]volume=1[a1];` +
          `[${musicInputIdx}:a]volume=${vol}[m1];` +
          `[a1][m1]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      );
    }
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
    // Hard output cap: stop at the last scene's end even if the filtergraph
    // would otherwise keep producing frames. Belt-and-braces with trim above.
    "-t", totalDurationSec.toFixed(3),
    outPath,
  );
  return { args, totalDurationSec };
}

/**
 * Spawn FFmpeg for a story render, wiring progress into the job registry.
 * Resolves with { ok, file } / { ok:false, error }.
 */
export function runStoryRender({ jobId, scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height, outPath, audioDurationSec, onProgress }) {
  return new Promise((resolve) => {
    let built;
    try {
      built = buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height, outPath, audioDurationSec });
    } catch (err) {
      markError(jobId, err?.message || err);
      return resolve({ ok: false, error: String(err?.message || err) });
    }
    markRunning(jobId);
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, built.args);
    // Register so a user cancel (cancelJob) can SIGKILL this render.
    attachProc(jobId, proc);
    let stderrTail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderrTail = (stderrTail + s).slice(-2000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && built.totalDurationSec > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const pct = (sec / built.totalDurationSec) * 100;
        markProgress(jobId, pct);
        // Persist to the project too (callback) so progress survives across
        // requests/processes — the in-memory job map isn't always visible to
        // the request serving GET /story/:id.
        if (onProgress) { try { onProgress(pct); } catch { /* never break the render */ } }
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

/** Probe an audio file's duration in seconds via ffprobe. Resolves null on failure. */
export function probeAudioDurationSec(filePath) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const sec = Number(String(out).trim());
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null);
    });
  });
}
