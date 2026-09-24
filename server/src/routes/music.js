import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { listTracks } from "../lib/musicLibrary.js";
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
import { quota } from "../middleware/quota.js";

const router = Router();

/** A tenant upload, in the shape the picker already understands. */
function toListed(track) {
  return {
    id: track.id,
    label: track.label,
    mood: track.mood,
    previewUrl: null, // uploads are served through the authed /outputs path, not /music
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
router.get("/library", (req, res) => {
  const bundled = listTracks().map((t) => ({
    ...t,
    source: "bundled",
    licence: "pixabay-cleared",
    credit: BUNDLED_CREDIT,
    durationSec: null,
    ref: `library:${t.id}`,
  }));
  const mine = readMusicLibrary(req.ctx.dataDir).items.map(toListed);
  res.json({ ok: true, tracks: [...bundled, ...mine] });
});

// Remember a file the operator has ALREADY uploaded through
// POST /api/media/upload-audio (or the resumable pair). This route does not
// receive bytes; it only records what is already on disk.
router.post("/upload", async (req, res) => {
  try {
    const file = path.resolve(String(req.body?.file || "").trim());
    const root = path.resolve(req.ctx.outputDir);
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
    return res.json({ ok: true, track: toListed(track) });
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
  return res.json({ ok: true, track: toListed(track) });
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
  };
}

router.get("/capabilities", async (req, res) => {
  const sep = await _separator.available();
  res.json({ ok: true, vocalRemoval: Boolean(sep?.ok), amfEncoder: amfAvailable() });
});

router.post("/:id/instrumental", quota("render"), async (req, res) => {
  try {
    const src = sourceTrack(req.ctx.dataDir, String(req.params.id));
    if (!src) return res.status(404).json({ ok: false, error: "track not found" });
    if (!(await _separator.available())?.ok) {
      return res.status(409).json({ ok: false, error: "vocal removal is not set up on this machine — see docs/vocal-removal.md" });
    }
    const input = resolveTrackFile({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, src.ref);
    if (!input) return res.status(404).json({ ok: false, error: "that track's audio file is missing" });

    sweepStaleInstrumentals(req.ctx);
    const jobId = crypto.randomUUID();
    const resultPath = path.resolve(req.ctx.outputDir, `instrumental-${jobId}.m4a`);
    const workDir = path.resolve(req.ctx.outputDir, "stems-work", jobId);
    const quality = req.body?.quality === "fast" ? "fast" : "best";
    const job = createStemJob({
      jobId, userId: req.ctx.userId, sourceRef: src.ref, sourcePreview: src.previewUrl, resultPath,
    });

    runExclusive(async () => {
      updateStemJob(jobId, { status: "running" });
      await _separator.remove({
        input, outPath: resultPath, workDir, quality, signal: job.controller.signal,
        onProgress: (p) => updateStemJob(jobId, { percent: Math.min(99, p) }),
      });
      updateStemJob(jobId, { status: "done", percent: 100 });
    }, { signal: job.controller.signal }).catch((e) => {
      fs.rmSync(resultPath, { force: true });
      updateStemJob(jobId, { status: "error", error: String(e?.message || e) });
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
  job.controller.abort();
  return res.json({ ok: true });
});

router.post("/instrumental/:jobId/keep", async (req, res) => {
  try {
    const job = getStemJob(req.params.jobId, req.ctx.userId);
    if (!job) return res.status(404).json({ ok: false, error: "job not found" });
    if (job.status !== "done") return res.status(409).json({ ok: false, error: "the instrumental is not ready yet" });
    const src = sourceTrack(req.ctx.dataDir, job.sourceRef.replace(/^(library|mylib):/, ""));
    let durationSec = null;
    try { durationSec = await probeAudioDurationSec(job.resultPath); } catch { /* recorded without it */ }
    const track = registerTrack(req.ctx.dataDir, {
      file: job.resultPath,
      label: `${src?.label || "Track"} (instrumental)`,
      mood: src?.mood,
      // Separating a song does not clear it: the instrumental carries the
      // original's licence and credit, and the bed's licence gate still applies.
      licence: src?.licence || "unknown",
      credit: src?.credit || "",
      derivedFrom: job.sourceRef,
      durationSec,
    });
    removeStemJob(job.jobId);
    return res.json({ ok: true, track: toListed(track) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/instrumental/:jobId/discard", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  job.controller.abort();
  fs.rmSync(job.resultPath, { force: true });
  removeStemJob(job.jobId);
  return res.json({ ok: true });
});

export default router;
