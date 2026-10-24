import { z } from "zod";
import { ok, fail, PUBLISH_NOT_ALLOWED_MESSAGE } from "../toolResult.js";
import { NORMALISERS, outputUrl } from "../jobs.js";
import { resolveMediaOutput } from "../mediaPath.js";
import { lacksPublishConsent } from "../autoPublish.js";
import { renderQuotaRefusal } from "../planQuota.js";
import { VOICE_ID_PATTERN } from "./voice.js";

// Publishing tools (spec "Publishing needs the key owner's consent", rulings
// R27-R29). Every file an agent names is confined to the key owner's media
// folder and sent as its /outputs/ link; no tool takes a URL the server would
// fetch or post to (no webhookUrl, no videoUrl): a webhook is chosen by the id
// of one the user saved in Settings.

const PRIVACY = ["private", "unlisted", "public"];
const POST_DESTINATIONS = ["webhook", "buffer"];
const CAMPAIGN_DESTINATIONS = ["webhook", "buffer", "youtube"];
const SCHEDULE_ACTIONS = ["list", "create", "remove"];
const SCHEDULE_TYPES = ["replay", "auto_generate"];
const ASPECTS = ["portrait", "landscape", "square"];
const SAVED_ID = /^[\w-]{1,100}$/;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const STYLE_WORD = /^[\w-]{1,40}$/;
// Images that image generation wrote to the shared genImg folder: the route
// confines these to genImg itself; no dots in a segment, so no traversal.
const GENERATED_IMAGE = /^\/outputs\/genImg\/(?:[\w-]+\/){0,3}[\w-]+\.(?:png|jpe?g|webp)$/i;
// At most once an hour: five fields, the minute one a single number.
const HOURLY_AT_MOST = /^\d{1,2}$/;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const refuseWithoutConsent = () => fail("PUBLISH_NOT_ALLOWED", PUBLISH_NOT_ALLOWED_MESSAGE);

/** A video in the user's media folder as its /outputs/ link (`absolute`: the full public URL). */
async function videoLink(ctx, videoPath, { absolute = false } = {}) {
  const checked = await resolveMediaOutput(ctx, videoPath);
  if (checked.refusal) return checked;
  return { link: absolute ? outputUrl(checked.outputsPath, ctx.publicBase) : checked.outputsPath };
}

/**
 * WEBHOOK_NOT_FOUND unless `webhookId` names one of the user's saved webhooks that is enabled.
 * The route falls back to the first enabled hook for an unknown id, so an id is checked first.
 */
async function webhookRefusal(ctx, webhookId) {
  if (webhookId === undefined) return null;
  const config = await ctx.api.call("GET", "/api/social/config");
  const hooks = Array.isArray(config?.webhooks) ? config.webhooks : [];
  if (hooks.some((hook) => String(hook?.id) === webhookId && hook?.enabled === true)) return null;
  return fail("WEBHOOK_NOT_FOUND", `No enabled webhook with id "${webhookId}". Use an enabled webhook id from social_status, or leave webhookId out.`);
}

async function thumbnailLink(ctx, thumbnailPath) {
  if (thumbnailPath === undefined) return { link: undefined };
  if (GENERATED_IMAGE.test(thumbnailPath)) return { link: thumbnailPath };
  return videoLink(ctx, thumbnailPath);
}

// ---- social_status -----------------------------------------------------------

const pick = (source, fields) => Object.fromEntries(fields.filter((f) => source?.[f] !== undefined).map((f) => [f, source[f]]));

/** An API call whose failure is reported, not thrown (only ApiErrors; bugs still throw). */
async function tolerant(promise) {
  try {
    return { body: await promise };
  } catch (err) {
    if (err?.name === "ApiError") return { error: err.message || "unavailable" };
    throw err;
  }
}

