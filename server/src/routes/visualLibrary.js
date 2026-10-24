import fs from "fs";
import path from "path";
import { Router } from "express";
import { searchClips, similarClips, updateClip, removeClip, getClip, isClipId, addClip, aspectOf, leadsOf } from "../lib/visualLibrary/store.js";
import { backfillStoryClips, makeMissingPosters } from "../lib/visualLibrary/backfill.js";
import { listProjects, readProject } from "../lib/sceneScript/projectStore.js";
import { resolveSceneVideo } from "../lib/story/sceneVideo.js";
import { rerollPrice, startReroll, listRerolls, recentRerolls, resumeRerolls, refetchReroll, canRefetch, REROLL_STORE } from "../lib/visualLibrary/reroll.js";
import { isSeedanceConfigured } from "../lib/videoGen/providers/seedance.js";
import { ledgerSummary } from "../lib/videoGen/spend.js";
import { DATA_DIR, OUTPUT_DIR } from "../lib/paths.js";

/**
 * The visual library: every paid AI clip, reusable across videos.
 * Mounted behind requireAuth + withUserScope + requireSuperAdmin.
 */

const ASPECTS = new Set(["portrait", "landscape", "square"]);
// The library page shows up to this many clips at once; the Scene script picker asks for fewer.
const MAX_BROWSE = 200;

const MAX_PROMPT = 1500;
const MAX_COST_USD = 100;
const UPLOAD_NAME = /^bg-video-[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$/i;

/** The import body's optional fields, or a message saying which one is wrong. */
function importFields(body) {
  const { prompt = "", tags = [], costUsd = 0, model = "", taskId = "" } = body || {};
  if (typeof prompt !== "string" || prompt.length > MAX_PROMPT) return { error: `The prompt must be text of at most ${MAX_PROMPT} characters.` };
  if (!Array.isArray(tags) || tags.length > 20 || tags.some((t) => typeof t !== "string")) return { error: "Tags must be a list of up to 20 words." };
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0 || costUsd > MAX_COST_USD) {
    return { error: `The cost must be between $0 and $${MAX_COST_USD}.` };
  }
  if (typeof model !== "string" || model.length > 80) return { error: "The model name is too long." };
  if (typeof taskId !== "string" || taskId.length > 120) return { error: "The task id is too long." };
  return { prompt: prompt.trim(), tags, costUsd, model: model || null, taskId: taskId || null };
}

/** A converted clip leaves the original upload behind; it is not wanted once the clip is in the library. */
function removeOriginalUpload(outputDir, uploadPath, keptFile) {
  const name = path.basename(String(uploadPath));
  if (!UPLOAD_NAME.test(name)) return;
  const original = path.join(outputDir, name);
  if (path.resolve(original) !== path.resolve(keptFile)) fs.rmSync(original, { force: true });
}

function usedBy(dataDir, clipId) {
  return listProjects(dataDir)
    .map((p) => readProject(dataDir, p.id))
    .filter((p) => p?.shots?.some((s) => s.clip?.libraryId === clipId))
    .map((p) => ({ id: p.id, title: p.meta?.title || "Untitled" }));
}

/** A re-roll as the page sees it: whether it can be fetched again, not BytePlus's signed URL. */
function rerollView(job) {
  const { videoUrl: _url, ...rest } = job;
  return { ...rest, refetchable: canRefetch(job) };
}

function joinRun(runs, key, start) {
  if (!runs.has(key)) runs.set(key, Promise.resolve().then(start).finally(() => runs.delete(key)));
  return runs.get(key);
}

