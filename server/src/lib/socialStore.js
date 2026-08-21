import fs from "fs";
import path from "path";

function firstNonEmpty(...values) {
  for (const value of values) {
    const v = String(value || "").trim();
    if (v) return v;
  }
  return "";
}

function getYouTubeEnvDefaults() {
  return {
    clientId: firstNonEmpty(process.env.YOUTUBE_CLIENT_ID, process.env.SOCIAL_YOUTUBE_CLIENT_ID),
    clientSecret: firstNonEmpty(process.env.YOUTUBE_CLIENT_SECRET, process.env.SOCIAL_YOUTUBE_CLIENT_SECRET),
    refreshToken: firstNonEmpty(process.env.YOUTUBE_REFRESH_TOKEN, process.env.SOCIAL_YOUTUBE_REFRESH_TOKEN),
  };
}

function mergeYouTubeConfig(stored = {}) {
  const env = getYouTubeEnvDefaults();
  // Per-user values WIN over env. Env is the operator fallback (super-admin
  // shares ops-level YouTube creds via env vars). Regular users get their
  // own refreshToken set by the OAuth callback after they click "Connect
  // YouTube" — that's what enables per-user posting.
  return {
    clientId: firstNonEmpty(stored?.clientId, env.clientId),
    clientSecret: firstNonEmpty(stored?.clientSecret, env.clientSecret),
    refreshToken: firstNonEmpty(stored?.refreshToken, env.refreshToken),
    // Channel metadata captured during OAuth callback so the UI can
    // display "Connected to Sarah's Channel" instead of just "Connected".
    // Optional — older stores without these fields just show "Connected".
    channelId: String(stored?.channelId || "").trim(),
    channelTitle: String(stored?.channelTitle || "").trim(),
    connectedAt: stored?.connectedAt ? String(stored.connectedAt) : "",
  };
}

function getStorePath(dataDir) {
  if (!dataDir) throw new Error("social: dataDir required");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "social.json");
}

