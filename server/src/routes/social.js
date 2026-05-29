import { Router } from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import cron from "node-cron";
import { google } from "googleapis";
import { readSocialStore, writeSocialStore } from "../lib/socialStore.js";
// DATA_DIR is used ONLY by the boot-time cron rehydrator below, which operates
// on the super-admin's global social.json. Per-user schedule rehydration is
// Phase 4 work; see specs/2026-05-26-public-multitenancy-design.md §6.
import { DATA_DIR, OUTPUT_DIR } from "../lib/paths.js";

const router = Router();
const scheduleTasks = new Map();

function getConfiguredPublicBaseUrl() {
  return String(
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
  ).trim().replace(/\/+$/, "");
}

function getRequestPublicBaseUrl(req) {
  if (!req) return getConfiguredPublicBaseUrl();
  const proto = req.headers["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
    : req.protocol;
  const host = req.headers["x-forwarded-host"]
    ? String(req.headers["x-forwarded-host"]).split(",")[0].trim()
    : req.get("host");
  if (!host) return getConfiguredPublicBaseUrl();
  return `${proto}://${host}`;
}

function toAbsolutePublicUrl(req, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getRequestPublicBaseUrl(req);
  if (!base) return raw;
  const pathOnly = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${pathOnly}`;
}

function resolveOutputAlias(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (fs.existsSync(raw)) return path.resolve(raw);

  const normalized = raw.replace(/\\/g, "/");
  if (normalized.startsWith("/outputs/")) return path.join(OUTPUT_DIR, normalized.slice("/outputs/".length));
  if (normalized.startsWith("outputs/")) return path.join(OUTPUT_DIR, normalized.slice("outputs/".length));
  if (normalized.startsWith("./outputs/")) return path.join(OUTPUT_DIR, normalized.slice("./outputs/".length));
  if (normalized.startsWith("server/outputs/")) return path.join(OUTPUT_DIR, normalized.slice("server/outputs/".length));

  const byName = path.join(OUTPUT_DIR, path.basename(normalized));
  if (fs.existsSync(byName)) return byName;
  return null;
}

async function resolveVideoInputForUpload(videoUrl, req) {
  const raw = String(videoUrl || "").trim();
  if (!raw) throw new Error("videoUrl required");

  const local = resolveOutputAlias(raw);
  if (local && fs.existsSync(local)) {
    return { filePath: local, cleanup: async () => {} };
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const localFromPath = resolveOutputAlias(u.pathname);
      if (localFromPath && fs.existsSync(localFromPath)) {
        return { filePath: localFromPath, cleanup: async () => {} };
      }
    } catch {}
  }

  const absoluteUrl = toAbsolutePublicUrl(req, raw);
  if (!/^https?:\/\//i.test(absoluteUrl)) {
    throw new Error(`videoUrl must be absolute or resolvable: ${videoUrl}`);
  }

  const resp = await fetch(absoluteUrl);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to fetch video: ${resp.status} ${errText}`);
  }
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!bytes.length) throw new Error("Fetched video is empty");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, `youtube-upload-${uuid()}.mp4`);
  fs.writeFileSync(outFile, bytes);

  return {
    filePath: outFile,
    cleanup: async () => {
      try { fs.unlinkSync(outFile); } catch {}
    },
  };
}

function sanitizePrivacyStatus(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "public" || v === "unlisted" || v === "private") return v;
  return "private";
}

function titleFromCaption(title, caption) {
  const provided = String(title || "").trim();
  if (provided) return provided.slice(0, 100);
  const fromCaption = String(caption || "").trim().split("\n").find(Boolean) || "Biblefuel Studio Upload";
  return fromCaption.slice(0, 100);
}

