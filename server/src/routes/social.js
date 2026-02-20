import { Router } from "express";
import fetch from "node-fetch";
import { readSocialStore, writeSocialStore } from "../lib/socialStore.js";

const router = Router();

function toAbsolutePublicUrl(req, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const proto = req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim() : req.protocol;
  const host = req.headers["x-forwarded-host"] ? String(req.headers["x-forwarded-host"]).split(",")[0].trim() : req.get("host");
  if (!host) return raw;
  const pathOnly = raw.startsWith("/") ? raw : `/${raw}`;
  return `${proto}://${host}${pathOnly}`;
}

router.get("/config", (req, res) => {
  const store = readSocialStore();
  res.json({
    ok: true,
    buffer: {
      enabled: Boolean(store.buffer?.accessToken),
      profileIds: store.buffer?.profileIds || [],
    },
    direct: store.direct || {},
    webhooks: (store.webhooks || []).map((w) => ({ id: w.id, name: w.name, url: w.url, enabled: w.enabled })),
  });
});

router.post("/config", (req, res) => {
  const payload = req.body || {};
  const store = readSocialStore();
  const buffer = payload.buffer || store.buffer || {};
  const webhooks = Array.isArray(payload.webhooks) ? payload.webhooks : store.webhooks || [];
  const direct = payload.direct || store.direct || {};

  const next = {
    buffer: {
      accessToken: String(buffer.accessToken || store.buffer?.accessToken || "").trim(),
      profileIds: Array.isArray(buffer.profileIds) ? buffer.profileIds : (store.buffer?.profileIds || []),
    },
    webhooks: webhooks.map((w) => ({
      id: w.id || `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(w.name || "Webhook").trim(),
      url: String(w.url || "").trim(),
      enabled: Boolean(w.enabled ?? true),
    })),
    direct: {
      youtube: direct.youtube || store.direct?.youtube || {},
      instagram: direct.instagram || store.direct?.instagram || {},
      tiktok: direct.tiktok || store.direct?.tiktok || {},
    },
  };

  writeSocialStore(next);
  res.json({ ok: true });
});

router.post("/buffer/profiles", async (req, res) => {
  try {
    const store = readSocialStore();
    const accessToken = String(req.body?.accessToken || store.buffer?.accessToken || "").trim();
    if (!accessToken) return res.status(400).json({ ok: false, error: "Buffer access token missing" });

    const resp = await fetch(`https://api.bufferapp.com/1/profiles.json?access_token=${accessToken}`);
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(400).json({ ok: false, error: `Buffer error: ${resp.status} ${err}` });
    }
    const profiles = await resp.json();
    res.json({ ok: true, profiles });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/post", async (req, res) => {
  try {
    const { destination, caption, videoUrl, profileIds, webhookId, webhookUrl } = req.body || {};
    if (!caption || !videoUrl) return res.status(400).json({ ok: false, error: "caption and videoUrl required" });
    const mediaUrl = toAbsolutePublicUrl(req, videoUrl);
    if (!/^https?:\/\//i.test(mediaUrl)) {
      return res.status(400).json({ ok: false, error: `videoUrl must be absolute or resolvable: ${videoUrl}` });
    }

    if (destination === "webhook") {
      const store = readSocialStore();
      const target = (store.webhooks || []).find((w) => w.id === webhookId && w.enabled);
      const url = String(target?.url || webhookUrl || "").trim();
      if (!url) return res.status(400).json({ ok: false, error: "Webhook not configured" });
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          videoUrl: mediaUrl,
          source: "biblefuel-studio",
          sentAt: new Date().toISOString(),
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return res.status(400).json({ ok: false, error: `Webhook failed: ${resp.status} ${err}` });
      }
      return res.json({ ok: true, videoUrl: mediaUrl });
    }

    if (destination === "buffer") {
      const store = readSocialStore();
      const accessToken = String(store.buffer?.accessToken || "").trim();
      const ids = Array.isArray(profileIds) && profileIds.length ? profileIds : (store.buffer?.profileIds || []);
      if (!accessToken) return res.status(400).json({ ok: false, error: "Buffer access token missing" });
      if (!ids.length) return res.status(400).json({ ok: false, error: "Buffer profileIds missing" });

      const form = new URLSearchParams();
      ids.forEach((id) => form.append("profile_ids[]", id));
      form.append("text", caption);
      form.append("media[link]", mediaUrl);
      form.append("now", "true");
      form.append("access_token", accessToken);

      const resp = await fetch("https://api.bufferapp.com/1/updates/create.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      if (!resp.ok) {
        const err = await resp.text();
        return res.status(400).json({ ok: false, error: `Buffer post failed: ${resp.status} ${err}` });
      }
      const data = await resp.json();
      return res.json({ ok: true, data, videoUrl: mediaUrl });
    }

    if (destination === "youtube" || destination === "instagram" || destination === "tiktok") {
      return res.status(400).json({
        ok: false,
        error: "Direct API posting is not implemented in this build. Use Webhook (Make/Zapier) or Buffer.",
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown destination" });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;

