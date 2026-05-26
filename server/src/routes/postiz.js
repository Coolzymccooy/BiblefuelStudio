import { Router } from "express";
import { readSocialStore, writeSocialStore } from "../lib/socialStore.js";
import {
  isPostizConfigured,
  ensurePostizUser,
  getConnectUrl,
  listIntegrations,
  disconnectIntegration,
  postVideo,
} from "../lib/postizClient.js";

/**
 * Postiz routes — Phase 4.
 *
 * - GET    /status                       : config + the current user's connections
 * - POST   /connect/:platform            : returns a hosted "connect" URL
 * - DELETE /disconnect/:integrationId    : remove a connected platform
 * - POST   /post                         : push a video to selected destinations
 *
 * Per-user state lives in social.json under `postiz`:
 *   { postizUserId, lastSync, integrations: [{ id, platform, displayName, ... }] }
 *
 * Mount with: app.use("/api/postiz", requireAuth, withUserScope, requireVerifiedEmail, postizRouter)
 *
 * Spec: docs/superpowers/specs/2026-05-26-public-multitenancy-design.md §Phase 4
 */

const router = Router();

function readPostizSection(dataDir) {
  const store = readSocialStore(dataDir);
  return store?.postiz || { postizUserId: null, lastSync: null, integrations: [] };
}

function writePostizSection(dataDir, patch) {
  const store = readSocialStore(dataDir);
  const next = {
    ...(store || {}),
    postiz: {
      ...(store?.postiz || {}),
      ...patch,
      lastSync: new Date().toISOString(),
    },
  };
  writeSocialStore(dataDir, next);
  return next.postiz;
}

router.get("/status", async (req, res) => {
  if (!isPostizConfigured()) {
    return res.json({ ok: true, configured: false, integrations: [] });
  }
  try {
    const section = readPostizSection(req.ctx.dataDir);
    // If we haven't provisioned a Postiz user for this Biblefuel user yet,
    // do it lazily here so the Settings page always returns a valid id.
    let postizUserId = section.postizUserId;
    if (!postizUserId) {
      const created = await ensurePostizUser({
        biblefuelUserId: req.ctx.userId,
        email: req.ctx.email,
      });
      postizUserId = String(created?.id || created?.userId || created?.externalId || "").trim();
      if (postizUserId) {
        writePostizSection(req.ctx.dataDir, { postizUserId });
      }
    }
    let integrations = [];
    try {
      const remote = postizUserId ? await listIntegrations(postizUserId) : [];
      integrations = Array.isArray(remote) ? remote : (remote?.integrations || []);
      writePostizSection(req.ctx.dataDir, { integrations });
    } catch (listErr) {
      // Fall back to whatever we cached last sync — don't hide the screen.
      integrations = section.integrations || [];
      console.warn("[POSTIZ] listIntegrations failed, returning cached:", listErr?.message || listErr);
    }
    res.json({ ok: true, configured: true, postizUserId, integrations });
  } catch (e) {
    console.error("[POSTIZ] status error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/connect/:platform", async (req, res) => {
  if (!isPostizConfigured()) {
    return res.status(503).json({ ok: false, error: "POSTIZ_NOT_CONFIGURED" });
  }
  const platform = String(req.params.platform || "").toLowerCase();
  const SUPPORTED = ["tiktok", "youtube", "instagram", "x", "facebook", "linkedin", "threads", "pinterest", "reddit", "bluesky"];
  if (!SUPPORTED.includes(platform)) {
    return res.status(400).json({ ok: false, error: `Unsupported platform: ${platform}` });
  }
  try {
    let section = readPostizSection(req.ctx.dataDir);
    if (!section.postizUserId) {
      const created = await ensurePostizUser({
        biblefuelUserId: req.ctx.userId,
        email: req.ctx.email,
      });
      section = writePostizSection(req.ctx.dataDir, {
        postizUserId: String(created?.id || created?.userId || created?.externalId || "").trim(),
      });
    }
    const returnUrl = String(req.body?.returnUrl || `${req.headers.origin || ""}/settings?connected=${platform}`).trim();
    const connect = await getConnectUrl(platform, section.postizUserId, returnUrl);
    res.json({ ok: true, url: connect?.url || connect?.connectUrl || connect, platform });
  } catch (e) {
    console.error(`[POSTIZ] connect/${platform} error:`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.delete("/disconnect/:integrationId", async (req, res) => {
  if (!isPostizConfigured()) {
    return res.status(503).json({ ok: false, error: "POSTIZ_NOT_CONFIGURED" });
  }
  const integrationId = String(req.params.integrationId || "").trim();
  if (!integrationId) return res.status(400).json({ ok: false, error: "integrationId required" });
  try {
    const section = readPostizSection(req.ctx.dataDir);
    if (!section.postizUserId) return res.status(400).json({ ok: false, error: "No Postiz user provisioned" });
    await disconnectIntegration(section.postizUserId, integrationId);
    // Refresh cached integrations
    const remote = await listIntegrations(section.postizUserId);
    writePostizSection(req.ctx.dataDir, {
      integrations: Array.isArray(remote) ? remote : (remote?.integrations || []),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("[POSTIZ] disconnect error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/auto-publish", async (req, res) => {
  const section = readPostizSection(req.ctx.dataDir);
  res.json({
    ok: true,
    enabled: Boolean(section.autoPublish),
    platforms: Array.isArray(section.autoPublishPlatforms) ? section.autoPublishPlatforms : [],
  });
});

router.put("/auto-publish", async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const rawPlatforms = Array.isArray(req.body?.platforms) ? req.body.platforms : [];
  const platforms = rawPlatforms.map((p) => String(p || "").toLowerCase()).filter(Boolean);
  const updated = writePostizSection(req.ctx.dataDir, {
    autoPublish: enabled,
    autoPublishPlatforms: platforms,
  });
  res.json({ ok: true, enabled: Boolean(updated.autoPublish), platforms: updated.autoPublishPlatforms || [] });
});

router.post("/post", async (req, res) => {
  if (!isPostizConfigured()) {
    return res.status(503).json({ ok: false, error: "POSTIZ_NOT_CONFIGURED" });
  }
  try {
    const { videoUrl, caption, platforms, title } = req.body || {};
    if (!videoUrl) return res.status(400).json({ ok: false, error: "videoUrl required" });
    const section = readPostizSection(req.ctx.dataDir);
    if (!section.postizUserId) return res.status(400).json({ ok: false, error: "Connect a platform first" });
    const result = await postVideo({
      postizUserId: section.postizUserId,
      videoUrl,
      caption,
      platforms,
      title,
    });
    res.json({ ok: true, result });
  } catch (e) {
    console.error("[POSTIZ] post error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
