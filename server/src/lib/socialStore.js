import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";

function getStorePath() {
  const dir = DATA_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "social.json");
}

function normalizeSchedule(raw = {}) {
  return {
    id: String(raw.id || `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    name: String(raw.name || "Scheduled Post").trim() || "Scheduled Post",
    enabled: Boolean(raw.enabled ?? true),
    cron: String(raw.cron || "").trim(),
    timezone: String(raw.timezone || "").trim() || "UTC",
    destination: String(raw.destination || "webhook").trim(),
    caption: String(raw.caption || "").trim(),
    videoUrl: String(raw.videoUrl || "").trim(),
    webhookId: String(raw.webhookId || "").trim(),
    profileId: String(raw.profileId || "").trim(),
    privacyStatus: String(raw.privacyStatus || "private").trim() || "private",
  };
}

export function readSocialStore() {
  try {
    const file = getStorePath();
    if (!fs.existsSync(file)) {
      return { buffer: { accessToken: "", profileIds: [] }, webhooks: [], direct: { youtube: {}, instagram: {}, tiktok: {} }, schedules: [] };
    }
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    return {
      buffer: {
        accessToken: data?.buffer?.accessToken || "",
        profileIds: Array.isArray(data?.buffer?.profileIds) ? data.buffer.profileIds : [],
      },
      webhooks: Array.isArray(data?.webhooks) ? data.webhooks : [],
      direct: {
        youtube: data?.direct?.youtube || {},
        instagram: data?.direct?.instagram || {},
        tiktok: data?.direct?.tiktok || {},
      },
      schedules: Array.isArray(data?.schedules) ? data.schedules.map(normalizeSchedule) : [],
    };
  } catch {
    return { buffer: { accessToken: "", profileIds: [] }, webhooks: [], direct: { youtube: {}, instagram: {}, tiktok: {} }, schedules: [] };
  }
}

export function writeSocialStore(next) {
  const file = getStorePath();
  const payload = {
    buffer: {
      accessToken: String(next?.buffer?.accessToken || "").trim(),
      profileIds: Array.isArray(next?.buffer?.profileIds) ? next.buffer.profileIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
    },
    webhooks: Array.isArray(next?.webhooks) ? next.webhooks.map((w) => ({
      id: String(w?.id || `wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      name: String(w?.name || "Webhook").trim() || "Webhook",
      url: String(w?.url || "").trim(),
      enabled: Boolean(w?.enabled ?? true),
    })) : [],
    direct: {
      youtube: next?.direct?.youtube || {},
      instagram: next?.direct?.instagram || {},
      tiktok: next?.direct?.tiktok || {},
    },
    schedules: Array.isArray(next?.schedules) ? next.schedules.map(normalizeSchedule) : [],
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}
