import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import publishTools from "./publish.js";

const USER = { id: "u_social", email: "social@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const keyStore = await import("../../lib/agentKeys/store.js");
const { resolveScopeDirs } = await import("../../lib/paths.js");
const { writeSocialStore } = await import("../../lib/socialStore.js");

const clients = [];
async function keyClient(publishAllowed, name) {
  const made = keyStore.createKey(USER.id, name);
  if (publishAllowed) keyStore.updateKey(USER.id, made.key.id, { publishAllowed: true });
  const client = await mcpClient(testApp.port, made.plain);
  clients.push(client);
  return client;
}
const noConsent = await keyClient(false, "no-consent");

after(async () => {
  _setScopeForTests(null);
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

const byName = Object.fromEntries(publishTools.map((t) => [t.name, t]));
const userDataDir = () => resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role }).dataDir;
const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);
const apiError = (status, message = "nope") => Object.assign(new Error(message), { name: "ApiError", status, code: `HTTP_${status}` });

/** A media folder for unit tests, with the given empty files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "publish-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return dir;
}

const CONSENT = { agentKey: { publishAllowed: true } };
function ctxWith(responses, extra = {}) {
  const fake = fakeMcpCtx(responses);
  return { ...fake, ctx: { ...fake.ctx, ...extra } };
}

// ---- definitions ----

test("the publish file declares the six publishing tools with their consent and caps", () => {
  assert.deepEqual(publishTools.map((t) => t.name), [
    "social_status", "publish_youtube", "publish_post", "youtube_thumbnail", "schedules", "autopublish_run",
  ]);
  const publishFlag = Object.fromEntries(publishTools.map((t) => [t.name, t.publish === true]));
  assert.deepEqual(publishFlag, {
    social_status: false, publish_youtube: true, publish_post: true, youtube_thumbnail: true, schedules: false, autopublish_run: true,
  });
  // Publish tools charge their publish in the handler, after inputs are checked, so refused input costs nothing.
  assert.equal(byName.publish_youtube.caps, undefined);
  assert.equal(byName.publish_post.caps, undefined);
  assert.equal(byName.youtube_thumbnail.caps, undefined);
  assert.equal(byName.schedules.caps, undefined);
  // autopublish_run pre-checks the plan quota (R34), then charges a render and a publish together in its handler.
  assert.equal(byName.autopublish_run.caps, undefined);
  assert.deepEqual(byName.autopublish_run.routes, ["/api/jobs"]);
  for (const name of ["social_status", "publish_youtube", "publish_post", "youtube_thumbnail", "schedules"]) {
    assert.deepEqual(byName[name].routes, ["/api/social"], name);
  }
});

test("no publishing tool takes a webhook URL or a raw video URL", () => {
  for (const def of publishTools) {
    for (const field of ["webhookUrl", "videoUrl", "url", "generatedImage", "prebuiltScript"]) {
      assert.equal(Object.hasOwn(def.inputSchema, field), false, `${def.name}.${field}`);
    }
  }
});

// ---- consent: publish tools refuse and never reach their route ----

for (const [name, args] of [
  ["publish_youtube", { videoPath: "/outputs/a.mp4", title: "Hi" }],
  ["publish_post", { destination: "webhook", videoPath: "/outputs/a.mp4", caption: "Hi" }],
  ["youtube_thumbnail", { videoId: "abcdefghijk", thumbnailPath: "/outputs/t.png" }],
  ["autopublish_run", {}],
]) {
  test(`${name} on a key without consent is PUBLISH_NOT_ALLOWED and its handler never runs`, async () => {
    const def = byName[name];
    const original = def.handler;
    let ran = false;
    def.handler = async (...a) => { ran = true; return original(...a); };
    try {
      const result = await noConsent.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error, "PUBLISH_NOT_ALLOWED");
      assert.equal(ran, false);
    } finally {
      def.handler = original;
    }
    const who = await noConsent.callTool({ name: "whoami", arguments: {} });
    assert.equal(who.structuredContent.caps.publishes.used, 0);
    assert.equal(who.structuredContent.caps.renders.used, 0);
  });
}

for (const action of ["create", "remove"]) {
  test(`schedules ${action} without consent is refused before any call, also with no agentKey at all`, async () => {
    for (const extra of [{ agentKey: { publishAllowed: false } }, {}]) {
      const { ctx, calls, charges } = ctxWith({}, extra);
      const result = await byName.schedules.handler(ctx, { action, id: "sch_1", cron: "0 9 * * *", destination: "webhook", type: "auto_generate" });
      assert.equal(result.structuredContent.error, "PUBLISH_NOT_ALLOWED");
      assert.deepEqual(calls, []);
      assert.deepEqual(charges, []);
    }
  });
}

test("schedules create through MCP without consent leaves the store without schedules", async () => {
  const result = await noConsent.callTool({ name: "schedules", arguments: { action: "create", cron: "0 9 * * *", type: "auto_generate", destination: "webhook" } });
  assert.equal(result.structuredContent.error, "PUBLISH_NOT_ALLOWED");
  const list = await noConsent.callTool({ name: "schedules", arguments: { action: "list" } });
  assert.notEqual(list.isError, true, list.content?.[0]?.text);
  assert.deepEqual(list.structuredContent.schedules, []);
});

// ---- social_status: an allowlist, never a secret ----

const SECRET = "sk-very-secret-123";
const HOOK_URL = "https://hook.make.com/abc-secret-path";
const WH1_CONFIG = { ok: true, webhooks: [{ id: "wh_1", name: "Make", url: HOOK_URL, enabled: true }] };

test("social_status returns only allowlisted fields and tolerates a failing playlists call", async () => {
  const { ctx } = ctxWith({
    "GET /api/social/youtube/status": { ok: true, serverConfigured: true, connected: true, canUsePlaylists: true, channelTitle: "Sthill", channelId: "UC1", connectedAt: "2026-10-01", refreshToken: SECRET },
    "GET /api/social/auto-publish-status": { ok: true, canAutoPublish: true, destinations: ["webhook", "youtube"], isSuperAdmin: true, isOwner: true },
    "GET /api/social/config": {
      ok: true,
      buffer: { enabled: true, profileIds: ["p1"], accessToken: SECRET },
      direct: { youtube: { clientId: "cid", hasClientSecret: true, clientSecret: SECRET } },
      schedules: [{ id: "sch_1", name: "Morning", cron: "0 9 * * *", timezone: "UTC", destination: "webhook", enabled: true, type: "replay", caption: "secret caption", videoUrl: "https://x/v.mp4", webhookId: "wh_1", voiceId: "v" }],
      webhooks: [{ id: "wh_1", name: "Make", url: HOOK_URL, enabled: true, secret: SECRET }],
    },
    "GET /api/social/youtube/playlists": apiError(502, "YouTube is down"),
    "GET /api/postiz/auto-publish": { ok: true, enabled: true, platforms: ["tiktok"], postizUserId: SECRET },
  });
  const result = await byName.social_status.handler(ctx, {});
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(result.structuredContent, {
    youtube: { serverConfigured: true, connected: true, canUsePlaylists: true, channelTitle: "Sthill", channelId: "UC1", connectedAt: "2026-10-01" },
    playlists: null,
    playlistsError: "YouTube is down",
    autoPublish: { canAutoPublish: true, destinations: ["webhook", "youtube"] },
    renderAutoPublish: { enabled: true, platforms: ["tiktok"] },
    buffer: { enabled: true, profileIds: ["p1"] },
    webhooks: [{ id: "wh_1", name: "Make", enabled: true }],
    schedules: [{ id: "sch_1", title: "Morning", cron: "0 9 * * *", timezone: "UTC", destination: "webhook", enabled: true }],
  });
  const text = JSON.stringify(result);
  for (const leak of [SECRET, HOOK_URL, "secret caption", "clientSecret", "refreshToken", "accessToken"]) {
    assert.equal(text.includes(leak), false, leak);
  }
});

test("social_status skips playlists when YouTube is not connected and lists them when it is", async () => {
  const base = {
    "GET /api/social/auto-publish-status": { ok: true, canAutoPublish: false, destinations: [] },
    "GET /api/social/config": { ok: true, buffer: { enabled: false, profileIds: [] }, schedules: [], webhooks: [] },
    "GET /api/postiz/auto-publish": apiError(500),
  };
  const off = ctxWith({ ...base, "GET /api/social/youtube/status": { ok: true, connected: false } });
  const offResult = await byName.social_status.handler(off.ctx, {});
  assert.equal(routesCalled(off.calls).includes("GET /api/social/youtube/playlists"), false);
  assert.equal(offResult.structuredContent.playlists, null);
  assert.equal(offResult.structuredContent.renderAutoPublish, null);
  const on = ctxWith({
    ...base,
    "GET /api/social/youtube/status": { ok: true, connected: true },
    "GET /api/social/youtube/playlists": { ok: true, playlists: [{ id: "PL1", title: "Psalms", itemCount: 3, privacyStatus: "public", etag: "x" }] },
  });
  const onResult = await byName.social_status.handler(on.ctx, {});
  assert.deepEqual(onResult.structuredContent.playlists, [{ id: "PL1", title: "Psalms", itemCount: 3, privacyStatus: "public" }]);
});

test("social_status through MCP never returns a seeded secret, token or webhook URL", async () => {
  writeSocialStore(userDataDir(), {
    buffer: { accessToken: SECRET, profileIds: ["p9"] },
    direct: { youtube: { refreshToken: SECRET, clientSecret: SECRET, channelTitle: "Mine" }, tiktok: { accessToken: SECRET } },
    webhooks: [{ id: "wh_9", name: "Zap", url: HOOK_URL, enabled: true, secret: SECRET }],
    schedules: [{ id: "sch_9", name: "Evening", cron: "0 18 * * *", timezone: "UTC", destination: "webhook", enabled: false, caption: "private words", videoUrl: HOOK_URL }],
  });
  const result = await noConsent.callTool({ name: "social_status", arguments: {} });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  const text = JSON.stringify(result);
  for (const leak of [SECRET, HOOK_URL, "private words"]) assert.equal(text.includes(leak), false, leak);
  assert.deepEqual(result.structuredContent.webhooks, [{ id: "wh_9", name: "Zap", enabled: true }]);
  assert.equal(result.structuredContent.youtube.connected, true);
  assert.equal(result.structuredContent.schedules[0].title, "Evening");
  writeSocialStore(userDataDir(), {});
});

// ---- publish_youtube ----

test("publish_youtube sends the confined video as its /outputs/ link and returns a publish handle", async () => {
  const dir = mediaWith("clip.mp4", "thumb.png");
  const { ctx, calls } = ctxWith({ "POST /api/social/youtube/publish": { ok: true, jobId: "pub_1", joined: false } }, CONSENT);
  const result = await byName.publish_youtube.handler(ctx, {
    videoPath: path.join(dir, "clip.mp4"),
    title: "Psalm 23",
    description: "The Lord is my shepherd",
    tags: ["psalms"],
    privacyStatus: "unlisted",
    thumbnailPath: path.join(dir, "thumb.png"),
    thumbnailTitle: true,
  });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(calls[0].opts.body, {
    videoUrl: "/outputs/clip.mp4",
    title: "Psalm 23",
    description: "The Lord is my shepherd",
    tags: ["psalms"],
    privacyStatus: "unlisted",
    thumbnailPath: "/outputs/thumb.png",
    thumbnailTitle: true,
  });
  assert.deepEqual(result.structuredContent, { kind: "publish", id: "pub_1", status: "running", joined: false });
});

test("publish_youtube takes the caller's own generated image as a thumbnail and refuses another user's", async () => {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "publish-genimg-"));
  const sharedDir = fs.mkdtempSync(path.join(testApp.dataDir, "publish-shared-"));
  fs.writeFileSync(path.join(dir, "clip.mp4"), "x");
  for (const series of ["genvis-u_unit-ab12", "genvis-u_other-ab12", "auto-u_unit"]) {
    fs.mkdirSync(path.join(sharedDir, "genImg", series), { recursive: true });
    fs.writeFileSync(path.join(sharedDir, "genImg", series, "part-1.png"), "x");
  }
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir }));
  const mine = ctxWith({ "POST /api/social/youtube/publish": { ok: true, jobId: "pub_2" } }, CONSENT);
  const accepted = await byName.publish_youtube.handler(mine.ctx, { videoPath: path.join(dir, "clip.mp4"), title: "T", thumbnailPath: "/outputs/genImg/genvis-u_unit-ab12/part-1.png" });
  assert.notEqual(accepted.isError, true, accepted.content?.[0]?.text);
  assert.equal(mine.calls[0].opts.body.thumbnailPath, "/outputs/genImg/genvis-u_unit-ab12/part-1.png");
  for (const bad of [
    "/outputs/genImg/genvis-u_other-ab12/part-1.png",
    "/outputs/genImg/auto-u_unit/part-1.png",
    "/outputs/genImg/genvis-u_unit-ab12/../genvis-u_other-ab12/part-1.png",
    "/outputs/genImg/../../users.json",
    "https://evil.test/t.png",
    "C:/Windows/t.png",
  ]) {
    const refused = ctxWith({}, CONSENT);
    const result = await byName.publish_youtube.handler(refused.ctx, { videoPath: path.join(dir, "clip.mp4"), title: "T", thumbnailPath: bad });
    assert.equal(result.isError, true, bad);
    assert.deepEqual(refused.calls, [], bad);
  }
});

test("publish_youtube refuses a URL or outside video", async () => {
  mediaWith();
  for (const bad of ["https://evil.test/v.mp4", "http://169.254.169.254/latest/meta-data", "C:/Windows/notepad.exe"]) {
    const { ctx, calls } = ctxWith({}, CONSENT);
    const result = await byName.publish_youtube.handler(ctx, { videoPath: bad, title: "T" });
    assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA", bad);
    assert.deepEqual(calls, []);
  }
});

// ---- publish_post ----

test("publish_post to a webhook sends an absolute public video link and the webhook id, never a URL", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx, calls } = ctxWith({
    "GET /api/social/config": WH1_CONFIG,
    "POST /api/social/post": {
      ok: true, partial: false, videoUrl: "x", make: { ok: true }, zernio: { ok: true, raw: { apiKey: SECRET } },
      results: [{ destination: "webhook", ok: true, error: "" }, { destination: "tiktok", ok: true, error: "", draft: false, apiKey: SECRET }],
    },
  }, CONSENT);
  const result = await byName.publish_post.handler(ctx, {
    destination: "webhook", videoPath: path.join(dir, "clip.mp4"), caption: "Be still", title: "Psalm 46", webhookId: "wh_1", webhookUrl: HOOK_URL,
  });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(calls.at(-1).opts.body, {
    destination: "webhook", videoUrl: "http://host.test/outputs/clip.mp4", caption: "Be still", title: "Psalm 46", webhookId: "wh_1",
  });
  assert.deepEqual(result.structuredContent, {
    posted: true,
    destination: "webhook",
    partial: false,
    results: [{ destination: "webhook", ok: true, error: "" }, { destination: "tiktok", ok: true, error: "", draft: false }],
  });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("publish_post reports posted false when the route says no destination took it", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx } = ctxWith({ "POST /api/social/post": { ok: false, results: [{ destination: "webhook", ok: false, error: "Webhook failed: 500" }] } }, CONSENT);
  const result = await byName.publish_post.handler(ctx, { destination: "webhook", videoPath: path.join(dir, "clip.mp4"), caption: "c" });
  assert.equal(result.structuredContent.posted, false);
  assert.equal(result.structuredContent.results[0].error, "Webhook failed: 500");
});

test("publish_post to buffer sends the profile ids", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx, calls } = ctxWith({ "POST /api/social/post": { ok: true, buffer: { ok: true } } }, CONSENT);
  await byName.publish_post.handler(ctx, { destination: "buffer", videoPath: path.join(dir, "clip.mp4"), caption: "c", profileIds: ["p1"] });
  assert.deepEqual(calls[0].opts.body, { destination: "buffer", videoUrl: "http://host.test/outputs/clip.mp4", caption: "c", profileIds: ["p1"] });
});

test("publish_post only posts to webhook or buffer", () => {
  const schema = z.object(byName.publish_post.inputSchema);
  const base = { videoPath: "/outputs/a.mp4", caption: "c" };
  assert.equal(schema.safeParse({ ...base, destination: "webhook" }).success, true);
  assert.equal(schema.safeParse({ ...base, destination: "youtube" }).success, false);
  assert.equal(schema.safeParse({ ...base, destination: "tiktok" }).success, false);
});

// ---- youtube_thumbnail ----

test("youtube_thumbnail sends the video id and the confined picture link", async () => {
  const dir = mediaWith("thumb.jpg");
  const { ctx, calls } = ctxWith({ "POST /api/social/youtube/thumbnail": { ok: true } }, CONSENT);
  const result = await byName.youtube_thumbnail.handler(ctx, { videoId: "dQw4w9WgXcQ", thumbnailPath: path.join(dir, "thumb.jpg"), thumbnailTitle: true, title: "Psalm 23" });
  assert.deepEqual(calls[0].opts.body, { videoId: "dQw4w9WgXcQ", thumbnailPath: "/outputs/thumb.jpg", thumbnailTitle: true, title: "Psalm 23" });
  assert.deepEqual(result.structuredContent, { videoId: "dQw4w9WgXcQ", thumbnailSet: true });
  const schema = z.object(byName.youtube_thumbnail.inputSchema);
  assert.equal(schema.safeParse({ videoId: "../../x", thumbnailPath: "a.png" }).success, false);
});

// ---- schedules ----

test("schedules list returns only id, title, time, destination and enabled", async () => {
  const { ctx } = ctxWith({
    "GET /api/social/schedules": { ok: true, schedules: [{ id: "s1", name: "Daily", cron: "0 7 * * *", timezone: "Europe/London", destination: "youtube", enabled: true, caption: "hidden", videoUrl: "hidden", webhookId: "w", profileId: "p" }] },
  });
  const result = await byName.schedules.handler(ctx, { action: "list" });
  assert.deepEqual(result.structuredContent, { schedules: [{ id: "s1", title: "Daily", cron: "0 7 * * *", timezone: "Europe/London", destination: "youtube", enabled: true }] });
});

test("schedules create with consent charges one publish and posts a new schedule (never an id)", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx, calls, charges } = ctxWith({ "GET /api/social/config": WH1_CONFIG, "POST /api/social/schedules": (_m, _p, opts) => ({ ok: true, schedule: { ...opts.body.schedule, id: "sch_new" } }) }, CONSENT);
  const result = await byName.schedules.handler(ctx, {
    action: "create", id: "sch_existing", type: "replay", title: "Replay", cron: "30 8 * * 1", timezone: "UTC",
    destination: "webhook", webhookId: "wh_1", caption: "Again", videoPath: path.join(dir, "clip.mp4"),
  });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(charges, [{ bucket: "publishes", amount: 1 }]);
  assert.deepEqual(calls.at(-1).opts.body, {
    schedule: {
      name: "Replay", type: "replay", cron: "30 8 * * 1", timezone: "UTC", destination: "webhook", enabled: true,
      webhookId: "wh_1", caption: "Again", videoUrl: "http://host.test/outputs/clip.mp4",
    },
  });
  assert.deepEqual(result.structuredContent.schedule, { id: "sch_new", title: "Replay", cron: "30 8 * * 1", timezone: "UTC", destination: "webhook", enabled: true });
});

test("schedules create refuses a schedule that fires more than once an hour, and a replay without a video, charging nothing", async () => {
  for (const input of [
    { cron: "* * * * *", type: "auto_generate" },
    { cron: "*/5 * * * *", type: "auto_generate" },
    { cron: "0,30 * * * *", type: "auto_generate" },
    { cron: "0 0 9 * * *", type: "auto_generate" },
    { cron: "0 9 * * *", type: "replay", caption: "c" },
  ]) {
    const { ctx, calls, charges } = ctxWith({}, CONSENT);
    const result = await byName.schedules.handler(ctx, { action: "create", destination: "webhook", ...input });
    assert.equal(result.structuredContent.error, "BAD_INPUT", JSON.stringify(input));
    assert.deepEqual(calls, []);
    assert.deepEqual(charges, []);
  }
});

