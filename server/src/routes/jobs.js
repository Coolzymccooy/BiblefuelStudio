import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn, spawnSync } from "child_process";
import { readLibrary } from "../lib/library.js";
import { DATA_DIR, OUTPUT_DIR, resolveOutputAlias, isLocalOrRemote } from "../lib/mediaThumb.js";
import { generateScripts } from "../lib/generateScripts.js";
import { synthesizeTts } from "../lib/ttsOrchestrator.js";
import { synthesizeForCategory } from "../lib/voice/categorySynthesis.js";
import { resolveProfile, listCategories } from "../lib/voice/profiles.js";
import { dispatchPost } from "./social.js";
import { readSocialStore } from "../lib/socialStore.js";
import { isPostizConfigured, postVideo as postizPostVideo } from "../lib/postizClient.js";
import { pickBestBackground, classifyText } from "../lib/categorize.js";
import { charsToWords, captionWordsFromNativeWords, annotatePhrasedTiers, groupWordsByBeat } from "../lib/captions.js";
import { alignAudioWithText, isForcedAlignmentAvailable } from "../lib/voice/alignment.js";
import { buildWordDrawtext, buildLineDrawtext, buildSceneGraph, resolveKineticAnimation, resolveTypographyPreset, buildEndingFade } from "../lib/videoFilters.js";
import { buildSocialCaption } from "../lib/socialCaption.js";
import { pickScriptType } from "../lib/highPerformerProfile.js";
import { ensureLocalPath } from "../lib/remoteCache.js";
import { resolveAutoBackgrounds } from "../lib/autoBackground.js";
import { generateBibleImage } from "../lib/imageGen/index.js";
import { resolveLibraryTrack, defaultTrackRef } from "../lib/musicLibrary.js";
import { buildSpeakableLines, cleanCaptionLine, cleanSpeakableText, sanitizeScriptObject } from "../lib/speakableScript.js";

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

function probeAudioMaxVolume(filePath) {
  return new Promise((resolve) => {
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    // `volumedetect` writes its stats at log level info, so we must NOT
    // pass `-v error` here — that filters out exactly the lines we want.
    // We do silence the banner/stats lines to keep stderr small.
    const proc = spawn(ffmpeg, [
      "-hide_banner", "-nostats",
      "-i", filePath,
      "-af", "volumedetect",
      "-vn", "-f", "null", "-",
    ]);
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const m = err.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
      if (!m) return resolve(null);
      const v = parseFloat(m[1]);
      resolve(Number.isFinite(v) ? v : null);
    });
  });
}

function probeAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err.slice(-200) || code}`));
      const dur = parseFloat(out.trim());
      if (!Number.isFinite(dur) || dur <= 0) return reject(new Error(`ffprobe returned invalid duration: ${out.trim()}`));
      resolve(dur);
    });
  });
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

// Phase 1 multi-tenancy: the worker is serialized (workerTick runs one job
// at a time, awaited), so a module-level "current job ctx" is safe and avoids
// threading dataDir/outputDir through every render helper signature. Set by
// executeJob, reset in the finally block. See specs/2026-05-26-public-multitenancy-design.md.
let currentJobCtx = null;
function currentOutDir() { return currentJobCtx?.outputDir || OUTPUT_DIR; }
function currentDataDir() { return currentJobCtx?.dataDir || DATA_DIR; }

// Monotonic counter backing the script-type rotation. Persisted per-tenant so
// the rotation survives restarts — an in-memory counter would reset to the
// first bucket on every deploy, which is how the page ends up looking
// repetitive again. Failure to read or write is non-fatal: a bad counter must
// never stop a post from going out, so we fall back to a time-derived index.
function nextScriptTypeIndex() {
  const file = path.join(currentDataDir(), "script-rotation.json");
  try {
    let current = 0;
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Number.isFinite(Number(parsed?.index))) current = Number(parsed.index);
    }
    const next = current + 1;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ index: next }, null, 2));
    return current;
  } catch (e) {
    console.warn("[JOBS] script rotation counter unavailable, using time-derived index:", e?.message || e);
    return Math.floor(Date.now() / 60000);
  }
}
function currentIsSuperAdmin() { return Boolean(currentJobCtx?.isSuperAdmin); }

/**
 * Tier-aware "does this user have anywhere their video could go?" check.
 *
 * - Super-admin: env Zernio counts (their env IS the operator's env), plus
 *   any of their stored webhooks.
 * - Regular user: ONLY their own stored webhooks. Env Zernio is deliberately
 *   off-limits — falling back to it would post regular users' content to
 *   the operator's TikTok account, which is a multi-tenant safety bug.
 *
 * Returns { canAutoPublish, destinations: string[] } so callers can both
 * gate the dispatch and tell the UI which destinations are live.
 *
 * @param {{dataDir:string, isSuperAdmin?:boolean}} ctx
 * @returns {{ canAutoPublish: boolean, destinations: string[] }}
 */
function describeConfiguredDestinations(ctx) {
  const destinations = [];
  let store = { webhooks: [] };
  try { store = readSocialStore(ctx?.dataDir || DATA_DIR); } catch { /* missing file → empty */ }
  const enabledWebhooks = Array.isArray(store?.webhooks)
    ? store.webhooks.filter((w) => w?.enabled && String(w?.url || "").trim())
    : [];
  if (enabledWebhooks.length > 0) destinations.push("webhook");

  // YouTube — per-user OAuth refreshToken counts for everyone (super-admin
  // and regular user alike). Operator clientId/clientSecret comes from env;
  // each user gets their own refresh_token via the consent flow, posting
  // to THEIR channel. No cross-tenant risk like env Zernio.
  const ytRefresh = String(store?.direct?.youtube?.refreshToken || "").trim();
  if (ytRefresh) destinations.push("youtube");

  if (ctx?.isSuperAdmin) {
    const zernioOn = Boolean(
      String(process.env.ZERNIO_API_KEY || "").trim() &&
      String(process.env.ZERNIO_TIKTOK_ACCOUNT_ID || "").trim(),
    );
    if (zernioOn) destinations.push("zernio");
  }

  return { canAutoPublish: destinations.length > 0, destinations };
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
  const libTrack = resolveLibraryTrack(normalized);
  if (libTrack) return libTrack;
  const direct = resolveOutputAlias(normalized);
  if (String(direct).startsWith("http")) return direct;
  if (fs.existsSync(direct)) return direct;

  // Try to find in library
  const lib = readLibrary(currentDataDir());
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

// Extract the actually useful part of ffmpeg's stderr after a failure. The
// banner (version + library versions + config) eats the first ~30 lines and
// pushed the real error out of any small UI clamp. Walk backwards looking
// for known-error patterns; fall back to the last 8 lines.
function summarizeFfmpegError(stderr) {
  if (!stderr) return "(ffmpeg produced no stderr output)";
  const all = stderr.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  if (all.length === 0) return "(empty stderr)";
  // drawtext prints `[Parsed_drawtext_N @ addr] Using "<font>"` ONCE PER WORD
  // during filtergraph init — pure info that floods the tail and used to mask
  // the real error (the bottom-up scan would return the last font line). Drop
  // that noise (plus progress/banner lines) before scanning for the real error.
  const noiseRx = /\] Using ['"]|^frame=|^size=|^\s*(Stream mapping|Stream #|Input #|Output #|Duration:|Metadata:|encoder\s|configuration:|built with|Press \[q\]|lib[a-z]+\s+\d)/i;
  const lines = all.filter((l) => !noiseRx.test(l));
  const scan = lines.length ? lines : all;
  const errorRx = [
    /\bError\b/i,
    /Conversion failed/i,
    /Invalid argument/i,
    /No such filter/i,
    /Cannot find/i,
    /Unable to/i,
    /Could not/i,
    /does not contain any stream/i,
    /unconnected output/i,
    /matches no streams/i,
    // A `[Parsed_*]` filter line that is NOT a benign font-load (those were
    // already stripped above) — e.g. "[Parsed_drawtext_3] Cannot load font".
    /\[Parsed_/,
  ];
  for (let i = scan.length - 1; i >= 0; i--) {
    if (errorRx.some((rx) => rx.test(scan[i]))) {
      // Include a few surrounding lines for context.
      return scan.slice(Math.max(0, i - 2), Math.min(scan.length, i + 3)).join("\n");
    }
  }
  return scan.slice(-8).join("\n");
}

function runFFmpeg(args, totalDurationSec, onProgress) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  // Prepend -hide_banner so the version dump doesn't crowd out the real
  // error message in the captured stderr. We still need info-level output
  // so the progress parser (matching `time=HH:MM:SS.xx`) can read the
  // running encoder stats — so we don't touch -loglevel.
  const fullArgs = args.includes("-hide_banner") ? args : ["-hide_banner", ...args];
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, fullArgs);
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
        return done(new Error(`ffmpeg timed out after ${JOB_EXEC_TIMEOUT_SEC}s\n${summarizeFfmpegError(stderr)}`));
      }
      if (code !== 0) return done(new Error(`ffmpeg failed: ${code}\n${summarizeFfmpegError(stderr)}`));
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

    const rawLines = Array.isArray(lines) ? lines.map(s => cleanCaptionLine(String(s).slice(0, 140))).filter(Boolean) : [];
    const { w, h } = getDims(aspect);
    const widthPct = Math.min(100, Math.max(60, Number(captionWidthPct || 90)));
    const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
    const maxChars = Math.max(18, Math.floor(baseChars * (widthPct / 100)));
    const safeLines = wrapTextLines(rawLines, maxChars, 6);
    const outFile = path.join(currentOutDir(), `waveform-${uuid()}.mp4`);

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
        // Voice feeds both the sidechain key and the mix — split it (a label
        // can feed only one pad; reusing [a1] broke stricter ffmpeg builds with
        // "Stream specifier 'a1' in filtergraph …").
        filterComplexParts.push(`[a1]asplit=2[voice1][voice2]`);
        filterComplexParts.push(`[m1][voice1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked]`);
        filterComplexParts.push(`[voice2][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[amix]`);
      } else {
        filterComplexParts.push(`[a1][m1]amix=inputs=2:duration=shortest:dropout_transition=2[amix]`);
      }
      // Split the mixed audio so the showwaves filter can consume one copy
      // while the muxer keeps the other for output. Without this both the
      // visualizer AND `-map [amix]` try to claim the same label and ffmpeg
      // dies before the first frame.
      filterComplexParts.push(`[amix]asplit=2[awave][aout]`);
      audioLabel = "awave";
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
      "-map", resolvedMusic ? "[aout]" : `${resolvedBackground ? 1 : 0}:a`,
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
    return await renderVideoCore(job.payload || {}, job.id);
  }

  if (job.type === "campaign_auto_post") {
    return await runCampaignAutoPost(job.payload || {}, job.id);
  }

  throw new Error("Unknown job type");
}

// Auto background: when a render_video payload opts in (`autoBackground: true`)
// and supplies no explicit scenes/background, choose one mood-matched clip per
// overlay line from the user's own library — falling back to AI generation when
// their pool is empty. Returns a payload with `scenes[]` populated so the normal
// scene-splitter pipeline takes over. Throws (failing the job) with guidance
// when nothing can be sourced. Pure selection logic lives in lib/autoBackground.
async function applyAutoBackground(payload) {
  const lib = readLibrary(currentDataDir());
  const pool = Array.isArray(lib?.items) ? lib.items : [];
  const lines = Array.isArray(payload?.lines) ? payload.lines.filter(Boolean) : [];
  const total = clampDuration(payload?.durationSec || 20);
  const aspect = String(payload?.aspect || "portrait");

  const auto = await resolveAutoBackgrounds({
    pool,
    beats: lines,
    text: lines.join(" "),
    maxBackgrounds: 4,
    generateImage: (genArgs) =>
      generateBibleImage({
        seriesId: `auto-${currentJobCtx?.userId || "anon"}`,
        partNumber: 1,
        aspect,
        ...genArgs,
      }),
  });

  if (auto.backgroundIds.length === 0) {
    throw new Error(auto.error || "Could not auto-select a background");
  }

  const n = auto.backgroundIds.length;
  const perSlot = Math.max(0.5, total / n);
  const scenes = auto.backgroundIds.map((id) => ({ backgroundPath: id, duration: perSlot }));
  // Clear the flag so the scene pipeline doesn't loop back here.
  return { ...payload, scenes, autoBackground: false, autoBackgroundSource: auto.source };
}

// Core renderer extracted so both render_video jobs and campaign_auto_post
// can produce a video without spinning up a sub-job (worker concurrency = 1).
// When payload.words[] or payload.scenes[] is present, routes through the
// new word-level / scene-splitter pipeline. Otherwise uses the legacy
// single-background + line-captions path.
async function renderVideoCore(payload, jobId) {
  // Resolve auto backgrounds into scenes up front so the rest of the pipeline
  // treats them exactly like client-supplied scenes.
  const noExplicitBg =
    !(Array.isArray(payload?.scenes) && payload.scenes.length > 0) && !payload?.backgroundPath;
  if (payload?.autoBackground && noExplicitBg) {
    payload = await applyAutoBackground(payload);
  }
  const hasWords = Array.isArray(payload?.words) && payload.words.length > 0;
  const hasScenes = Array.isArray(payload?.scenes) && payload.scenes.length > 0;
  if (hasWords || hasScenes) {
    // Kinetic (word-by-word) captions need word timings. The scene/multi-bg
    // path used to jump straight to renderAdvancedVideo and SKIP the
    // augmentation below, so generative-image / multi-background renders always
    // came out with STATIC captions (Bug: "static text in the background").
    // Generate timings here first when kinetic is requested but words aren't
    // present yet; augment falls back to static (and stamps a warning on the
    // job) if alignment is unavailable.
    if (payload?.kineticCaptions && !hasWords) {
      payload = await augmentPayloadWithKineticCaptions(payload, jobId);
    }
    return await renderAdvancedVideo(payload, jobId);
  }
  if (payload?.kineticCaptions) {
    const augmented = await augmentPayloadWithKineticCaptions(payload, jobId);
    // If the augment produced word-level timings, take the advanced path.
    // If it stripped kineticCaptions (alignment unavailable/failed), recurse
    // back through renderVideoCore so the LEGACY path picks it up — that's
    // the one that calls wrapTextLines() on the captions. Without this,
    // raw long lines flow straight into buildLineDrawtext and render off
    // the side of the frame (the "od's plan is better than your plan"
    // clipping that comes from x=(w-text_w)/2 going negative).
    const augmentedHasWords = Array.isArray(augmented?.words) && augmented.words.length > 0;
    if (augmentedHasWords) {
      return await renderAdvancedVideo(augmented, jobId);
    }
    return await renderVideoCore({ ...augmented, kineticCaptions: false }, jobId);
  }
  const { backgroundPath, audioPath, lines, durationSec, aspect, captionWidthPct, musicPath, musicVolume, autoDuck, typographyPreset } = payload || {};
  let resolvedBackground = resolveAssetPath(backgroundPath);
  const resolvedAudio = resolveAssetPath(audioPath);
  const resolvedMusic = resolveAssetPath(musicPath);

  if (!resolvedBackground || !isLocalOrRemote(resolvedBackground)) throw new Error(`backgroundPath missing or not found: ${backgroundPath || "<empty>"}`);
  if (resolvedAudio && !isLocalOrRemote(resolvedAudio)) throw new Error(`audioPath not found: ${audioPath}`);
  if (resolvedMusic && !isLocalOrRemote(resolvedMusic)) throw new Error(`musicPath not found: ${musicPath}`);
  if (isFileTooLarge(resolvedBackground)) throw new Error(`backgroundPath too large (>${MAX_INPUT_MB}MB)`);
  if (resolvedAudio && isFileTooLarge(resolvedAudio)) throw new Error(`audioPath too large (>${MAX_INPUT_MB}MB)`);
  if (resolvedMusic && isFileTooLarge(resolvedMusic)) throw new Error(`musicPath too large (>${MAX_INPUT_MB}MB)`);
  // Cache remote bg locally — see ensureLocalPath rationale (Pexels CDN
  // resets connections under `-stream_loop -1`, which the legacy single-bg
  // ffmpeg invocation also uses below).
  if (/^https?:\/\//i.test(resolvedBackground)) {
    try {
      resolvedBackground = await ensureLocalPath(resolvedBackground);
    } catch (err) {
      throw new Error(`background download failed: ${err?.message || err}`);
    }
  }
  const rawLines = Array.isArray(lines) ? lines.map(s => cleanCaptionLine(String(s).slice(0, 140))).filter(Boolean) : [];
  const { w, h } = getDims(aspect);
  const widthPct = Math.min(100, Math.max(60, Number(captionWidthPct || 90)));
  const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
  const maxChars = Math.max(18, Math.floor(baseChars * (widthPct / 100)));
  // Cap raised from 6 → 12 so longer verses (e.g. a Psalm 23 part) don't
  // get cut mid-sentence when this fallback path is taken. The kinetic
  // renderer is now the default for series + auto-publish, but if it
  // can't get alignment we shouldn't silently truncate.
  const safeLines = wrapTextLines(rawLines, maxChars, 12);
  if (safeLines.length === 0) throw new Error("lines[] required");

  const outFile = path.join(currentOutDir(), `video-${uuid()}.mp4`);

  // Honour the audio's full length when it's longer than the requested
  // durationSec — otherwise -shortest truncates the narration mid-sentence.
  // Padding is harmless; truncation is the bug we're fixing.
  let t = clampDuration(durationSec || 20);
  if (resolvedAudio) {
    try {
      const audioDur = await probeAudioDuration(resolvedAudio);
      if (Number.isFinite(audioDur) && audioDur > t) {
        t = clampDuration(Math.ceil(audioDur) + 1);
      }
    } catch {
      // probe failure isn't fatal; fall back to requested duration.
    }
  }

  // Pace the lines across the real video length. `t` is resolved above (not
  // below, where it used to live) precisely because the caption filter needs
  // it: without a duration every line draws for the whole video and the
  // entire script stacks on screen at once.
  // Same rule as the advanced path: a line-mode preset renders paced blocks,
  // wrapping the raw lines itself so type can be large.
  const legacyWantsBlocks = resolveTypographyPreset(typographyPreset)?.captionMode === "lines";
  const filters = legacyWantsBlocks
    ? buildLineDrawtext({ lines: rawLines, w, h, preset: typographyPreset, duration: t, block: true })
    : buildLineDrawtext({ lines: safeLines, w, h, preset: typographyPreset, duration: t });
  if (!filters) throw new Error("lines[] required");

  const args = ["-y", "-stream_loop", "-1", "-i", resolvedBackground];
  if (resolvedAudio) args.push("-i", resolvedAudio);
  if (resolvedMusic) args.push("-i", resolvedMusic);

  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${filters}`;
  const preset = process.env.FFMPEG_PRESET || "fast";
  const hwaccel = process.env.FFMPEG_HWACCEL;
  const vcodec = hwaccel === 'nvenc' ? 'h264_nvenc' : hwaccel === 'qsv' ? 'h264_qsv' : 'libx264';
  const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
  const duck = Boolean(autoDuck) && Boolean(resolvedMusic) && Boolean(resolvedAudio);

  if (resolvedMusic) {
    const aIndex = resolvedAudio ? 1 : null;
    const mIndex = resolvedAudio ? 2 : 1;
    const vFilter = `[0:v]${vf}[vout]`;
    const aFilter = resolvedAudio
      ? duck
        ? `[${aIndex}:a]volume=1.0,asplit=2[voice1][voice2];[${mIndex}:a]volume=${musicVol}[m1];[m1][voice1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];[voice2][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
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
      "-movflags", "+faststart",
      "-shortest"
    );
  } else {
    args.push("-t", String(t), "-vf", vf, "-r", "30", "-c:v", vcodec, "-preset", preset, "-crf", "22", "-pix_fmt", "yuv420p");
    if (resolvedAudio) {
      // Explicit -map so ffmpeg doesn't auto-pick the background clip's audio
      // track over our narration. Pexels b-roll commonly ships with a silent
      // stereo AAC track; default auto-mapping prefers stereo over the
      // Edge-TTS mono MP3 and the final render ends up dead silent.
      // Drop the background's audio explicitly and route only the TTS file in.
      args.push("-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest");
    } else {
      args.push("-an", "-movflags", "+faststart");
    }
  }
  args.push(outFile);

  try {
    await runFFmpeg(args, t, (p) => {
      const now = Date.now();
      const prev = lastProgressByJob.get(jobId);
      const changedEnough = !prev || p > prev.p;
      const intervalElapsed = !prev || now - prev.ts >= 1000;
      if (!changedEnough || !intervalElapsed) return;
      lastProgressByJob.set(jobId, { p, ts: now });
      volatileProgressByJob.set(jobId, p);
    });
    logMemory(`job:render_video:done`);
    if (global.gc) global.gc();
    volatileProgressByJob.set(jobId, 100);
    safeUpdateJob(jobId, { progress: 100 });
    return { outFile };
  } catch (e) {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
    throw e;
  } finally {
    lastProgressByJob.delete(jobId);
    volatileProgressByJob.delete(jobId);
  }
}

// Generate word-level captions for kinetic rendering.
//
// Two paths:
//   1) Caller already supplied `audioPath` — they generated audio with their
//      preferred provider (Chatterbox/ElevenLabs) and probably ran it through
//      Process Audio. We MUST keep their file. Use Whisper forced alignment
//      against it to extract word timings.
//   2) No audioPath — synthesize fresh TTS with timestamps and use the
//      provider's alignment (ElevenLabs has it natively; Edge-TTS does not,
//      so kinetic will gracefully fall back to line captions).
//
// In both paths, if we can't get word-level alignment we strip
// `kineticCaptions` and let renderVideoCore fall through to the legacy line
// renderer — WITHOUT discarding the user's audio. The previous behaviour
// (always re-synthesize, then overwrite audioPath) silently replaced
// hand-tuned Chatterbox audio with whatever Edge-TTS produced.
async function augmentPayloadWithKineticCaptions(payload, jobId) {
  const rawLines = Array.isArray(payload?.lines) ? payload.lines.map((s) => cleanCaptionLine(String(s).slice(0, 280))).filter(Boolean) : [];
  const cleanLines = rawLines.map((s) => s.trim()).filter(Boolean);
  if (cleanLines.length === 0) throw new Error("kineticCaptions: lines[] required");
  const ttsText = cleanLines.join(" ").trim();

  const userSuppliedAudio = resolveAssetPath(payload?.audioPath);
  console.log(
    `[RENDER] kineticCaptions: audioPath=${payload?.audioPath ? "supplied" : "none"} ` +
    `resolved=${userSuppliedAudio ? "ok" : "missing"} ` +
    `alignmentAvailable=${isForcedAlignmentAvailable()}`,
  );
  if (userSuppliedAudio && isLocalOrRemote(userSuppliedAudio)) {
    if (!isForcedAlignmentAvailable()) {
      console.warn(
        "[RENDER] kineticCaptions requested with user audio but OPENAI_API_KEY missing — " +
        "falling back to line captions on the user's audio (no resynth)",
      );
      safeUpdateJob(jobId, { captionFallback: "Word-by-word captions need an ElevenLabs voice, or OPENAI_API_KEY set on the server for this voice. Rendered static captions this time." });
      return { ...payload, kineticCaptions: false };
    }
    safeUpdateJob(jobId, { progress: 25 });
    const alignStart = Date.now();
    const alignment = await alignAudioWithText(userSuppliedAudio, ttsText);
    const alignMs = Date.now() - alignStart;
    safeUpdateJob(jobId, { progress: 45 });
    if (!alignment || !Array.isArray(alignment.characters) || alignment.characters.length === 0) {
      console.warn(
        `[RENDER] Whisper alignment failed after ${alignMs}ms — check earlier ` +
        `"[alignment] whisper error <code>" log. Falling back to line captions ` +
        `(audio preserved).`,
      );
      safeUpdateJob(jobId, { captionFallback: "Couldn't align words to your audio for kinetic captions — rendered static captions this time." });
      return { ...payload, kineticCaptions: false };
    }
    console.log(`[RENDER] Whisper alignment succeeded in ${alignMs}ms — ${alignment.characters.length} chars`);
    const rawWords = charsToWords(alignment);
    // Chunk into micro-phrases and assign 3-tier emphasis (one hero per phrase).
  // cleanLines no longer drives emphasis — phrase boundaries do.
  const words = annotatePhrasedTiers(rawWords);
    return { ...payload, words };
  }

  // Caller didn't provide audio — synthesize fresh with timestamps.
  const tts = await synthesizeTts({ text: cleanSpeakableText(ttsText), voiceId: payload?.voiceId, withTimestamps: true });
  safeUpdateJob(jobId, { progress: 35 });
  // Prefer the provider's native word boundaries (Azure — the kinetic-caption
  // primary, registered word-timestamp provider). Fall back to char-level
  // alignment (ElevenLabs). Edge/Chatterbox supply neither, so kinetic
  // gracefully degrades to line captions.
  let rawWords = [];
  if (Array.isArray(tts?.words) && tts.words.length > 0) {
    rawWords = captionWordsFromNativeWords(tts.words);
  } else if (tts?.alignment && Array.isArray(tts.alignment.characters) && tts.alignment.characters.length > 0) {
    rawWords = charsToWords(tts.alignment);
  }
  if (rawWords.length === 0) {
    console.warn("[RENDER] kineticCaptions: TTS returned no word timings — falling back to line captions");
    safeUpdateJob(jobId, { captionFallback: "This voice doesn't provide word timings for kinetic captions — rendered static. Use an ElevenLabs or Azure voice for word-by-word." });
    return { ...payload, kineticCaptions: false, audioPath: tts.file };
  }
  // Chunk into micro-phrases and assign 3-tier emphasis (one hero per phrase).
  // cleanLines no longer drives emphasis — phrase boundaries do.
  const words = annotatePhrasedTiers(rawWords);
  return { ...payload, audioPath: tts.file, words };
}

// Advanced renderer used when the caller provides word-level captions
// (`words: [{text,start,end,emphasize?}]`) and/or a scene split
// (`scenes: [{ backgroundPath, duration }]`). Both inputs are optional —
// `words` without `scenes` falls back to a single background, and `scenes`
// without `words` falls back to legacy line captions.
async function renderAdvancedVideo(payload, jobId) {
  const {
    audioPath,
    musicPath,
    musicVolume,
    autoDuck,
    aspect,
    durationSec,
    lines,
    words,
    scenes,
    backgroundPath,
    typographyPreset,
    layout,
    depth,
  } = payload || {};
  const resolvedAudio = resolveAssetPath(audioPath);
  const resolvedMusic = resolveAssetPath(musicPath);

  if (resolvedAudio && !isLocalOrRemote(resolvedAudio)) throw new Error(`audioPath not found: ${audioPath}`);
  if (resolvedMusic && !isLocalOrRemote(resolvedMusic)) throw new Error(`musicPath not found: ${musicPath}`);
  if (resolvedAudio && isFileTooLarge(resolvedAudio)) throw new Error(`audioPath too large (>${MAX_INPUT_MB}MB)`);
  if (resolvedMusic && isFileTooLarge(resolvedMusic)) throw new Error(`musicPath too large (>${MAX_INPUT_MB}MB)`);

  // Probe audio length so the output video spans the full TTS audio — never
  // cuts off mid-sentence (the previous bug) and never trails silence past
  // the last word. When audio is absent we fall back to the user's
  // durationSec.
  let audioDur = null;
  if (resolvedAudio) {
    try {
      audioDur = await probeAudioDuration(resolvedAudio);
    } catch (err) {
      console.warn(`[RENDER] probe audio duration failed (${err?.message || err}); using durationSec fallback`);
    }
  }

  const sceneList = Array.isArray(scenes) && scenes.length > 0
    ? scenes
    : [{ backgroundPath, duration: audioDur ?? clampDuration(durationSec || 20) }];

  const resolvedScenes = sceneList.map((s, i) => {
    const resolved = resolveAssetPath(s?.backgroundPath);
    if (!resolved || !isLocalOrRemote(resolved)) throw new Error(`scene[${i}] backgroundPath missing or not found: ${s?.backgroundPath || "<empty>"}`);
    if (isFileTooLarge(resolved)) throw new Error(`scene[${i}] backgroundPath too large (>${MAX_INPUT_MB}MB)`);
    // `kind` distinguishes still images (generated artwork) from video clips
    // (Pexels library). Image scenes need `-loop 1` instead of
    // `-stream_loop -1` on the ffmpeg input. Default to caller's hint, fall
    // back to extension sniffing so payloads from old clients still work.
    const explicit = String(s?.kind || "").toLowerCase();
    const ext = String(resolved || "").toLowerCase().split(".").pop();
    const sniffed = ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) ? "image" : "video";
    const kind = explicit === "image" || explicit === "video" ? explicit : sniffed;
    return { backgroundPath: resolved, duration: Math.max(0.5, Number(s?.duration) || 0), kind };
  });

  // Materialize any remote (http(s)) backgrounds to local cache files BEFORE
  // ffmpeg sees them. Streaming Pexels CDN directly is flaky on Windows —
  // WSAECONNRESET (-10054) tears down the input mid-render, especially under
  // -stream_loop -1 where every wraparound re-fetches the file. Local copies
  // are bulletproof; subsequent renders re-use the cache for free.
  for (const s of resolvedScenes) {
    if (/^https?:\/\//i.test(s.backgroundPath)) {
      try {
        s.backgroundPath = await ensureLocalPath(s.backgroundPath);
      } catch (err) {
        throw new Error(`scene background download failed: ${err?.message || err}`);
      }
    }
  }

  // Final safety: if the audio is longer than what the scene graph emits
  // (after the xfade overlap math), grow the last scene so -shortest doesn't
  // truncate the audio.
  const XFADE = 0.5;
  if (audioDur != null && audioDur > 0 && resolvedScenes.length > 0) {
    const sceneN = resolvedScenes.length;
    const currentOutputDur = resolvedScenes.reduce((s, sc) => s + sc.duration, 0) - (sceneN - 1) * XFADE;
    const shortfall = audioDur - currentOutputDur;
    if (shortfall > 0.05) {
      resolvedScenes[sceneN - 1].duration += shortfall + 0.1;
    }
  }

  const { w, h } = getDims(aspect);
  const graph = buildSceneGraph({ scenes: resolvedScenes, w, h, kenBurns: payload?.kenBurns === true });
  const totalDuration = Math.min(
    MAX_RENDER_SECONDS,
    audioDur != null ? audioDur : Math.max(1, Number(durationSec) || graph.totalDuration),
  );

  // Map a kinetic-animation id (lumina catalog) to its concrete preset. Non-
  // renderable picks degrade to their fallback presetId; existing preset and
  // category names pass through unchanged.
  const resolvedPreset = resolveKineticAnimation(typographyPreset)?.presetId || typographyPreset;
  // Line captions (no kinetic) need their lines wrapped to fit the canvas
  // width — without this, drawtext's `x=(w-text_w)/2` goes negative and the
  // line scrolls off both edges (the "lready ... gave you. Take 10 secon..."
  // clipping seen on multi-bg renders). The legacy renderVideoCore path
  // already wraps; this advanced path was passing lines through raw.
  const captionWidthPct = Math.min(100, Math.max(60, Number(payload?.captionWidthPct || 90)));
  const baseChars = w >= 1800 ? 42 : w >= 1200 ? 34 : 28;
  const maxChars = Math.max(18, Math.floor(baseChars * (captionWidthPct / 100)));
  const wrappedLines = Array.isArray(lines)
    ? wrapTextLines(lines.map((s) => cleanCaptionLine(String(s).slice(0, 140))).filter(Boolean), maxChars, 12)
    : [];
  // The preset decides word-vs-line. Marker / Soft Glow / Headline are paced
  // LINE styles: before this, kinetic captions forced word mode for every
  // style, so picking one of them changed the look but still rendered one
  // word at a time - not what those styles are. Every other preset keeps
  // word-by-word, so this adds a mode rather than replacing one.
  const wantsLines = resolveTypographyPreset(resolvedPreset)?.captionMode === "lines";
  const hasWordTimings = Array.isArray(words) && words.length > 0;
  // Block mode wraps the ORIGINAL lines itself (to ~16 chars, so type can be
  // large); handing it the pre-wrapped copy would double-wrap.
  const rawCaptionLines = Array.isArray(lines)
    ? lines.map((s) => cleanCaptionLine(String(s).slice(0, 280))).filter(Boolean)
    : [];
  const drawtextChain = hasWordTimings && !wantsLines
    ? buildWordDrawtext({ words, w, h, preset: resolvedPreset, layout, depth })
    : wantsLines
      ? buildLineDrawtext({ lines: rawCaptionLines, w, h, preset: resolvedPreset, duration: totalDuration, block: true })
      : buildLineDrawtext({ lines: wrappedLines, w, h, preset: resolvedPreset, duration: totalDuration });

  const filterParts = graph.filterParts.slice();
  let videoLabel = graph.videoLabel;
  if (drawtextChain) {
    filterParts.push(`[${videoLabel}]${drawtextChain}[vout]`);
    videoLabel = "vout";
  }

  const sceneCount = resolvedScenes.length;
  const args = ["-y"];
  // Remote URLs (Pexels CDN, generated artwork hosts) drop intermittently —
  // the default ffmpeg HTTP demuxer just dies with WSAECONNRESET (-10054 on
  // Windows). Push reconnect flags BEFORE each remote `-i` so ffmpeg
  // re-establishes the connection and resumes at the last byte offset.
  // `-reconnect_streamed 1` is needed for non-seekable streams; the delay
  // cap prevents hammering when the source is genuinely down.
  const httpReconnect = (p) => (String(p || "").startsWith("http")
    ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
    : []);
  for (const s of resolvedScenes) {
    args.push(...httpReconnect(s.backgroundPath));
    // `-loop 1` is image-only (ffmpeg loops a still demuxer); `-stream_loop -1`
    // is the video equivalent. Mixing them up errors out (`-loop` on a video
    // ignores; `-stream_loop` on an image errors). Sniff via the `kind`
    // populated above.
    if (s.kind === "image") {
      args.push("-loop", "1", "-i", s.backgroundPath);
    } else {
      args.push("-stream_loop", "-1", "-i", s.backgroundPath);
    }
  }
  let audioInputIdx = null;
  let musicInputIdx = null;
  if (resolvedAudio) {
    audioInputIdx = sceneCount + 0;
    args.push(...httpReconnect(resolvedAudio), "-i", resolvedAudio);
  }
  if (resolvedMusic) {
    musicInputIdx = (resolvedAudio ? sceneCount + 1 : sceneCount);
    args.push(...httpReconnect(resolvedMusic), "-i", resolvedMusic);
  }

  const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
  const duck = Boolean(autoDuck) && resolvedAudio != null && resolvedMusic != null;
  let audioMapTarget = null;
  if (resolvedAudio && resolvedMusic) {
    if (duck) {
      // Voice feeds BOTH the sidechain key AND the final mix. A label can be
      // consumed by only one pad, so split it — reusing [a1] made stricter
      // ffmpeg builds fail with "Stream specifier 'a1' in filtergraph …".
      filterParts.push(`[${audioInputIdx}:a]volume=1.0,asplit=2[voice1][voice2]`);
      filterParts.push(`[${musicInputIdx}:a]volume=${musicVol}[m1]`);
      filterParts.push(`[m1][voice1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked]`);
      filterParts.push(`[voice2][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`);
    } else {
      filterParts.push(`[${audioInputIdx}:a]volume=1.0[a1]`);
      filterParts.push(`[${musicInputIdx}:a]volume=${musicVol}[a2]`);
      filterParts.push(`[a1][a2]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`);
    }
    audioMapTarget = "[aout]";
  } else if (resolvedAudio) {
    audioMapTarget = `${audioInputIdx}:a`;
  } else if (resolvedMusic) {
    filterParts.push(`[${musicInputIdx}:a]volume=${musicVol}[aout]`);
    audioMapTarget = "[aout]";
  }

  // Smart ending: fade the picture to black and the mixed audio out at the very
  // end so the render finishes cleanly instead of cutting off sharp with the
  // narration. Fades clamp to half the clip for short videos.
  const { aFade, vFade, aStart, vStart } = buildEndingFade({ totalDuration });
  if (vFade > 0) {
    filterParts.push(`[${videoLabel}]fade=t=out:st=${vStart.toFixed(3)}:d=${vFade.toFixed(3)}[vend]`);
    videoLabel = "vend";
  }
  if (aFade > 0 && audioMapTarget) {
    // audioMapTarget is either a graph label "[aout]" or a raw input pad
    // "idx:a" (voice-only, no music) — bracket the latter for the filter input.
    const aIn = audioMapTarget.startsWith("[") ? audioMapTarget : `[${audioMapTarget}]`;
    filterParts.push(`${aIn}afade=t=out:st=${aStart.toFixed(3)}:d=${aFade.toFixed(3)}[aend]`);
    audioMapTarget = "[aend]";
  }

  const filterComplex = filterParts.join(";");
  const preset = process.env.FFMPEG_PRESET || "fast";
  const hwaccel = process.env.FFMPEG_HWACCEL;
  const vcodec = hwaccel === "nvenc" ? "h264_nvenc" : hwaccel === "qsv" ? "h264_qsv" : "libx264";

  // Word-level captions + scene splits produce a filter graph that can easily
  // exceed Windows' ~32KB command-line limit (spawn ENAMETOOLONG). Write the
  // graph to a temp file and pass it via -filter_complex_script — same syntax,
  // no length cap.
  const outFile = path.join(currentOutDir(), `video-${uuid()}.mp4`);
  const filterScriptFile = path.join(currentOutDir(), `filter-${path.basename(outFile, ".mp4")}.txt`);
  fs.writeFileSync(filterScriptFile, filterComplex, "utf-8");

  args.push(
    "-t", String(totalDuration),
    "-filter_complex_script", filterScriptFile,
    "-map", `[${videoLabel}]`,
  );
  if (audioMapTarget) args.push("-map", audioMapTarget);
  args.push(
    "-r", "30",
    "-c:v", vcodec,
    "-preset", preset,
    "-crf", "22",
    "-pix_fmt", "yuv420p",
  );
  if (audioMapTarget) {
    args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart", outFile);

  const cleanupFilterScript = () => {
    try { if (fs.existsSync(filterScriptFile)) fs.unlinkSync(filterScriptFile); } catch {}
  };

  try {
    await runFFmpeg(args, totalDuration, (p) => {
      const now = Date.now();
      const prev = lastProgressByJob.get(jobId);
      const changedEnough = !prev || p > prev.p;
      const intervalElapsed = !prev || now - prev.ts >= 1000;
      if (!changedEnough || !intervalElapsed) return;
      lastProgressByJob.set(jobId, { p, ts: now });
      volatileProgressByJob.set(jobId, p);
    });
    logMemory(`job:render_video_advanced:done scenes=${sceneCount} words=${Array.isArray(words) ? words.length : 0}`);
    if (global.gc) global.gc();
    volatileProgressByJob.set(jobId, 100);
    safeUpdateJob(jobId, { progress: 100 });
    cleanupFilterScript();
    return { outFile };
  } catch (e) {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
    cleanupFilterScript();
    throw e;
  } finally {
    lastProgressByJob.delete(jobId);
    volatileProgressByJob.delete(jobId);
  }
}

// Orchestrates the full content-creation pipeline in one job:
// generate script -> pick library bg -> generate Edge-TTS -> render video ->
// fire Make webhook (or other destination) so TikTok/YouTube auto-publishes.
async function runCampaignAutoPost(payload, jobId) {
  const {
    aspect = "portrait",
    durationSec = 20,
    captionWidthPct = 90,
    voiceId,
    backgroundQuery,
    niche,
    tone,
    ctaStyle = "save",
    lengthSeconds = 20,
    includeVerseReference = true,
    destination = "webhook",
    webhookId,
    webhookUrl,
    profileIds,
    privacyStatus = "private",
    title,
    // Series Mode hooks: when present, skip AI script generation and use
    // the authoritative verse-based script the series builder produced.
    prebuiltScript,
    captionOverride,
    series,
    // Optional pre-generated AI artwork (Cloudflare Workers AI / Imagen).
    // When supplied it becomes the hook-beat scene; subsequent scenes still
    // come from the Pexels library so the overall video stays varied.
    generatedImage,
    // Voice Synthesis settings — when narrationCategory is provided we route
    // through synthesizeForCategory so profile defaults (voice settings,
    // prosody, forced-alignment fallback) and the recommended typography
    // preset all apply automatically. Without it we keep the legacy path.
    narrationCategory,
    preferredProvider,
    forcedAlignmentFallback,
    typographyPreset: typographyPresetOverride,
  } = payload || {};

  // Series + Auto-Publish auto-apply the default gospel bed when none chosen.
  payload = {
    ...payload,
    musicPath: payload?.musicPath || defaultTrackRef(),
    musicVolume: payload?.musicVolume ?? 0.3,
    autoDuck: payload?.autoDuck ?? true,
  };

  safeUpdateJob(jobId, { progress: 2 });

  // 1. Get a script — either prebuilt (Series Mode) or AI-generated.
  let script;
  if (prebuiltScript && (prebuiltScript.verse || prebuiltScript.hook)) {
    script = {
      hook: String(prebuiltScript.hook || "").trim(),
      verse: String(prebuiltScript.verse || "").trim(),
      reference: String(prebuiltScript.reference || "").trim(),
      reflection: String(prebuiltScript.reflection || "").trim(),
      cta: String(prebuiltScript.cta || "").trim(),
      title: String(prebuiltScript.title || "").trim(),
    };
  } else {
    // scriptType was previously omitted here, so generateScripts fell back to
    // its "peace" default on EVERY auto-publish and every scheduled run — one
    // narrow bucket feeding the whole page. Rotate through the problem-led
    // types instead (see highPerformerProfile), keyed off the run counter so
    // consecutive posts land in different territory. An explicit payload
    // scriptType still wins, so Series Mode and manual runs are unaffected.
    const rotatedScriptType = payload?.scriptType || pickScriptType(nextScriptTypeIndex());
    const scripts = await generateScripts({
      niche: niche || "Christian / Bible encouragement",
      tone: tone || "warm, encouraging, simple",
      count: 1,
      lengthSeconds: Math.max(8, Math.min(90, Number(lengthSeconds) || 20)),
      includeVerseReference: Boolean(includeVerseReference),
      ctaStyle,
      scriptType: rotatedScriptType,
    });
    script = Array.isArray(scripts) ? scripts[0] : null;
    if (!script) throw new Error("campaign: script generation produced 0 results");
  }
  const cleanScript = sanitizeScriptObject(script);
  const lines = [cleanScript.hook, cleanScript.reference ? `${cleanScript.verse} (${cleanScript.reference})` : cleanScript.verse, cleanScript.reflection, cleanScript.cta].filter(Boolean);
  safeUpdateJob(jobId, { progress: 12 });

  // 2. Library check — we'll pick backgrounds per beat after TTS so each
  // scene matches its own text mood.
  const lib = readLibrary(currentDataDir());
  const pool = Array.isArray(lib?.items) ? lib.items : [];
  if (pool.length === 0) throw new Error("campaign: library is empty — add at least one background before running auto-post");
  safeUpdateJob(jobId, { progress: 18 });

  // 3. Generate voice. Request timestamps so we can do word-level captions.
  // ElevenLabs supplies them natively; for Edge-TTS / Chatterbox we lean on
  // the category orchestrator's forced-alignment fallback (Whisper) when the
  // caller opted into Voice Synthesis defaults.
  const ttsText = cleanSpeakableText(`${cleanScript.hook}\n${cleanScript.verse}\n${cleanScript.reflection}\n${cleanScript.cta}`);
  const useCategory = typeof narrationCategory === "string" && narrationCategory.trim().length > 0;
  const tts = useCategory
    ? await synthesizeForCategory({
        text: ttsText,
        category: narrationCategory,
        preferredProvider,
        withTimestamps: true,
        overrides: {
          voiceId,
          forcedAlignmentFallback:
            forcedAlignmentFallback === undefined ? true : Boolean(forcedAlignmentFallback),
        },
      })
    : await synthesizeTts({ text: ttsText, voiceId, withTimestamps: true });
  const audioPath = tts.file;
  // Pick the typography preset: explicit override > category profile recommendation > undefined
  const typographyPreset =
    (typeof typographyPresetOverride === "string" && typographyPresetOverride.trim().length > 0)
      ? typographyPresetOverride.trim()
      : (useCategory ? resolveProfile(narrationCategory).recommendedTypographyPreset : undefined);

  // Defensive probe: confirm the TTS provider actually returned a playable
  // audible file. We've seen renders ship with -91 dB silence — symptom of
  // a provider returning a non-empty but inaudible file, or a swap/race we
  // can't see in static code. Fail the job loudly here so the next run
  // produces a real diagnostic instead of silently shipping a muted video.
  let ttsAudioStats = { size: 0, duration: null, maxVolumeDb: null };
  try {
    ttsAudioStats.size = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
  } catch { /* keep zero */ }
  try { ttsAudioStats.duration = await probeAudioDuration(audioPath); } catch { /* keep null */ }
  ttsAudioStats.maxVolumeDb = await probeAudioMaxVolume(audioPath);
  console.log(
    `[CAMPAIGN] tts provider=${tts.provider} voice=${tts.voice} ` +
    `aligned=${tts.alignment?.characters?.length || 0}chars ` +
    `category=${narrationCategory || "<none>"} preset=${typographyPreset || "<none>"} ` +
    `file=${audioPath} size=${ttsAudioStats.size}B ` +
    `duration=${ttsAudioStats.duration == null ? "?" : ttsAudioStats.duration.toFixed(2) + "s"} ` +
    `max_volume=${ttsAudioStats.maxVolumeDb == null ? "?" : ttsAudioStats.maxVolumeDb.toFixed(1) + "dB"}`
  );
  if (ttsAudioStats.size < 1024) {
    throw new Error(
      `TTS file too small (${ttsAudioStats.size}B) from provider=${tts.provider}, path=${audioPath}. ` +
      `Likely the provider returned an empty buffer that was still considered a success.`
    );
  }
  if (ttsAudioStats.maxVolumeDb != null && ttsAudioStats.maxVolumeDb <= -60) {
    throw new Error(
      `TTS file is silent (max_volume=${ttsAudioStats.maxVolumeDb.toFixed(1)}dB) ` +
      `from provider=${tts.provider}, path=${audioPath}. ` +
      `Rendering would ship a muted video — failing the job so the user can retry.`
    );
  }
  safeUpdateJob(jobId, { progress: 45 });

  // 4. If we have alignment, build word-level captions + per-beat scenes.
  // Otherwise fall back to the legacy single-bg + line-captions path.
  const ttsLines = [cleanScript.hook, cleanScript.verse, cleanScript.reflection, cleanScript.cta].filter(Boolean);
  const beatTexts = [
    cleanScript.hook,
    cleanScript.reference ? `${cleanScript.verse} (${cleanScript.reference})` : cleanScript.verse,
    [cleanScript.reflection, cleanScript.cta].filter(Boolean).join(" "),
  ].filter(Boolean);

  let renderResult;
  let pickedBackground;
  if (tts.alignment && Array.isArray(tts.alignment.characters) && tts.alignment.characters.length > 0) {
    const rawWords = charsToWords(tts.alignment);
    const words = annotatePhrasedTiers(rawWords);
    const beats = groupWordsByBeat(words, beatTexts);
    const sceneCount = beats.length >= 2 ? beats.length : 1;

    // Probe the actual audio so the scene boundaries tile the WHOLE clip —
    // including leading silence before the first word and trailing silence
    // after the last word. Without this the campaign was clipping the tail
    // of the TTS (audio cut off at the last beat-end, not the audio end).
    let audioDurForBoundaries = 0;
    try { audioDurForBoundaries = await probeAudioDuration(audioPath); } catch { /* fall through */ }
    if (!Number.isFinite(audioDurForBoundaries) || audioDurForBoundaries <= 0) {
      audioDurForBoundaries = words.length > 0 ? words[words.length - 1].end + 0.5 : Number(durationSec) || 20;
    }

    // boundaries[i] = start time of scene i. boundaries[sceneCount] = audio end.
    // Scene 0 always starts at t=0 so any leading silence is covered.
    const boundaries = [0];
    for (let i = 1; i < sceneCount; i++) {
      const beatStart = beats[i] ? Math.max(0, Number(beats[i].start) || 0) : null;
      boundaries.push(beatStart != null ? beatStart : (audioDurForBoundaries * i) / sceneCount);
    }
    boundaries.push(audioDurForBoundaries);

    const XFADE = 0.5;
    const scenes = [];
    const usedIds = new Set();
    // If a generative-image was supplied for this segment, it claims scene 0
    // (the "hook" beat). The remaining beats keep using Pexels picks so the
    // overall video still has motion. The generated still loops via
    // `-loop 1` (handled in renderAdvancedVideo's scene loop).
    const hasGenImage = typeof generatedImage === "string" && generatedImage.trim().length > 0;

    for (let i = 0; i < sceneCount; i++) {
      const beat = beats[i];
      const naturalSpan = Math.max(0.5, boundaries[i + 1] - boundaries[i]);
      const duration = i < sceneCount - 1 ? naturalSpan + XFADE : naturalSpan;

      if (i === 0 && hasGenImage) {
        scenes.push({ backgroundPath: generatedImage, duration, kind: "image", _libItem: null });
        continue;
      }

      const beatCats = beat ? classifyText(beat.line) : [];
      const candidatePool = pool.filter((it) => !usedIds.has(String(it?.id)));
      const fallbackPool = candidatePool.length > 0 ? candidatePool : pool;
      const matched = beatCats.length > 0
        ? fallbackPool.filter((it) => Array.isArray(it?.categories) && it.categories.some((c) => beatCats.includes(String(c).toLowerCase())))
        : [];
      const tier = matched.length > 0 ? matched : fallbackPool;
      const pick = tier[Math.floor(Math.random() * tier.length)] || pool[0];
      usedIds.add(String(pick.id));
      scenes.push({ backgroundPath: pick.id, duration, kind: "video", _libItem: pick });
    }

    pickedBackground = scenes.find((s) => s._libItem)?._libItem || { id: hasGenImage ? generatedImage : null };

    renderResult = await renderVideoCore({
      audioPath,
      words,
      scenes: scenes.map((s) => ({ backgroundPath: s.backgroundPath, duration: s.duration, kind: s.kind })),
      durationSec: audioDurForBoundaries,
      aspect,
      captionWidthPct,
      typographyPreset,
      musicPath: payload.musicPath,
      musicVolume: payload.musicVolume,
      autoDuck: payload.autoDuck,
    }, jobId);
  } else {
    // Tell the OPERATOR, not just the console. A scheduled post publishes
    // unreviewed, so a silent downgrade to static captions is discovered by
    // watching the finished video on a public feed. Word timings come from the
    // TTS provider's alignment, and only ElevenLabs returns it - so the honest
    // message names the cause and the fix.
    console.warn("[CAMPAIGN] no alignment from TTS (Edge-TTS fallback?) — using legacy line captions");
    safeUpdateJob(jobId, {
      captionFallback:
        "Word-by-word captions need an ElevenLabs voice — this schedule's voice returned no word timings, "
        + "so static captions were used. Set an ElevenLabs voice on the schedule to get animated captions.",
    });
    const hasGenImage = typeof generatedImage === "string" && generatedImage.trim().length > 0;
    if (hasGenImage) {
      // Route through the advanced renderer (scenes[]) so the image gets
      // `-loop 1` instead of the legacy single-bg `-stream_loop -1` (which
      // is video-only and breaks on PNG inputs).
      renderResult = await renderVideoCore({
        scenes: [{ backgroundPath: generatedImage, duration: clampDuration(durationSec || 20), kind: "image" }],
        audioPath,
        lines: ttsLines,
        durationSec,
        aspect,
        captionWidthPct,
        typographyPreset,
        musicPath: payload.musicPath,
        musicVolume: payload.musicVolume,
        autoDuck: payload.autoDuck,
      }, jobId);
      pickedBackground = { id: generatedImage };
    } else {
      pickedBackground = pickBestBackground(pool, { script, backgroundQuery });
      if (!pickedBackground?.id) throw new Error("campaign: picked library item has no id");
      renderResult = await renderVideoCore({
        backgroundPath: pickedBackground.id,
        audioPath,
        lines: ttsLines,
        durationSec,
        aspect,
        captionWidthPct,
        typographyPreset,
        musicPath: payload.musicPath,
        musicVolume: payload.musicVolume,
        autoDuck: payload.autoDuck,
      }, jobId);
    }
  }
  const outFile = renderResult.outFile;
  safeUpdateJob(jobId, { progress: 90 });

  // 5. Fire Make webhook (or other destination) so TikTok/YouTube auto-publish.
  // Series Mode supplies its own pre-formatted caption (verse text +
  // YouVersion link + cliffhanger); regular AI campaigns use the structured
  // social-caption builder (hook on top, hashtags at the end, word-safe
  // truncation).
  const caption = (typeof captionOverride === "string" && captionOverride.trim().length > 0)
    ? captionOverride.trim().slice(0, 1900)
    : buildSocialCaption(script);
  const videoFile = path.basename(outFile);
  const videoUrl = `/outputs/${videoFile}`;
  let shareResult = null;

  // Pre-flight tier-aware destination check. For users without any
  // configured destination (regular user with no webhooks, or super-admin
  // who hasn't set anything up), skip dispatch entirely instead of
  // letting it fail with "No destination configured" — the video DID
  // render fine, that's the value, sharing is optional.
  //
  // The skipped result still ends the job as DONE (not failed) so the
  // UI can show a green "Video ready" with a render-only badge and a
  // nudge to set up a destination, rather than a misleading red toast.
  const configured = describeConfiguredDestinations(currentJobCtx);
  if (!configured.canAutoPublish) {
    shareResult = {
      ok: false,
      skipped: true,
      reason: currentIsSuperAdmin()
        ? "no_destination_configured"
        : "no_destination_configured_user_tier",
      message: currentIsSuperAdmin()
        ? "No destination configured. Add a webhook in Settings or set ZERNIO_API_KEY in .env."
        : "Auto-publish needs a destination connected to your account. Connect a webhook (Make / Zapier) in Settings to start posting automatically.",
    };
  } else {
    try {
      // Build a stub req object so social.js's URL-resolution logic can derive
      // an absolute public URL for the rendered video. Order of preference:
      //   PUBLIC_BASE_URL / APP_BASE_URL / RENDER_EXTERNAL_URL > localhost:PORT
      // The campaign worker has no HTTP context of its own, so we synthesize one.
      const configuredBase = String(
        process.env.PUBLIC_BASE_URL ||
        process.env.APP_BASE_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        ""
      ).trim().replace(/\/+$/, "");
      let stubProto = "http";
      let stubHost = `localhost:${process.env.PORT || 5051}`;
      if (configuredBase) {
        try {
          const u = new URL(configuredBase);
          stubProto = u.protocol.replace(":", "") || stubProto;
          stubHost = u.host || stubHost;
        } catch { /* keep defaults */ }
      }
      const reqLike = {
        headers: { host: stubHost, "x-forwarded-proto": stubProto },
        protocol: stubProto,
        // ctx is THE key plumbing here — social.js's tier-aware Zernio
        // gate reads ctx.isSuperAdmin to decide whether falling back to
        // env Zernio is allowed. Without this, a regular user's
        // campaign could leak to the operator's TikTok.
        ctx: currentJobCtx,
        get: (name) => (String(name).toLowerCase() === "host" ? stubHost : ""),
      };
      shareResult = await dispatchPost({
        destination,
        caption,
        videoUrl,
        title: title || script.title || "Biblefuel Post",
        webhookId,
        webhookUrl,
        profileIds,
        privacyStatus,
      }, reqLike);
    } catch (err) {
      console.warn("[CAMPAIGN] share dispatch failed:", err?.message || err);
      shareResult = { ok: false, error: String(err?.message || err) };
    }
  }

  return {
    outFile,
    file: outFile,
    videoUrl,
    caption,
    script,
    backgroundId: pickedBackground.id,
    share: shareResult,
    series: series || null,
  };
}

export function validatePayloadForEnqueue(type, payload) {
  if (type === "render_video") {
    // Accept either a single `backgroundPath` (legacy) or a `scenes[]` array
    // (multi-bg). Both shapes flow through renderVideoCore → renderAdvancedVideo,
    // which detects the array form and hard-cuts between segments. The Render
    // page sends scenes[] when the user picks more than one background.
    const hasScenes = Array.isArray(payload?.scenes) && payload.scenes.length > 0;
    const resolvedAudio = resolveAssetPath(payload?.audioPath);
    const resolvedMusic = resolveAssetPath(payload?.musicPath);
    if (hasScenes) {
      for (let i = 0; i < payload.scenes.length; i++) {
        const s = payload.scenes[i];
        const resolved = resolveAssetPath(s?.backgroundPath);
        if (!resolved || !isLocalOrRemote(resolved)) {
          return { ok: false, error: `scenes[${i}].backgroundPath missing or not found: ${s?.backgroundPath || "<empty>"}` };
        }
      }
    } else if (payload?.autoBackground) {
      // Auto mode: the worker sources backgrounds from the user's library (or
      // AI-generates them) at render time, so no explicit background is required
      // here. The render still needs lines[] (validated below) to pick by mood.
    } else {
      const resolvedBackground = resolveAssetPath(payload?.backgroundPath);
      if (!resolvedBackground || !isLocalOrRemote(resolvedBackground)) {
        return { ok: false, error: `backgroundPath missing or not found: ${payload?.backgroundPath || "<empty>"}` };
      }
    }
    if (payload?.audioPath && !isLocalOrRemote(resolvedAudio)) {
      return { ok: false, error: `audioPath not found: ${payload?.audioPath}` };
    }
    if (payload?.musicPath && !isLocalOrRemote(resolvedMusic)) {
      return { ok: false, error: `musicPath not found: ${payload?.musicPath}` };
    }
    const lines = Array.isArray(payload?.lines) ? buildSpeakableLines(payload.lines.join("\n"), { maxLines: 12, maxChars: 140 }) : [];
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

  if (type === "campaign_auto_post") {
    // Library is the only hard precondition — everything else has defaults.
    const lib = readLibrary(currentDataDir());
    if (!Array.isArray(lib?.items) || lib.items.length === 0) {
      return { ok: false, error: "campaign_auto_post requires at least one background in the Library" };
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

function publicVideoUrlFromOutFile(outFile) {
  if (!outFile) return "";
  const base = String(
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${process.env.PORT || 5051}`
  ).trim().replace(/\/+$/, "");
  const fileName = path.basename(String(outFile));
  if (!fileName) return "";
  return `${base}/outputs/${fileName}`;
}

function buildAutoPublishCaption(job) {
  const p = (job?.payload || {});
  if (typeof p.caption === "string" && p.caption.trim()) return p.caption.trim().slice(0, 1900);
  if (Array.isArray(p.lines)) return p.lines.map(cleanCaptionLine).filter(Boolean).join(" ").slice(0, 1900);
  if (typeof p.title === "string" && p.title.trim()) return p.title.trim().slice(0, 1900);
  return "";
}

async function maybeAutoPublish(job, result) {
  try {
    if (!isPostizConfigured()) return;
    const outFile = result?.outFile || result?.file;
    if (!outFile) return;
    const dataDir = job?.ctx?.dataDir;
    if (!dataDir) return;
    const store = readSocialStore(dataDir);
    const postiz = store?.postiz || {};
    if (!postiz.autoPublish) return;
    if (!postiz.postizUserId) return;
    const platforms = Array.isArray(postiz.autoPublishPlatforms) ? postiz.autoPublishPlatforms : [];
    if (platforms.length === 0) return;

    const videoUrl = publicVideoUrlFromOutFile(outFile);
    if (!videoUrl || /localhost|127\.0\.0\.1/.test(videoUrl)) {
      console.warn("[AUTO-PUBLISH] skipped — no public URL for", outFile);
      return;
    }
    const caption = buildAutoPublishCaption(job);
    const title = String(job?.payload?.title || "").trim() || undefined;
    console.log(`[AUTO-PUBLISH] posting job ${job.id} to ${platforms.join(",")}`);
    await postizPostVideo({
      postizUserId: postiz.postizUserId,
      videoUrl,
      caption,
      platforms,
      title,
    });
  } catch (err) {
    console.warn("[AUTO-PUBLISH] failed:", err?.message || err);
  }
}

async function workerTick() {
  if (running) return;
  store = loadJobs();
  const next = store.jobs.find(j => j.status === "queued");
  if (!next) return;
  running = true;
  volatileProgressByJob.set(next.id, 0);
  safeUpdateJob(next.id, { status: "running", startedAt: new Date().toISOString(), progress: 0 });
  currentJobCtx = next.ctx || null;
  try {
    const result = await executeJob(next);
    volatileProgressByJob.set(next.id, 100);
    safeUpdateJob(next.id, { status: "done", progress: 100, finishedAt: new Date().toISOString(), result });
    if (next.type === "render_video" || next.type === "render_waveform") {
      await maybeAutoPublish(next, result);
    }
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
    currentJobCtx = null;
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

// Data isolation: jobs.json is a single global store, but each job carries
// an `ownerId` (the userId that enqueued it). Regular users only see their
// own jobs; super-admin sees everything (including pre-multitenancy jobs
// that have no ownerId yet — these were created by the original operator
// and belong implicitly to the super-admin).
export function isJobVisibleTo(job, ctx) {
  if (!job) return false;
  if (ctx?.isSuperAdmin) return true;
  const owner = String(job.ownerId || job.ctx?.userId || "").trim();
  if (!owner) return false; // legacy untagged jobs: super-admin only
  return owner === String(ctx?.userId || "").trim();
}

router.get("/", (req, res) => {
  store = loadJobs();
  const visible = store.jobs.filter((j) => isJobVisibleTo(j, req.ctx));
  const jobs = visible.slice().reverse().slice(0, JOBS_RETENTION).map(withVolatileProgress);
  res.json({ ok: true, jobs });
});

router.get("/:id", (req, res) => {
  store = loadJobs();
  const j = store.jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ ok: false, error: "Not found" });
  if (!isJobVisibleTo(j, req.ctx)) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, job: withVolatileProgress(j) });
});