const BIBLE_REFERENCE_REGEX = /\b(?:[1-3]\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d+:\d+(?:[-–]\d+)?\b/;

function deriveCleanTitle(caption) {
  const text = String(caption || "").trim();
  if (!text) return "Biblefuel Studio";

  const firstChunk = text.split(/[\n.!?]/).find((s) => s.trim().length > 0) || text;
  const hook = firstChunk.trim().replace(/[\s\-,;:]+$/, "");

  const referenceMatch = text.match(BIBLE_REFERENCE_REGEX);
  const reference = referenceMatch ? referenceMatch[0].trim() : "";

  const combined = reference && !hook.includes(reference)
    ? `${hook} - ${reference}`
    : hook;

  const cleaned = combined.slice(0, 100).trim();
  return cleaned || "Biblefuel Studio";
}

async function publishToZernioTikTok({ caption, videoUrl, title }) {
  const apiKey = String(process.env.ZERNIO_API_KEY || "").trim();
  const accountId = String(process.env.ZERNIO_TIKTOK_ACCOUNT_ID || "").trim();
  if (!apiKey || !accountId) {
    return { skipped: true, reason: "ZERNIO_API_KEY or ZERNIO_TIKTOK_ACCOUNT_ID not set" };
  }

  const resp = await fetch("https://zernio.com/api/v1/posts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: caption,
      title,
      publishNow: true,
      isDraft: false,
      platforms: [{ platform: "tiktok", accountId }],
      mediaItems: [{ type: "video", url: videoUrl }],
    }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Zernio publish failed: ${resp.status} ${text.slice(0, 500)}`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { ok: true, data };
}

async function postToWebhook({ caption, videoUrl, title, webhookId, webhookUrl }, req, store) {
  const mediaUrl = toAbsolutePublicUrl(req, videoUrl);
  if (!/^https?:\/\//i.test(mediaUrl)) {
    throw new Error(`videoUrl must be absolute or resolvable: ${videoUrl}`);
  }

  // Resolve webhook in this order:
  //   1. Explicit webhookId match in the store (and enabled).
  //   2. Caller-supplied webhookUrl.
  //   3. The first enabled webhook in the store (so one-click Auto-Publish
  //      Just Works without the caller having to know which webhook ID to pass).
  const webhooks = Array.isArray(store.webhooks) ? store.webhooks : [];
  const exact = webhookId ? webhooks.find((w) => w.id === webhookId && w.enabled) : null;
  const firstEnabled = !exact && !webhookUrl ? webhooks.find((w) => w.enabled && String(w.url || "").trim()) : null;
  const target = exact || firstEnabled;
  const url = String(target?.url || webhookUrl || "").trim();
  // Env Zernio is operator-only. For regular users, falling back to env
  // Zernio would post THEIR campaign to the OPERATOR'S TikTok account,
  // which is a multi-tenant cross-tenant leak. Gate on req.ctx.isSuperAdmin
  // (set in jobs.js when persisting the job ctx, or by the userScope
  // middleware on direct HTTP calls).
  const callerIsSuperAdmin = Boolean(req?.ctx?.isSuperAdmin);
  const zernioConfigured = callerIsSuperAdmin && Boolean(
    String(process.env.ZERNIO_API_KEY || "").trim() &&
    String(process.env.ZERNIO_TIKTOK_ACCOUNT_ID || "").trim()
  );
  if (!url && !zernioConfigured) {
    throw new Error(callerIsSuperAdmin
      ? "No destination configured. Set a Make/Zapier webhook in Settings, or configure ZERNIO_API_KEY + ZERNIO_TIKTOK_ACCOUNT_ID in server/.env."
      : "No destination configured for your account. Connect a Make / Zapier webhook in Settings to enable auto-publish.",
    );
  }

  const resolvedTitle = String(title || "").trim().slice(0, 100) || deriveCleanTitle(caption);

  let make = null;
  if (url) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: resolvedTitle,
        caption,
        videoUrl: mediaUrl,
        source: "biblefuel-studio",
        sentAt: new Date().toISOString(),
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      // If Zernio is also configured, treat Make's failure as soft so we
      // still attempt TikTok directly.
      const msg = `Webhook failed: ${resp.status} ${err.slice(0, 300)}`;
      if (!zernioConfigured) throw new Error(msg);
      make = { ok: false, error: msg };
    } else {
      make = { ok: true };
    }
  }

  let zernio = null;
  if (zernioConfigured) {
    try {
      zernio = await publishToZernioTikTok({ caption, videoUrl: mediaUrl, title: resolvedTitle });
    } catch (e) {
      zernio = { ok: false, error: e?.message || String(e) };
    }
  }

  const success = (make?.ok === true) || (zernio?.ok === true);
  return { ok: success, videoUrl: mediaUrl, title: resolvedTitle, make, zernio };
}

async function postToBuffer({ caption, videoUrl, profileIds }, req, store) {
  const mediaUrl = toAbsolutePublicUrl(req, videoUrl);
  if (!/^https?:\/\//i.test(mediaUrl)) {
    throw new Error(`videoUrl must be absolute or resolvable: ${videoUrl}`);
  }

  const accessToken = String(store.buffer?.accessToken || "").trim();
  const ids = Array.isArray(profileIds) && profileIds.length ? profileIds : (store.buffer?.profileIds || []);
  if (!accessToken) throw new Error("Buffer access token missing");
  if (!ids.length) throw new Error("Buffer profileIds missing");

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
    throw new Error(`Buffer post failed: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  return { data, videoUrl: mediaUrl };
}

async function postToYoutube({ caption, videoUrl, title, privacyStatus }, req, store) {
  const yt = store.direct?.youtube || {};
  const clientId = String(yt.clientId || "").trim();
  const clientSecret = String(yt.clientSecret || "").trim();
  const refreshToken = String(yt.refreshToken || "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YouTube direct config missing. Set clientId, clientSecret, and refreshToken in Settings.");
  }

  const upload = await resolveVideoInputForUpload(videoUrl, req);
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });

    const youtube = google.youtube({ version: "v3", auth: oauth2 });
    const requestBody = {
      snippet: {
        title: titleFromCaption(title, caption),
        description: String(caption || "").slice(0, 5000),
      },
      status: {
        privacyStatus: sanitizePrivacyStatus(privacyStatus),
        selfDeclaredMadeForKids: false,
      },
    };

    const result = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody,
      media: { body: fs.createReadStream(upload.filePath) },
    });

    const videoId = String(result?.data?.id || "").trim();
    return {
      data: result.data,
      videoId,
      videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    };
  } finally {
    await upload.cleanup();
  }
}

