import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { listTracks, bundledDurations } from "../lib/musicLibrary.js";
import {
  readMusicLibrary, registerTrack, updateTrack, removeTrack,
} from "../lib/musicLibraryStore.js";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";
import { BUNDLED_CREDIT } from "../lib/ambient/trackInfo.js";
import { resolveTrackFile } from "../lib/ambient/stages.js";
import { amfAvailable } from "../lib/ambient/encoders.js";
import { runExclusive } from "../lib/heavyJobGate.js";
import { separatorAvailable, removeVocals } from "../lib/stems/separator.js";
import {
  createStemJob, getStemJob, updateStemJob, removeStemJob,
} from "../lib/stems/stemJobs.js";
import { sweepStaleInstrumentals } from "../lib/stems/sweep.js";
import {
  laptopQueueEnabled, laptopOnline, enqueueLaptopJob, cancelLaptopJob, persistLaptopQueue, queueRoomFor,
} from "../lib/stems/laptopQueue.js";
import { quota } from "../middleware/quota.js";

const router = Router();

/**
 * How the browser plays an upload: its bare name when it sits at the top of
 * the caller's media folder (as uploads do), or its /outputs/ path when it is
 * in a sub-folder (a Timeline render, say), where the bare name would 404.
 */
function servedFile(file, outputDir) {
  const name = path.basename(file);
  if (!outputDir) return name;
  let root = path.resolve(outputDir);
  try { root = fs.realpathSync(root); } catch { /* not there: compare as given */ }
  const rel = path.relative(root, path.resolve(file));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return name;
  return rel.includes(path.sep) ? `/outputs/${rel.split(path.sep).join("/")}` : name;
}

/** A tenant upload, in the shape the picker already understands. */
function toListed(track, outputDir) {
  return {
    id: track.id,
    label: track.label,
    mood: track.mood,
    previewUrl: null, // uploads are played from /outputs/<mediaFile>, not /music
    mediaFile: servedFile(track.file, outputDir),
    default: false,
    source: "upload",
    licence: track.licence,
    credit: track.credit || "",
    derivedFrom: track.derivedFrom || null,
    durationSec: track.durationSec,
    ref: `mylib:${track.id}`,
  };
}

// Bundled first (they are the curated set), then the operator's own.
let _durationProbe = probeAudioDurationSec;
export function _setDurationProbe(fn) { _durationProbe = fn; }
export function _resetDurationProbe() { _durationProbe = probeAudioDurationSec; }

router.get("/library", async (req, res) => {
  let lengths = {};
  try { lengths = await bundledDurations(_durationProbe); } catch { /* listed without lengths */ }
  const bundled = listTracks().map((t) => ({
    ...t,
    source: "bundled",
    licence: "pixabay-cleared",
    credit: BUNDLED_CREDIT,
    durationSec: lengths[t.id] ?? null,
    ref: `library:${t.id}`,
  }));
  const mine = readMusicLibrary(req.ctx.dataDir).items.map((t) => toListed(t, req.ctx.outputDir));
  res.json({ ok: true, tracks: [...bundled, ...mine] });
});