test("schedules remove with consent deletes by id and charges nothing", async () => {
  const { ctx, calls, charges } = ctxWith({ "DELETE /api/social/schedules/sch%201": { ok: true } }, CONSENT);
  const result = await byName.schedules.handler(ctx, { action: "remove", id: "sch 1" });
  assert.deepEqual(routesCalled(calls), ["DELETE /api/social/schedules/sch%201"]);
  assert.deepEqual(charges, []);
  assert.deepEqual(result.structuredContent, { removed: "sch 1" });
});

// ---- autopublish_run ----

test("autopublish_run enqueues campaign_auto_post with only allowlisted fields and returns a job handle", async () => {
  const { ctx, calls, charges } = ctxWith({
    "GET /api/billing/usage": { ok: true, usage: { buckets: { render: { used: 1, limit: 5, unlimited: false, remaining: 4 } } } },
    "POST /api/jobs/enqueue": (_m, _p, opts) => ({ ok: true, job: { id: "job_c", type: opts.body.type, status: "queued" } }),
  }, CONSENT);
  const result = await byName.autopublish_run.handler(ctx, {
    destination: "youtube", privacyStatus: "public", niche: "hope", voiceId: "en-US-AriaNeural", kineticCaptions: true,
    webhookUrl: HOOK_URL, generatedImage: "C:/x.png", musicPath: "C:/x.mp3",
  });
  assert.deepEqual(calls.at(-1).opts.body, {
    type: "campaign_auto_post",
    payload: { destination: "youtube", privacyStatus: "public", niche: "hope", voiceId: "en-US-AriaNeural", kineticCaptions: true },
  });
  assert.equal(result.structuredContent.kind, "job");
  assert.equal(result.structuredContent.id, "job_c");
  assert.deepEqual(charges, [{ bucket: "renders", amount: 1 }, { bucket: "publishes", amount: 1 }]);
});

