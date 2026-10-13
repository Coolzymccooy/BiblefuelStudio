// server/src/routes/lyricVideo.js
//
// Song mode: lyric-video projects, the timing job and the render, over HTTP.
// Mounted at /api/lyric-video behind auth + withUserScope + the "lyric.video"
// capability. There is NO router-level quota: the quota middleware charges on
// every request it sees, so polling a project would burn a free user's whole
// day. Only POST /:id/align and POST /:id/render are charged, and only once
// the request has passed its own checks (a refused click costs nothing).
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { v4 as uuid } from "uuid";
import { confineToDir } from "../lib/confinePath.js";
import { hasDiskHeadroomForUpload } from "../lib/diskHeadroom.js";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";
import { probeMediaSize } from "../lib/story/sceneFraming.js";
import { createJob, persistJob, readPersistedJob, getJob, updateJob, markError, cancelJob } from "../lib/renderJobs.js";
import { EFFECT_IDS } from "../lib/kinetic/director.js";
import { ENERGIES, isStudioLook } from "../lib/kinetic/looks.js";
import { SHEET_MAX_CHARS, SHEET_MAX_LINES } from "../lib/lyricVideo/sheetParser.js";
import {
  createProject, readProject, updateProject, listProjects, deleteProject, readPrefs, writePrefs, applySheet,
} from "../lib/lyricVideo/projectStore.js";
import { runAlignJob, isAligning } from "../lib/lyricVideo/alignJob.js";
import { buildLyricAss } from "../lib/lyricVideo/lyricAss.js";
import { renderSize, runLyricRender } from "../lib/lyricVideo/lyricRender.js";
import { quota } from "../middleware/quota.js";

const EFFECTS_ALLOWED = new Set(["auto", ...EFFECT_IDS]);
const ASPECTS = ["portrait", "landscape", "square"];
const QUALITIES = ["720p", "1080p"];
const MAX_SONG_SEC = 15 * 60;
const MAX_CONCURRENT_RENDERS = 2; // prod: 8 cores, no swap, ~0.5-1 GB per x264 encode
// Output size estimate for the disk check: the encoder's target bitrate plus 192k audio.
const VIDEO_BPS = { "720p": 6e6, "1080p": 12e6 };
const AUDIO_BPS = 192000;
const FITS = ["auto", "cover", "contain"];
const MIN_GAP = 0.05;
const CAPTION_MIN = 160;
const CAPTION_MAX = 3840;
const PROBE_TIMEOUT_MS = 15_000;
const COVER_TIMEOUT_MS = 30_000;

const NOT_FOUND = "That song project was not found";
const INTERRUPTED = "Timing stopped before it finished — run it again.";
const RENDER_FAILED = "The video could not be made. Try again, or choose a different background.";
const RENDER_INTERRUPTED = "The render was interrupted — start it again.";
const SERVER_ERROR = "Something went wrong on our side. Please try again.";

/** A refusal with a status and a message that is fit to show the user. */
class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const ok = (res, data) => res.json(data);
const bad = (res, status, error) => res.status(status).json({ error });
const bodyOf = (req) => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});
const round3 = (n) => Math.round(n * 1000) / 1000;
const placed = (l) => Array.isArray(l?.words) && l.words.length > 0 && Number.isFinite(l.start) && Number.isFinite(l.end);
const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** Wraps a handler so a refusal answers its status and anything else is logged and answered plainly (no stack, no paths). */
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof Refusal) return bad(res, err.status, err.message);
      console.error("[lyric-video] unexpected error:", err);
      if (!res.headersSent) bad(res, 500, SERVER_ERROR);
    }
  };
}

/** Runs a child process to completion; resolves its exit code and stdout, or { error } when it cannot start or times out. */
function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    let proc;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { proc?.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ error: "timeout" });
    }, timeoutMs);
    try {
      proc = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch (err) {
      return finish({ error: err });
    }
    proc.stdout.on("data", (d) => { out += d; });
    proc.on("error", (err) => finish({ error: err }));
    proc.on("close", (code) => finish({ code, out }));
  });
}