export async function dispatchPost(payload, req) {
  const { destination, caption, videoUrl, profileIds, webhookId, webhookUrl, title, privacyStatus } = payload || {};
  if (!caption || !videoUrl) throw new Error("caption and videoUrl required");

  // Cron-triggered calls pass a reqLike without ctx — fall back to DATA_DIR
  // (super-admin's store). Phase 4 will switch this to per-schedule ctx.
  const storeDir = req?.ctx?.dataDir || DATA_DIR;
  const store = readSocialStore(storeDir);

  if (destination === "webhook") {
    return postToWebhook({ caption, videoUrl, title, webhookId, webhookUrl }, req, store);
  }

  if (destination === "buffer") {
    return postToBuffer({ caption, videoUrl, profileIds }, req, store);
  }

  if (destination === "youtube") {
    return postToYoutube({ caption, videoUrl, title, privacyStatus }, req, store);
  }

  if (destination === "instagram" || destination === "tiktok") {
    throw new Error("Direct API posting for Instagram/TikTok is not implemented. Use Webhook (Make/Zapier) or Buffer.");
  }

  throw new Error("Unknown destination");
}

function scheduleSignature(s) {
  return JSON.stringify({
    enabled: Boolean(s.enabled),
    type: String(s.type || "replay"),
    cron: String(s.cron || ""),
    timezone: String(s.timezone || "UTC"),
    destination: String(s.destination || "webhook"),
    caption: String(s.caption || ""),
    videoUrl: String(s.videoUrl || ""),
    webhookId: String(s.webhookId || ""),
    profileId: String(s.profileId || ""),
    privacyStatus: String(s.privacyStatus || "private"),
  });
}

async function runScheduledPost(schedule) {
  try {
    if (!schedule?.enabled) return;

    // Type "auto_generate": enqueue a campaign_auto_post job that produces a
    // fresh video (script + bg + voice + render) and fires the webhook.
    if (String(schedule.type || "replay") === "auto_generate") {
      const { enqueueCampaignAutoPost } = await import("./jobs.js");
      const job = await enqueueCampaignAutoPost({
        destination: schedule.destination || "webhook",
        webhookId: schedule.webhookId || undefined,
        profileIds: schedule.profileId ? [schedule.profileId] : undefined,
        title: schedule.name,
        privacyStatus: schedule.privacyStatus,
        // Optional content knobs piggy-backed on the schedule row.
        niche: schedule.niche,
        tone: schedule.tone,
        ctaStyle: schedule.ctaStyle,
        aspect: schedule.aspect,
        durationSec: schedule.durationSec,
        voiceId: schedule.voiceId,
        backgroundQuery: schedule.backgroundQuery,
      });
      console.log(`[SOCIAL][CRON] Schedule ${schedule.id} enqueued auto_generate job ${job?.id}`);
      return;
    }

    // Default "replay": post an existing videoUrl through the configured destination.
    const payload = {
      destination: schedule.destination,
      caption: schedule.caption,
      videoUrl: schedule.videoUrl,
      webhookId: schedule.webhookId || undefined,
      profileIds: schedule.profileId ? [schedule.profileId] : undefined,
      title: schedule.name,
      privacyStatus: schedule.privacyStatus,
    };
    const reqLike = {
      headers: {},
      protocol: "https",
      get: () => "",
    };
    const result = await dispatchPost(payload, reqLike);
    console.log(`[SOCIAL][CRON] Schedule ${schedule.id} posted successfully`, {
      destination: schedule.destination,
      videoUrl: result?.videoUrl || "",
    });
  } catch (e) {
    console.warn(`[SOCIAL][CRON] Schedule ${schedule?.id || "<unknown>"} failed:`, e?.message || e);
  }
}