// This is an ALLOWLIST: anything not named here is dropped on save. `type` and
// the auto_generate settings were missing, so every save silently rewrote a
// schedule back to "replay" and discarded its content config. The schedule
// then reloaded as replay — which looked like the UI resetting itself, and
// like edits made on one device never reaching another.
//
// When adding a schedule field, it MUST be added here too or it will not
// survive a save.
function normalizeSchedule(raw = {}) {
  const optionalString = (value) => {
    const s = String(value ?? "").trim();
    return s ? s : undefined;
  };

  return {
    id: String(raw.id || `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    name: String(raw.name || "Scheduled Post").trim() || "Scheduled Post",
    enabled: Boolean(raw.enabled ?? true),
    // "replay" reposts a fixed URL; "auto_generate" builds a fresh video each
    // run. Anything unrecognised falls back to replay, matching the /schedules
    // route so both write paths agree.
    type: String(raw.type || "").trim() === "auto_generate" ? "auto_generate" : "replay",
    cron: String(raw.cron || "").trim(),
    timezone: String(raw.timezone || "").trim() || "UTC",
    destination: String(raw.destination || "webhook").trim(),
    caption: String(raw.caption || "").trim(),
    videoUrl: String(raw.videoUrl || "").trim(),
    webhookId: String(raw.webhookId || "").trim(),
    profileId: String(raw.profileId || "").trim(),
    privacyStatus: String(raw.privacyStatus || "private").trim() || "private",
    // auto_generate content settings. Left undefined rather than "" when
    // absent so the generator falls back to its own defaults instead of
    // being handed an empty string as an explicit choice.
    niche: optionalString(raw.niche),
    tone: optionalString(raw.tone),
    ctaStyle: optionalString(raw.ctaStyle),
    aspect: optionalString(raw.aspect),
    durationSec: Number.isFinite(Number(raw.durationSec)) ? Number(raw.durationSec) : undefined,
    voiceId: optionalString(raw.voiceId),
    backgroundQuery: optionalString(raw.backgroundQuery),
  };
}

function normalizePostiz(raw = {}) {
  return {
    postizUserId: String(raw?.postizUserId || "").trim(),
    lastSync: raw?.lastSync ? String(raw.lastSync) : null,
    integrations: Array.isArray(raw?.integrations) ? raw.integrations : [],
    autoPublish: Boolean(raw?.autoPublish),
    autoPublishPlatforms: Array.isArray(raw?.autoPublishPlatforms)
      ? raw.autoPublishPlatforms.map((p) => String(p || "").toLowerCase()).filter(Boolean)
      : [],
  };
}

function emptyStore() {
  return {
    buffer: { accessToken: "", profileIds: [] },
    webhooks: [],
    direct: { youtube: mergeYouTubeConfig({}), instagram: {}, tiktok: {} },
    schedules: [],
    postiz: normalizePostiz({}),
  };
}

/**
 * Recover the `type` of a schedule written before it was persisted.
 *
 * normalizeSchedule's allowlist omitted `type`, so schedules saved by older
 * builds have NO type field at all and would now default to "replay". A replay
 * schedule with no videoUrl can never post anything, so such a record is
 * certainly a lost auto_generate — recovering it is strictly better than
 * leaving the operator with a schedule that silently cannot run.
 *
 * Only applied when `type` is ABSENT. An explicit "replay" is always honoured.
 *
 * @param {object} raw a schedule as read from disk
 * @returns {object} the schedule with a usable type
 */
function recoverScheduleType(raw = {}) {
  if (raw.type) return raw;
  const hasReplayTarget = String(raw.videoUrl || "").trim().length > 0;
  return { ...raw, type: hasReplayTarget ? "replay" : "auto_generate" };
}

export function readSocialStore(dataDir) {
  try {
    const file = getStorePath(dataDir);
    if (!fs.existsSync(file)) return emptyStore();
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    return {
      buffer: {
        accessToken: data?.buffer?.accessToken || "",
        profileIds: Array.isArray(data?.buffer?.profileIds) ? data.buffer.profileIds : [],
      },
      webhooks: Array.isArray(data?.webhooks) ? data.webhooks : [],
      direct: {
        youtube: mergeYouTubeConfig(data?.direct?.youtube || {}),
        instagram: data?.direct?.instagram || {},
        tiktok: data?.direct?.tiktok || {},
      },
      schedules: Array.isArray(data?.schedules)
        ? data.schedules.map((r) => normalizeSchedule(recoverScheduleType(r)))
        : [],
      postiz: normalizePostiz(data?.postiz || {}),
    };
  } catch {
    return emptyStore();
  }
}

export function writeSocialStore(dataDir, next) {
  const file = getStorePath(dataDir);
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
      // Delivery history surfaced in the UI as "Last delivery: 2 days ago"
      // + failure indicators. Touched by every dispatch (test or
      // production) so users see proof their scenario is reachable AND
      // catch silent breakages (e.g. user deleted the Make scenario after
      // saving it here) without needing to wait for a real render to fail.
      lastSuccessAt: w?.lastSuccessAt ? String(w.lastSuccessAt) : "",
      lastFailureAt: w?.lastFailureAt ? String(w.lastFailureAt) : "",
      lastFailureMessage: w?.lastFailureMessage ? String(w.lastFailureMessage).slice(0, 300) : "",
      failureCount: Number.isFinite(Number(w?.failureCount)) ? Math.max(0, Number(w.failureCount)) : 0,
    })) : [],
    direct: {
      youtube: {
        clientId: String(next?.direct?.youtube?.clientId || "").trim(),
        clientSecret: String(next?.direct?.youtube?.clientSecret || "").trim(),
        refreshToken: String(next?.direct?.youtube?.refreshToken || "").trim(),
        channelId: String(next?.direct?.youtube?.channelId || "").trim(),
        channelTitle: String(next?.direct?.youtube?.channelTitle || "").trim(),
        connectedAt: next?.direct?.youtube?.connectedAt ? String(next.direct.youtube.connectedAt) : "",
      },
      instagram: next?.direct?.instagram || {},
      tiktok: next?.direct?.tiktok || {},
    },
    schedules: Array.isArray(next?.schedules) ? next.schedules.map(normalizeSchedule) : [],
    postiz: normalizePostiz(next?.postiz || {}),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}
