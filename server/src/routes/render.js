import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn, spawnSync } from "child_process";
import { readLibrary } from "../lib/library.js";

const router = Router();
let ffmpegChecked = false;
let ffmpegOk = false;
const MAX_RENDER_SECONDS = Number(process.env.MAX_RENDER_SECONDS || 30);
const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || "./outputs");

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

function resolveOutputAlias(p) {
  if (!p) return p;
  const raw = String(p).trim().replace(/\\/g, "/");
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/outputs/")) return path.join(OUTPUT_DIR, raw.slice("/outputs/".length));
  if (raw.startsWith("outputs/")) return path.join(OUTPUT_DIR, raw.slice("outputs/".length));
  if (raw.startsWith("./outputs/")) return path.join(OUTPUT_DIR, raw.slice("./outputs/".length));
  return raw;
}

function resolveAssetPath(pathOrId) {
  if (pathOrId == null) return null;
  const normalized = String(pathOrId).trim();
  if (!normalized) return null;
  const direct = resolveOutputAlias(normalized);
  if (String(direct).startsWith("http")) return direct;
  if (fs.existsSync(direct)) return direct;

  const lib = readLibrary();
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

function isLocalOrRemote(p) {
  if (!p) return false;
  if (p.startsWith('http')) return true;
  return fs.existsSync(p);
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
    let { backgroundPath, audioPath, lines, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = req.body || {};
    backgroundPath = resolveAssetPath(backgroundPath);
    audioPath = resolveAssetPath(audioPath);
    musicPath = resolveAssetPath(musicPath);

    if (!backgroundPath || !isLocalOrRemote(backgroundPath)) {
      return res.status(400).json({ ok: false, error: "backgroundPath missing or not found" });
    }
    if (isFileTooLarge(backgroundPath)) {
      return res.status(400).json({ ok: false, error: `backgroundPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (audioPath && !isLocalOrRemote(audioPath)) {
      return res.status(400).json({ ok: false, error: "audioPath not found" });
    }
    if (audioPath && isFileTooLarge(audioPath)) {
      return res.status(400).json({ ok: false, error: `audioPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (musicPath && !isLocalOrRemote(musicPath)) {
      return res.status(400).json({ ok: false, error: "musicPath not found" });
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

    const outDir = OUTPUT_DIR;
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

    args.push(outFile);

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
    let { backgroundPath, audioPath, lines, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = req.body || {};
    backgroundPath = resolveAssetPath(backgroundPath);
    audioPath = resolveAssetPath(audioPath);
    musicPath = resolveAssetPath(musicPath);

    if (!audioPath || !isLocalOrRemote(audioPath)) {
      return res.status(400).json({ ok: false, error: "audioPath missing or not found" });
    }
    if (isFileTooLarge(audioPath)) {
      return res.status(400).json({ ok: false, error: `audioPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (backgroundPath && !isLocalOrRemote(backgroundPath)) {
      return res.status(400).json({ ok: false, error: "backgroundPath not found" });
    }
    if (backgroundPath && isFileTooLarge(backgroundPath)) {
      return res.status(400).json({ ok: false, error: `backgroundPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (musicPath && !isLocalOrRemote(musicPath)) {
      return res.status(400).json({ ok: false, error: "musicPath not found" });
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

    const outDir = OUTPUT_DIR;
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

export default router;
