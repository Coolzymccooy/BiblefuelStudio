import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn, spawnSync } from "child_process";
import { readLibrary } from "../lib/library.js";
import { DATA_DIR, OUTPUT_DIR, resolveOutputAlias, isLocalOrRemote } from "../lib/mediaThumb.js";

const router = Router();
let ffmpegChecked = false;
let ffmpegOk = false;
const MAX_RENDER_SECONDS = Number(process.env.MAX_RENDER_SECONDS || 30);
const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200);
const JOBS_RETENTION = Math.max(50, Number(process.env.JOBS_RETENTION || 500));
const JOB_EXEC_TIMEOUT_SEC = Math.max(30, Number(process.env.JOB_EXEC_TIMEOUT_SEC || 600));
const STALE_RUNNING_JOB_MINUTES = Math.max(1, Number(process.env.STALE_RUNNING_JOB_MINUTES || 45));

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

const outDir = OUTPUT_DIR;
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const jobsFile = path.join(DATA_DIR, "jobs.json");
const jobsTmpFile = path.join(DATA_DIR, "jobs.json.tmp");
const jobsBakFile = path.join(DATA_DIR, "jobs.json.bak");
const legacyJobsFile = path.join(OUTPUT_DIR, "jobs.json");
let liveStore = { jobs: [] };

function trimJobs(jobs) {
  const list = Array.isArray(jobs) ? jobs.slice() : [];
  if (list.length <= JOBS_RETENTION) return list;
  const newest = list
    .slice()
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    .slice(0, JOBS_RETENTION);
  const keep = new Set(newest.map((x) => x.id));
  return list.filter((x) => keep.has(x.id));
}

function ensureJobsStoreReady() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(jobsFile)) {
    if (fs.existsSync(legacyJobsFile)) {
      fs.copyFileSync(legacyJobsFile, jobsFile);
      console.warn(`[JOBS] Migrated legacy jobs store from ${legacyJobsFile} -> ${jobsFile}`);
    } else {
      fs.writeFileSync(jobsFile, JSON.stringify({ jobs: [] }, null, 2), "utf-8");
      console.log(`[JOBS] Initialized jobs store at ${jobsFile}`);
    }
  }
}

function atomicWriteJobs(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  let fd;
  try {
    fd = fs.openSync(jobsTmpFile, "w");
    fs.writeFileSync(fd, payload, "utf-8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (fs.existsSync(jobsFile)) {
      fs.copyFileSync(jobsFile, jobsBakFile);
    }
    fs.renameSync(jobsTmpFile, jobsFile);
  } finally {
    if (typeof fd === "number") {
      try { fs.closeSync(fd); } catch {}
    }
    if (fs.existsSync(jobsTmpFile)) {
      try { fs.unlinkSync(jobsTmpFile); } catch {}
    }
  }
}

let lastGoodStore = { jobs: [] };

function loadJobs() {
  ensureJobsStoreReady();
  try {
    const parsed = JSON.parse(fs.readFileSync(jobsFile, "utf-8"));
    const normalized = { jobs: trimJobs(parsed?.jobs || []) };
    lastGoodStore = normalized;
    liveStore = normalized;
    if ((parsed?.jobs || []).length !== normalized.jobs.length) {
      atomicWriteJobs(normalized);
    }
    return normalized;
  } catch (err) {
    console.warn(`[JOBS] Failed to read ${jobsFile}. Attempting backup recovery.`, err?.message || err);
    try {
      if (fs.existsSync(jobsBakFile)) {
        const parsedBak = JSON.parse(fs.readFileSync(jobsBakFile, "utf-8"));
        const recovered = { jobs: trimJobs(parsedBak?.jobs || []) };
        lastGoodStore = recovered;
        liveStore = recovered;
        atomicWriteJobs(recovered);
        console.warn(`[JOBS] Recovered jobs store from backup ${jobsBakFile}`);
        return recovered;
      }
    } catch (bakErr) {
      console.warn(`[JOBS] Backup recovery failed.`, bakErr?.message || bakErr);
    }
    if (Array.isArray(lastGoodStore?.jobs)) {
      console.warn("[JOBS] Serving last good snapshot to avoid dropping jobs.");
      return { jobs: trimJobs(lastGoodStore.jobs) };
    }
    if (Array.isArray(liveStore?.jobs)) {
      console.warn("[JOBS] Serving live in-memory snapshot to avoid dropping jobs.");
      return { jobs: trimJobs(liveStore.jobs) };
    }
    try {
      if (fs.existsSync(jobsFile)) {
        const corruptPath = `${jobsFile}.corrupt-${Date.now()}`;
        fs.renameSync(jobsFile, corruptPath);
        console.warn(`[JOBS] Preserved corrupt jobs store at ${corruptPath}`);
      }
    } catch {}
    return { jobs: [] };
  }
}

