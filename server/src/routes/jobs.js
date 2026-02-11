import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";
import { readLibrary } from "../lib/library.js";

const router = Router();

const outDir = process.env.OUTPUT_DIR || "./outputs";
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const jobsFile = path.join(outDir, "jobs.json");

function loadJobs() {
  try {
    if (!fs.existsSync(jobsFile)) return { jobs: [] };
    return JSON.parse(fs.readFileSync(jobsFile, "utf-8"));
  } catch {
    return { jobs: [] };
  }
}
function saveJobs(store) {
  fs.writeFileSync(jobsFile, JSON.stringify(store, null, 2));
}

let store = loadJobs();

function updateJob(id, patch) {
  const store = loadJobs(); // Reload to ensure freshness
  const j = store.jobs.find(x => x.id === id);
  if (!j) return null;
  Object.assign(j, patch);
  saveJobs(store);
  return j;
}

function resolveAssetPath(pathOrId) {
  if (pathOrId == null) return null;
  const normalized = String(pathOrId).trim();
  if (!normalized) return null;
  if (normalized.startsWith('http')) return normalized;
  if (fs.existsSync(normalized)) return normalized;

  // Try to find in library
  const lib = readLibrary();
  const item = lib.items.find(x => String(x.id) === normalized);
  if (item) {
    if (Array.isArray(item.files) && item.files.length > 0) {
      const sorted = item.files.slice().sort((a, b) => (b.width || 0) - (a.width || 0));
      const hd = sorted.find(f => f.quality === 'hd') || sorted[0];
      if (hd?.link) return hd.link;
    }
    if (item.previewUrl) return item.previewUrl;
    if (item.url) return item.url;
  }

  return normalized; // Return as is (might be external URL)
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

let running = false;

function runFFmpeg(args, totalDurationSec, onProgress) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    let stderr = "";

    proc.stderr.on("data", d => {
      const chunk = d.toString();
      stderr += chunk;

      if (onProgress && totalDurationSec > 0) {
        // Parse time=00:00:05.12
        const match = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (match) {
          const h = parseFloat(match[1]);
          const m = parseFloat(match[2]);
          const s = parseFloat(match[3]);
          const currentTime = h * 3600 + m * 60 + s;
          const pct = Math.min(99, Math.floor((currentTime / totalDurationSec) * 100));
          onProgress(pct);
        }
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed: ${code}\n${stderr.slice(-2000)}`));
      resolve(true);
    });
  });
}

async function executeJob(job) {
  if (job.type === "render_waveform") {
    const { backgroundPath, audioPath, lines, durationSec, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = job.payload || {};
    const resolvedBackground = resolveAssetPath(backgroundPath);
    const resolvedAudio = resolveAssetPath(audioPath);
    const resolvedMusic = resolveAssetPath(musicPath);

    if (!resolvedAudio || !isLocalOrRemote(resolvedAudio)) throw new Error("audioPath missing or not found");

    const rawLines = Array.isArray(lines) ? lines.map(s => String(s).slice(0, 140)) : [];
    const { w, h } = getDims(aspect);
    const widthPct = Math.min(100, Math.max(60, Number(captionWidthPct || 90)));
    const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
    const maxChars = Math.max(18, Math.floor(baseChars * (widthPct / 100)));
    const safeLines = wrapTextLines(rawLines, maxChars, 6);
    const outFile = path.join(outDir, `waveform-${uuid()}.mp4`);

    const startY = Math.round(h * 0.2);
    const lineGap = Math.round(h * 0.055);
    const fontSize = Math.max(24, Math.round(h * 0.03));
    const textFilters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'[\]]/g, "\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    const filterComplexParts = [];
    const baseVideo = resolvedBackground
      ? `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuv420p[base]`
      : `color=c=black:s=${w}x${h}:r=30[base]`;

    filterComplexParts.push(baseVideo);
    const waveH = Math.round(h * 0.22);
    const waveY = h - waveH - Math.round(h * 0.03);
    const audioIndex = resolvedBackground ? 1 : 0;
    const musicIndex = resolvedBackground ? 2 : 1;
    const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
    let audioLabel = `${audioIndex}:a`;
    const duck = Boolean(autoDuck) && Boolean(resolvedMusic);
    if (resolvedMusic) {
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
    filterComplexParts.push(`[wave]colorchannelmixer=aa=0.75[wavea]`);
    filterComplexParts.push(`[base][wavea]overlay=x=0:y=${waveY}:shortest=1[withwave]`);

    let finalLabel = "withwave";
    if (textFilters && textFilters.length > 0) {
      filterComplexParts.push(`[withwave]${textFilters}[vout]`);
      finalLabel = "vout";
    }
    const filterComplex = filterComplexParts.join(";");

    const args = ["-y"];
    if (resolvedBackground) {
      args.push("-stream_loop", "-1", "-i", resolvedBackground, "-i", resolvedAudio);
    } else {
      args.push("-i", resolvedAudio);
    }
    if (resolvedMusic) args.push("-i", resolvedMusic);
    const t = Number(durationSec || 20);
    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL; // e.g., 'nvenc' or 'qsv'

    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    args.push(
      "-t", String(t),
      "-filter_complex", filterComplex,
      "-map", `[${finalLabel}]`,
      "-map", resolvedMusic ? "[amix]" : `${resolvedBackground ? 1 : 0}:a`,
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
    await runFFmpeg(args, t, (p) => updateJob(job.id, { progress: p }));
    return { outFile };
  }

  if (job.type === "render_video") {
    const { backgroundPath, audioPath, lines, durationSec, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = job.payload || {};
    const resolvedBackground = resolveAssetPath(backgroundPath);
    const resolvedAudio = resolveAssetPath(audioPath);
    const resolvedMusic = resolveAssetPath(musicPath);

    if (!resolvedBackground || !isLocalOrRemote(resolvedBackground)) throw new Error("backgroundPath missing or not found");
    const rawLines = Array.isArray(lines) ? lines.map(s => String(s).slice(0, 140)) : [];
    const { w, h } = getDims(aspect);
    const widthPct = Math.min(100, Math.max(60, Number(captionWidthPct || 90)));
    const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
    const maxChars = Math.max(18, Math.floor(baseChars * (widthPct / 100)));
    const safeLines = wrapTextLines(rawLines, maxChars, 6);
    if (safeLines.length === 0) throw new Error("lines[] required");

    const outFile = path.join(outDir, `video-${uuid()}.mp4`);
    const startY = Math.round(h * 0.22);
    const lineGap = Math.round(h * 0.06);
    const fontSize = Math.max(28, Math.round(h * 0.033));
    const filters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'\[\]]/g, "\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    const args = ["-y", "-stream_loop", "-1", "-i", resolvedBackground];
    if (resolvedAudio) args.push("-i", resolvedAudio);
    if (resolvedMusic) args.push("-i", resolvedMusic);

    const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${filters}`;
    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';
    const t = Number(durationSec || 20);

    const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
    const duck = Boolean(autoDuck) && Boolean(resolvedMusic) && Boolean(resolvedAudio);

    if (resolvedMusic) {
      const aIndex = resolvedAudio ? 1 : null;
      const mIndex = resolvedAudio ? 2 : 1;
      const vFilter = `[0:v]${vf}[vout]`;
      const aFilter = resolvedAudio
        ? duck
          ? `[${aIndex}:a]volume=1.0[a1];[${mIndex}:a]volume=${musicVol}[m1];[m1][a1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];[a1][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
          : `[${aIndex}:a]volume=1.0[a1];[${mIndex}:a]volume=${musicVol}[a2];[a1][a2]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
        : `[${mIndex}:a]volume=${musicVol}[aout]`;
      args.push(
        "-t", String(t),
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
      args.push("-t", String(t), "-vf", vf, "-r", "30", "-c:v", vcodec, "-preset", preset, "-crf", "22", "-pix_fmt", "yuv420p");
      if (resolvedAudio) args.push("-c:a", "aac", "-b:a", "192k", "-shortest"); else args.push("-an");
    }
    args.push(outFile);

    await runFFmpeg(args, t, (p) => updateJob(job.id, { progress: p }));
    return { outFile };
  }

  throw new Error("Unknown job type");
}

async function workerTick() {
  if (running) return;
  const next = store.jobs.find(j => j.status === "queued");
  if (!next) return;
  running = true;
  updateJob(next.id, { status: "running", startedAt: new Date().toISOString() });
  try {
    const result = await executeJob(next);
    updateJob(next.id, { status: "done", finishedAt: new Date().toISOString(), result });
  } catch (e) {
    updateJob(next.id, { status: "failed", finishedAt: new Date().toISOString(), error: String(e?.message || e) });
  } finally {
    running = false;
  }
}

// poll worker every 1s
const _t = setInterval(workerTick, 1000);
_t.unref();

router.get("/", (req, res) => {
  store = loadJobs();
  res.json({ ok: true, jobs: store.jobs.slice().reverse().slice(0, 200) });
});

router.get("/:id", (req, res) => {
  store = loadJobs();
  const j = store.jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, job: j });
});

router.post("/enqueue", (req, res) => {
  const type = String(req.body?.type || "").trim();
  const payload = req.body?.payload || {};
  if (!type) return res.status(400).json({ ok: false, error: "type required" });

  const id = `job_${uuid()}`;
  const job = {
    id, type, payload,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  store = loadJobs();
  store.jobs.push(job);
  saveJobs(store);
  res.json({ ok: true, job });
});

export default router;
