import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import storyTools, { _setDurationProbeForTests } from "./story.js";
import storySceneTools from "./storyScenes.js";

const USER = { id: "u_story", email: "story@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  _setDurationProbeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(storyTools.map((t) => [t.name, t]));
const UNLIMITED_USAGE = { ok: true, usage: { plan: "premium", buckets: { render: { used: 0, limit: -1, unlimited: true, remaining: null } } } };
const SPENT_USAGE = { ok: true, usage: { plan: "free", buckets: { render: { used: 5, limit: 5, unlimited: false, remaining: 0 } } } };

const PROJECT = (fields = {}) => ({
  projectId: "p1", title: "Psalm 23", status: "segmenting", error: null, style: "cinematic-bible",
  scenes: [], transcript: { words: [] }, source: { audioPath: null, durationMs: 0 }, render: {}, aiMotion: null, ...fields,
});
const scene = (id, fields = {}) => ({ id, text: id, imagePrompt: "p", imageStatus: "done", imagePath: `/x/${id}.png`, ...fields });

/** A media folder for unit tests, with the given files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "story-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return fs.realpathSync(dir);
}

/** A fake ctx whose chargeCap records each call as one object. */
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

// ---- definitions ----

test("the story file declares six tools on /api/story, charged in their handlers", () => {
  assert.deepEqual(storyTools.map((t) => t.name), [
    "story_project", "story_import_script", "story_process", "story_step", "story_render", "story_cancel",
  ]);
  for (const tool of storyTools) {
    assert.deepEqual(tool.routes, ["/api/story"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.publish, undefined, tool.name);
    assert.equal(tool.requires, undefined, tool.name);
  }
});

test("descriptions name the job kind, the costs and the resegment warning", () => {
  for (const name of ["story_import_script", "story_process", "story_step", "story_render"]) {
    assert.match(byName[name].description, /kind story/, name);
  }
  assert.match(byName.story_step.description, /resegment discards/i);
  assert.match(byName.story_render.description, /every scene needs a picture/i);
  assert.match(byName.story_render.description, /never posts/i);
  assert.match(byName.story_process.description, /images/);
  for (const name of ["story_import_script", "story_process", "story_step"]) {
    assert.match(byName[name].description, /no more scenes than were charged/i, name);
  }
});

// ---- story_project ----

test("story_project list and characters read their routes", async () => {
  const { ctx, calls } = ctxWith({
    "GET /api/story": { ok: true, projects: [{ projectId: "p1", title: "A", status: "done" }] },
    "GET /api/story/characters": { ok: true, characters: [{ key: "moses", description: "d" }] },
  });
  const list = await byName.story_project.handler(ctx, { action: "list" });
  assert.deepEqual(list.structuredContent, { projects: [{ projectId: "p1", title: "A", status: "done" }] });
  const cast = await byName.story_project.handler(ctx, { action: "characters" });
  assert.deepEqual(cast.structuredContent, { characters: [{ key: "moses", description: "d" }] });
  assert.deepEqual(routesCalled(calls), ["GET /api/story", "GET /api/story/characters"]);
});

test("story_project get returns the project view without the transcript", async () => {
  const project = PROJECT({ transcript: { words: [{ text: "a", startMs: 0, endMs: 5000 }] }, scenes: [scene("scene-001")] });
  const { ctx, calls } = ctxWith({ "GET /api/story/p1": { ok: true, project } });
  const result = await byName.story_project.handler(ctx, { action: "get", id: "p1" });
  const view = result.structuredContent.project;
  assert.equal(view.id, "p1");
  assert.equal(view.transcript, undefined);
  assert.equal(view.durationMs, 5000);
  assert.equal(view.scenes[0].id, "scene-001");
  assert.equal(view.job.kind, "story");
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1"]);
});

test("story_project create posts only the fields given; delete deletes", async () => {
  const { ctx, calls } = ctxWith({
    "POST /api/story": { ok: true, project: PROJECT({ status: "draft" }) },
    "DELETE /api/story/p1": { ok: true },
  });
  const made = await byName.story_project.handler(ctx, { action: "create", title: "Psalm 23", aspect: "landscape", cast: ["moses"] });
  assert.deepEqual(calls[0].opts.body, { title: "Psalm 23", aspect: "landscape", cast: ["moses"] });
  assert.equal(made.structuredContent.project.id, "p1");
  const gone = await byName.story_project.handler(ctx, { action: "delete", id: "p1" });
  assert.deepEqual(gone.structuredContent, { id: "p1", deleted: true });
  assert.deepEqual(routesCalled(calls), ["POST /api/story", "DELETE /api/story/p1"]);
});

test("story_project get and delete need an id", async () => {
  const { ctx, calls } = ctxWith({});
  for (const action of ["get", "delete"]) {
    const result = await byName.story_project.handler(ctx, { action });
    assert.equal(result.structuredContent.error, "BAD_INPUT", action);
  }
  assert.equal(calls.length, 0);
});

// ---- story_import_script ----

test("story_import_script refuses an audio path outside the media folder and calls nothing", async () => {
  mediaWith();
  const { ctx, calls, chargeCalls } = ctxWith({});
  const result = await byName.story_import_script.handler(ctx, { script: "The Lord is my shepherd", audioPath: "C:/Windows/win.ini", durationMs: 8000 });
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
  assert.equal(chargeCalls.length, 0);
});

test("story_import_script without autoStart imports with the confined path and charges nothing", async () => {
  const dir = mediaWith("voice.mp3");
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/story/import-script": { ok: true, project: PROJECT() } });
  const words = [{ text: "The", startMs: 0, endMs: 300 }];
  const result = await byName.story_import_script.handler(ctx, {
    script: "The Lord is my shepherd", audioPath: path.join(dir, "voice.mp3"), durationMs: 8000, words, title: "Psalm 23",
  });
  assert.deepEqual(calls[0].opts.body, {
    script: "The Lord is my shepherd", audioPath: path.join(dir, "voice.mp3"), durationMs: 8000, words, title: "Psalm 23",
  });
  assert.equal(chargeCalls.length, 0);
  assert.equal(result.structuredContent.project.id, "p1");
  assert.equal(result.structuredContent.kind, undefined);
});

test("story_import_script with autoStart checks the plan quota, charges the estimated pictures and returns a story handle", async () => {
  const dir = mediaWith("voice.mp3");
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/story/import-script": { ok: true, project: PROJECT() } });
  const result = await byName.story_import_script.handler(ctx, {
    script: "The Lord is my shepherd", audioPath: path.join(dir, "voice.mp3"), durationMs: 80_000, autoStart: true,
  });
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage", "POST /api/story/import-script"]);
  assert.equal(calls[1].opts.body.autoStart, true);
  assert.equal(calls[1].opts.body.aiMotion, undefined);
  assert.deepEqual(calls[1].opts.body.scene, { maxScenes: 10 });
  assert.deepEqual(chargeCalls, [{ images: 10 }]);
  assert.equal(result.structuredContent.kind, "story");
  assert.equal(result.structuredContent.id, "p1");
  assert.equal(result.structuredContent.imagesCharged, 10);
});

test("story_import_script estimates from the timed words when they run past durationMs, and caps the scenes there", async () => {
  const dir = mediaWith("voice.mp3");
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/story/import-script": { ok: true, project: PROJECT() } });
  const words = [{ text: "The", startMs: 0, endMs: 1000 }, { text: "Lord", startMs: 95_000, endMs: 96_000 }];
  await byName.story_import_script.handler(ctx, {
    script: "The Lord is my shepherd", audioPath: path.join(dir, "voice.mp3"), durationMs: 80_000, words, autoStart: true,
  });
  assert.deepEqual(chargeCalls, [{ images: 12 }]);
  assert.deepEqual(calls[1].opts.body.scene, { maxScenes: 12 });
});

test("story_import_script without autoStart sends no scene limit", async () => {
  const dir = mediaWith("voice.mp3");
  const { ctx, calls } = ctxWith({ "POST /api/story/import-script": { ok: true, project: PROJECT() } });
  await byName.story_import_script.handler(ctx, { script: "The Lord is my shepherd", audioPath: path.join(dir, "voice.mp3"), durationMs: 80_000 });
  assert.equal(calls[0].opts.body.scene, undefined);
});

test("story_import_script with autoStart and no render quota left is refused before any charge", async () => {
  const dir = mediaWith("voice.mp3");
  const { ctx, calls, chargeCalls } = ctxWith({}, { usage: SPENT_USAGE });
  const result = await byName.story_import_script.handler(ctx, {
    script: "The Lord is my shepherd", audioPath: path.join(dir, "voice.mp3"), durationMs: 80_000, autoStart: true,
  });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage"]);
  assert.equal(chargeCalls.length, 0);
});

// ---- story_process ----

test("story_process refuses a media path outside the folder before reading the project", async () => {
  mediaWith();
  const { ctx, calls } = ctxWith({});
  const result = await byName.story_process.handler(ctx, { id: "p1", mediaPath: "https://example.com/a.mp3" });
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

test("story_process on a project with scenes charges the scenes missing a picture", async () => {
  const dir = mediaWith("talk.mp3");
  const project = PROJECT({ status: "error", scenes: [scene("s1"), scene("s2", { imageStatus: "error" }), scene("s3", { imageStatus: "pending" })] });
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project }, "POST /api/story/p1/process": { ok: true } });
  const result = await byName.story_process.handler(ctx, { id: "p1", mediaPath: path.join(dir, "talk.mp3") });
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1", "GET /api/billing/usage", "POST /api/story/p1/process"]);
  // The scenes exist, so nothing is segmented and no scene limit is sent.
  assert.deepEqual(calls[2].opts.body, { mediaPath: path.join(dir, "talk.mp3") });
  assert.deepEqual(chargeCalls, [{ images: 2 }]);
  assert.equal(result.structuredContent.kind, "story");
  assert.equal(result.structuredContent.status, "running");
  assert.equal(result.structuredContent.imagesCharged, 2);
});

test("story_process on an imported script estimates from the transcript", async () => {
  const dir = mediaWith("talk.mp3");
  const project = PROJECT({ transcript: { words: [{ text: "a", startMs: 0, endMs: 40_000 }] } });
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project }, "POST /api/story/p1/process": { ok: true } });
  await byName.story_process.handler(ctx, { id: "p1", mediaPath: path.join(dir, "talk.mp3") });
  assert.deepEqual(chargeCalls, [{ images: 5 }]);
  // R44: the charged estimate is the most scenes the segmenter may cut.
  assert.deepEqual(calls[2].opts.body, { mediaPath: path.join(dir, "talk.mp3"), maxScenes: 5 });
});