// Remember a file the operator has ALREADY uploaded through
// POST /api/media/upload-audio (or the resumable pair). This route does not
// receive bytes; it only records what is already on disk.
router.post("/upload", async (req, res) => {
  try {
    const root = path.resolve(req.ctx.outputDir);
    // A bare name ("user-audio-….m4a", as a Timeline lane stores a loose
    // upload) is read as a file in the caller's media folder; the containment
    // checks below still apply, so "../x" cannot climb out.
    // The served form ("/outputs/…") names the same folder, so it is read as
    // a name inside it too.
    const given = String(req.body?.file || "").trim().replace(/^\/?outputs[\\/]/, "");
    const file = path.resolve(root, given);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return res.status(403).json({ ok: false, error: "That file is outside your media folder" });
    }
    if (!fs.existsSync(file)) {
      return res.status(400).json({ ok: false, error: "That file is no longer there" });
    }
    // Canonicalize both paths to reject symlinks that escape the outputDir.
    // fs.realpathSync throws if the path disappears between checks — treat that as 400.
    let realFile, realRoot;
    try {
      realFile = fs.realpathSync(file);
      realRoot = fs.realpathSync(root);
    } catch {
      return res.status(400).json({ ok: false, error: "That file is no longer there" });
    }
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
      return res.status(403).json({ ok: false, error: "That file is outside your media folder" });
    }
    // Must be a regular file — `file !== root` above lets `file === root`
    // through (posting the outputDir path itself), and nothing previously
    // stopped a directory, a .json, or any other non-audio file from being
    // "registered" as a track.
    let stat;
    try {
      stat = fs.statSync(realFile);
    } catch {
      return res.status(400).json({ ok: false, error: "That file is no longer there" });
    }
    if (!stat.isFile()) {
      return res.status(400).json({ ok: false, error: "That path is not a file" });
    }
    // A duration makes the picker useful ("3:02") and lets a later bed
    // assembly know how many tracks it needs. A probe failure is not fatal.
    // probeAudioDurationSec is declared `function` (storyRender.js:435) and
    // returns a promise; awaiting it is correct, and a rejection must not
    // cost the operator their saved track.
    let durationSec = null;
    try { durationSec = await probeAudioDurationSec(realFile); } catch { durationSec = null; }

    // Store the canonicalized realFile, not the (possibly symlinked) `file`
    // the operator posted — otherwise swapping the symlink's target after
    // registration would silently redirect future reads of this track.
    const track = registerTrack(req.ctx.dataDir, {
      file: realFile,
      label: req.body?.label,
      mood: req.body?.mood,
      licence: req.body?.licence,
      durationSec,
    });
    return res.json({ ok: true, track: toListed(track, req.ctx.outputDir) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id", (req, res) => {
  const track = updateTrack(req.ctx.dataDir, req.params.id, {
    label: req.body?.label,
    mood: req.body?.mood,
    licence: req.body?.licence,
    credit: req.body?.credit,
  });
  if (!track) return res.status(404).json({ ok: false, error: "track not found" });
  return res.json({ ok: true, track: toListed(track, req.ctx.outputDir) });
});

router.delete("/:id", (req, res) => {
  const bundled = listTracks().some((t) => t.id === req.params.id);
  if (bundled) return res.status(400).json({ ok: false, error: "Bundled tracks ship with the app" });
  if (!removeTrack(req.ctx.dataDir, req.params.id)) {
    return res.status(404).json({ ok: false, error: "track not found" });
  }
  return res.json({ ok: true });
});

let _separator = { available: separatorAvailable, remove: removeVocals };
export function _setSeparatorImpl(impl) { _separator = { ..._separator, ...impl }; }
export function _resetSeparatorImpl() { _separator = { available: separatorAvailable, remove: removeVocals }; }

/** The source track as `{ ref, label, mood, licence, credit, previewUrl }`, or null. */
function sourceTrack(dataDir, id) {
  const bundled = listTracks().find((t) => t.id === id);
  if (bundled) {
    return {
      ref: `library:${id}`, label: bundled.label, mood: bundled.mood, licence: "pixabay-cleared", credit: BUNDLED_CREDIT, previewUrl: bundled.previewUrl,
    };
  }
  const mine = readMusicLibrary(dataDir).items.find((t) => t.id === id);
  if (!mine) return null;
  return {
    ref: `mylib:${id}`, label: mine.label, mood: mine.mood, licence: mine.licence, credit: mine.credit || "", previewUrl: path.basename(mine.file),
  };
}

function jobView(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    percent: job.percent,
    error: job.error,
    sourceRef: job.sourceRef,
    sourcePreview: job.sourcePreview,
    resultFile: job.status === "done" ? path.basename(job.resultPath) : null,
    track: job.track || null,
    // "laptop": the operator's laptop does this one for the live site.
    where: job.where === "laptop" ? "laptop" : "server",
    laptopOnline: laptopOnline(),
  };
}

/**
 * Put a finished instrumental in the library. Done the moment the separation
 * ends, not when someone presses Keep: the dialog that used to ask lives in
 * the browser, so leaving the page stranded a finished file with no way back
 * to it. Separating a song does not clear it — the instrumental carries the
 * licence and credit captured when the job started, and the bed's licence
 * gate still applies.
 */
export async function saveInstrumental(dataDir, job, outputDir, known = {}) {
  if (!fs.existsSync(job.resultPath)) throw new Error("the separator finished but wrote no file");
  let durationSec = known.durationSec ?? null;
  if (durationSec == null) {
    try { durationSec = await probeAudioDurationSec(job.resultPath); } catch { /* recorded without it */ }
  }
  // Last point before it becomes a library track: a cancel that landed while
  // the separator was finishing or the file was being measured wins.
  if (job.controller.signal.aborted) throw new Error("Cancelled.");
  const track = registerTrack(dataDir, {
    file: job.resultPath,
    label: `${job.sourceLabel || "Track"} (instrumental)`,
    mood: job.sourceMood,
    licence: job.sourceLicence || "unknown",
    credit: job.sourceCredit || "",
    derivedFrom: job.sourceRef,
    durationSec,
  });
  return toListed(track, outputDir);
}

