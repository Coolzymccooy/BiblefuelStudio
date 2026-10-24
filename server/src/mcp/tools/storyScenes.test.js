import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { fail } from "../toolResult.js";
import { _setScopeForTests } from "../mediaPath.js";
import sceneTools from "./storyScenes.js";

const USER = { id: "u_scenes", email: "scenes@example.com", role: "user", emailVerified: true };
const ADMIN = { id: "u_admin", email: "admin@example.com", role: "admin", emailVerified: true };
const testApp = await startTestApp({ users: [USER, ADMIN], superAdminEmail: ADMIN.email });
const userClient = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const adminClient = await mcpClient(testApp.port, testApp.keyFor(ADMIN.id));

after(async () => {
  _setScopeForTests(null);
  await userClient.close().catch(() => {});
  await adminClient.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(sceneTools.map((t) => [t.name, t]));
const UNLIMITED_USAGE = { ok: true, usage: { plan: "premium", buckets: { render: { used: 0, limit: -1, unlimited: true, remaining: null } } } };
const SPENT_USAGE = { ok: true, usage: { plan: "free", buckets: { render: { used: 5, limit: 5, unlimited: false, remaining: 0 } } } };
const PROJECT = (fields = {}) => ({ projectId: "p1", title: "T", status: "ready_to_render", scenes: [{ id: "scene-001", imageStatus: "done" }], ...fields });

function ctxWith(responses, { usage = UNLIMITED_USAGE } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usage, ...responses }, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);

test("the scenes file declares three story tools; story_animate is super-admin only", () => {
  assert.deepEqual(sceneTools.map((t) => t.name), ["story_scene_update", "story_settings", "story_animate"]);
  for (const tool of sceneTools) {
    assert.deepEqual(tool.routes, ["/api/story"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
  }
  assert.equal(byName.story_animate.requires, "super_admin");
  assert.equal(byName.story_scene_update.requires, undefined);
  assert.match(byName.story_animate.description, /dollars|\$/);
  assert.match(byName.story_animate.description, /kind story/);
  assert.match(byName.story_animate.description, /real cost can differ/i);
  assert.match(byName.story_settings.description, /Free: no plan quota/);
  assert.match(byName.story_scene_update.description, /prompt or text is free/);
});

// ---- story_scene_update ----

test("story_scene_update needs something to change", async () => {
  const { ctx, calls } = ctxWith({});
  const result = await byName.story_scene_update.handler(ctx, { id: "p1", sceneId: "scene-001" });
  assert.equal(result.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("story_scene_update patches the prompt and caption text without charging", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "PATCH /api/story/p1/scenes/scene-001": { ok: true, project: PROJECT() } });
  const result = await byName.story_scene_update.handler(ctx, { id: "p1", sceneId: "scene-001", prompt: "a shepherd at dawn", text: "The Lord is my shepherd" });
  assert.deepEqual(routesCalled(calls), ["PATCH /api/story/p1/scenes/scene-001"]);
  assert.deepEqual(calls[0].opts.body, { imagePrompt: "a shepherd at dawn", text: "The Lord is my shepherd" });
  assert.equal(chargeCalls.length, 0);
  assert.equal(result.structuredContent.project.id, "p1");
});

test("story_scene_update regenerate checks the plan quota and charges one picture", async () => {
  const { ctx, calls, chargeCalls, refunds } = ctxWith({
    "PATCH /api/story/p1/scenes/scene-001": { ok: true, project: PROJECT() },
    "POST /api/story/p1/scenes/scene-001/regenerate": { ok: true, project: PROJECT(), sceneOk: true, sceneError: null },
  });
  const result = await byName.story_scene_update.handler(ctx, { id: "p1", sceneId: "scene-001", prompt: "new", regenerate: true });
  // The quota is read before anything changes, so a refused regenerate leaves the prompt as it was.
  assert.deepEqual(routesCalled(calls), [
    "GET /api/billing/usage", "PATCH /api/story/p1/scenes/scene-001", "POST /api/story/p1/scenes/scene-001/regenerate",
  ]);
  assert.deepEqual(chargeCalls, [{ images: 1 }]);
  assert.equal(refunds.length, 0);
  assert.equal(result.structuredContent.sceneOk, true);
});

test("story_scene_update gives the picture back when the provider made none", async () => {
  const { ctx, refunds } = ctxWith({
    "POST /api/story/p1/scenes/scene-001/regenerate": { ok: true, project: PROJECT(), sceneOk: false, sceneError: "Daily free image quota used up." },
  });
  const result = await byName.story_scene_update.handler(ctx, { id: "p1", sceneId: "scene-001", regenerate: true });
  assert.deepEqual(refunds, [{ bucket: "images", amount: 1 }]);
  assert.equal(result.structuredContent.sceneOk, false);
  assert.equal(result.structuredContent.sceneError, "Daily free image quota used up.");
});

test("story_scene_update regenerate without plan quota is refused before any charge", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({}, { usage: SPENT_USAGE });
  const result = await byName.story_scene_update.handler(ctx, { id: "p1", sceneId: "scene-001", prompt: "new", regenerate: true });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage"]);
  assert.equal(chargeCalls.length, 0);
});

test("story_scene_update regenerate with the daily images cap used up changes nothing", async () => {
  const fake = fakeMcpCtx({ "GET /api/billing/usage": UNLIMITED_USAGE }, {
    chargeCap: async () => fail("MCP_CAP_REACHED", "This key has used its daily images."),
  });
  const result = await byName.story_scene_update.handler(fake.ctx, { id: "p1", sceneId: "scene-001", prompt: "new", regenerate: true });
  assert.equal(result.structuredContent.error, "MCP_CAP_REACHED");
  // Charged before the PATCH, so the prompt is left as it was.
  assert.deepEqual(routesCalled(fake.calls), ["GET /api/billing/usage"]);
});

// ---- story_settings ----

test("story_settings needs at least one section", async () => {
  const { ctx, calls } = ctxWith({});
  const result = await byName.story_settings.handler(ctx, { id: "p1" });
  assert.equal(result.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("story_settings patches only the sections given, mapping the caption fields", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "PATCH /api/story/p1/captions": { ok: true, project: PROJECT() },
    "PATCH /api/story/p1/cast": { ok: true, project: PROJECT(), rejected: ["zeus"], note: "1 scene image(s) already generated — regenerate them to apply the new cast." },
  });
  const result = await byName.story_settings.handler(ctx, {
    id: "p1",
    captions: { mode: "static", preset: "default", layout: "bottom-center", energy: "calm", title: "Psalm 23", stagger: true },
    cast: ["moses", "zeus"],
  });
  assert.deepEqual(routesCalled(calls), ["PATCH /api/story/p1/captions", "PATCH /api/story/p1/cast"]);
  assert.deepEqual(calls[0].opts.body, {
    captions: "static", captionPreset: "default", captionLayout: "bottom-center", captionEnergy: "calm", captionTitle: "Psalm 23", captionStagger: true,
  });
  assert.deepEqual(calls[1].opts.body, { cast: ["moses", "zeus"] });
  assert.deepEqual(result.structuredContent.rejectedCast, ["zeus"]);
  assert.match(result.structuredContent.note, /regenerate/);
  assert.equal(chargeCalls.length, 0);
});

test("story_settings music takes a library ref or a confined file, and null clears it", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(testApp.dataDir, "scenes-media-")));
  fs.writeFileSync(path.join(dir, "bed.mp3"), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  const { ctx, calls } = ctxWith({ "PATCH /api/story/p1/music": { ok: true, project: PROJECT() } });
  await byName.story_settings.handler(ctx, { id: "p1", music: { path: "library:calm-piano", volume: 0.2 } });
  await byName.story_settings.handler(ctx, { id: "p1", music: { path: path.join(dir, "bed.mp3"), autoDuck: false } });
  await byName.story_settings.handler(ctx, { id: "p1", music: { path: null } });
  assert.deepEqual(calls.map((c) => c.opts.body), [
    { path: "library:calm-piano", volume: 0.2 },
    { path: path.join(dir, "bed.mp3"), autoDuck: false },
    { path: null },
  ]);
});