test("story_process on fresh media reads its length to estimate the pictures", async () => {
  const dir = mediaWith("talk.mp3");
  const probed = [];
  _setDurationProbeForTests(async (file) => { probed.push(file); return 160; });
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project: PROJECT({ status: "draft" }) }, "POST /api/story/p1/process": { ok: true } });
  await byName.story_process.handler(ctx, { id: "p1", mediaPath: path.join(dir, "talk.mp3") });
  assert.deepEqual(probed, [path.join(dir, "talk.mp3")]);
  assert.deepEqual(chargeCalls, [{ images: 20 }]);
  assert.deepEqual(calls[2].opts.body, { mediaPath: path.join(dir, "talk.mp3"), maxScenes: 20 });
});

test("story_process refuses media whose length cannot be read, charging nothing", async () => {
  const dir = mediaWith("talk.mp3");
  _setDurationProbeForTests(async () => null);
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project: PROJECT({ status: "draft" }) } });
  const result = await byName.story_process.handler(ctx, { id: "p1", mediaPath: path.join(dir, "talk.mp3") });
  assert.equal(result.structuredContent.error, "MEDIA_UNREADABLE");
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1"]);
  assert.equal(chargeCalls.length, 0);
});

test("story_process refuses a project that would start paid AI motion by itself", async () => {
  const dir = mediaWith("talk.mp3");
  const project = PROJECT({ scenes: [scene("s1", { imageStatus: "pending" })], aiMotion: { quality: "standard", autoStartedAt: null } });
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project } });
  const result = await byName.story_process.handler(ctx, { id: "p1", mediaPath: path.join(dir, "talk.mp3") });
  assert.equal(result.structuredContent.error, "AI_MOTION_PROJECT");
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1"]);
  assert.equal(chargeCalls.length, 0);
});