router.post("/enqueue", (req, res) => {
  const type = String(req.body?.type || "").trim();
  const payload = req.body?.payload || {};
  if (!type) return res.status(400).json({ ok: false, error: "type required" });
  // Set currentJobCtx synchronously for validation that reads the library,
  // then restore it. The actual job-execution ctx is set in workerTick.
  const prevCtx = currentJobCtx;
  currentJobCtx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, userId: req.ctx.userId, isSuperAdmin: Boolean(req.ctx.isSuperAdmin) };
  let validation;
  try { validation = validatePayloadForEnqueue(type, payload); }
  finally { currentJobCtx = prevCtx; }
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });

  const id = `job_${uuid()}`;
  const job = {
    id, type, payload,
    ownerId: req.ctx.userId,
    // isSuperAdmin persisted on the job so the worker can apply
    // tier-aware rules (e.g. only super-admins fall back to env Zernio
    // when no per-user webhook is configured).
    ctx: { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, userId: req.ctx.userId, isSuperAdmin: Boolean(req.ctx.isSuperAdmin) },
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

/**
 * Re-enqueue a failed or done job's payload as a fresh queued job. Used by
 * the Jobs page "Retry" button so a user doesn't have to manually rebuild
 * the form to re-run a Pexels-CDN failure or a transient ffmpeg crash.
 *
 * Returns the NEW job (different id) — the original job's row is left
 * untouched in history so the user can compare attempts.
 *
 * Ownership: only the job's owner (or super-admin) can retry. Anything
 * else returns 404 to avoid leaking job existence across tenants.
 */
router.post("/:id/retry", (req, res) => {
  store = loadJobs();
  const original = store.jobs.find((j) => j.id === req.params.id);
  if (!original) return res.status(404).json({ ok: false, error: "Not found" });
  if (!isJobVisibleTo(original, req.ctx)) return res.status(404).json({ ok: false, error: "Not found" });
  if (original.status === "queued" || original.status === "running") {
    return res.status(409).json({
      ok: false,
      error: `Job is already ${original.status}; nothing to retry`,
    });
  }
  const type = original.type;
  // Deep-clone the payload so we don't mutate the original job's stored
  // copy if the worker mutates fields during validation/normalization.
  const payload = JSON.parse(JSON.stringify(original.payload || {}));

  const prevCtx = currentJobCtx;
  currentJobCtx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, userId: req.ctx.userId, isSuperAdmin: Boolean(req.ctx.isSuperAdmin) };
  let validation;
  try { validation = validatePayloadForEnqueue(type, payload); }
  finally { currentJobCtx = prevCtx; }
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });

  const id = `job_${uuid()}`;
  const job = {
    id,
    type,
    payload,
    ownerId: req.ctx.userId,
    ctx: { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, userId: req.ctx.userId, isSuperAdmin: Boolean(req.ctx.isSuperAdmin) },
    status: "queued",
    createdAt: new Date().toISOString(),
    // Provenance — links the retry back to its source so we can show
    // "Retried from #abc12345" in the UI later if useful.
    retryOf: original.id,
  };
  store.jobs.push(job);
  saveJobs(store);
  queueMicrotask(() => {
    workerTick().catch((err) => console.warn("[JOBS] workerTick retry trigger failed:", err?.message || err));
  });
  res.json({ ok: true, job });
});

