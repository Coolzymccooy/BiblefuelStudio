import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn, spawnSync } from "child_process";
import { readLibrary } from "../lib/library.js";
import { resolveAutoBackgrounds } from "../lib/autoBackground.js";
import { computeSyncedSegments, buildCrossfadeChain } from "../lib/backgroundSequence.js";
import { generateBibleImage } from "../lib/imageGen/index.js";
import { isLocalOrRemote, resolveOutputAlias } from "../lib/mediaThumb.js";
import { buildWordDrawtext, resolveKineticAnimation } from "../lib/videoFilters.js";
import { createJob, getJob, gcJobs, markRunning, markProgress, markDone, markError } from "../lib/renderJobs.js";
import { appendRender, listRenders } from "../lib/renderHistory.js";
import { friendlyRenderError } from "../lib/renderErrors.js";

const router = Router();
let ffmpegChecked = false;
let ffmpegOk = false;
const MAX_RENDER_SECONDS = Number(process.env.MAX_RENDER_SECONDS || 30);
const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200);

function ensureFfmpegAvailable() {
  if (ffmpegChecked) return ffmpegOk;
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    const result = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" });
    ffmpegOk = result.status === 0;
  } catch {
    ffmpegOk = false;
  }
  ffmpegChecked = true;
  return ffmpegOk;
}

function clampDuration(value) {
  const n = Number(value || 20);
  if (Number.isNaN(n)) return 20;
  return Math.min(Math.max(n, 1), MAX_RENDER_SECONDS);
}

function isFileTooLarge(p) {
  if (!p || p.startsWith('http')) return false;
  try {
    const stat = fs.statSync(p);
    return stat.size > MAX_INPUT_MB * 1024 * 1024;
  } catch {
    return false;
  }
}

function logMemory(tag) {
  const m = process.memoryUsage();
  console.log(`[MEM] ${tag} rss=${Math.round(m.rss / 1024 / 1024)}MB heap=${Math.round(m.heapUsed / 1024 / 1024)}MB`);
}

function resolveAssetPath(dataDir, pathOrId) {
  if (pathOrId == null) return null;
  const normalized = String(pathOrId).trim();
  if (!normalized) return null;
  const direct = resolveOutputAlias(normalized);
  if (String(direct).startsWith("http")) return direct;
  if (fs.existsSync(direct)) return direct;

  const lib = readLibrary(dataDir);
  const item = lib.items.find(x => String(x.id) === normalized);
  if (item) {
    if (Array.isArray(item.files) && item.files.length > 0) {
      const sorted = item.files.slice().sort((a, b) => (b.width || 0) - (a.width || 0));
      const hd = sorted.find(f => f.quality === 'hd') || sorted[0];
      if (hd?.link) return hd.link;
    }
    const localUrl = resolveOutputAlias(item.url);
    if (localUrl && !String(localUrl).startsWith("http") && fs.existsSync(localUrl)) return localUrl;
    const preview = resolveOutputAlias(item.previewUrl);
    if (preview && String(preview).startsWith("http")) return preview;
    if (preview && fs.existsSync(preview)) return preview;
    if (localUrl) return localUrl;
    if (preview) return preview;
  }

  return direct;
}

function getDims(aspect) {
  switch (String(aspect || "").toLowerCase()) {
    case "landscape":
      return { w: 1920, h: 1080 };
    case "square":
      return { w: 1080, h: 1080 };
    default:
      return { w: 1080, h: 1920 };
  }
}

function wrapTextLines(lines, maxChars, maxLines) {
  const out = [];
  for (const raw of lines) {
    const words = String(raw).split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars) {
        current = next;
      } else {
        if (current) out.push(current);
        current = word;
      }
      if (out.length >= maxLines) break;
    }
    if (current && out.length < maxLines) out.push(current);
    if (out.length >= maxLines) break;
  }
  return out.slice(0, maxLines);
}

/**
 * Creates a simple vertical video (1080x1920) using FFmpeg:
 * - background mp4 (looped)
 * - text overlay (hook + verse + reflection + CTA)
 * - optional audio mp3
 */