function stopScheduleTask(id) {
  const current = scheduleTasks.get(id);
  if (!current) return;
  try { current.task.stop(); } catch {}
  scheduleTasks.delete(id);
}

function refreshScheduleTasks() {
  // Phase 1: super-admin only. Per-user schedule rehydration is Phase 4 work.
  // See specs/2026-05-26-public-multitenancy-design.md §6 — when MULTITENANT
  // ships, walk users/*/social.json and key tasks by `${userId}::${schedule.id}`.
  const store = readSocialStore(DATA_DIR);
  const schedules = Array.isArray(store.schedules) ? store.schedules : [];
  const activeIds = new Set();

  for (const s of schedules) {
    const id = String(s.id || "").trim();
    if (!id) continue;
    activeIds.add(id);

    const sig = scheduleSignature(s);
    const existing = scheduleTasks.get(id);
    if (existing && existing.signature === sig) continue;
    if (existing) stopScheduleTask(id);

    if (!s.enabled) continue;
    if (!s.cron || !cron.validate(s.cron)) {
      console.warn(`[SOCIAL][CRON] Invalid cron for schedule ${id}: ${s.cron}`);
      continue;
    }

    const task = cron.schedule(
      s.cron,
      async () => { await runScheduledPost(s); },
      { timezone: s.timezone || "UTC" }
    );

    scheduleTasks.set(id, { task, signature: sig });
    console.log(`[SOCIAL][CRON] Scheduled ${id} (${s.name}) at "${s.cron}" tz=${s.timezone || "UTC"}`);
  }

  for (const [id] of scheduleTasks) {
    if (!activeIds.has(id)) stopScheduleTask(id);
  }
}

setTimeout(() => {
  try { refreshScheduleTasks(); } catch (e) { console.warn("[SOCIAL][CRON] init failed:", e?.message || e); }
}, 1200);


/**
 * Pre-flight status for the AutoPublishCard / any "Auto-Publish Now" button.
 * Tells the caller whether the user has any destination connected and what
 * kinds. Drives the render-only-mode badge in the UI.
 *
 * Returns shape:
 *   {
 *     ok: true,
 *     canAutoPublish: boolean,        // any destination connected?
 *     destinations: string[],         // ["webhook"], ["webhook","zernio"], etc.
 *     isSuperAdmin: boolean,          // UI uses this for "configure in .env" vs "Settings" hint
 *   }
 *
 * Tier rules:
 *   - super-admin: env Zernio counts
 *   - regular user: only their own webhooks count (env Zernio off-limits)
 */
router.get("/auto-publish-status", (req, res) => {
  const store = readSocialStore(req.ctx.dataDir);
  const enabledWebhooks = Array.isArray(store?.webhooks)
    ? store.webhooks.filter((w) => w?.enabled && String(w?.url || "").trim())
    : [];
  const destinations = [];
  if (enabledWebhooks.length > 0) destinations.push("webhook");

  if (req.ctx.isSuperAdmin) {
    const zernioOn = Boolean(
      String(process.env.ZERNIO_API_KEY || "").trim() &&
      String(process.env.ZERNIO_TIKTOK_ACCOUNT_ID || "").trim(),
    );
    if (zernioOn) destinations.push("zernio");
  }

  res.json({
    ok: true,
    canAutoPublish: destinations.length > 0,
    destinations,
    isSuperAdmin: Boolean(req.ctx.isSuperAdmin),
  });
});