// Pure constructor for a campaign_auto_post job row. Extracted so the
// ownership/isolation contract is unit-testable without touching the jobs
// store: a job MUST carry the caller's `ownerId` and per-user `ctx`
// (dataDir/outputDir) or it falls back to the global super-admin scope and
// becomes visible ONLY to the operator — the Series cross-tenant leak.
// A missing isSuperAdmin defaults to false (safer — treat unknown ctx as a
// regular user so we never accidentally leak to env Zernio / global dirs).
export function buildCampaignJob(id, payload, ctx) {
  const normalizedCtx = ctx
    ? { ...ctx, isSuperAdmin: Boolean(ctx.isSuperAdmin) }
    : null;
  return {
    id,
    type: "campaign_auto_post",
    payload: payload || {},
    ownerId: normalizedCtx?.userId || null,
    ctx: normalizedCtx,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

// Programmatic enqueue helper for in-process callers (e.g. cron-driven
// schedules in social.js). Skips HTTP/auth, performs the same validation.
export async function enqueueCampaignAutoPost(payload, ctx) {
  // ctx (required for non-super-admin under MULTITENANT=true):
  //   { dataDir, outputDir, userId, isSuperAdmin }
  // Callers that don't pass ctx (legacy cron in social.js pre-refactor) get
  // the global super-admin paths, matching pre-multi-tenant behaviour.
  const normalizedCtx = ctx
    ? { ...ctx, isSuperAdmin: Boolean(ctx.isSuperAdmin) }
    : null;
  const prevCtx = currentJobCtx;
  currentJobCtx = normalizedCtx;
  let validation;
  try { validation = validatePayloadForEnqueue("campaign_auto_post", payload || {}); }
  finally { currentJobCtx = prevCtx; }
  if (!validation.ok) throw new Error(validation.error);
  const job = buildCampaignJob(`job_${uuid()}`, payload, ctx);
  store = loadJobs();
  store.jobs.push(job);
  saveJobs(store);
  queueMicrotask(() => {
    workerTick().catch((err) => console.warn("[JOBS] workerTick enqueue trigger failed:", err?.message || err));
  });
  return job;
}

export default router;
