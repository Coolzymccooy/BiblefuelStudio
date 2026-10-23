import { Router } from "express";
import { searchClips, similarClips, updateClip, removeClip, getClip, isClipId } from "../lib/visualLibrary/store.js";
import { listProjects, readProject } from "../lib/sceneScript/projectStore.js";

/**
 * The visual library: every paid AI clip, reusable across videos.
 * Mounted behind requireAuth + withUserScope + requireSuperAdmin.
 */

const ASPECTS = new Set(["portrait", "landscape", "square"]);

function usedBy(dataDir, clipId) {
  return listProjects(dataDir)
    .map((p) => readProject(dataDir, p.id))
    .filter((p) => p?.shots?.some((s) => s.clip?.libraryId === clipId))
    .map((p) => ({ id: p.id, title: p.meta?.title || "Untitled" }));
}

export function createVisualLibraryRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
    const aspect = ASPECTS.has(req.query.aspect) ? req.query.aspect : null;
    res.json({ ok: true, clips: searchClips(req.ctx.dataDir, { q, aspect }) });
  });

  router.get("/similar", (req, res) => {
    const prompt = typeof req.query.prompt === "string" ? req.query.prompt.slice(0, 1500) : "";
    const aspect = ASPECTS.has(req.query.aspect) ? req.query.aspect : null;
    res.json({ ok: true, matches: similarClips(req.ctx.dataDir, prompt, { aspect, limit: 6 }) });
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

  return router;
}