test("story_process gives the pictures back when the route only resumed a run already starting", async () => {
  const dir = mediaWith("talk.mp3");
  const project = PROJECT({ status: "generating_images", scenes: [scene("s1", { imageStatus: "pending" })] });
  const { ctx, refunds } = ctxWith({ "GET /api/story/p1": { ok: true, project }, "POST /api/story/p1/process": { ok: true, preparing: true } });
  const result = await byName.story_process.handler(ctx, { id: "p1", mediaPath: path.join(dir, "talk.mp3") });
  assert.deepEqual(refunds, [{ bucket: "images", amount: 1 }]);
  assert.equal(result.structuredContent.imagesCharged, 0);
});

// ---- story_step ----

test("story_step segment runs the segmenter and charges nothing", async () => {
  const project = PROJECT({ status: "generating_images", scenes: [scene("s1", { imageStatus: "pending" })] });
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/story/p1/segment": { ok: true, project } });
  const result = await byName.story_step.handler(ctx, { id: "p1", step: "segment" });
  assert.deepEqual(routesCalled(calls), ["POST /api/story/p1/segment"]);
  assert.equal(chargeCalls.length, 0);
  assert.equal(result.structuredContent.project.sceneCount, 1);
});

test("story_step images charges the scenes missing a picture, or every scene with force", async () => {
  const project = PROJECT({ status: "generating_images", scenes: [scene("s1"), scene("s2", { imageStatus: "error" })] });
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project }, "POST /api/story/p1/images": { ok: true, project } });
  const result = await byName.story_step.handler(ctx, { id: "p1", step: "images" });
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1", "GET /api/billing/usage", "POST /api/story/p1/images"]);
  assert.deepEqual(calls[2].opts.body, { force: false });
  assert.equal(result.structuredContent.kind, "story");
  await byName.story_step.handler(ctx, { id: "p1", step: "images", force: true });
  assert.deepEqual(calls[5].opts.body, { force: true });
  assert.deepEqual(chargeCalls, [{ images: 1 }, { images: 2 }]);
});