const scheduleRow = (s) => ({
  id: String(s?.id ?? ""),
  title: s?.name ?? null,
  cron: s?.cron ?? null,
  timezone: s?.timezone ?? null,
  destination: s?.destination ?? null,
  enabled: Boolean(s?.enabled),
});
const webhookRow = (w) => ({ id: String(w?.id ?? ""), name: w?.name ?? null, enabled: Boolean(w?.enabled) });
const playlistRow = (p) => pick(p, ["id", "title", "itemCount", "privacyStatus"]);

async function playlistsFor(ctx, youtube) {
  if (!youtube?.connected) return { playlists: null };
  const read = await tolerant(ctx.api.call("GET", "/api/social/youtube/playlists"));
  if (read.error) return { playlists: null, playlistsError: read.error };
  return { playlists: (Array.isArray(read.body?.playlists) ? read.body.playlists : []).map(playlistRow) };
}

const socialStatus = {
  name: "social_status",
  title: "Where you can publish",
  description:
    "What publishing is set up for this account, before any publish tool: YouTube (connected, channel, playlists), auto-publish destinations (webhook, youtube, zernio for TikTok), " +
    "renderAutoPublish (whether finished render_short videos are posted automatically, and where), Buffer profile ids, saved webhooks (id, name, enabled) and schedules. " +
    "Use a webhook id with publish_post or schedules, a playlist id with publish_youtube. Never returns tokens, secrets or webhook addresses. " +
    "Connecting accounts and adding webhooks happen in the app's Settings, not here. Free and instant; needs no publish consent.",
  inputSchema: {},
  routes: ["/api/social"],
  async handler(ctx) {
    const [youtubeBody, autoBody, config, render] = await Promise.all([
      ctx.api.call("GET", "/api/social/youtube/status"),
      ctx.api.call("GET", "/api/social/auto-publish-status"),
      ctx.api.call("GET", "/api/social/config"),
      tolerant(ctx.api.call("GET", "/api/postiz/auto-publish")),
    ]);
    const youtube = pick(youtubeBody, ["serverConfigured", "connected", "canUsePlaylists", "channelTitle", "channelId", "connectedAt"]);
    return ok({
      youtube,
      ...(await playlistsFor(ctx, youtube)),
      autoPublish: pick(autoBody, ["canAutoPublish", "destinations"]),
      renderAutoPublish: render.error ? null : pick(render.body, ["enabled", "platforms"]),
      buffer: pick(config?.buffer, ["enabled", "profileIds"]),
      webhooks: (Array.isArray(config?.webhooks) ? config.webhooks : []).map(webhookRow),
      schedules: (Array.isArray(config?.schedules) ? config.schedules : []).map(scheduleRow),
    });
  },
};

// ---- publish_youtube -----------------------------------------------------------