export function createVisualLibraryRouter({ ledgerDir = DATA_DIR, deps = {} } = {}) {
  const router = Router();
  // One poster run and one Story back-fill at a time per user's library;
  // a second request waits for the run already going.
  const posterRuns = new Map();
  const backfillRuns = new Map();

  router.get("/", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
    const aspect = ASPECTS.has(req.query.aspect) ? req.query.aspect : null;
    const lead = typeof req.query.lead === "string" ? req.query.lead.slice(0, 600) : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag.slice(0, 40) : "";
    const rating = Number(req.query.rating);
    const minRating = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0;
    const asked = Number(req.query.limit);
    const limit = Number.isInteger(asked) && asked >= 1 && asked <= MAX_BROWSE ? asked : 60;
    const all = searchClips(req.ctx.dataDir, { q, aspect, lead, tag, minRating, limit: Infinity });
    res.json({ ok: true, clips: all.slice(0, limit), total: all.length });
  });

  router.get("/leads", (req, res) => res.json({ ok: true, leads: leadsOf(req.ctx.dataDir) }));

  router.get("/rerolls", (req, res) => res.json({
    // Running and fetchable jobs always, however many newer ones there are.
    ok: true, jobs: recentRerolls(listRerolls(req.ctx.dataDir), 20).map(rerollView), month: ledgerSummary(ledgerDir),
  }));

  router.post("/rerolls/:jobId/refetch", (req, res) => {
    const r = refetchReroll(req.ctx, String(req.params.jobId).slice(0, 64), { ledgerDir, deps: deps.reroll });
    if (!r.ok) return res.status(r.status).json({ ok: false, code: r.code, error: r.error });
    return res.json({ ok: true, job: rerollView(r.job) });
  });

  router.post("/posters", async (req, res) => {
    try {
      const r = await joinRun(posterRuns, req.ctx.dataDir, () => makeMissingPosters(req.ctx, { poster: deps.poster }));
      return res.json({ ok: true, ...r });
    } catch (e) {
      console.warn(`[visual-library] posters failed: ${e?.message || e}`);
      return res.status(500).json({ ok: false, error: "Posters could not be made." });
    }
  });

  router.post("/backfill-story", async (req, res) => {
    try {
      const r = await joinRun(backfillRuns, req.ctx.dataDir, () => backfillStoryClips(req.ctx, { probe: deps.probe }));
      return res.json({ ok: true, ...r });
    } catch (e) {
      console.warn(`[visual-library] Story back-fill failed: ${e?.message || e}`);
      return res.status(500).json({ ok: false, error: "Older Story clips could not be added." });
    }
  });

  router.get("/similar", (req, res) => {
    const prompt = typeof req.query.prompt === "string" ? req.query.prompt.slice(0, 1500) : "";
    const aspect = ASPECTS.has(req.query.aspect) ? req.query.aspect : null;
    res.json({ ok: true, matches: similarClips(req.ctx.dataDir, prompt, { aspect, limit: 6 }) });
  });

  // A clip made outside this server (an earlier prototype, another account):
  // uploaded first with POST /api/media/upload-background, then checked,
  // converted to H.264 when it needs it, and given a poster, as a Story scene
  // clip is.
  router.post("/import", async (req, res) => {
    const fields = importFields(req.body);
    if (fields.error) return res.status(400).json({ ok: false, error: fields.error });
    const uploadPath = req.body?.uploadPath;
    if (typeof uploadPath !== "string" || !uploadPath) return res.status(400).json({ ok: false, error: "Choose a clip to import." });
    try {
      const video = await resolveSceneVideo({ outputDir: req.ctx.outputDir, uploadPath });
      if (!video.ok) return res.status(video.status).json({ ok: false, error: video.error });
      removeOriginalUpload(req.ctx.outputDir, uploadPath, video.videoPath);
      const clip = addClip(req.ctx, {
        file: video.videoPath,
        posterFile: video.posterPath,
        prompt: fields.prompt,
        tags: fields.tags,
        costUsd: fields.costUsd,
        model: fields.model,
        taskId: fields.taskId,
        aspect: aspectOf(video.width, video.height),
        durationSec: video.durationSec,
        source: { kind: "import" },
      });
      return res.json({ ok: true, clip });
    } catch (e) {
      console.warn("[visual-library] import failed:", e?.message || e);
      return res.status(500).json({ ok: false, error: "The clip could not be imported." });
    }
  });

  router.patch("/:id", (req, res) => {
    if (!isClipId(req.params.id)) return res.status(404).json({ ok: false, error: "Clip not found." });
    const clip = updateClip(req.ctx.dataDir, req.params.id, { tags: req.body?.tags, rating: req.body?.rating });
    if (!clip) return res.status(404).json({ ok: false, error: "Clip not found." });
    return res.json({ ok: true, clip });
  });

  router.delete("/:id", (req, res) => {
    if (!isClipId(req.params.id) || !getClip(req.ctx.dataDir, req.params.id)) {
      return res.status(404).json({ ok: false, error: "Clip not found." });
    }
    const users = usedBy(req.ctx.dataDir, req.params.id);
    if (users.length && req.query.force !== "1") {
      return res.status(409).json({ ok: false, code: "IN_USE", error: `This clip is used in ${users.map((u) => u.title).join(", ")}.`, usedBy: users });
    }
    removeClip(req.ctx, req.params.id);
    return res.json({ ok: true });
  });

  // Re-roll from a clip's prompt: the price first, then the paid order.
  router.get("/:id/reroll-price", (req, res) => {
    const clip = isClipId(req.params.id) ? getClip(req.ctx.dataDir, req.params.id) : null;
    if (!clip) return res.status(404).json({ ok: false, error: "Clip not found." });
    return res.json({ ok: true, price: rerollPrice(clip), month: ledgerSummary(ledgerDir), seedance: isSeedanceConfigured() });
  });

  router.post("/:id/reroll", (req, res) => {
    if (!isSeedanceConfigured()) return res.status(503).json({ ok: false, code: "NOT_CONFIGURED", error: "AI video is not set up on this server." });
    if (!isClipId(req.params.id)) return res.status(404).json({ ok: false, error: "Clip not found." });
    const expectUsd = Number(req.body?.expectUsd);
    if (!Number.isFinite(expectUsd) || expectUsd < 0) {
      return res.status(400).json({ ok: false, code: "NO_PRICE", error: "Check the price before re-rolling." });
    }
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
    const r = startReroll(req.ctx, req.params.id, { prompt, expectUsd, ledgerDir, deps: deps.reroll });
    if (!r.ok) return res.status(r.status).json({ ok: false, code: r.code, error: r.error, ...(r.price ? { price: r.price } : {}) });
    return res.json({ ok: true, job: rerollView(r.job) });
  });

  return router;
}

/** Every library with re-rolls: the owner's and each other user's. */
function rerollContexts() {
  const out = [];
  if (fs.existsSync(path.join(DATA_DIR, REROLL_STORE))) out.push({ dataDir: DATA_DIR, outputDir: OUTPUT_DIR });
  const usersDir = path.join(DATA_DIR, "users");
  if (fs.existsSync(usersDir)) {
    for (const sub of fs.readdirSync(usersDir)) {
      const dataDir = path.join(usersDir, sub);
      if (fs.existsSync(path.join(dataDir, REROLL_STORE))) out.push({ dataDir, outputDir: path.join(dataDir, "outputs") });
    }
  }
  return out;
}

/** After a restart: collect re-rolls ordered before it. Resolves with how many. */
export async function resumeLibraryRerolls({ ledgerDir = DATA_DIR } = {}) {
  let count = 0;
  for (const ctx of rerollContexts()) count += await resumeRerolls(ctx, { ledgerDir });
  return count;
}