test("publish_youtube through MCP with consent reaches the real route, which refuses an unconnected channel", async () => {
  _setScopeForTests(null);
  const { outputDir } = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "agent-clip.mp4"), "x");
  const client = await keyClient(true, "consent");
  const result = await client.callTool({ name: "publish_youtube", arguments: { videoPath: "/outputs/agent-clip.mp4", title: "Psalm 23" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /YouTube is not connected/);
});

test("autopublish_run refuses with QUOTA_EXCEEDED before charging when the plan's renders are used up (R34)", async () => {
  const { ctx, calls, charges } = ctxWith({
    "GET /api/billing/usage": { ok: true, usage: { buckets: { render: { used: 5, limit: 5, unlimited: false, remaining: 0 } } } },
  }, CONSENT);
  const result = await byName.autopublish_run.handler(ctx, {});
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.deepEqual(charges, []);
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage"]);
});

test("autopublish_run charges render and publish in one atomic call", async () => {
  const seen = [];
  const fake = fakeMcpCtx({
    "GET /api/billing/usage": { ok: true, usage: { buckets: { render: { unlimited: true } } } },
    "POST /api/jobs/enqueue": { ok: true, job: { id: "job_d", status: "queued" } },
  }, { chargeCap: async (amounts) => { seen.push(amounts); return null; } });
  await byName.autopublish_run.handler({ ...fake.ctx, ...CONSENT }, {});
  assert.deepEqual(seen, [{ renders: 1, publishes: 1 }]);
});