const publishYoutube = {
  name: "publish_youtube",
  title: "Upload to YouTube",
  description:
    "Upload a finished video from your media folder (for example the output path jobs_wait gave for render_short) to the user's connected YouTube channel. " +
    "Needs the key's publish switch and a connected channel (see social_status). title is required (up to 100 characters). privacyStatus defaults to private; publishAt (ISO time) schedules it and keeps it private until then. " +
    "Optional: a thumbnail (a picture in your media folder or an images_generate path; thumbnailTitle draws the title on it), a playlist (playlistId from social_status, or newPlaylistTitle). " +
    "Returns a handle of kind publish: call jobs_wait with kind publish and the id; the finished handle carries the video link. Costs one daily publish. An upload takes from seconds to several minutes; two may run at once.",
  inputSchema: {
    videoPath: z.string().min(1).max(1000).describe("The video in your media folder (a path or /outputs/ link from a render). URLs are refused."),
    title: z.string().trim().min(1).max(100).describe("The video title."),
    description: z.string().max(5000).optional().describe("The video description."),
    tags: z.array(z.string().trim().min(1).max(100)).max(30).optional().describe("Tags; together at most 500 characters."),
    hashtags: z.array(z.string().trim().min(1).max(50)).max(15).optional().describe("Hashtags added at the end of the description."),
    categoryId: z.string().regex(/^\d{1,3}$/).optional().describe("A YouTube category number (default 22, People & Blogs)."),
    privacyStatus: z.enum(PRIVACY).optional().describe("private (default), unlisted or public."),
    publishAt: z.string().max(40).optional().describe("An ISO time to make it public later; the upload stays private until then."),
    playlistId: z.string().regex(SAVED_ID).optional().describe("A playlist id from social_status."),
    newPlaylistTitle: z.string().trim().min(1).max(150).optional().describe("Add to the playlist with this name, made if the channel has none."),
    syntheticMedia: z.boolean().optional().describe("YouTube's question: is the content altered or synthetic (AI)? Answer for the user if you know."),
    thumbnailPath: z.string().max(1000).optional().describe("A picture in your media folder, or an /outputs/genImg/... path from images_generate."),
    thumbnailTitle: z.boolean().optional().describe("Draw the title on the thumbnail."),
    thumbnailTagline: z.string().max(60).optional().describe("A short line under the drawn title."),
  },
  routes: ["/api/social"],
  publish: true,
  async handler(ctx, input) {
    const video = await videoLink(ctx, input.videoPath);
    if (video.refusal) return video.refusal;
    const thumbnail = await thumbnailLink(ctx, input.thumbnailPath);
    if (thumbnail.refusal) return thumbnail.refusal;
    const { title, description, tags, hashtags, categoryId, privacyStatus, publishAt, playlistId, newPlaylistTitle, syntheticMedia, thumbnailTitle, thumbnailTagline } = input;
    const body = defined({
      videoUrl: video.link, title, description, tags, hashtags, categoryId, privacyStatus, publishAt, playlistId, newPlaylistTitle,
      syntheticMedia, thumbnailPath: thumbnail.link, thumbnailTitle, thumbnailTagline,
    });
    const refused = await ctx.chargeCap({ publishes: 1 });
    if (refused) return refused;
    const response = await ctx.api.call("POST", "/api/social/youtube/publish", { body });
    return ok({ kind: "publish", id: String(response?.jobId ?? ""), status: "running", joined: Boolean(response?.joined) });
  },
};

// ---- publish_post --------------------------------------------------------------

const publishPost = {
  name: "publish_post",
  title: "Post a video",
  description:
    "Post a finished video from your media folder with a caption. destination webhook sends it to a Make or Zapier webhook the user saved (webhookId of an enabled one from social_status, WEBHOOK_NOT_FOUND otherwise; leave it out for their first enabled one), " +
    "and to TikTok too when TikTok is connected; buffer queues it on Buffer profiles (profileIds from social_status). For YouTube use publish_youtube. " +
    "Needs the key's publish switch. Costs one daily publish. Waits for the destination to accept the post: up to about half a minute.",
  inputSchema: {
    destination: z.enum(POST_DESTINATIONS).describe("webhook or buffer."),
    videoPath: z.string().min(1).max(1000).describe("The video in your media folder. URLs are refused."),
    caption: z.string().trim().min(1).max(2200).describe("The post text."),
    title: z.string().trim().max(100).optional().describe("webhook: a title (default: from the caption)."),
    webhookId: z.string().regex(SAVED_ID).optional().describe("webhook: the id of a saved webhook from social_status."),
    profileIds: z.array(z.string().regex(SAVED_ID)).min(1).max(10).optional().describe("buffer: Buffer profile ids from social_status."),
  },
  routes: ["/api/social"],
  publish: true,
  async handler(ctx, { destination, videoPath, caption, title, webhookId, profileIds }) {
    const video = await videoLink(ctx, videoPath, { absolute: true });
    if (video.refusal) return video.refusal;
    const badHook = destination === "webhook" ? await webhookRefusal(ctx, webhookId) : null;
    if (badHook) return badHook;
    const fields = destination === "webhook" ? { title, webhookId } : { profileIds };
    const body = defined({ destination, videoUrl: video.link, caption, ...fields });
    const refused = await ctx.chargeCap({ publishes: 1 });
    if (refused) return refused;
    // The route answers 200 with ok false when no destination accepted it; only its per-destination summary is returned.
    const response = await ctx.api.call("POST", "/api/social/post", { body });
    const results = (Array.isArray(response?.results) ? response.results : []).map((r) => pick(r, ["destination", "ok", "error", "draft"]));
    return ok({ posted: response?.ok !== false, destination, partial: Boolean(response?.partial), results });
  },
};

