import { Router, raw } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";
import {
  laptopQueueEnabled, claimNext, heldJob, reportProgress, failLaptopJob, persistLaptopQueue,
} from "../lib/stems/laptopQueue.js";
import { updateStemJob } from "../lib/stems/stemJobs.js";
import { saveInstrumental } from "./music.js";

/**
 * The laptop's side of vocal removal for the live site
 * (scripts/stems-worker.mjs). Mounted WITHOUT user auth: the worker key is
 * the only thing between these routes and the internet, so it fails closed —
 * no key, or one too short to be a real secret, and nothing is served. The
 * key reaches only these routes, and only jobs the laptop has claimed.
 */
const router = Router();

export const MAX_RESULT_BYTES = 300 * 1024 * 1024;

let _probe = probeAudioDurationSec;
export function _setResultProbe(fn) { _probe = fn; }
export function _resetResultProbe() { _probe = probeAudioDurationSec; }

function sameSecret(a, b) {
  // Fixed-size digests: equal length for timingSafeEqual, still constant time.
  const da = crypto.createHash("sha256").update(String(a)).digest();
  const db = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

router.use((req, res, next) => {
  if (!laptopQueueEnabled()) {
    return res.status(503).json({ ok: false, error: "STEMS_WORKER_NOT_CONFIGURED" });
  }
  const key = String(process.env.STEMS_WORKER_TOKEN).trim();
  const given = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!given || !sameSecret(given, key)) {
    return res.status(401).json({ ok: false, error: "STEMS_WORKER_UNAUTHORIZED" });
  }
  return next();
});

router.post("/claim", (req, res) => {
  const job = claimNext();
  if (!job) return res.json({ ok: true, job: null });
  return res.json({ ok: true, job: { jobId: job.jobId, quality: job.quality, sourceName: path.basename(job.input) } });
});

function held(req, res) {
  const job = heldJob(req.params.jobId);
  if (!job) res.status(404).json({ ok: false, error: "no such job on this laptop" });
  return job;
}

router.get("/jobs/:jobId/source", (req, res) => {
  const job = held(req, res);
  if (!job) return undefined;
  if (!fs.existsSync(job.input)) {
    failLaptopJob(job, "The song's audio file is missing on the server.");
    return res.status(410).json({ ok: false, error: "source missing" });
  }
  return res.sendFile(path.resolve(job.input), { dotfiles: "allow" });
});

router.post("/jobs/:jobId/progress", (req, res) => {
  // A lapsed or cancelled job: tell the laptop to stop, not 404 it into retrying.
  const job = heldJob(req.params.jobId);
  if (!job) return res.json({ ok: true, cancelled: true });
  return res.json({ ok: true, ...reportProgress(job, req.body?.percent) });
});

router.post("/jobs/:jobId/fail", (req, res) => {
  const job = held(req, res);
  if (!job) return undefined;
  failLaptopJob(job, req.body?.error);
  return res.json({ ok: true });
});

// An MP4/M4A file opens with a box whose type, at bytes 4–8, is "ftyp".
const looksLikeM4a = (buf) => buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp";

router.post(
  "/jobs/:jobId/result",
  raw({ type: () => true, limit: MAX_RESULT_BYTES }),
  async (req, res) => {
    // Checked before the lease: a cancel makes the job unheld, and the
    // laptop should hear "cancelled", not "no such job".
    const job = heldJob(req.params.jobId);
    if (!job) {
      return res.status(409).json({ ok: false, error: "that job was cancelled or has lapsed" });
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!looksLikeM4a(body)) {
      return res.status(400).json({ ok: false, error: "the result is not an M4A audio file" });
    }
    // The server's own name for it, in the job owner's media folder.
    const tmp = `${job.resultPath}.upload`;
    try {
      fs.writeFileSync(tmp, body);
      let durationSec;
      try {
        durationSec = await _probe(tmp);
      } catch {
        throw Object.assign(new Error("the result could not be read as audio"), { status: 400 });
      }
      if (!(durationSec > 0)) throw Object.assign(new Error("the result has no audio"), { status: 400 });
      if (job.controller.signal.aborted) throw Object.assign(new Error("that job was cancelled"), { status: 409 });
      fs.renameSync(tmp, job.resultPath);
      const track = await saveInstrumental(job.dataDir, job, job.outputDir, { durationSec });
      updateStemJob(job.jobId, { status: "done", percent: 100, track });
      persistLaptopQueue();
      return res.json({ ok: true });
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* swept up later */ }
      try { fs.rmSync(job.resultPath, { force: true }); } catch { /* swept up later */ }
      return res.status(e.status || 500).json({ ok: false, error: String(e?.message || e) });
    }
  },
);

export default router;
