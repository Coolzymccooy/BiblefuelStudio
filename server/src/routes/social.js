import { Router } from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import cron from "node-cron";
import { google } from "googleapis";
import { readSocialStore, writeSocialStore } from "../lib/socialStore.js";
import { OUTPUT_DIR } from "../lib/paths.js";

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

async function postToWebhook({ caption, videoUrl, webhookId, webhookUrl }, req, store) {
  const mediaUrl = toAbsolutePublicUrl(req, videoUrl);
  if (!/^https?:\/\//i.test(mediaUrl)) {
    throw new Error(`videoUrl must be absolute or resolvable: ${videoUrl}`);
  }

  const target = (store.webhooks || []).find((w) => w.id === webhookId && w.enabled);
  const url = String(target?.url || webhookUrl || "").trim();
  if (!url) throw new Error("Webhook not configured");

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
    throw new Error(`Webhook failed: ${resp.status} ${err}`);
  }

  return { videoUrl: mediaUrl };
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

async function dispatchPost(payload, req) {
  const { destination, caption, videoUrl, profileIds, webhookId, webhookUrl, title, privacyStatus } = payload || {};
  if (!caption || !videoUrl) throw new Error("caption and videoUrl required");

  const store = readSocialStore();

  if (destination === "webhook") {
    return postToWebhook({ caption, videoUrl, webhookId, webhookUrl }, req, store);
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
  const store = readSocialStore();
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


router.get("/config", (req, res) => {
  const store = readSocialStore();
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
  const store = readSocialStore();
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

  writeSocialStore(next);
  refreshScheduleTasks();
  res.json({ ok: true });
});

router.get("/schedules", (req, res) => {
  const store = readSocialStore();
  res.json({ ok: true, schedules: store.schedules || [] });
});

router.post("/schedules", (req, res) => {
  try {
    const incoming = req.body?.schedule || req.body || {};
    const schedule = {
      id: String(incoming.id || `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      name: String(incoming.name || "Scheduled Post").trim() || "Scheduled Post",
      enabled: Boolean(incoming.enabled ?? true),
      cron: String(incoming.cron || "").trim(),
      timezone: String(incoming.timezone || "").trim() || "UTC",
      destination: String(incoming.destination || "webhook").trim(),
      caption: String(incoming.caption || "").trim(),
      videoUrl: String(incoming.videoUrl || "").trim(),
      webhookId: String(incoming.webhookId || "").trim(),
      profileId: String(incoming.profileId || "").trim(),
      privacyStatus: String(incoming.privacyStatus || "private").trim() || "private",
    };

    if (!schedule.cron || !cron.validate(schedule.cron)) {
      return res.status(400).json({ ok: false, error: "Invalid cron expression" });
    }
    if (!schedule.caption || !schedule.videoUrl) {
      return res.status(400).json({ ok: false, error: "caption and videoUrl are required for schedules" });
    }

    const store = readSocialStore();
    const list = Array.isArray(store.schedules) ? store.schedules : [];
    const index = list.findIndex((x) => String(x.id) === schedule.id);
    if (index >= 0) list[index] = schedule;
    else list.unshift(schedule);

    writeSocialStore({ ...store, schedules: list });
    refreshScheduleTasks();
    res.json({ ok: true, schedule });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.delete("/schedules/:id", (req, res) => {
  const id = String(req.params?.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "schedule id required" });
  const store = readSocialStore();
  const list = (store.schedules || []).filter((s) => String(s.id) !== id);
  writeSocialStore({ ...store, schedules: list });
  refreshScheduleTasks();
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
    const result = await dispatchPost(req.body || {}, req);
    return res.json({ ok: true, ...result });
  } catch (e) {
    const message = String(e?.message || e);
    const status = message.toLowerCase().includes("missing") ? 400 : 400;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;