router.get("/config", (req, res) => {
  const store = readSocialStore(req.ctx.dataDir);
  res.json({
    ok: true,
    buffer: {
      enabled: Boolean(store.buffer?.accessToken),
      profileIds: store.buffer?.profileIds || [],
    },
    direct: store.direct || {},
    schedules: store.schedules || [],
    webhooks: (store.webhooks || []).map((w) => ({ id: w.id, name: w.name, url: w.url, enabled: w.enabled })),
  });
});

router.post("/config", (req, res) => {
  const payload = req.body || {};
  const store = readSocialStore(req.ctx.dataDir);
  const buffer = payload.buffer || store.buffer || {};
  const webhooks = Array.isArray(payload.webhooks) ? payload.webhooks : store.webhooks || [];
  const direct = payload.direct || store.direct || {};
  const schedules = Array.isArray(payload.schedules) ? payload.schedules : (store.schedules || []);

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
    schedules,
  };

  writeSocialStore(req.ctx.dataDir, next);
  if (req.ctx.isSuperAdmin) refreshScheduleTasks();
  res.json({ ok: true });
});

router.get("/schedules", (req, res) => {
  const store = readSocialStore(req.ctx.dataDir);
  res.json({ ok: true, schedules: store.schedules || [] });
});

router.post("/schedules", (req, res) => {
  try {
    const incoming = req.body?.schedule || req.body || {};
    const type = String(incoming.type || "replay").trim() === "auto_generate" ? "auto_generate" : "replay";
    const schedule = {
      id: String(incoming.id || `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      name: String(incoming.name || (type === "auto_generate" ? "Auto-Generate Post" : "Scheduled Post")).trim() || "Scheduled Post",
      enabled: Boolean(incoming.enabled ?? true),
      type,
      cron: String(incoming.cron || "").trim(),
      timezone: String(incoming.timezone || "").trim() || "UTC",
      destination: String(incoming.destination || "webhook").trim(),
      caption: String(incoming.caption || "").trim(),
      videoUrl: String(incoming.videoUrl || "").trim(),
      webhookId: String(incoming.webhookId || "").trim(),
      profileId: String(incoming.profileId || "").trim(),
      privacyStatus: String(incoming.privacyStatus || "private").trim() || "private",
      // Auto-generate content knobs (optional, used only when type === auto_generate)
      niche: String(incoming.niche || "").trim() || undefined,
      tone: String(incoming.tone || "").trim() || undefined,
      ctaStyle: String(incoming.ctaStyle || "").trim() || undefined,
      aspect: String(incoming.aspect || "").trim() || undefined,
      durationSec: Number.isFinite(Number(incoming.durationSec)) ? Number(incoming.durationSec) : undefined,
      voiceId: String(incoming.voiceId || "").trim() || undefined,
      backgroundQuery: String(incoming.backgroundQuery || "").trim() || undefined,
    };

    if (!schedule.cron || !cron.validate(schedule.cron)) {
      return res.status(400).json({ ok: false, error: "Invalid cron expression" });
    }
    if (schedule.type === "replay" && (!schedule.caption || !schedule.videoUrl)) {
      return res.status(400).json({ ok: false, error: "caption and videoUrl are required for replay schedules" });
    }

    const store = readSocialStore(req.ctx.dataDir);
    const list = Array.isArray(store.schedules) ? store.schedules : [];
    const index = list.findIndex((x) => String(x.id) === schedule.id);
    if (index >= 0) list[index] = schedule;
    else list.unshift(schedule);

    writeSocialStore(req.ctx.dataDir, { ...store, schedules: list });
    if (req.ctx.isSuperAdmin) refreshScheduleTasks();
    res.json({ ok: true, schedule });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.delete("/schedules/:id", (req, res) => {
  const id = String(req.params?.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "schedule id required" });
  const store = readSocialStore(req.ctx.dataDir);
  const list = (store.schedules || []).filter((s) => String(s.id) !== id);
  writeSocialStore(req.ctx.dataDir, { ...store, schedules: list });
  if (req.ctx.isSuperAdmin) refreshScheduleTasks();
  res.json({ ok: true });
});

router.post("/buffer/profiles", async (req, res) => {
  try {
    const store = readSocialStore(req.ctx.dataDir);
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
    const result = await dispatchPost(req.body || {}, req);
    return res.json({ ok: true, ...result });
  } catch (e) {
    const message = String(e?.message || e);
    const status = message.toLowerCase().includes("missing") ? 400 : 400;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;