// ---- a publish is charged only after the input is accepted, just before the route ----

for (const [name, args, route] of [
  ["publish_youtube", (dir) => ({ videoPath: path.join(dir, "clip.mp4"), title: "T" }), "POST /api/social/youtube/publish"],
  ["publish_post", (dir) => ({ destination: "buffer", videoPath: path.join(dir, "clip.mp4"), caption: "c" }), "POST /api/social/post"],
]) {
  test(`${name} charges nothing for a refused path and one publish before an accepted call`, async () => {
    const dir = mediaWith("clip.mp4");
    const refused = ctxWith({}, CONSENT);
    const bad = await byName[name].handler(refused.ctx, { ...args(dir), videoPath: "https://evil.test/v.mp4" });
    assert.equal(bad.structuredContent.error, "PATH_OUTSIDE_MEDIA");
    assert.deepEqual(refused.charges, []);
    const order = [];
    const fake = fakeMcpCtx({ [route]: () => { order.push("route"); return { ok: true, jobId: "j" }; } }, {
      chargeCap: async (amounts) => { order.push(amounts); return null; },
    });
    await byName[name].handler({ ...fake.ctx, ...CONSENT }, args(dir));
    assert.deepEqual(order, [{ publishes: 1 }, "route"]);
  });

  test(`${name} refused by the publishes cap never calls its route`, async () => {
    const dir = mediaWith("clip.mp4");
    const fake = fakeMcpCtx({}, { chargeCap: async () => ({ isError: true, structuredContent: { error: "MCP_CAP_REACHED" } }) });
    const result = await byName[name].handler({ ...fake.ctx, ...CONSENT }, args(dir));
    assert.equal(result.structuredContent.error, "MCP_CAP_REACHED");
    assert.deepEqual(fake.calls, []);
  });
}