test("story_step images with no scenes says to segment first and charges nothing", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project: PROJECT() } });
  const result = await byName.story_step.handler(ctx, { id: "p1", step: "images" });
  assert.equal(result.structuredContent.error, "NO_SCENES");
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1"]);
  assert.equal(chargeCalls.length, 0);
});

test("story_step resegment charges a fresh picture for every new scene", async () => {
  const project = PROJECT({ status: "done", transcript: { words: [{ text: "a", startMs: 0, endMs: 24_000 }] }, scenes: [scene("s1")] });
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project }, "POST /api/story/p1/resegment": { ok: true } });
  const result = await byName.story_step.handler(ctx, { id: "p1", step: "resegment" });
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1", "GET /api/billing/usage", "POST /api/story/p1/resegment"]);
  assert.deepEqual(chargeCalls, [{ images: 3 }]);
  assert.deepEqual(calls[2].opts.body, { maxScenes: 3 });
  assert.equal(result.structuredContent.phase, "segmenting");
});

test("story_step images refuses an AI-motion project before charging", async () => {
  const project = PROJECT({ scenes: [scene("s1", { imageStatus: "pending" })], aiMotion: { quality: "high", autoStartedAt: null } });
  const { ctx, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project } });
  const result = await byName.story_step.handler(ctx, { id: "p1", step: "images" });
  assert.equal(result.structuredContent.error, "AI_MOTION_PROJECT");
  assert.equal(chargeCalls.length, 0);
});