/** "audio" when the file has a sound stream, "silent" when it is readable without one, "unreadable" otherwise. */
async function probeAudio(file) {
  const probe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const r = await run(probe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], PROBE_TIMEOUT_MS);
  if (r.error || r.code !== 0) return "unreadable";
  return r.out.trim().length > 0 ? "audio" : "silent";
}

/** One frame of the song's picture to use as the default background; null when there is none. */
async function extractCoverStill(file, outputDir, durationSec) {
  if (!(await probeMediaSize(file))) return null;
  const still = path.join(outputDir, `lyric-cover-${uuid()}.jpg`);
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const at = String(Math.min(1, Math.max(0, durationSec / 2)));
  const r = await run(ffmpeg, ["-nostdin", "-v", "error", "-y", "-ss", at, "-i", file, "-frames:v", "1", still], COVER_TIMEOUT_MS);
  // A clip shorter than the seek point exits 0 without writing a frame.
  if (r.error || r.code !== 0 || !isFile(still)) { removeFile(still); return null; }
  return still;
}

function removeFile(file) {
  if (!file) return;
  try { fs.rmSync(file, { force: true }); } catch { /* a leftover scratch file is harmless */ }
}

/**
 * Confines a request path to the outputs folder, following links: the real path
 * of the file must sit inside the real outputs folder (a link inside it that
 * points elsewhere is refused). Returns the real path, or null.
 */
function confineReal(outputDir, candidate) {
  const lexical = confineToDir(outputDir, candidate);
  if (!lexical) return null;
  try {
    const realFile = fs.realpathSync(lexical);
    const realRoot = fs.realpathSync(outputDir);
    return realFile.startsWith(realRoot + path.sep) ? realFile : null;
  } catch {
    return null;
  }
}

/** Removes a file this feature made, only when it lives inside the user's output folder. */
function removeOwned(outputDir, file) {
  const confined = typeof file === "string" ? confineToDir(outputDir, file) : null;
  if (confined) removeFile(confined);
}

/**
 * A saved "running" timing state with no live job in this process means the
 * server restarted mid-run: persist it as stopped so the page stops spinning.
 * Returns the project as it now stands (null when it vanished meanwhile).
 */
function settleInterrupted(dataDir, project) {
  const id = project.projectId;
  if (project.timing?.status !== "running" || isAligning(id)) return project;
  return updateProject(dataDir, id, (latest) => {
    if (latest.timing?.status !== "running" || isAligning(id)) return latest;
    return { ...latest, timing: { ...latest.timing, status: "error", progress: null, error: INTERRUPTED } };
  });
}

/**
 * The line moved to start at `want`: its words shift with it, it never crosses
 * the nearest timed neighbour (plus a small gap) or the song's ends, and it is
 * locked so a later timing run keeps it. A line already squeezed tighter than
 * the gap may stay where it is but is never pushed further out of order.
 */
function nudgeLine(lines, i, want, songEnd) {
  const line = lines[i];
  const len = line.end - line.start;
  const prev = lines.slice(0, i).reverse().find(placed);
  const next = lines.slice(i + 1).find(placed);
  const lower = prev ? prev.end + MIN_GAP : 0;
  const upper = Math.min(next ? next.start - MIN_GAP : Infinity, songEnd) - len;
  const lo = Math.min(lower, line.start);
  const hi = Math.max(upper, line.start);
  const start = round3(Math.max(lo, Math.min(want, hi)));
  const shift = start - line.start;
  return {
    ...line,
    words: line.words.map((w) => ({ ...w, start: round3(w.start + shift), end: round3(w.end + shift) })),
    start,
    end: round3(line.end + shift),
    locked: true,
    flag: null,
  };
}

function publicJob(job) {
  let error = null;
  if (job.error) {
    if (job.cancelled) error = "Render cancelled";
    else error = RENDER_FAILED;
  }
  return { jobId: job.jobId, status: job.status, progress: job.percent, error, file: job.file ? path.basename(job.file) : null };
}