// ---- youtube_thumbnail ---------------------------------------------------------

const youtubeThumbnail = {
  name: "youtube_thumbnail",
  title: "Set a YouTube thumbnail",
  description:
    "Replace the thumbnail of a video already on the user's connected channel. videoId is the 11-character YouTube id (from a finished publish_youtube handle). " +
    "thumbnailPath is a picture in your media folder or an images_generate /outputs/genImg/... path; thumbnailTitle draws title on it. " +
    "Needs the key's publish switch; costs no daily publish (it changes an existing upload). The channel needs phone verification for custom thumbnails. Takes a few seconds.",
  inputSchema: {
    videoId: z.string().regex(YOUTUBE_VIDEO_ID, "videoId must be an 11-character YouTube video id").describe("The YouTube video id."),
    thumbnailPath: z.string().min(1).max(1000).describe("A picture in your media folder, or an /outputs/genImg/... path."),
    thumbnailTitle: z.boolean().optional().describe("Draw the title on the picture."),
    title: z.string().trim().max(100).optional().describe("The text to draw when thumbnailTitle is true."),
    thumbnailTagline: z.string().max(60).optional().describe("A short line under the drawn title."),
  },
  routes: ["/api/social"],
  publish: true,
  async handler(ctx, { videoId, thumbnailPath, thumbnailTitle, title, thumbnailTagline }) {
    const thumbnail = await thumbnailLink(ctx, thumbnailPath);
    if (thumbnail.refusal) return thumbnail.refusal;
    const body = defined({ videoId, thumbnailPath: thumbnail.link, thumbnailTitle, title, thumbnailTagline });
    await ctx.api.call("POST", "/api/social/youtube/thumbnail", { body });
    return ok({ videoId, thumbnailSet: true });
  },
};

// ---- schedules -----------------------------------------------------------------

function cronProblem(cron) {
  const fields = String(cron || "").trim().split(/\s+/);
  if (fields.length !== 5) return "cron needs five fields: minute hour day-of-month month day-of-week, for example 0 9 * * *.";
  if (!HOURLY_AT_MOST.test(fields[0])) return "A schedule may run at most once an hour: the minute field must be a single number, for example 0 9 * * *.";
  return null;
}

function scheduleProblem(input) {
  const problem = cronProblem(input.cron);
  if (problem) return problem;
  if (!input.destination) return "create needs destination: webhook, buffer or youtube.";
  if ((input.type ?? "replay") === "replay" && !(input.caption && input.videoPath)) {
    return "A replay schedule posts the same video each time: it needs caption and videoPath. Use type auto_generate for a fresh video each run.";
  }
  return null;
}

/** Everything that refuses a new schedule before anything is charged, or null. */
async function scheduleRefusal(ctx, input) {
  const problem = scheduleProblem(input);
  if (problem) return fail("BAD_INPUT", problem);
  return input.destination === "webhook" ? webhookRefusal(ctx, input.webhookId) : null;
}

