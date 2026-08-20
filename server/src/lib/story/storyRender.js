import { spawn } from "child_process";
import { buildWordDrawtext, escapeDrawText } from "../videoFilters.js";
import { kenBurnsFilter } from "../kenBurns.js";
import { kenBurnsVariedFilter, moveForIndex } from "../kenBurnsVaried.js";
import { buildXfadeChain } from "./sceneTransitions.js";
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
 * Group word-timed tokens into short subtitle-style cues so long videos don't
 * generate one drawtext filter per word. A cue closes when it reaches maxWords
 * or would span more than maxSec. Each cue keeps the first word's start and the
 * last word's end so it stays in sync with the audio.
 *
 * @param {Array<{text:string,start:number,end:number}>} words
 * @param {{maxWords?:number, maxSec?:number}} [opts]
 * @returns {Array<{text:string,start:number,end:number}>}
 */
export function groupWordsIntoCues(words, { maxWords = 8, maxSec = 4 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    if (!cur) { cur = { text: String(w.text), start: w.start, end: w.end, n: 1 }; continue; }
    const span = w.end - cur.start;
    if (cur.n >= maxWords || span > maxSec) {
      cues.push({ text: cur.text, start: cur.start, end: cur.end });
      cur = { text: String(w.text), start: w.start, end: w.end, n: 1 };
    } else {
      cur.text += " " + String(w.text);
      cur.end = w.end;
      cur.n += 1;
    }
  }
  if (cur) cues.push({ text: cur.text, start: cur.start, end: cur.end });
  return cues;
}

/**
 * Greedy word-wrap into lines of at most maxChars. Never drops words (a single
 * over-long word becomes its own line).
 * @returns {string[]}
 */
export function wrapCue(text, maxChars) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Build a compact, lower-third SUBTITLE drawtext chain for long videos: a
 * moderate fixed font (no per-word size clamping that overflowed and clipped),
 * wrapped to fit the frame width, anchored in the lower third with a readable
 * box. One cue shows at a time via enable='between(...)'.
 *
 * @param {Array<{text:string,start:number,end:number}>} cues
 * @param {number} w @param {number} h
 * @returns {string | null}
 */
export function buildSubtitleDrawtext(words, w, h) {
  if (!Array.isArray(words) || words.length === 0) return null;
  // Compact caption size. Each cue is ONE line; ffmpeg's drawtext chain gets
  // pathologically slow past ~600 filters, so we keep the cue count down by
  // packing each line near `maxChars` (a smaller font fits more per line → far
  // fewer total lines → fast encode) instead of wrapping (which doubled them).
  const fontSize = Math.max(28, Math.round(h * 0.026));
  const maxChars = Math.max(20, Math.floor((w * 0.9) / (fontSize * 0.5)));
  const y = Math.round(h * 0.80); // single-line caption, lower third
  // Outline + shadow (not a filled box — boxes per cue stall the encode).
  const style = "fontcolor=white:borderw=6:bordercolor=black@0.95:shadowcolor=black@0.85:shadowx=2:shadowy=2";

  // Pack words into single-line cues ≤ maxChars (and ≤5s) — no wrapping, so the
  // filter count stays near the proven-fast zone and nothing ever clips.
  const cues = [];
  let cur = null;
  for (const word of words) {
    const t = String(word?.text || "").trim();
    if (!t) continue;
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (!cur) { cur = { text: t, start, end }; continue; }
    const cand = `${cur.text} ${t}`;
    if (cand.length > maxChars || end - cur.start > 5) {
      cues.push(cur);
      cur = { text: t, start, end };
    } else {
      cur.text = cand;
      cur.end = end;
    }
  }
  if (cur) cues.push(cur);

  const parts = cues.map((c) => {
    const txt = escapeDrawText(c.text);
    return txt
      ? `drawtext=text='${txt}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:${style}:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'`
      : null;
  }).filter(Boolean);
  return parts.length ? parts.join(",") : null;
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
  // Crossfade instead of hard-cutting between scenes. xfade OVERLAPS its
  // inputs, so each scene (bar the last) is rendered slightly longer and the
  // extra frames are what the dissolve consumes — total runtime is unchanged,
  // which keeps the visuals locked to the narration audio.
  const xfade = buildXfadeChain(segs);
  segs.forEach((seg, i) => {
    // Ken Burns spans the PADDED duration so the move still completes across
    // the whole clip, including the frames the crossfade eats.
    const kbDuration = xfade.paddedDurations[i] ?? seg.durationSec;
    // Alternate the move per scene; a uniform push-in across 30 stills is what
    // makes a sequence feel mechanical. Deterministic on index so re-renders
    // match the approved video.
    const kb = kenBurnsVariedFilter(width, height, kbDuration, 30, moveForIndex(i));
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
  if (xfade.filters.length > 0) {
    filterParts.push(...xfade.filters);
  } else {
    // Single scene: nothing to cross into, so alias it straight to [vcat].
    filterParts.push(`${sceneLabels.join("")}null[vcat]`);
  }

  const drawWords = words
    .filter((w) => w && w.text && Number.isFinite(w.startMs) && Number.isFinite(w.endMs))
    .map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 }));
  // Per-word kinetic captions emit ~2 drawtext filters PER WORD, each evaluated
  // every frame — fine for short videos, but a long transcript (a 27-min sermon
  // ≈ 3,800 words) becomes thousands of filters and the render crawls / stalls
  // the box. So: short videos (≤ STORY_KINETIC_MAX_WORDS, ~10 min at 150 wpm)
  // keep the full word-by-word kinetic box; longer videos switch to a compact,
  // wrapped, lower-third SUBTITLE (a few hundred filters, renders in minutes,
  // and no edge-clipping).
  const kineticMaxWords = Math.max(0, Number(process.env.STORY_KINETIC_MAX_WORDS) || 1500);
  const drawtext = drawWords.length > kineticMaxWords
    ? buildSubtitleDrawtext(drawWords, width, height)
    : buildWordDrawtext({ words: drawWords, w: width, h: height });
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