test("story_settings music with only volume sends no path, so the route keeps the current bed", async () => {
  const { ctx, calls } = ctxWith({ "PATCH /api/story/p1/music": { ok: true, project: PROJECT() } });
  await byName.story_settings.handler(ctx, { id: "p1", music: { volume: 0.2 } });
  assert.deepEqual(calls.map((c) => c.opts.body), [{ volume: 0.2 }]);
  assert.equal(Object.hasOwn(calls[0].opts.body, "path"), false);
});

test("story_settings refuses a music path outside the media folder before changing anything", async () => {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "scenes-media-"));
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  const { ctx, calls } = ctxWith({});
  const result = await byName.story_settings.handler(ctx, { id: "p1", captions: { mode: "none" }, music: { path: "/etc/passwd" } });
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

// ---- story_animate ----

const ESTIMATE = (fields = {}) => ({
  ok: true, configured: true, quality: "standard", running: false, spentUsd: 1, reservedUsd: 0, capUsd: 50, monthClips: 3,
  clips: 2, seconds: 16, usd: 0.4321, model: "m", resolution: "720p", usdPerSecond: 0.027, sceneIds: ["scene-001", "scene-002"], ...fields,
});

test("story_animate estimateOnly returns the estimate and orders nothing", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/story/p1/animate/estimate": ESTIMATE() });
  const result = await byName.story_animate.handler(ctx, { id: "p1", estimateOnly: true, quality: "high" });
  assert.deepEqual(routesCalled(calls), ["POST /api/story/p1/animate/estimate"]);
  assert.deepEqual(calls[0].opts.body, { quality: "high" });
  assert.equal(result.structuredContent.estimate.usd, 0.4321);
  assert.equal(result.structuredContent.estimate.ok, undefined);
  assert.equal(chargeCalls.length, 0);
});