function saveJobs(store) {
  const normalized = { jobs: trimJobs(store?.jobs || []) };
  atomicWriteJobs(normalized);
  lastGoodStore = normalized;
  liveStore = normalized;
}

let store = loadJobs();
console.log(`[JOBS] DATA_DIR=${DATA_DIR}`);
console.log(`[JOBS] OUTPUT_DIR=${OUTPUT_DIR}`);
console.log(`[JOBS] STORE_FILE=${jobsFile}`);

function updateJob(id, patch) {
  store = loadJobs(); // Reload to ensure freshness
  const j = store.jobs.find(x => x.id === id);
  if (!j) return null;
  Object.assign(j, patch);
  saveJobs(store);
  return j;
}

function safeUpdateJob(id, patch) {
  try {
    return updateJob(id, patch);
  } catch (err) {
    console.warn(`[JOBS] Failed to persist update for ${id}:`, err?.message || err);
    return null;
  }
}

function resolveAssetPath(pathOrId) {
  if (pathOrId == null) return null;
  const normalized = String(pathOrId).trim();
  if (!normalized) return null;
  const direct = resolveOutputAlias(normalized);
  if (String(direct).startsWith("http")) return direct;
  if (fs.existsSync(direct)) return direct;

  // Try to find in library
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

  return direct; // Return as is (might be external URL)
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
const lastProgressByJob = new Map();
const volatileProgressByJob = new Map();

function runFFmpeg(args, totalDurationSec, onProgress) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killFallbackTimer;

    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killFallbackTimer) clearTimeout(killFallbackTimer);
      if (err) return reject(err);
      resolve(true);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      const timeoutMsg = `ffmpeg timed out after ${JOB_EXEC_TIMEOUT_SEC}s`;
      stderr += `\n${timeoutMsg}`;
      try { proc.kill("SIGTERM"); } catch {}
      killFallbackTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
        done(new Error(`${timeoutMsg}\n${stderr.slice(-2000)}`));
      }, 5000);
      if (killFallbackTimer?.unref) killFallbackTimer.unref();
    }, JOB_EXEC_TIMEOUT_SEC * 1000);
    if (timeoutTimer?.unref) timeoutTimer.unref();

    proc.stderr.on("data", d => {
      const chunk = d.toString();
      stderr += chunk;
      if (stderr.length > 64_000) {
        stderr = stderr.slice(-64_000);
      }

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

    proc.on("error", (err) => {
      done(new Error(`ffmpeg spawn error: ${String(err?.message || err)}`));
    });

    proc.on("close", (code) => {
      if (timedOut) {
        return done(new Error(`ffmpeg timed out after ${JOB_EXEC_TIMEOUT_SEC}s\n${stderr.slice(-2000)}`));
      }
      if (code !== 0) return done(new Error(`ffmpeg failed: ${code}\n${stderr.slice(-2000)}`));
      done(null);
    });
  });
}