router.post("/video", async (req, res) => {
  try {
    if (!ensureFfmpegAvailable()) {
      return res.status(500).json({ ok: false, error: "FFmpeg not available on server" });
    }
    const rawBackgroundPath = req.body?.backgroundPath;
    const rawAudioPath = req.body?.audioPath;
    const rawMusicPath = req.body?.musicPath;
    let { backgroundPath, audioPath, lines, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = req.body || {};
    backgroundPath = resolveAssetPath(req.ctx.dataDir, rawBackgroundPath);
    audioPath = resolveAssetPath(req.ctx.dataDir, rawAudioPath);
    musicPath = resolveAssetPath(req.ctx.dataDir, rawMusicPath);

    if (!backgroundPath || !isLocalOrRemote(backgroundPath)) {
      return res.status(400).json({ ok: false, error: `backgroundPath missing or not found: ${rawBackgroundPath || "<empty>"}` });
    }
    if (isFileTooLarge(backgroundPath)) {
      return res.status(400).json({ ok: false, error: `backgroundPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (audioPath && !isLocalOrRemote(audioPath)) {
      return res.status(400).json({ ok: false, error: `audioPath not found: ${rawAudioPath}` });
    }
    if (audioPath && isFileTooLarge(audioPath)) {
      return res.status(400).json({ ok: false, error: `audioPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (musicPath && !isLocalOrRemote(musicPath)) {
      return res.status(400).json({ ok: false, error: `musicPath not found: ${rawMusicPath}` });
    }
    if (musicPath && isFileTooLarge(musicPath)) {
      return res.status(400).json({ ok: false, error: `musicPath too large (>${MAX_INPUT_MB}MB)` });
    }
    logMemory("render/video:start");
    const rawLines = Array.isArray(lines) ? lines.map(s => String(s).slice(0, 140)) : [];
    const { w, h } = getDims(aspect);
    const widthPct = Math.min(100, Math.max(60, Number(captionWidthPct || 90)));
    const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
    const maxChars = Math.max(18, Math.floor(baseChars * (widthPct / 100)));
    const safeLines = wrapTextLines(rawLines, maxChars, 6);
    if (safeLines.length === 0) return res.status(400).json({ ok: false, error: "lines[] required" });

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `video-${uuid()}.mp4`);
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    // Build drawtext filters (simple stacking)
    // Note: font is system-dependent; this uses default. On Windows you can set a fontfile path.
    const startY = Math.round(h * 0.22);
    const lineGap = Math.round(h * 0.06);
    const fontSize = Math.max(28, Math.round(h * 0.033));
    const filters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'\[\]]/g, "\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    const args = ["-y", "-stream_loop", "-1", "-i", backgroundPath];
    if (audioPath) args.push("-i", audioPath);
    if (musicPath) args.push("-i", musicPath);

    // scale/crop to 9:16
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${filters}`;

    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));

    const hasVoice = Boolean(audioPath);
    const hasMusic = Boolean(musicPath);
    const duck = Boolean(autoDuck) && hasVoice && hasMusic;

    const duration = clampDuration(req.body?.durationSec || 20);
    if (hasMusic) {
      const aIndex = hasVoice ? 1 : null;
      const mIndex = hasVoice ? 2 : 1;
      const vFilter = `[0:v]${vf}[vout]`;
      const aFilter = hasVoice
        ? duck
          ? `[${aIndex}:a]volume=1.0[a1];[${mIndex}:a]volume=${musicVol}[m1];[m1][a1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];[a1][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
          : `[${aIndex}:a]volume=1.0[a1];[${mIndex}:a]volume=${musicVol}[a2];[a1][a2]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
        : `[${mIndex}:a]volume=${musicVol}[aout]`;
      args.push(
        "-t", String(duration),
        "-filter_complex", `${vFilter};${aFilter}`,
        "-map", "[vout]",
        "-map", "[aout]",
        "-r", "30",
        "-c:v", vcodec,
        "-preset", preset,
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest"
      );
    } else {
      args.push(
        "-t", String(duration),
        "-vf", vf,
        "-r", "30",
        "-c:v", vcodec,
        "-preset", preset,
        "-crf", "22",
        "-pix_fmt", "yuv420p"
      );

      if (audioPath) {
        args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
      } else {
        args.push("-an");
      }
    }

    args.push("-movflags", "+faststart", outFile);

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());

    proc.on("close", (code) => {
      if (code !== 0) {
        try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
        return res.status(400).json({ ok: false, error: `ffmpeg failed: ${code}`, details: stderr.slice(-2000) });
      }
      logMemory("render/video:done");
      if (global.gc) global.gc();
      res.json({ ok: true, file: outFile.replace(/\\/g, '/') });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Creates a vertical video with an audio waveform overlay (1080x1920) using FFmpeg:
 * - optional background mp4 (looped); if omitted, uses black background
 * - waveform generated from audio (required)
 * - optional text overlay lines (max 6)
 * Body: { backgroundPath?: string, audioPath: string, lines?: string[] }
 */
router.post("/waveform", async (req, res) => {
  try {
    if (!ensureFfmpegAvailable()) {
      return res.status(500).json({ ok: false, error: "FFmpeg not available on server" });
    }
    const rawBackgroundPath = req.body?.backgroundPath;
    const rawAudioPath = req.body?.audioPath;
    const rawMusicPath = req.body?.musicPath;
    let { backgroundPath, audioPath, lines, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = req.body || {};
    backgroundPath = resolveAssetPath(req.ctx.dataDir, rawBackgroundPath);
    audioPath = resolveAssetPath(req.ctx.dataDir, rawAudioPath);
    musicPath = resolveAssetPath(req.ctx.dataDir, rawMusicPath);

    if (!audioPath || !isLocalOrRemote(audioPath)) {
      return res.status(400).json({ ok: false, error: `audioPath missing or not found: ${rawAudioPath || "<empty>"}` });
    }
    if (isFileTooLarge(audioPath)) {
      return res.status(400).json({ ok: false, error: `audioPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (backgroundPath && !isLocalOrRemote(backgroundPath)) {
      return res.status(400).json({ ok: false, error: `backgroundPath not found: ${rawBackgroundPath}` });
    }
    if (backgroundPath && isFileTooLarge(backgroundPath)) {
      return res.status(400).json({ ok: false, error: `backgroundPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (musicPath && !isLocalOrRemote(musicPath)) {
      return res.status(400).json({ ok: false, error: `musicPath not found: ${rawMusicPath}` });
    }
    if (musicPath && isFileTooLarge(musicPath)) {
      return res.status(400).json({ ok: false, error: `musicPath too large (>${MAX_INPUT_MB}MB)` });
    }
    logMemory("render/waveform:start");

    const rawLines = Array.isArray(lines) ? lines.map(s => String(s).slice(0, 140)) : [];
    const { w, h } = getDims(aspect);
    const widthPct = Math.min(100, Math.max(60, Number(captionWidthPct || 90)));
    const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
    const maxChars = Math.max(18, Math.floor(baseChars * (widthPct / 100)));
    const safeLines = wrapTextLines(rawLines, maxChars, 6);

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `waveform-${uuid()}.mp4`);

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    // Text overlays
    const startY = Math.round(h * 0.2);
    const lineGap = Math.round(h * 0.055);
    const fontSize = Math.max(24, Math.round(h * 0.03));
    const textFilters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'[\]]/g, "\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    // Waveform (bottom area). Use showwaves; alpha blend for nice overlay.
    // showwaves outputs RGBA with transparent background if we key out black.
    const filterComplexParts = [];

    // Video source: background or black
    // 0:v = bg video if provided else color
    // 1:a = audio
    // We'll build:
    // [base] = scaled/cropped 1080x1920
    // [wave] = waveform 1080x420
    // overlay wave at y=1420, then apply text
    const baseVideo = backgroundPath
      ? `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuv420p[base]`
      : `color=c=black:s=${w}x${h}:r=30[base]`;

    if (backgroundPath) filterComplexParts.push(baseVideo);
    else filterComplexParts.push(baseVideo);

    const waveH = Math.round(h * 0.22);
    const waveY = h - waveH - Math.round(h * 0.03);
    const audioIndex = backgroundPath ? 1 : 0;
    const musicIndex = backgroundPath ? 2 : 1;
    const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
    let audioLabel = `${audioIndex}:a`;
    const duck = Boolean(autoDuck) && Boolean(musicPath);
    if (musicPath) {
      filterComplexParts.push(`[${audioIndex}:a]volume=1.0[a1]`);
      filterComplexParts.push(`[${musicIndex}:a]volume=${musicVol}[m1]`);
      if (duck) {
        filterComplexParts.push(`[m1][a1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked]`);
        filterComplexParts.push(`[a1][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[amix]`);
      } else {
        filterComplexParts.push(`[a1][m1]amix=inputs=2:duration=shortest:dropout_transition=2[amix]`);
      }
      audioLabel = "amix";
    }
    filterComplexParts.push(`[${audioLabel}]aformat=channel_layouts=stereo,showwaves=s=${w}x${waveH}:mode=line:rate=30:colors=White,format=rgba[wave]`);
    // Make black transparent-ish by blending over base with 0.75 opacity using colorchannelmixer
    filterComplexParts.push(`[wave]colorchannelmixer=aa=0.75[wavea]`);
    filterComplexParts.push(`[base][wavea]overlay=x=0:y=${waveY}:shortest=1[withwave]`);

    let finalLabel = "withwave";
    if (textFilters && textFilters.length > 0) {
      filterComplexParts.push(`[withwave]${textFilters}[vout]`);
      finalLabel = "vout";
    }

    const filterComplex = filterComplexParts.join(";");

    const args = ["-y"];
    if (backgroundPath) {
      args.push("-stream_loop", "-1", "-i", backgroundPath, "-i", audioPath);
    } else {
      args.push("-i", audioPath);
    }
    if (musicPath) args.push("-i", musicPath);

    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    const duration = clampDuration(req.body?.durationSec || 20);
    args.push(
      "-t", String(duration),
      "-filter_complex", filterComplex,
      "-map", `[${finalLabel}]`,
      "-map", musicPath ? "[amix]" : `${backgroundPath ? 1 : 0}:a`,
      "-r", "30",
      "-c:v", vcodec,
      "-preset", preset,
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-shortest",
      outFile
    );

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", (code) => {
      if (code !== 0) {
        try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
        return res.status(400).json({ ok: false, error: `ffmpeg failed: ${code}`, details: stderr.slice(-2000) });
      }
      logMemory("render/waveform:done");
      if (global.gc) global.gc();
      res.json({ ok: true, file: outFile.replace(/\\/g, '/') });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Probe duration + dimensions of a media file via ffprobe. Resolves to
// `{ durationSec, width, height }` or `null` on any failure (missing ffprobe,
// unreadable file). Used by the captioned-video render route to drive both
// the FFmpeg pipeline and the drawtext positioning math from the source video
// itself rather than a hardcoded aspect.
function probeMediaInfo(filePath) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "default=noprint_wrappers=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const widthMatch = out.match(/width=(\d+)/);
      const heightMatch = out.match(/height=(\d+)/);
      const durMatch = out.match(/duration=([\d.]+)/);
      const width = widthMatch ? Number(widthMatch[1]) : null;
      const height = heightMatch ? Number(heightMatch[1]) : null;
      const durationSec = durMatch ? Number(durMatch[1]) : null;
      if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(durationSec)) {
        return resolve(null);
      }
      resolve({ width, height, durationSec });
    });
  });
}

// Audio-only sibling of probeMediaInfo. /captioned-video's audio+background
// mode needs the sermon duration from a .wav/.mp3 (no video stream), which
// probeMediaInfo returns null for because it selects v:0.
function probeAudioDuration(filePath) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const d = Number(String(out).trim());
      resolve(Number.isFinite(d) && d > 0 ? d : null);
    });
  });
}

/**
 * Burn kinetic-typography captions onto a sermon. Two input modes:
 *
 *   (a) videoPath          — uploaded sermon video; drives duration + canvas
 *                            from the source clip itself.
 *   (b) audioPath +        — sermon audio with a looped background video as the
 *       backgroundPath       canvas. Duration comes from the audio (-shortest);
 *                            canvas dimensions come from the background. The
 *                            background can be a local file or a Pexels library
 *                            ID (resolved to a remote URL FFmpeg streams).
 *
 * Both modes share the same music-bed + auto-duck filter chain. The combined
 * filter complex is written to a sidecar file and passed via
 * `-filter_complex_script` so a long sermon doesn't blow past Windows' ~32 KB
 * CreateProcess cmdline cap.
 *
 * Body: { videoPath?, audioPath?, backgroundPath?, words: [{text, startMs, endMs}],
 *         typographyPreset?, musicPath?, musicVolume?, autoDuck? }
 */
router.post("/captioned-video", async (req, res) => {
  try {
    if (!ensureFfmpegAvailable()) {
      return res.status(500).json({ ok: false, error: "FFmpeg not available on server" });
    }

    const rawVideoPath = req.body?.videoPath;
    const rawAudioPath = req.body?.audioPath;
    // Accept both shapes: single `backgroundPath` (legacy) and
    // `backgroundPaths[]` (new multi-background sequence). The plural form
    // wins when both are present; the singular collapses into a 1-element
    // array so the rest of the pipeline only sees one shape.
    const rawBackgroundPath = req.body?.backgroundPath;
    const rawBackgroundPathsInput = Array.isArray(req.body?.backgroundPaths)
      ? req.body.backgroundPaths
      : rawBackgroundPath
        ? [rawBackgroundPath]
        : [];
    const rawBackgroundPaths = rawBackgroundPathsInput
      .map((p) => (p == null ? "" : String(p).trim()))
      .filter(Boolean);
    const rawMusicPath = req.body?.musicPath;
    const words = Array.isArray(req.body?.words) ? req.body.words : [];
    const typographyPreset = String(req.body?.typographyPreset || "default");
    const musicVolume = req.body?.musicVolume;
    const autoDuck = Boolean(req.body?.autoDuck);
    // Timeline trim window (the Main Assembly clip's START / DURATION). Both are
    // optional: startSec seeks into the source, durationSec caps the output.
    // Clamped against the real media length below once it's been probed.
    const rawStartSec = req.body?.startSec;
    const rawDurationSec = req.body?.durationSec;
    // Opt-in: sync multi-background cuts to spoken phrases + crossfade between
    // them, instead of equal hard cuts. No-op for a single background.
    const syncBackgrounds = req.body?.syncBackgrounds === true;

    if (!words.length) {
      return res.status(400).json({ ok: false, error: "words[] is required and must be non-empty" });
    }

    const MAX_BACKGROUNDS = 4;

    // Auto background mode: when the caller opts in (`autoBackground: true`) and
    // hasn't picked any background explicitly, let BibleFuel choose one clip per
    // script beat from the user's own library — falling back to AI generation
    // when their pool is empty. Explicit picks always win (manual override).
    let autoBackgroundSource = null;
    const wantsAuto =
      req.body?.autoBackground === true || String(req.body?.background || "").toLowerCase() === "auto";
    if (wantsAuto && rawBackgroundPaths.length === 0 && rawAudioPath) {
      const script = req.body?.script && typeof req.body.script === "object" ? req.body.script : undefined;
      const transcript = words.map((w) => w?.text).filter(Boolean).join(" ");
      const lib = readLibrary(req.ctx.dataDir);
      const pool = Array.isArray(lib?.items) ? lib.items : [];
      const aspect = String(req.body?.aspect || "portrait");
      const auto = await resolveAutoBackgrounds({
        pool,
        script,
        text: transcript,
        maxBackgrounds: MAX_BACKGROUNDS,
        generateImage: (genArgs) =>
          generateBibleImage({
            seriesId: `auto-${req.ctx.userId || "anon"}`,
            partNumber: 1,
            aspect,
            ...genArgs,
          }),
      });
      if (auto.backgroundIds.length === 0) {
        return res.status(400).json({ ok: false, error: auto.error || "Could not auto-select a background" });
      }
      rawBackgroundPaths.push(...auto.backgroundIds);
      autoBackgroundSource = auto.source;
    }
    if (rawBackgroundPaths.length > MAX_BACKGROUNDS) {
      return res.status(400).json({
        ok: false,
        error: `at most ${MAX_BACKGROUNDS} backgrounds supported (got ${rawBackgroundPaths.length})`,
      });
    }

    const hasVideoMode = Boolean(rawVideoPath);
    const hasAudioMode = Boolean(rawAudioPath) && rawBackgroundPaths.length > 0;
    if (!hasVideoMode && !hasAudioMode) {
      return res.status(400).json({
        ok: false,
        error: "Provide either videoPath OR (audioPath + backgroundPath)",
      });
    }

    let videoPath = null;
    let audioPath = null;
    /** @type {string[]} resolved background paths (1..MAX_BACKGROUNDS, audio mode only). */
    let backgroundPaths = [];
    let canvasWidth = 0;
    let canvasHeight = 0;
    let durationSec = 0;

    if (hasVideoMode) {
      videoPath = resolveAssetPath(req.ctx.dataDir, rawVideoPath);
      if (!videoPath || !isLocalOrRemote(videoPath)) {
        return res.status(400).json({ ok: false, error: `videoPath not found: ${rawVideoPath}` });
      }
      if (isFileTooLarge(videoPath)) {
        return res.status(400).json({ ok: false, error: `videoPath too large (>${MAX_INPUT_MB}MB)` });
      }
      const info = await probeMediaInfo(videoPath);
      if (!info || info.durationSec <= 0) {
        return res.status(400).json({ ok: false, error: "Could not probe video duration / dimensions" });
      }
      canvasWidth = info.width;
      canvasHeight = info.height;
      durationSec = info.durationSec;
    } else {
      audioPath = resolveAssetPath(req.ctx.dataDir, rawAudioPath);
      if (!audioPath || !isLocalOrRemote(audioPath)) {
        return res.status(400).json({ ok: false, error: `audioPath not found: ${rawAudioPath}` });
      }
      if (isFileTooLarge(audioPath)) {
        return res.status(400).json({ ok: false, error: `audioPath too large (>${MAX_INPUT_MB}MB)` });
      }

      // Resolve + validate every requested background. Each may be a local
      // path or a Pexels library id (resolveAssetPath handles both). We
      // surface the failing index in the error so a user with 4 backgrounds
      // can tell which one is busted.
      for (let i = 0; i < rawBackgroundPaths.length; i++) {
        const resolved = resolveAssetPath(req.ctx.dataDir, rawBackgroundPaths[i]);
        if (!resolved || !isLocalOrRemote(resolved)) {
          return res.status(400).json({
            ok: false,
            error: `backgroundPaths[${i}] not found: ${rawBackgroundPaths[i]}`,
          });
        }
        if (isFileTooLarge(resolved)) {
          return res.status(400).json({
            ok: false,
            error: `backgroundPaths[${i}] too large (>${MAX_INPUT_MB}MB)`,
          });
        }
        backgroundPaths.push(resolved);
      }

      // Canvas dims come from the FIRST background; concat requires every
      // input to be the same size, so we'll scale the others to match below.
      const firstBgInfo = await probeMediaInfo(backgroundPaths[0]);
      if (!firstBgInfo || !firstBgInfo.width || !firstBgInfo.height) {
        return res.status(400).json({ ok: false, error: "Could not probe background dimensions" });
      }
      const audDur = await probeAudioDuration(audioPath);
      if (!audDur) {
        return res.status(400).json({ ok: false, error: "Could not probe audio duration" });
      }
      canvasWidth = firstBgInfo.width;
      canvasHeight = firstBgInfo.height;
      durationSec = audDur;
    }

    const musicPath = rawMusicPath ? resolveAssetPath(req.ctx.dataDir, rawMusicPath) : null;
    if (musicPath && !isLocalOrRemote(musicPath)) {
      return res.status(400).json({ ok: false, error: `musicPath not found: ${rawMusicPath}` });
    }

    // Apply the Timeline trim window. `durationSec` so far holds the FULL source
    // length; reinterpret it through the requested start/duration so the render
    // honours the user's START/DURATION instead of always encoding the whole
    // sermon. Clamped so a bad value can't produce a zero-length or over-long
    // render. trimStart seeks the voice/video input; trimDuration caps output.
    const fullDuration = durationSec;
    const trimStart = Math.min(
      Math.max(Number(rawStartSec) || 0, 0),
      Math.max(0, fullDuration - 0.5),
    );
    const requestedDuration = Number(rawDurationSec);
    const trimDuration =
      Number.isFinite(requestedDuration) && requestedDuration > 0
        ? Math.min(requestedDuration, fullDuration - trimStart)
        : fullDuration - trimStart;
    // Everything downstream (bg slot math, caption window, output cap) renders
    // the trimmed window, so collapse durationSec to it.
    durationSec = trimDuration;

    // Cap the render canvas at 1080p-equivalent. 4K Pexels backgrounds (2160x3840)
    // are common in the library but blow up x264 memory on long sermons
    // ("malloc of size N failed"). Vertical-1080 is plenty for social video and
    // keeps allocations sane. Aspect ratio is preserved; both dims rounded to
    // an even number because libx264 requires that for yuv420p.
    const MAX_OUTPUT_DIM = 1920;
    const longestSide = Math.max(canvasWidth, canvasHeight);
    const scaleFactor = longestSide > MAX_OUTPUT_DIM ? MAX_OUTPUT_DIM / longestSide : 1;
    const renderWidth = scaleFactor < 1 ? Math.round(canvasWidth * scaleFactor / 2) * 2 : canvasWidth;
    const renderHeight = scaleFactor < 1 ? Math.round(canvasHeight * scaleFactor / 2) * 2 : canvasHeight;
    const needsScale = scaleFactor < 1;

    // buildWordDrawtext expects { text, start, end } in seconds; the
    // /api/transcribe contract emits { text, startMs, endMs } in milliseconds.
    // Convert here so the captions/render pipelines stay millisecond-native.
    // Word times are absolute against the full source. Shift them by trimStart
    // (the trimmed voice is rebased to t=0) and keep only words overlapping the
    // [0, trimDuration] window, clamping partial words to the edges so a caption
    // never renders before t=0 or past the output end.
    const drawWords = words
      .map((w) => ({
        text: w?.text,
        start: Number(w?.startMs) / 1000 - trimStart,
        end: Number(w?.endMs) / 1000 - trimStart,
        emphasize: Boolean(w?.emphasize),
      }))
      .filter(
        (w) =>
          w.text &&
          Number.isFinite(w.start) &&
          Number.isFinite(w.end) &&
          w.end > 0 &&
          w.start < durationSec &&
          w.end > w.start,
      )
      .map((w) => ({
        ...w,
        start: Math.max(0, w.start),
        end: Math.min(durationSec, w.end),
      }));

    if (drawWords.length === 0) {
      return res.status(400).json({ ok: false, error: "words[] contained no usable entries (need text + startMs + endMs)" });
    }

    const resolvedPreset = resolveKineticAnimation(typographyPreset)?.presetId || typographyPreset;
    const drawtextChain = buildWordDrawtext({
      words: drawWords,
      w: renderWidth,
      h: renderHeight,
      preset: resolvedPreset,
    });
    if (!drawtextChain) {
      return res.status(400).json({ ok: false, error: "buildWordDrawtext returned empty filter chain" });
    }

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `captioned-${uuid()}.mp4`);

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    // Input order is mode-dependent. In video mode: [0]=video, [1?]=music.
    // In audio mode with N backgrounds: [0..N-1]=backgrounds, [N]=audio,
    // [N+1?]=music. Each background gets -stream_loop -1 so a Pexels clip
    // shorter than its segment slot fills the slot via wraparound instead of
    // freezing on the last frame.
    const args = ["-y"];
    let voiceIdx, musicIdx;
    // Pre-drawtext video chain — emits [vbg]. For video mode this is just
    // [0:v]; for audio mode it's a single scaled bg, or a concat of N scaled
    // bgs hard-cut at durationSec/N each.
    let preDrawChain = "";

    if (hasVideoMode) {
      // Input-level seek so the trimmed sermon video starts at trimStart,
      // rebased to t=0 (captions were shifted to match above).
      if (trimStart > 0) args.push("-ss", trimStart.toFixed(3));
      args.push("-i", videoPath);
      if (musicPath) args.push("-i", musicPath);
      voiceIdx = 0;
      musicIdx = musicPath ? 1 : -1;
      preDrawChain = needsScale
        ? `[0:v]scale=${renderWidth}:${renderHeight}[vbg];`
        : `[0:v]null[vbg];`;
    } else {
      const N = backgroundPaths.length;
      // Per-background input flags depend on whether the file is an image or
      // a video. Images need `-loop 1 -framerate 30 -t <dur>` so FFmpeg
      // produces a fixed-duration stream of repeated frames; videos need
      // `-stream_loop -1` so a short Pexels clip wraps to fill its slot.
      // Slot duration: for N=1 we just need the full audio length; for N>=2
      // each input fills its 1/N segment.
      // Sync mode: cut on phrase boundaries (from caption word timings) and
      // crossfade. Computed once up front because the image inputs need their
      // per-slot `-t` length. Falls back silently to the equal-cut path when
      // not requested. The output `-t durationSec` cap trims the xfade surplus.
      const useSyncBackgrounds = syncBackgrounds && N >= 2;
      let syncChain = null;
      let syncInputDurations = null;
      if (useSyncBackgrounds) {
        const segs = computeSyncedSegments({ words: drawWords, durationSec, count: N });
        const built = buildCrossfadeChain({ count: N, segments: segs, w: renderWidth, h: renderHeight, label: "vbg" });
        syncChain = built.chain;
        syncInputDurations = built.inputDurations;
      }

      const perSlotSec = N >= 2 ? durationSec / N : durationSec;
      backgroundPaths.forEach((bg, i) => {
        const isImage = /\.(jpg|jpeg|png|webp)$/i.test(String(bg));
        // Images need a fixed-duration stream. In sync mode each must cover its
        // (variable) slot plus the crossfade tail; otherwise the equal slot.
        const imgDur = useSyncBackgrounds ? syncInputDurations[i] : perSlotSec;
        if (isImage) {
          args.push("-loop", "1", "-framerate", "30", "-t", imgDur.toFixed(3), "-i", bg);
        } else {
          args.push("-stream_loop", "-1", "-i", bg);
        }
      });
      // Input-level seek so the trimmed sermon audio starts at trimStart,
      // rebased to t=0 (captions were shifted to match above). Backgrounds are
      // not seeked — they just fill the trimmed duration.
      if (trimStart > 0) args.push("-ss", trimStart.toFixed(3));
      args.push("-i", audioPath);
      if (musicPath) args.push("-i", musicPath);
      voiceIdx = N;
      musicIdx = musicPath ? N + 1 : -1;

      // For multi-bg we MUST scale every input to the same dims (concat
      // requirement) AND trim each to its slot duration so concat doesn't
      // splice in extra frames. For single-bg we keep the legacy lean chain:
      // scale-on-demand only, no trim (`-shortest` handles termination).
      if (N === 1) {
        preDrawChain = needsScale
          ? `[0:v]scale=${renderWidth}:${renderHeight}[vbg];`
          : `[0:v]null[vbg];`;
      } else if (useSyncBackgrounds) {
        // Crossfade chain over the speech-synced slot durations -> [vbg].
        preDrawChain = syncChain;
      } else {
        const segSec = durationSec / N;
        const segParts = backgroundPaths.map((_, i) =>
          // setsar=1 normalizes pixel aspect across mixed sources so concat
          // doesn't reject the inputs as "incompatible". setpts=PTS-STARTPTS
          // rebases each trimmed segment to t=0 so concat re-times them
          // sequentially on the output timeline.
          `[${i}:v]trim=duration=${segSec.toFixed(3)},scale=${renderWidth}:${renderHeight},setsar=1,setpts=PTS-STARTPTS[seg${i}]`,
        );
        const concatInputs = backgroundPaths.map((_, i) => `[seg${i}]`).join("");
        preDrawChain = `${segParts.join(";")};${concatInputs}concat=n=${N}:v=1:a=0[vbg];`;
      }
    }

    const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.25)));
    // drawtext consumes [vbg] (whatever the pre-chain produced) and emits
    // [vout]. Coordinates were built against renderWidth/renderHeight upstream,
    // so the pre-scale + drawtext stay in lockstep regardless of source size.
    const vFilter = `${preDrawChain}[vbg]${drawtextChain}[vout]`;
    // The autoDuck path needs the voice signal twice: once as the sidechain
    // trigger for the compressor, and again as one of the two amix inputs.
    // FFmpeg requires every filter label to have exactly one consumer, so we
    // use asplit to fan the voice signal out into two distinct labels. Without
    // this, the parser falls through to interpreting the second `[a1]` as a
    // stream specifier ("Stream specifier 'a1' matches no streams") and the
    // whole filtergraph fails to bind. The bug is undefined-behavior-shaped:
    // shorter chains sometimes work, larger ones (e.g. 4K + long sermon)
    // surface it consistently.
    // amix uses duration=longest (not shortest) so a music bed SHORTER than the
    // sermon can't truncate the voice — the mix lasts as long as the voice, and
    // the explicit `-t durationSec` on the output caps a LONGER music bed. This
    // is what makes the render end when the sermon audio ends.
    const aFilter = musicPath
      ? autoDuck
        ? `[${voiceIdx}:a]volume=1.0,asplit=2[voice1][voice2];[${musicIdx}:a]volume=${musicVol}[m1];[m1][voice1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];[voice2][ducked]amix=inputs=2:duration=longest:dropout_transition=2[aout]`
        : `[${voiceIdx}:a]volume=1.0[a1];[${musicIdx}:a]volume=${musicVol}[a2];[a1][a2]amix=inputs=2:duration=longest:dropout_transition=2[aout]`
      : `[${voiceIdx}:a]anull[aout]`;

    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === "nvenc" ? "h264_nvenc" : hwaccel === "qsv" ? "h264_qsv" : "libx264";

    // The drawtext chain alone can blow past Windows' ~32 KB CreateProcess
    // cmdline limit on anything beyond a ~30 s sermon. Ship the filter via
    // FFmpeg's `-filter_complex_script <file>` form so cmdline length stays
    // bounded. NOTE: use `-filter_complex_script` (supported since FFmpeg ~2.x),
    // NOT the `-/filter_complex` "read option from file" form — that only exists
    // on FFmpeg 7.x+, so it explodes on the FFmpeg 5.1 in production with
    // "Unrecognized option '/filter_complex'". The sibling renderer in jobs.js
    // uses the same `-filter_complex_script` form.
    const filterFile = path.join(outDir, `filter-${uuid()}.txt`);
    fs.writeFileSync(filterFile, `${vFilter};${aFilter}`);

    args.push(
      "-filter_complex_script", filterFile,
      "-map", "[vout]",
      "-map", "[aout]",
      // Hard cap the output at the trimmed window. With duration=longest on the
      // audio mix this is what actually ends the render at the sermon's end.
      "-t", durationSec.toFixed(3),
      "-c:v", vcodec,
      "-preset", preset,
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-shortest",
      outFile,
    );

    // Diagnostic dump: log the full ffmpeg command on every attempt so we can
    // see exactly which arg vector failed. The .args.txt sidecar lets us
    // re-run the exact invocation from a shell when triaging.
    const argsDump = path.join(outDir, `captioned-args-${path.basename(outFile, ".mp4")}.txt`);
    fs.writeFileSync(argsDump, args.map(a => /\s/.test(String(a)) ? `"${a}"` : String(a)).join(" "));
    console.log(`[captioned-video] ffmpeg args dumped to ${argsDump}`);

    // Async pivot: create a job, return jobId immediately, run ffmpeg in the
    // background. The client streams progress via GET /captioned-video-progress/:jobId
    // (SSE) so the UI can render a determinate progress bar instead of an
    // indeterminate spinner. A `wait=true` query param preserves the legacy
    // synchronous response for tests + curl smoke checks.
    const job = createJob(req.ctx.userId, { durationSec });
    const waitForCompletion = String(req.query?.wait || "").toLowerCase() === "true";

    const runRender = () =>
      new Promise((resolve, reject) => {
        markRunning(job.jobId);
        const proc = spawn(ffmpeg, args);
        let stderr = "";
        // FFmpeg emits `time=HH:MM:SS.MS` on stderr during encoding. Parse it
        // to a percentage of the target duration so SSE clients see a
        // monotonic 0-100 bar.
        const progressRegex = /time=(\d+):(\d+):(\d+\.\d+)/g;
        proc.stderr.on("data", (d) => {
          const chunk = d.toString();
          stderr += chunk;
          let m;
          let last = null;
          while ((m = progressRegex.exec(chunk)) !== null) last = m;
          if (last && durationSec > 0) {
            const sec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
            markProgress(job.jobId, (sec / durationSec) * 100);
          }
        });
        proc.on("error", (err) => {
          markError(job.jobId, `ffmpeg launch failed: ${err?.message || err}`);
          reject(err);
        });
        proc.on("close", (code) => {
          if (code === 0) {
            const finalFile = outFile.replace(/\\/g, "/");
            markDone(job.jobId, finalFile);
            // Persist into the user's history so the Recent Renders panel can
            // surface this render later. Best-effort: failure here must not
            // hide the success from the client.
            try {
              appendRender(req.ctx.dataDir, {
                jobId: job.jobId,
                file: finalFile,
                createdAt: Date.now(),
                durationSec,
                sourceMediaPath: hasVideoMode ? rawVideoPath : rawAudioPath,
                // backgroundIds is the full sequence (1..N) used to render;
                // backgroundId stays for backward-compat with older history
                // entries the client may still display.
                backgroundIds: hasVideoMode ? [] : rawBackgroundPaths,
                backgroundId: hasVideoMode ? null : rawBackgroundPaths[0] || null,
                mode: hasVideoMode ? "video" : "audio+bg",
                autoBackground: autoBackgroundSource,
              });
            } catch {}
            try { fs.unlinkSync(filterFile); } catch {}
            logMemory("render/captioned-video:done");
            return resolve(outFile);
          }
          try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
          const stderrDump = path.join(outDir, `captioned-stderr-${path.basename(outFile, ".mp4")}.txt`);
          try { fs.writeFileSync(stderrDump, stderr); } catch {}
          // The user sees a plain-language message; the raw ffmpeg stderr stays
          // server-side (this log + the sidecar dump above) for triage. We
          // attach `technical` to the Error for the `wait=true` callers/tests.
          const technical = `ffmpeg exited ${code}: ${stderr.slice(-600)}`;
          const friendly = friendlyRenderError(code, stderr);
          console.error(`[captioned-video] FAILED job ${job.jobId} — ${friendly}\n  filter kept at ${filterFile}\n  ${technical}`);
          const err = new Error(friendly);
          err.technical = technical;
          markError(job.jobId, friendly);
          reject(err);
        });
      });

    if (waitForCompletion) {
      try {
        await runRender();
        return res.json({
          ok: true,
          jobId: job.jobId,
          file: outFile.replace(/\\/g, "/"),
          durationSec,
          autoBackground: autoBackgroundSource,
          backgroundIds: hasVideoMode ? [] : rawBackgroundPaths,
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }

    // Default: fire-and-forget. Surface launch errors via the job record; the
    // SSE/status endpoints expose them to the client.
    runRender().catch(() => {
      // Already marked on the job record; swallow so the unhandled rejection
      // doesn't crash the process.
    });
    return res.json({
      ok: true,
      jobId: job.jobId,
      durationSec,
      autoBackground: autoBackgroundSource,
      backgroundIds: hasVideoMode ? [] : rawBackgroundPaths,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Live progress feed for a captioned-video render. Server-Sent Events stream:
 *   - `progress` { jobId, status, percent }   — emitted on every 500ms tick while running
 *   - `done`     { jobId, file, percent: 100 } — emitted once when ffmpeg exits 0
 *   - `error`    { jobId, error }              — emitted once on failure
 * The stream auto-closes after a terminal event so the client doesn't need to
 * track an explicit disconnect.
 *
 * Auth note: EventSource can't set Authorization headers, so the client passes
 * the token via `?token=...`; auth.js's requireAuth already accepts that.
 */
router.get("/captioned-video-progress/:jobId", (req, res) => {
  gcJobs();
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  if (job.userId !== req.ctx.userId) {
    return res.status(403).json({ ok: false, error: "job belongs to another user" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Disable nginx-style buffering so events flush immediately even behind a
  // proxy that defaults to buffering response bodies.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Emit current state immediately so a late subscriber doesn't sit at 0%.
  const initialEvent = job.status === "done" ? "done" : job.status === "error" ? "error" : "progress";
  send(initialEvent, summarizeJob(job));
  if (job.status === "done" || job.status === "error") {
    return res.end();
  }

  const tick = setInterval(() => {
    const current = getJob(req.params.jobId);
    if (!current) {
      clearInterval(tick);
      return res.end();
    }
    if (current.status === "done") {
      send("done", summarizeJob(current));
      clearInterval(tick);
      return res.end();
    }
    if (current.status === "error") {
      send("error", summarizeJob(current));
      clearInterval(tick);
      return res.end();
    }
    send("progress", summarizeJob(current));
  }, 500);

  req.on("close", () => clearInterval(tick));
});

/**
 * JSON status snapshot for the same job. Useful when SSE isn't available
 * (e.g. tests) — clients can poll this every 1s as a fallback.
 */
router.get("/captioned-video-status/:jobId", (req, res) => {
  gcJobs();
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  if (job.userId !== req.ctx.userId) {
    return res.status(403).json({ ok: false, error: "job belongs to another user" });
  }
  return res.json({ ok: true, ...summarizeJob(job) });
});

function summarizeJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    phase: job.phase,
    percent: job.percent,
    durationSec: job.durationSec,
    file: job.file,
    error: job.error,
  };
}

/**
 * Return the requesting user's recent captioned-video renders, newest-first.
 * Backed by a JSON file inside the user's dataDir — see renderHistory.js for
 * the file shape and the MAX_ENTRIES cap.
 */
router.get("/captioned-video-history", (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));
  const items = listRenders(req.ctx.dataDir, limit);
  res.json({ ok: true, items });
});

export default router;