// ---- story_render ----

test("story_render checks the plan quota, charges one render and returns a story handle", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/story/p1/render": { ok: true, jobId: "rj1", project: PROJECT({ status: "rendering" }) } });
  const result = await byName.story_render.handler(ctx, { id: "p1" });
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage", "POST /api/story/p1/render"]);
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
  assert.deepEqual(result.structuredContent, {
    kind: "story", id: "p1", status: "running", percent: null, phase: "rendering", output: null, error: null, jobId: "rj1",
  });
});

test("story_render without plan quota is refused before any charge", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({}, { usage: SPENT_USAGE });
  const result = await byName.story_render.handler(ctx, { id: "p1" });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage"]);
  assert.equal(chargeCalls.length, 0);
});

// ---- story_cancel ----

test("story_cancel stops the render or the AI motion orders, for free", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "POST /api/story/p1/cancel": { ok: true, project: PROJECT({ status: "error", error: "Cancelled." }) },
    "POST /api/story/p1/animate/cancel": { ok: true, project: PROJECT() },
  });
  const render = await byName.story_cancel.handler(ctx, { id: "p1", what: "render" });
  assert.deepEqual(render.structuredContent, { kind: "story", id: "p1", cancelled: "render" });
  const animate = await byName.story_cancel.handler(ctx, { id: "p1", what: "animate" });
  assert.deepEqual(animate.structuredContent, { kind: "story", id: "p1", cancelled: "animate" });
  assert.deepEqual(routesCalled(calls), ["POST /api/story/p1/cancel", "POST /api/story/p1/animate/cancel"]);
  assert.equal(chargeCalls.length, 0);
});

// ---- through the real MCP client ----

test("tools/list shows the story tools, but not story_animate to a normal user", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const tool of [...storyTools, ...storySceneTools].filter((t) => t.requires !== "super_admin")) {
    assert.ok(names.includes(tool.name), tool.name);
  }
  assert.ok(!names.includes("story_animate"));
});

test("a real story project is created, read, listed, cancelled and deleted", async () => {
  const made = await client.callTool({ name: "story_project", arguments: { action: "create", title: "Real one" } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  const id = made.structuredContent.project.id;
  const got = await client.callTool({ name: "story_project", arguments: { action: "get", id } });
  assert.equal(got.structuredContent.project.title, "Real one");
  const listed = await client.callTool({ name: "story_project", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.projects.some((p) => p.projectId === id));
  const cast = await client.callTool({ name: "story_project", arguments: { action: "characters" } });
  assert.ok(cast.structuredContent.characters.some((c) => c.key === "moses"));
  const cancelled = await client.callTool({ name: "story_cancel", arguments: { id, what: "render" } });
  assert.ok(!cancelled.isError, JSON.stringify(cancelled.structuredContent));
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "story", id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "cancelled");
  const gone = await client.callTool({ name: "story_project", arguments: { action: "delete", id } });
  assert.deepEqual(gone.structuredContent, { id, deleted: true });
});

test("a real story_render on a project without pictures is refused, and the render cap is given back", async () => {
  const made = await client.callTool({ name: "story_project", arguments: { action: "create", title: "No pictures" } });
  const id = made.structuredContent.project.id;
  const before = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const result = await client.callTool({ name: "story_render", arguments: { id } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /every scene needs/);
  const afterCall = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  assert.deepEqual(afterCall, before);
});
