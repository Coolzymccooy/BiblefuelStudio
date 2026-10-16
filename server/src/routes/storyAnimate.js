import { Router } from "express";
import { readProject } from "../lib/story/projectStore.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { DATA_DIR } from "../lib/paths.js";
import { isSeedanceConfigured } from "../lib/videoGen/providers/seedance.js";
import { ledgerSummary, wouldExceedCap, usdPerSecond } from "../lib/videoGen/spend.js";
import { estimateAnimation, startAnimation, cancelAnimation, isAnimating, qualityOf, AI_QUALITY } from "../lib/story/animateStage.js";

/**
 * AI motion for Story scenes (BytePlus Seedance). Super admins only: one
 * BytePlus balance pays for every clip, so every route is behind
 * requireSuperAdmin and the spend ledger lives in the shared DATA_DIR.
 *
 * Built by a factory so story.js can hand over its scene lock
 * (sceneImageBlocked) without the two files importing each other.
 */
export function createStoryAnimateRouter({ sceneBlocked, ledgerDir = DATA_DIR, deps } = {}) {
  const router = Router();

  // Absent means every scene; present must name at least one scene, so a
  // malformed list can never widen into "animate all".
  const sceneIdsFrom = (body) => {
    if (body?.sceneIds === undefined) return { ok: true, ids: undefined };
    const ids = Array.isArray(body.sceneIds) ? body.sceneIds.filter((x) => typeof x === "string").slice(0, 500) : [];
    return ids.length ? { ok: true, ids } : { ok: false };
  };
  const BAD_SCENE_IDS = Object.freeze({ ok: false, code: "BAD_SCENE_IDS", error: "Choose at least one scene." });

  const load = (req, res) => {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) res.status(404).json({ ok: false, error: "project not found" });
    return project;
  };

  // What a second of clip costs at each quality, in a portrait frame (the
  // Series flow's shape), and the month so far: the Series page's estimate.
  // story.js mounts this router before its GET /:id, which would otherwise
  // take "animate" for a project id.
  router.get("/animate/rates", requireSuperAdmin, (_req, res) => {
    const { spentUsd, reservedUsd, capUsd } = ledgerSummary(ledgerDir);
    const perSecond = (q) => usdPerSecond({ ...AI_QUALITY[q], ratio: "9:16" });
    return res.json({
      ok: true,
      configured: isSeedanceConfigured(),
      usdPerSecond: { standard: perSecond("standard"), high: perSecond("high") },
      monthSpentUsd: spentUsd,
      reservedUsd,
      capUsd,
    });
  });

  router.post("/:id/animate/estimate", requireSuperAdmin, (req, res) => {
    const project = load(req, res);
    if (!project) return;
    const picked = sceneIdsFrom(req.body);
    if (!picked.ok) return res.status(400).json(BAD_SCENE_IDS);
    const quality = qualityOf(req.body?.quality);
    const { clips: monthClips, ...month } = ledgerSummary(ledgerDir);
    return res.json({
      ok: true,
      configured: isSeedanceConfigured(),
      quality,
      running: isAnimating(project.projectId),
      ...month,
      monthClips,
      ...estimateAnimation(project, picked.ids, quality),
    });
  });

  const start = (pickIds) => (req, res) => {
    if (!isSeedanceConfigured()) {
      return res.status(503).json({ ok: false, code: "NOT_CONFIGURED", error: "AI video is not set up on this server." });
    }
    const project = load(req, res);
    if (!project) return;
    if (isAnimating(project.projectId)) {
      return res.status(409).json({ ok: false, code: "RUNNING", error: "Scenes are already being animated. Wait for them to finish, or stop ordering clips." });
    }
    const picked = pickIds(req);
    if (!picked.ok) return res.status(400).json(BAD_SCENE_IDS);
    const quality = qualityOf(req.body?.quality);
    const est = estimateAnimation(project, picked.ids, quality);
    if (!est.clips) {
      return res.status(400).json({ ok: false, code: "NOTHING_TO_ANIMATE", error: "No scene with a finished picture to animate." });
    }
    for (const id of est.sceneIds) {
      const refused = sceneBlocked(project, id);
      if (refused) return res.status(refused.status).json({ ok: false, ...refused.body });
    }
    const budget = wouldExceedCap(ledgerDir, est.usd);
    if (budget.exceeded) return res.status(409).json({ ok: false, code: "BUDGET", error: budget.error });
    const written = startAnimation(req.ctx, project.projectId, { sceneIds: est.sceneIds, quality, ledgerDir, deps });
    if (!written) {
      return res.status(409).json({ ok: false, code: "RUNNING", error: "Scenes are already being animated. Wait for them to finish, or stop ordering clips." });
    }
    return res.json({ ok: true, project: written });
  };

  router.post("/:id/animate", requireSuperAdmin, start((req) => sceneIdsFrom(req.body)));
  router.post("/:id/scenes/:sid/animate", requireSuperAdmin, start((req) => ({ ok: true, ids: [req.params.sid] })));

  router.post("/:id/animate/cancel", requireSuperAdmin, (req, res) => {
    const project = load(req, res);
    if (!project) return;
    cancelAnimation(project.projectId);
    return res.json({ ok: true, project });
  });

  return router;
}