router.get("/capabilities", async (req, res) => {
  const local = Boolean((await _separator.available())?.ok);
  // No separator here (the live site): the laptop can still do it, via the queue.
  const laptop = !local && laptopQueueEnabled();
  res.json({
    ok: true,
    vocalRemoval: local || laptop,
    vocalRemovalWhere: local ? "server" : (laptop ? "laptop" : null),
    laptopOnline: laptopOnline(),
    amfEncoder: amfAvailable(),
  });
});

router.post("/:id/instrumental", quota("render"), async (req, res) => {
  try {
    const src = sourceTrack(req.ctx.dataDir, String(req.params.id));
    if (!src) return res.status(404).json({ ok: false, error: "track not found" });
    const local = Boolean((await _separator.available())?.ok);
    if (!local && !laptopQueueEnabled()) {
      return res.status(409).json({ ok: false, error: "vocal removal is not set up on this machine — see docs/vocal-removal.md" });
    }
    const input = resolveTrackFile({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, src.ref);
    if (!input) return res.status(404).json({ ok: false, error: "that track's audio file is missing" });

    sweepStaleInstrumentals(req.ctx);
    const jobId = crypto.randomUUID();
    const resultPath = path.resolve(req.ctx.outputDir, `instrumental-${jobId}.m4a`);
    const workDir = path.resolve(req.ctx.outputDir, "stems-work", jobId);
    const quality = req.body?.quality === "fast" ? "fast" : "best";
    const fields = {
      jobId,
      userId: req.ctx.userId,
      sourceRef: src.ref,
      sourcePreview: src.previewUrl,
      resultPath,
      sourceLabel: src.label,
      sourceMood: src.mood,
      sourceLicence: src.licence,
      sourceCredit: src.credit,
    };
    if (!local && !queueRoomFor(req.ctx.userId)) {
      return res.status(429).json({ ok: false, error: "You already have songs waiting for vocal removal. Try again when they finish." });
    }
    if (!local) {
      // The laptop picks it up (routes/stemsWorker.js) and uploads the result.
      enqueueLaptopJob({ ...fields, input, quality, dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir });
      return res.json({ ok: true, jobId, where: "laptop" });
    }
    const job = createStemJob(fields);

    runExclusive(async () => {
      updateStemJob(jobId, { status: "running" });
      await _separator.remove({
        input, outPath: resultPath, workDir, quality, signal: job.controller.signal,
        onProgress: (p) => updateStemJob(jobId, { percent: Math.min(99, p) }),
      });
      const track = await saveInstrumental(req.ctx.dataDir, job, req.ctx.outputDir);
      updateStemJob(jobId, { status: "done", percent: 100, track });
    }, { signal: job.controller.signal }).catch((e) => {
      // Record the failure FIRST: a killed separator can leave a WAV/partial
      // output briefly locked on Windows (EBUSY/EPERM), and `force: true`
      // only suppresses ENOENT — it does not guarantee rmSync succeeds. If
      // the delete threw before the status was set, the job would stay
      // "running" forever and this rejection would go unhandled. Any
      // leftover file here is best-effort cleanup; the weekly sweep reclaims
      // it if this delete fails.
      updateStemJob(jobId, { status: "error", error: String(e?.message || e) });
      try { fs.rmSync(resultPath, { force: true }); } catch { /* swept up later */ }
    });

    return res.json({ ok: true, jobId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/instrumental/:jobId", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  return res.json({ ok: true, job: jobView(job) });
});

router.post("/instrumental/:jobId/cancel", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  if (job.where === "laptop") {
    // Nothing on this server is running it; the laptop stops at its next report.
    if (job.status === "queued" || job.status === "running") cancelLaptopJob(job);
  } else {
    job.controller.abort();
  }
  return res.json({ ok: true });
});

// Kept for older clients: a finished job is already in the library, so this
// only hands back the track it was saved as.
router.post("/instrumental/:jobId/keep", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  if (job.status !== "done" || !job.track) return res.status(409).json({ ok: false, error: "the instrumental is not ready yet" });
  return res.json({ ok: true, track: job.track });
});

router.post("/instrumental/:jobId/discard", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  job.controller.abort();
  if (job.track) removeTrack(req.ctx.dataDir, job.track.id);
  // Best-effort: a busy/locked file must not 500 and leave the job stuck
  // registered — the weekly sweep reclaims anything left behind.
  try { fs.rmSync(job.resultPath, { force: true }); } catch { /* swept up later */ }
  removeStemJob(job.jobId);
  if (job.where === "laptop") persistLaptopQueue();
  return res.json({ ok: true });
});

export default router;