/** What a job looked like before a restart wiped the live registry, for the same owner and project. */
function persistedJob(req) {
  const rec = readPersistedJob(req.ctx.dataDir, req.params.jobId);
  if (!rec || rec.userId !== req.ctx.userId || rec.projectId !== req.params.id) return null;
  const finished = rec.status === "done";
  return {
    jobId: rec.jobId,
    status: finished ? "done" : "error",
    progress: finished ? 100 : 0,
    error: finished ? null : RENDER_INTERRUPTED,
    file: finished && rec.outputPath ? path.basename(rec.outputPath) : null,
  };
}

/**
 * Options exist for tests only: `alignDeps` (an object or a function returning
 * one) replaces the audio and speech steps of the timing job, `runRender`
 * replaces the ffmpeg render.
 */
export function createLyricVideoRouter({ alignDeps, runRender = runLyricRender, statfs } = {}) {
  const router = Router();
  const rendering = new Map(); // project id -> { userId, bytes } for each render in flight in this process
  const timingByUser = new Map(); // user id -> project id of the timing run in flight

  function load(req) {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) throw new Refusal(404, NOT_FOUND);
    return project;
  }

  /** Charges one unit of the render allowance, or answers 429 and returns false. */
  function charged(req, res) {
    let passed = false;
    quota("render")(req, res, () => { passed = true; });
    return passed;
  }

  const busy = (id) => {
    if (isAligning(id)) throw new Refusal(409, "Timing is running for this song — wait for it to finish.");
    if (rendering.has(id)) throw new Refusal(409, "A video is being made for this song — wait for it to finish.");
  };

  router.get("/prefs", (req, res) => ok(res, readPrefs(req.ctx.dataDir)));
  router.put("/prefs", route((req, res) => ok(res, writePrefs(req.ctx.dataDir, { artist: bodyOf(req).artist }))));

  router.get("/", route((req, res) => {
    for (const summary of listProjects(req.ctx.dataDir)) {
      const project = readProject(req.ctx.dataDir, summary.projectId);
      if (project) settleInterrupted(req.ctx.dataDir, project);
    }
    ok(res, { projects: listProjects(req.ctx.dataDir) });
  }));

  router.post("/", route((req, res) => {
    const { title, artist } = bodyOf(req);
    const project = createProject(req.ctx.dataDir, { title, artist });
    if (project.artist) writePrefs(req.ctx.dataDir, { artist: project.artist });
    ok(res, { project });
  }));

  router.get("/:id", route((req, res) => {
    const project = settleInterrupted(req.ctx.dataDir, load(req));
    if (!project) throw new Refusal(404, NOT_FOUND);
    ok(res, { project });
  }));

  router.delete("/:id", route((req, res) => {
    const project = load(req);
    busy(project.projectId);
    if (!deleteProject(req.ctx.dataDir, project.projectId)) throw new Refusal(404, NOT_FOUND);
    // Only what this feature made. The uploaded song and backgrounds are the user's own files.
    removeOwned(req.ctx.outputDir, project.song?.coverStill);
    for (const render of project.renders || []) removeOwned(req.ctx.outputDir, render?.file);
    ok(res, {});
  }));

  router.post("/:id/song", route(async (req, res) => {
    const project = load(req);
    busy(project.projectId);
    const file = confineReal(req.ctx.outputDir, bodyOf(req).path);
    if (!file || !isFile(file)) throw new Refusal(400, "That upload could not be found. Please upload the song again.");
    const sound = await probeAudio(file);
    if (sound === "unreadable") throw new Refusal(400, "That file could not be read as audio or video. Try an MP3, M4A or WAV file.");
    if (sound === "silent") throw new Refusal(400, "That file has no sound in it. Upload the song itself.");
    const duration = await probeAudioDurationSec(file);
    if (!Number.isFinite(duration) || duration <= 0) throw new Refusal(400, "That song could not be read. Try an MP3, M4A or WAV file.");
    if (duration > MAX_SONG_SEC) throw new Refusal(400, "That song is longer than 15 minutes. Trim it and upload again.");
    const durationSec = Math.round(duration * 100) / 100;
    const coverStill = await extractCoverStill(file, req.ctx.outputDir, durationSec);
    let replaced = null;
    const next = updateProject(req.ctx.dataDir, project.projectId, (latest) => {
      busy(project.projectId); // timing or a render may have started while the file was probed
      replaced = latest.song?.coverStill;
      return { ...latest, song: { file, durationSec, coverStill }, timing: { status: "idle" } };
    });
    if (!next) { removeOwned(req.ctx.outputDir, coverStill); throw new Refusal(404, NOT_FOUND); }
    if (replaced && replaced !== coverStill) removeOwned(req.ctx.outputDir, replaced);
    ok(res, { project: next });
  }));

  router.put("/:id/sheet", route((req, res) => {
    const project = load(req);
    const { sheet } = bodyOf(req);
    if (typeof sheet !== "string") throw new Refusal(400, "Paste the lyrics, one line per line.");
    if (sheet.length > SHEET_MAX_CHARS) throw new Refusal(400, `The lyrics are too long (over ${SHEET_MAX_CHARS} characters).`);
    if (sheet.split(/\r?\n/).length > SHEET_MAX_LINES) throw new Refusal(400, `The lyrics are too long (over ${SHEET_MAX_LINES} lines).`);
    const next = updateProject(req.ctx.dataDir, project.projectId, (latest) => {
      const applied = applySheet(latest, sheet);
      if (!applied.lines.length) throw new Refusal(400, "Paste the lyrics, one line per line.");
      return applied;
    });
    if (!next) throw new Refusal(404, NOT_FOUND);
    ok(res, { project: next });
  }));

  router.post("/:id/align", route((req, res) => {
    const project = load(req);
    if (!project.song?.file) throw new Refusal(409, "Upload the song first.");
    if (!project.lines?.length) throw new Refusal(409, "Paste the lyrics first.");
    if (!isFile(project.song.file)) throw new Refusal(409, "The song file is missing — upload the song again.");
    if (isAligning(project.projectId)) throw new Refusal(409, "Timing is already running for this song.");
    if (timingByUser.has(req.ctx.userId)) throw new Refusal(409, "Timing is already running for another song — wait for it to finish.");
    if (!charged(req, res)) return;
    // runAlignJob marks the project "running" before it first yields, so the 202 below reports it.
    const deps = typeof alignDeps === "function" ? alignDeps() : alignDeps;
    timingByUser.set(req.ctx.userId, project.projectId);
    runAlignJob({ dataDir: req.ctx.dataDir, workDir: req.ctx.outputDir, projectId: project.projectId, deps })
      .catch((err) => { console.error("[lyric-video] timing job crashed:", err); })
      .finally(() => { timingByUser.delete(req.ctx.userId); });
    const marked = readProject(req.ctx.dataDir, project.projectId);
    if (!marked) throw new Refusal(404, NOT_FOUND);
    res.status(202).json({ project: marked });
  }));

  router.patch("/:id/lines/:lineId", route((req, res) => {
    const project = load(req);
    const { start, effect } = bodyOf(req);
    if (start === undefined && effect === undefined) throw new Refusal(400, "Nothing to change.");
    if (effect !== undefined && !EFFECTS_ALLOWED.has(effect)) throw new Refusal(400, "Unknown effect");
    if (start !== undefined && !(typeof start === "number" && Number.isFinite(start))) throw new Refusal(400, "That start time is not a number.");
    const next = updateProject(req.ctx.dataDir, project.projectId, (latest) => {
      const i = latest.lines.findIndex((l) => l.id === req.params.lineId);
      if (i < 0) throw new Refusal(404, "That line was not found");
      let line = latest.lines[i];
      if (effect !== undefined) line = { ...line, effect };
      if (start !== undefined) {
        if (!placed(line)) throw new Refusal(400, "That line has no timing yet — run timing first.");
        const songEnd = Number(latest.song?.durationSec) > 0 ? Number(latest.song.durationSec) : Infinity;
        line = nudgeLine(latest.lines.map((l, k) => (k === i ? line : l)), i, start, songEnd);
      }
      return { ...latest, lines: latest.lines.map((l, k) => (k === i ? line : l)) };
    });
    if (!next) throw new Refusal(404, NOT_FOUND);
    ok(res, { project: next });
  }));

  router.put("/:id/look", route((req, res) => {
    const project = load(req);
    const { id, energy, seed } = bodyOf(req);
    if (id !== undefined && !isStudioLook(id)) throw new Refusal(400, "Unknown look");
    if (energy !== undefined && !ENERGIES.some((e) => e.id === energy)) throw new Refusal(400, "Unknown energy");
    if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0)) throw new Refusal(400, "That mix is not valid");
    const next = updateProject(req.ctx.dataDir, project.projectId, (latest) => ({
      ...latest,
      look: { ...latest.look, ...(id !== undefined && { id }), ...(energy !== undefined && { energy }), ...(seed !== undefined && { seed }) },
    }));
    if (!next) throw new Refusal(404, NOT_FOUND);
    ok(res, { project: next });
  }));

  router.put("/:id/background", route(async (req, res) => {
    const project = load(req);
    const body = bodyOf(req);
    let background = null;
    if (body.path !== null) {
      if (body.fit !== undefined && !FITS.includes(body.fit)) throw new Refusal(400, "Unknown fit");
      const file = confineReal(req.ctx.outputDir, body.path);
      if (!file || !isFile(file)) throw new Refusal(400, "That background could not be found");
      if (!(await probeMediaSize(file))) throw new Refusal(400, "That background could not be read as a picture or video.");
      background = { file, kind: /\.(jpe?g|png|webp)$/i.test(file) ? "image" : "video", fit: body.fit ?? "auto" };
    }
    const next = updateProject(req.ctx.dataDir, project.projectId, (latest) => ({ ...latest, background }));
    if (!next) throw new Refusal(404, NOT_FOUND);
    ok(res, { project: next });
  }));

  router.get("/:id/captions.ass", route((req, res) => {
    const project = load(req);
    const size = (value, fallback) => Math.min(CAPTION_MAX, Math.max(CAPTION_MIN, Math.round(Number(value)) || fallback));
    const w = size(req.query.w, 720);
    const h = size(req.query.h, 1280);
    res.type("text/plain").set("Cache-Control", "no-store").send(buildLyricAss(project, { w, h }));
  }));

  /** Finishes a render: records the job's end state, files the result on the project, frees the slot. */
  async function settleRender({ req, project, job, aspect, quality, width, height, durationSec, outPath, assPath }) {
    const dataDir = req.ctx.dataDir;
    const id = project.projectId;
    try {
      let result;
      try {
        result = await runRender({
          jobId: job.jobId, songPath: project.song.file, background: renderBackground(project), assPath,
          width, height, durationSec, outPath,
        });
      } catch (err) {
        console.error(`[lyric-video] render ${job.jobId} crashed:`, err);
        markError(job.jobId, "The render could not run");
        result = { ok: false };
      }
      const live = getJob(job.jobId);
      if (result?.ok && live?.status === "done") {
        persistJob(dataDir, { ...job, ...live, projectId: id, outputPath: outPath });
        updateProject(dataDir, id, (latest) => ({
          ...latest,
          renders: [...(latest.renders || []), { jobId: job.jobId, aspect, quality, file: outPath, durationSec, at: new Date().toISOString() }],
        }));
      } else {
        if (live && live.status !== "error") markError(job.jobId, "The render did not finish");
        const ended = getJob(job.jobId);
        if (!ended?.cancelled) console.error(`[lyric-video] render ${job.jobId} failed:`, ended?.error || result?.error);
        persistJob(dataDir, { ...job, ...getJob(job.jobId), projectId: id, status: "error", outputPath: null });
        removeFile(outPath);
      }
    } catch (err) {
      console.error(`[lyric-video] could not finish render ${job.jobId}:`, err);
    } finally {
      removeFile(assPath);
      rendering.delete(id);
    }
  }

  /** Bytes the renders in flight may still write, plus this one, for the disk check. */
  const pendingBytes = () => [...rendering.values()].reduce((sum, r) => sum + r.bytes, 0);

  router.post("/:id/render", route((req, res) => {
    const project = load(req);
    const body = bodyOf(req);
    if (body.aspect !== undefined && !ASPECTS.includes(body.aspect)) throw new Refusal(400, "Unknown video shape");
    if (body.quality !== undefined && !QUALITIES.includes(body.quality)) throw new Refusal(400, "Unknown quality");
    const aspect = body.aspect ?? "portrait";
    const quality = body.quality ?? "720p";
    if (!project.song?.file) throw new Refusal(409, "Add the song first.");
    const durationSec = Number(project.song.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Refusal(409, "The song's length is not known — upload the song again.");
    if (!isFile(project.song.file)) throw new Refusal(409, "The song file is missing — upload the song again.");
    if (project.background?.file && !isFile(project.background.file)) throw new Refusal(409, "The background file is missing — choose it again.");
    if (rendering.has(project.projectId)) throw new Refusal(409, "A video is already being made for this song.");
    if ([...rendering.values()].some((r) => r.userId === req.ctx.userId)) throw new Refusal(409, "You already have a video being made — wait for it to finish.");
    if (rendering.size >= MAX_CONCURRENT_RENDERS) throw new Refusal(409, "The studio is busy making other videos — try again in a few minutes.");
    if (isAligning(project.projectId)) throw new Refusal(409, "Timing is still running for this song — wait for it to finish.");
    const { width, height } = renderSize(aspect, quality);
    const ass = buildLyricAss(project, { w: width, h: height, layout: aspect === "portrait" ? "shorts" : "default" });
    if (!ass) throw new Refusal(409, "Time the lyrics before rendering.");
    const bytes = Math.ceil(((VIDEO_BPS[quality] + AUDIO_BPS) / 8) * durationSec);
    if (!hasDiskHeadroomForUpload(req.ctx.outputDir, bytes + pendingBytes(), { statfs }).ok) {
      throw new Refusal(507, "The server is short of space right now — try again later.");
    }
    if (!charged(req, res)) return;

    rendering.set(project.projectId, { userId: req.ctx.userId, bytes });
    let job;
    // Rendered files are served by link: the name must not be guessable from the project id.
    const assPath = path.join(req.ctx.outputDir, `lyric-${uuid()}.ass`);
    const outPath = path.join(req.ctx.outputDir, `lyric-${uuid()}.mp4`);
    try {
      fs.writeFileSync(assPath, ass, "utf8");
      job = createJob(req.ctx.userId, { durationSec });
      updateJob(job.jobId, { projectId: project.projectId });
      persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
    } catch (err) {
      rendering.delete(project.projectId);
      removeFile(assPath);
      throw err;
    }
    // Detached: the response below does not wait for the render.
    settleRender({ req, project, job, aspect, quality, width, height, durationSec, outPath, assPath });
    res.status(202).json({ jobId: job.jobId });
  }));

  /** The live job for this owner and project, or null. */
  const ownJob = (req) => {
    const job = getJob(req.params.jobId);
    return job && job.userId === req.ctx.userId && job.projectId === req.params.id ? job : null;
  };

  router.get("/:id/render/:jobId", route((req, res) => {
    const job = ownJob(req);
    const view = job ? publicJob(job) : persistedJob(req);
    if (!view) throw new Refusal(404, "No such render");
    ok(res, { job: view });
  }));

  router.post("/:id/render/:jobId/cancel", route((req, res) => {
    const job = ownJob(req);
    if (!job) throw new Refusal(404, "No such render");
    const result = cancelJob(job.jobId, req.ctx.userId);
    if (!result.ok) throw new Refusal(result.reason === "terminal" ? 409 : 404, result.reason === "terminal" ? "That render has already finished." : "No such render");
    ok(res, {});
  }));

  return router;
}

/** The project's own background, else its cover still, else the renderer's dark colour. */
function renderBackground(project) {
  if (project.background?.file) return project.background;
  if (project.song?.coverStill && isFile(project.song.coverStill)) return { file: project.song.coverStill, kind: "image", fit: "auto" };
  return null;
}

export default createLyricVideoRouter();