async function createSchedule(ctx, input) {
  const refusal = await scheduleRefusal(ctx, input);
  if (refusal) return refusal;
  let videoUrl;
  if (input.videoPath !== undefined) {
    const video = await videoLink(ctx, input.videoPath, { absolute: true });
    if (video.refusal) return video.refusal;
    videoUrl = video.link;
  }
  const refused = await ctx.chargeCap("publishes", 1);
  if (refused) return refused;
  const { title, type = "replay", cron, timezone, destination, webhookId, profileId, privacyStatus, caption } = input;
  const generate = type === "auto_generate"
    ? pick(input, ["niche", "tone", "aspect", "durationSec", "voiceId", "backgroundQuery", "kineticCaptions"])
    : {};
  const schedule = defined({
    name: title, type, cron, timezone, destination, enabled: true, webhookId, profileId, privacyStatus, caption, videoUrl, ...generate,
  });
  const response = await ctx.api.call("POST", "/api/social/schedules", { body: { schedule } });
  return ok({ schedule: scheduleRow(response?.schedule) });
}

async function listSchedules(ctx) {
  const body = await ctx.api.call("GET", "/api/social/schedules");
  return ok({ schedules: (Array.isArray(body?.schedules) ? body.schedules : []).map(scheduleRow) });
}

async function removeSchedule(ctx, { id }) {
  if (!id) return fail("BAD_INPUT", "remove needs the schedule id from action list.");
  await ctx.api.call("DELETE", `/api/social/schedules/${encodeURIComponent(id)}`);
  return ok({ removed: id });
}

const schedules = {
  name: "schedules",
  title: "Scheduled posts",
  description:
    "The user's recurring posts. action list: each schedule's id, title, cron, timezone, destination and enabled (free, no consent needed). " +
    "action create: a new schedule that posts by itself on a cron time (five fields, at most once an hour, for example 0 9 * * * for 9:00 daily, in timezone, default UTC). " +
    "type replay posts the same video each time (needs caption and videoPath); type auto_generate makes and posts a fresh short each run (niche, tone, aspect, durationSec, voiceId, backgroundQuery, kineticCaptions). " +
    "destination is webhook (webhookId), buffer (profileId) or youtube (privacyStatus). create needs the key's publish switch and costs one daily publish now; the runs themselves happen on the server later. " +
    "action remove { id } deletes a schedule (needs the publish switch; free).",
  inputSchema: {
    action: z.enum(SCHEDULE_ACTIONS).describe("list, create or remove."),
    id: z.string().max(100).optional().describe("remove: the schedule id from action list."),
    type: z.enum(SCHEDULE_TYPES).optional().describe("create: replay (default) or auto_generate."),
    title: z.string().trim().max(100).optional().describe("create: a name for the schedule (also the post title)."),
    cron: z.string().max(60).optional().describe("create: when it runs, five cron fields, at most hourly."),
    timezone: z.string().max(60).optional().describe("create: an IANA time zone such as Europe/London. Default UTC."),
    destination: z.enum(CAMPAIGN_DESTINATIONS).optional().describe("create: webhook, buffer or youtube."),
    webhookId: z.string().regex(SAVED_ID).optional().describe("create, webhook: a saved webhook id from social_status."),
    profileId: z.string().regex(SAVED_ID).optional().describe("create, buffer: a Buffer profile id from social_status."),
    privacyStatus: z.enum(PRIVACY).optional().describe("create, youtube: private (default), unlisted or public."),
    caption: z.string().trim().max(2200).optional().describe("create, replay: the post text."),
    videoPath: z.string().max(1000).optional().describe("create, replay: the video in your media folder."),
    niche: z.string().max(200).optional().describe("create, auto_generate: the subject of each new script."),
    tone: z.string().max(200).optional().describe("create, auto_generate: the voice of each new script."),
    aspect: z.enum(ASPECTS).optional().describe("create, auto_generate: portrait, landscape or square."),
    durationSec: z.number().min(5).max(90).optional().describe("create, auto_generate: about how long each video is."),
    voiceId: z.string().max(100).regex(VOICE_ID_PATTERN).optional().describe("create, auto_generate: a voice from voice_list."),
    backgroundQuery: z.string().max(100).optional().describe("create, auto_generate: the mood to pick backgrounds by."),
    kineticCaptions: z.boolean().optional().describe("create, auto_generate: word-by-word captions (default on)."),
  },
  routes: ["/api/social"],
  async handler(ctx, input) {
    if (input.action === "list") return listSchedules(ctx);
    // R29: not registry-publish, so list stays open; changing schedules needs consent.
    if (lacksPublishConsent(ctx)) return refuseWithoutConsent();
    return input.action === "create" ? createSchedule(ctx, input) : removeSchedule(ctx, input);
  },
};

