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
  if (!pathOrId || typeof pathOrId !== 'string') return null;
  if (pathOrId.startsWith('http')) return pathOrId;
  if (fs.existsSync(pathOrId)) return pathOrId;

  // Try to find in library
  const lib = readLibrary();
  const item = lib.items.find(x => x.id === pathOrId || x.id == pathOrId);
  if (item && item.url) return item.url;

  return pathOrId; // Return as is (might be external URL)
}

function isLocalOrRemote(p) {
  if (!p) return false;
  if (p.startsWith('http')) return true;
  return fs.existsSync(p);
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
    const { backgroundPath, audioPath, lines, durationSec } = job.payload || {};
    const resolvedBackground = resolveAssetPath(backgroundPath);
    const resolvedAudio = resolveAssetPath(audioPath);

    if (!resolvedAudio || !isLocalOrRemote(resolvedAudio)) throw new Error("audioPath missing or not found");

    const safeLines = Array.isArray(lines) ? lines.slice(0, 6).map(s => String(s).slice(0, 140)) : [];
    const outFile = path.join(outDir, `waveform-${uuid()}.mp4`);

    const startY = 360;
    const lineGap = 100;
    const textFilters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'[\]]/g, "\\\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=60:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    const filterComplexParts = [];
    const baseVideo = resolvedBackground
      ? `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[base]`
      : `color=c=black:s=1080x1920:r=30[base]`;

    filterComplexParts.push(baseVideo);
    filterComplexParts.push(`[${resolvedBackground ? 1 : 0}:a]aformat=channel_layouts=stereo,showwaves=s=1080x420:mode=line:rate=30:colors=White,format=rgba[wave]`);
    filterComplexParts.push(`[wave]colorchannelmixer=aa=0.75[wavea]`);
    filterComplexParts.push(`[base][wavea]overlay=x=0:y=1420:shortest=1[withwave]`);

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
    const t = Number(durationSec || 20);
    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL; // e.g., 'nvenc' or 'qsv'

    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    args.push(
      "-t", String(t),
      "-filter_complex", filterComplex,
      "-map", `[${finalLabel}]`,
      "-map", `${resolvedBackground ? 1 : 0}:a`,
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
    const { backgroundPath, audioPath, lines, durationSec } = job.payload || {};
    const resolvedBackground = resolveAssetPath(backgroundPath);
    const resolvedAudio = resolveAssetPath(audioPath);

    if (!resolvedBackground || !isLocalOrRemote(resolvedBackground)) throw new Error("backgroundPath missing or not found");
    const safeLines = Array.isArray(lines) ? lines.slice(0, 6).map(s => String(s).slice(0, 140)) : [];
    if (safeLines.length === 0) throw new Error("lines[] required");

    const outFile = path.join(outDir, `video-${uuid()}.mp4`);
    const startY = 420;
    const lineGap = 110;
    const filters = safeLines.map((t, i) => {
      const y = startY + i * lineGap;
      const escaped = t.replace(/[:\\'\[\]]/g, "\\$&").replace(/\n/g, " ");
      return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18`;
    }).join(",");

    const args = ["-y", "-stream_loop", "-1", "-i", resolvedBackground];
    if (resolvedAudio) args.push("-i", resolvedAudio);

    const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${filters}`;
    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';

    args.push("-t", String(t), "-vf", vf, "-r", "30", "-c:v", vcodec, "-preset", preset, "-crf", "22", "-pix_fmt", "yuv420p");
    if (resolvedAudio) args.push("-c:a", "aac", "-b:a", "192k", "-shortest"); else args.push("-an");
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