test("story_animate charges the estimate's dollars before ordering exactly the estimated scenes", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "POST /api/story/p1/animate/estimate": ESTIMATE(),
    "POST /api/story/p1/animate": { ok: true, project: PROJECT() },
  });
  const result = await byName.story_animate.handler(ctx, { id: "p1", sceneIds: ["scene-001", "scene-002"] });
  assert.deepEqual(routesCalled(calls), ["POST /api/story/p1/animate/estimate", "POST /api/story/p1/animate"]);
  assert.deepEqual(calls[0].opts.body, { sceneIds: ["scene-001", "scene-002"] });
  assert.deepEqual(calls[1].opts.body, { sceneIds: ["scene-001", "scene-002"], quality: "standard" });
  assert.deepEqual(chargeCalls, [{ aiVideoUsd: 0.44 }]);
  assert.equal(result.structuredContent.kind, "story");
  assert.equal(result.structuredContent.phase, "animating");
  assert.equal(result.structuredContent.usdCharged, 0.44);
  assert.equal(result.structuredContent.clips, 2);
});

test("story_animate refuses when AI video is not set up or there is nothing to animate", async () => {
  const off = ctxWith({ "POST /api/story/p1/animate/estimate": ESTIMATE({ configured: false }) });
  const notSet = await byName.story_animate.handler(off.ctx, { id: "p1" });
  assert.equal(notSet.structuredContent.error, "NOT_CONFIGURED");
  const none = ctxWith({ "POST /api/story/p1/animate/estimate": ESTIMATE({ clips: 0, usd: 0, sceneIds: [] }) });
  const nothing = await byName.story_animate.handler(none.ctx, { id: "p1" });
  assert.equal(nothing.structuredContent.error, "NOTHING_TO_ANIMATE");
  assert.equal(off.chargeCalls.length + none.chargeCalls.length, 0);
  assert.equal(off.calls.length + none.calls.length, 2);
});

// ---- through the real MCP client ----

test("story_animate is listed for a super-admin key and hidden from a normal one", async () => {
  const userNames = (await userClient.listTools()).tools.map((t) => t.name);
  const adminNames = (await adminClient.listTools()).tools.map((t) => t.name);
  assert.ok(!userNames.includes("story_animate"));
  assert.ok(adminNames.includes("story_animate"));
  assert.ok(userNames.includes("story_settings"));
  assert.ok(userNames.includes("story_scene_update"));
});

test("a real story_settings call changes the captions and the cast", async () => {
  const made = await userClient.callTool({ name: "story_project", arguments: { action: "create", title: "Settings" } });
  const id = made.structuredContent.project.id;
  const result = await userClient.callTool({ name: "story_settings", arguments: { id, captions: { mode: "static" }, cast: ["moses", "nobody"] } });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.equal(result.structuredContent.project.captions, "static");
  assert.deepEqual(result.structuredContent.project.cast, ["moses"]);
  assert.deepEqual(result.structuredContent.rejectedCast, ["nobody"]);
});