// ---- a named webhook must be one of the user's own, enabled ----

const CONFIG_HOOKS = { ok: true, buffer: {}, schedules: [], webhooks: [{ id: "wh_on", name: "On", url: HOOK_URL, enabled: true }, { id: "wh_off", name: "Off", url: HOOK_URL, enabled: false }] };

for (const [name, args] of [
  ["publish_post", (dir, webhookId) => ({ destination: "webhook", videoPath: path.join(dir, "clip.mp4"), caption: "c", webhookId })],
  ["schedules", (_dir, webhookId) => ({ action: "create", type: "auto_generate", cron: "0 9 * * *", destination: "webhook", webhookId })],
  ["autopublish_run", (_dir, webhookId) => ({ destination: "webhook", webhookId })],
]) {
  test(`${name} refuses an unknown or disabled webhookId with WEBHOOK_NOT_FOUND before charging`, async () => {
    const dir = mediaWith("clip.mp4");
    for (const webhookId of ["wh_missing", "wh_off"]) {
      const { ctx, calls, charges } = ctxWith({
        "GET /api/social/config": CONFIG_HOOKS,
        "GET /api/social/schedules": { ok: true, schedules: [] },
        "GET /api/billing/usage": { ok: true, usage: { buckets: { render: { unlimited: true } } } },
      }, CONSENT);
      const result = await byName[name].handler(ctx, args(dir, webhookId));
      assert.equal(result.structuredContent.error, "WEBHOOK_NOT_FOUND", `${name} ${webhookId}`);
      assert.deepEqual(charges, []);
      assert.equal(calls.some((c) => c.method !== "GET"), false);
    }
  });

  test(`${name} accepts an enabled webhookId of the user's`, async () => {
    const dir = mediaWith("clip.mp4");
    const { ctx, calls } = ctxWith({
      "GET /api/social/config": CONFIG_HOOKS,
      "GET /api/social/schedules": { ok: true, schedules: [] },
      "GET /api/billing/usage": { ok: true, usage: { buckets: { render: { unlimited: true } } } },
      "POST /api/social/post": { ok: true, results: [] },
      "POST /api/social/schedules": { ok: true, schedule: { id: "s" } },
      "POST /api/jobs/enqueue": { ok: true, job: { id: "j", status: "queued" } },
    }, CONSENT);
    const result = await byName[name].handler(ctx, args(dir, "wh_on"));
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    assert.ok(calls.some((c) => c.method === "POST"));
  });
}

test("a youtube replay schedule stores the relative /outputs/ link, not an absolute one", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx, calls } = ctxWith({ "POST /api/social/schedules": (_m, _p, opts) => ({ ok: true, schedule: { ...opts.body.schedule, id: "s_yt" } }) }, CONSENT);
  const result = await byName.schedules.handler(ctx, {
    action: "create", type: "replay", cron: "0 9 * * *", destination: "youtube", caption: "c", videoPath: path.join(dir, "clip.mp4"),
  });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(calls.at(-1).opts.body.schedule.videoUrl, "/outputs/clip.mp4");
});