// ---- autopublish_run -----------------------------------------------------------

const CAMPAIGN_FIELDS = ["destination", "webhookId", "profileIds", "privacyStatus", "title", "niche", "tone", "aspect", "durationSec", "voiceId", "backgroundQuery", "narrationCategory", "kineticCaptions"];

const autopublishRun = {
  name: "autopublish_run",
  title: "Make and post a short",
  description:
    "The Home page's one-click Auto-Publish: the server writes a fresh Bible short script, speaks it, picks backgrounds from your library by mood, renders it and posts it to destination (webhook by default; buffer or youtube). " +
    "Needs the key's publish switch and at least one background in your library (library_items). Every field is optional. If nothing is connected to post to, the video is still made and the result says it was not shared. " +
    "Returns a job handle of kind job: call jobs_wait with kind job and the id. Costs one daily render and one daily publish, charged together, and one unit of the plan's render quota (QUOTA_EXCEEDED when it is used up, before any cap is spent). Takes a few minutes.",
  inputSchema: {
    destination: z.enum(CAMPAIGN_DESTINATIONS).optional().describe("webhook (default), buffer or youtube."),
    webhookId: z.string().regex(SAVED_ID).optional().describe("webhook: a saved webhook id from social_status."),
    profileIds: z.array(z.string().regex(SAVED_ID)).max(10).optional().describe("buffer: Buffer profile ids from social_status."),
    privacyStatus: z.enum(PRIVACY).optional().describe("youtube: private (default), unlisted or public."),
    title: z.string().trim().max(100).optional().describe("A post title."),
    niche: z.string().max(200).optional().describe("The subject of the script, for example hope in hard times."),
    tone: z.string().max(200).optional().describe("The voice of the script."),
    aspect: z.enum(ASPECTS).optional().describe("portrait (default), landscape or square."),
    durationSec: z.number().min(5).max(90).optional().describe("About how long the video is (default 20)."),
    voiceId: z.string().max(100).regex(VOICE_ID_PATTERN).optional().describe("A voice from voice_list."),
    backgroundQuery: z.string().max(100).optional().describe("The mood to pick backgrounds by."),
    narrationCategory: z.string().regex(STYLE_WORD).optional().describe("A voice profile from voice_list (for example devotional)."),
    kineticCaptions: z.boolean().optional().describe("Word-by-word captions."),
  },
  routes: ["/api/jobs"],
  publish: true,
  async handler(ctx, input) {
    const payload = pick(input, CAMPAIGN_FIELDS);
    const badHook = (input.destination ?? "webhook") === "webhook" ? await webhookRefusal(ctx, input.webhookId) : null;
    if (badHook) return badHook;
    // R34: the route spends the plan's render quota; read it first so a refused run spends no daily caps.
    const outOfQuota = await renderQuotaRefusal(ctx);
    if (outOfQuota) return outOfQuota;
    const refused = await ctx.chargeCap({ renders: 1, publishes: 1 });
    if (refused) return refused;
    const response = await ctx.api.call("POST", "/api/jobs/enqueue", { body: { type: "campaign_auto_post", payload } });
    return ok(NORMALISERS.job.normalise({ job: response?.job }, { outputUrl: (p) => outputUrl(p, ctx.publicBase) }));
  },
};

export default [socialStatus, publishYoutube, publishPost, youtubeThumbnail, schedules, autopublishRun];