async function executeJob(job) {
  if (!ensureFfmpegAvailable()) {
    throw new Error("FFmpeg not available on server");
  }
  logMemory(`job:${job.type}:start`);
  if (job.type === "render_waveform") {
    const { backgroundPath, audioPath, lines, durationSec, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = job.payload || {};
    const resolvedBackground = resolveAssetPath(backgroundPath);
    const resolvedAudio = resolveAssetPath(audioPath);
    const resolvedMusic = resolveAssetPath(musicPath);

    if (!resolvedAudio || !isLocalOrRemote(resolvedAudio)) throw new Error(`audioPath missing or not found: ${audioPath || "<empty>"}`);
    if (resolvedBackground && !isLocalOrRemote(resolvedBackground)) throw new Error(`backgroundPath not found: ${backgroundPath}`);
    if (resolvedMusic && !isLocalOrRemote(resolvedMusic)) throw new Error(`musicPath not found: ${musicPath}`);
    if (isFileTooLarge(resolvedAudio)) throw new Error(`audioPath too large (>${MAX_INPUT_MB}MB)`);
    if (resolvedBackground && isFileTooLarge(resolvedBackground)) throw new Error(`backgroundPath too large (>${MAX_INPUT_MB}MB)`);
    if (resolvedMusic && isFileTooLarge(resolvedMusic)) throw new Error(`musicPath too large (>${MAX_INPUT_MB}MB)`);

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
    const t = clampDuration(durationSec || 20);
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
    try {
      await runFFmpeg(args, t, (p) => {
        const now = Date.now();
        const prev = lastProgressByJob.get(job.id);
        const changedEnough = !prev || p > prev.p;
        const intervalElapsed = !prev || now - prev.ts >= 1000;
        if (!changedEnough || !intervalElapsed) return;
        lastProgressByJob.set(job.id, { p, ts: now });
        volatileProgressByJob.set(job.id, p);
      });
      logMemory(`job:${job.type}:done`);
      if (global.gc) global.gc();
      volatileProgressByJob.set(job.id, 100);
      safeUpdateJob(job.id, { progress: 100 });
      return { outFile };
    } catch (e) {
      try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
      throw e;
    } finally {
      lastProgressByJob.delete(job.id);
      volatileProgressByJob.delete(job.id);
    }
  }

  if (job.type === "render_video") {
    const { backgroundPath, audioPath, lines, durationSec, aspect, captionWidthPct, musicPath, musicVolume, autoDuck } = job.payload || {};
    const resolvedBackground = resolveAssetPath(backgroundPath);
    const resolvedAudio = resolveAssetPath(audioPath);
    const resolvedMusic = resolveAssetPath(musicPath);

    if (!resolvedBackground || !isLocalOrRemote(resolvedBackground)) throw new Error(`backgroundPath missing or not found: ${backgroundPath || "<empty>"}`);
    if (resolvedAudio && !isLocalOrRemote(resolvedAudio)) throw new Error(`audioPath not found: ${audioPath}`);
    if (resolvedMusic && !isLocalOrRemote(resolvedMusic)) throw new Error(`musicPath not found: ${musicPath}`);
    if (isFileTooLarge(resolvedBackground)) throw new Error(`backgroundPath too large (>${MAX_INPUT_MB}MB)`);
    if (resolvedAudio && isFileTooLarge(resolvedAudio)) throw new Error(`audioPath too large (>${MAX_INPUT_MB}MB)`);
    if (resolvedMusic && isFileTooLarge(resolvedMusic)) throw new Error(`musicPath too large (>${MAX_INPUT_MB}MB)`);
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
    const t = clampDuration(durationSec || 20);

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

    try {
      await runFFmpeg(args, t, (p) => {
        const now = Date.now();
        const prev = lastProgressByJob.get(job.id);
        const changedEnough = !prev || p > prev.p;
        const intervalElapsed = !prev || now - prev.ts >= 1000;
        if (!changedEnough || !intervalElapsed) return;
        lastProgressByJob.set(job.id, { p, ts: now });
        volatileProgressByJob.set(job.id, p);
      });
      logMemory(`job:${job.type}:done`);
      if (global.gc) global.gc();
      volatileProgressByJob.set(job.id, 100);
      safeUpdateJob(job.id, { progress: 100 });
      return { outFile };
    } catch (e) {
      try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
      throw e;
    } finally {
      lastProgressByJob.delete(job.id);
      volatileProgressByJob.delete(job.id);
    }
  }

  throw new Error("Unknown job type");
}

function validatePayloadForEnqueue(type, payload) {
  if (type === "render_video") {
    const resolvedBackground = resolveAssetPath(payload?.backgroundPath);
    const resolvedAudio = resolveAssetPath(payload?.audioPath);
    const resolvedMusic = resolveAssetPath(payload?.musicPath);
    if (!resolvedBackground || !isLocalOrRemote(resolvedBackground)) {
      return { ok: false, error: `backgroundPath missing or not found: ${payload?.backgroundPath || "<empty>"}` };
    }
    if (payload?.audioPath && !isLocalOrRemote(resolvedAudio)) {
      return { ok: false, error: `audioPath not found: ${payload?.audioPath}` };
    }
    if (payload?.musicPath && !isLocalOrRemote(resolvedMusic)) {
      return { ok: false, error: `musicPath not found: ${payload?.musicPath}` };
    }
    const lines = Array.isArray(payload?.lines) ? payload.lines.map((x) => String(x).trim()).filter(Boolean) : [];
    if (lines.length === 0) return { ok: false, error: "lines[] required for render_video" };
    return { ok: true };
  }

  if (type === "render_waveform") {
    const resolvedAudio = resolveAssetPath(payload?.audioPath);
    const resolvedBackground = resolveAssetPath(payload?.backgroundPath);
    const resolvedMusic = resolveAssetPath(payload?.musicPath);
    if (!resolvedAudio || !isLocalOrRemote(resolvedAudio)) {
      return { ok: false, error: `audioPath missing or not found: ${payload?.audioPath || "<empty>"}` };
    }
    if (payload?.backgroundPath && !isLocalOrRemote(resolvedBackground)) {
      return { ok: false, error: `backgroundPath not found: ${payload?.backgroundPath}` };
    }
    if (payload?.musicPath && !isLocalOrRemote(resolvedMusic)) {
      return { ok: false, error: `musicPath not found: ${payload?.musicPath}` };
    }
    return { ok: true };
  }

  return { ok: false, error: `unsupported job type: ${type}` };
}

function recoverStaleRunningJobs() {
  const now = Date.now();
  const staleAfterMs = STALE_RUNNING_JOB_MINUTES * 60 * 1000;
  store = loadJobs();
  let changed = false;

  for (const job of store.jobs) {
    if (job?.status !== "running") continue;
    const refIso = job.startedAt || job.createdAt;
    const refTs = new Date(refIso || 0).getTime();
    if (!Number.isFinite(refTs)) continue;
    if (now - refTs < staleAfterMs) continue;

    const lastPct = Number.isFinite(job.progress) ? job.progress : 0;
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.progress = lastPct;
    job.error = `Recovered stale running job after ${STALE_RUNNING_JOB_MINUTES}m (worker restart or timeout).`;
    changed = true;
    console.warn(`[JOBS] Recovered stale running job ${job.id}`);
  }

  if (changed) saveJobs(store);
}

async function workerTick() {
  if (running) return;
  store = loadJobs();
  const next = store.jobs.find(j => j.status === "queued");
  if (!next) return;
  running = true;
  volatileProgressByJob.set(next.id, 0);
  safeUpdateJob(next.id, { status: "running", startedAt: new Date().toISOString(), progress: 0 });
  try {
    const result = await executeJob(next);
    volatileProgressByJob.set(next.id, 100);
    safeUpdateJob(next.id, { status: "done", progress: 100, finishedAt: new Date().toISOString(), result });
  } catch (e) {
    const lastPct = volatileProgressByJob.get(next.id);
    const failedPatch = {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: String(e?.message || e)
    };
    if (Number.isFinite(lastPct)) failedPatch.progress = lastPct;
    safeUpdateJob(next.id, failedPatch);
  } finally {
    lastProgressByJob.delete(next.id);
    volatileProgressByJob.delete(next.id);
    running = false;
  }
}

function withVolatileProgress(job) {
  if (!job || job.status !== "running") return job;
  const pct = volatileProgressByJob.get(job.id);
  if (!Number.isFinite(pct)) return job;
  return { ...job, progress: pct };
}

// poll worker every 1s
recoverStaleRunningJobs();
const _t = setInterval(workerTick, 1000);
_t.unref();

router.get("/", (req, res) => {
  store = loadJobs();
  const jobs = store.jobs.slice().reverse().slice(0, JOBS_RETENTION).map(withVolatileProgress);
  res.json({ ok: true, jobs });
});

router.get("/:id", (req, res) => {
  store = loadJobs();
  const j = store.jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, job: withVolatileProgress(j) });
});

router.post("/enqueue", (req, res) => {
  const type = String(req.body?.type || "").trim();
  const payload = req.body?.payload || {};
  if (!type) return res.status(400).json({ ok: false, error: "type required" });
  const validation = validatePayloadForEnqueue(type, payload);
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });

  const id = `job_${uuid()}`;
  const job = {
    id, type, payload,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  store = loadJobs();
  store.jobs.push(job);
  saveJobs(store);
  queueMicrotask(() => {
    workerTick().catch((err) => console.warn("[JOBS] workerTick enqueue trigger failed:", err?.message || err));
  });
  res.json({ ok: true, job });
});

export default router;
