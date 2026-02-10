import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";
import { readLibrary } from "../lib/library.js";

const router = Router();

function resolveAssetPath(pathOrId) {
  if (!pathOrId || typeof pathOrId !== 'string') return null;
  if (pathOrId.startsWith('http')) return pathOrId;
  if (fs.existsSync(pathOrId)) return pathOrId;

  const lib = readLibrary();
  const item = lib.items.find(x => x.id === pathOrId || x.id == pathOrId);
  if (item && item.url) return item.url;

  return pathOrId;
}

function isLocalOrRemote(p) {
  if (!p) return false;
  if (p.startsWith('http')) return true;
  return fs.existsSync(p);
}

/**
 * Creates a simple vertical video (1080x1920) using FFmpeg:
 * - background mp4 (looped)
 * - text overlay (hook + verse + reflection + CTA)
 * - optional audio mp3
 */
router.post("/video", async (req, res) => {
  try {
    let { backgroundPath, audioPath, lines } = req.body || {};
    backgroundPath = resolveAssetPath(backgroundPath);
    audioPath = resolveAssetPath(audioPath);

    if (!backgroundPath || !isLocalOrRemote(backgroundPath)) {
      return res.status(400).json({ ok: false, error: "backgroundPath missing or not found" });
    }
    if (audioPath && !isLocalOrRemote(audioPath)) {
      return res.status(400).json({ ok: false, error: "audioPath not found" });
    }
    const safeLines = Array.isArray(lines) ? lines.slice(0, 6).map(s => String(s).slice(0, 140)) : [];
    if (safeLines.length === 0) return res.status(400).json({ ok: false, error: "lines[] required" });

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `video-${uuid()}.mp4`);
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    // Build drawtext filters (simple stacking)
    // Note: font is system-dependent; this uses default. On Windows you can set a fontfile path.
    const startY = 420;
    const lineGap = 110;
    const filters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'\[\]]/g, "\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    const args = [
      "-y",
      "-stream_loop", "-1",
      "-i", backgroundPath,
    ];

    if (audioPath) {
      args.push("-i", audioPath);
    }

    // scale/crop to 9:16
    const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${filters}`;

    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    args.push(
      "-t", "20",
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

    args.push(outFile);

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());

    proc.on("close", (code) => {
      if (code !== 0) {
        return res.status(400).json({ ok: false, error: `ffmpeg failed: ${code}`, details: stderr.slice(-2000) });
      }
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
    let { backgroundPath, audioPath, lines } = req.body || {};
    backgroundPath = resolveAssetPath(backgroundPath);
    audioPath = resolveAssetPath(audioPath);

    if (!audioPath || !isLocalOrRemote(audioPath)) {
      return res.status(400).json({ ok: false, error: "audioPath missing or not found" });
    }
    if (backgroundPath && !isLocalOrRemote(backgroundPath)) {
      return res.status(400).json({ ok: false, error: "backgroundPath not found" });
    }

    const safeLines = Array.isArray(lines) ? lines.slice(0, 6).map(s => String(s).slice(0, 140)) : [];

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `waveform-${uuid()}.mp4`);

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    // Text overlays
    const startY = 360;
    const lineGap = 100;
    const textFilters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'[\]]/g, "\\\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=60:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
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
      ? `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[base]`
      : `color=c=black:s=1080x1920:r=30[base]`;

    if (backgroundPath) filterComplexParts.push(baseVideo);
    else filterComplexParts.push(baseVideo);

    filterComplexParts.push(`[${backgroundPath ? 1 : 0}:a]aformat=channel_layouts=stereo,showwaves=s=1080x420:mode=line:rate=30:colors=White,format=rgba[wave]`);
    // Make black transparent-ish by blending over base with 0.75 opacity using colorchannelmixer
    filterComplexParts.push(`[wave]colorchannelmixer=aa=0.75[wavea]`);
    filterComplexParts.push(`[base][wavea]overlay=x=0:y=1420:shortest=1[withwave]`);

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

    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    args.push(
      "-t", "20",
      "-filter_complex", filterComplex,
      "-map", `[${finalLabel}]`,
      "-map", `${backgroundPath ? 1 : 0}:a`,
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
        return res.status(400).json({ ok: false, error: `ffmpeg failed: ${code}`, details: stderr.slice(-2000) });
      }
      res.json({ ok: true, file: outFile.replace(/\\/g, '/') });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
