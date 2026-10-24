import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import timelineTools from "./timeline.js";

const USER = { id: "u_timeline", email: "timeline@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));
// The same module instance the test app mounted: the proof renderer is replaced so no ffmpeg runs.
const { _setTimelineRendererForTest, _resetTimelineRenderJobsForTest } = await import("../../routes/timeline.js");

after(async () => {
  _setScopeForTests(null);
  _resetTimelineRenderJobsForTest();
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(timelineTools.map((t) => [t.name, t]));
const bucket = (fields) => ({ used: 0, limit: -1, unlimited: true, remaining: null, ...fields });
const usage = (render = {}) => ({ ok: true, usage: { plan: "premium", buckets: { render: bucket(render) } } });
const SPENT = { used: 5, limit: 5, unlimited: false, remaining: 0 };

const captionAsset = { id: "cap1", kind: "caption", source: "system", label: "Title" };
const PROJECT = (assets = { cap1: captionAsset }, tracks = null) => ({
  id: "tl_1", title: "Sunday reel", template: "blank", aspect: "9:16", targetDurationSec: 10, scenes: [],
  assets,
  tracks: tracks || [{ id: "t-cap", kind: "captions", label: "Captions", clips: [{ id: "c1", assetId: "cap1", startSec: 0, durationSec: 4, text: "Grace", transform: { fit: "cover" } }] }],
  renderSettings: { quality: "proof_720p" },
});

/** A fake ctx answering GET /api/timeline/projects/tl_1 with `project`; chargeCap records each call as one object. */
function ctxWith(responses = {}, { project = PROJECT(), usageBody = usage() } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usageBody, "GET /api/timeline/projects/tl_1": { ok: true, project }, ...responses }, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);
const QUEUED = { ok: true, jobId: "timeline-1", status: "queued", progress: 0, phase: "queued" };

/** A media folder for unit tests, with the given files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "timeline-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return fs.realpathSync(dir);
}

const videoProject = (videoPath) => PROJECT(
  { v1: { id: "v1", kind: "video", source: "upload", label: "Clip", path: videoPath } },
  [{ id: "t-v", kind: "video", label: "Video", clips: [{ id: "c1", assetId: "v1", startSec: 0, durationSec: 5, transform: { fit: "cover" } }] }],
);

test("the timeline file declares two tools on /api/timeline, charged in their handlers", () => {
  assert.deepEqual(Object.keys(byName).sort(), ["timeline_project", "timeline_render"]);
  for (const tool of timelineTools) {
    assert.deepEqual(tool.routes, ["/api/timeline"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
  }
  assert.match(byName.timeline_render.description, /kind timeline/);
  assert.match(byName.timeline_render.description, /one daily render/);
  assert.match(byName.timeline_render.description, /daily tts/);
  assert.match(byName.timeline_project.description, /media_import_url/);
});

test("timeline_project list summarises the projects; get returns one", async () => {
  const { ctx } = ctxWith({ "GET /api/timeline/projects": { ok: true, projects: [{ ...PROJECT(), updatedAt: 9 }] } });
  const listed = (await byName.timeline_project.handler(ctx, { action: "list" })).structuredContent.projects;
  assert.deepEqual(listed, [{ id: "tl_1", title: "Sunday reel", aspect: "9:16", template: "blank", targetDurationSec: 10, updatedAt: 9, tracks: 1, clips: 1, assets: 1 }]);
  const got = await byName.timeline_project.handler(ctx, { action: "get", id: "tl_1" });
  assert.equal(got.structuredContent.project.id, "tl_1");
  assert.equal((await byName.timeline_project.handler(ctx, { action: "get" })).structuredContent.error, "BAD_INPUT");
});

test("timeline_project save confines every asset path and saves the project as given", async () => {
  const dir = mediaWith("clip.mp4");
  const project = videoProject(path.join(dir, "clip.mp4"));
  const { ctx, calls } = ctxWith({ "PUT /api/timeline/projects/tl_1": { ok: true, project: { ...project, updatedAt: 1 } } });
  const result = await byName.timeline_project.handler(ctx, { action: "save", project });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.deepEqual(calls[0].opts.body, { project });
  assert.equal((await byName.timeline_project.handler(ctx, { action: "save" })).structuredContent.error, "BAD_INPUT");
});

test("timeline_project save refuses an asset outside the media folder, a URL or a library id, naming the asset", async () => {
  mediaWith("clip.mp4");
  for (const bad of ["/etc/passwd", "https://example.com/a.mp4", "12345"]) {
    const { ctx, calls } = ctxWith();
    const result = await byName.timeline_project.handler(ctx, { action: "save", project: videoProject(bad) });
    assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA", bad);
    assert.match(result.structuredContent.message, /Clip/);
    assert.equal(calls.length, 0);
  }
});

test("timeline_project save keeps library music refs and confines a proxy path too", async () => {
  const dir = mediaWith("clip.mp4");
  const music = PROJECT(
    { m1: { id: "m1", kind: "audio", source: "library", label: "Bed", path: "library:hopeful" } },
    [{ id: "t-m", kind: "music", label: "Music", clips: [{ id: "c1", assetId: "m1", startSec: 0, durationSec: 5, transform: { fit: "cover" } }] }],
  );
  const { ctx, calls } = ctxWith({ "PUT /api/timeline/projects/tl_1": { ok: true, project: music } });
  assert.ok(!(await byName.timeline_project.handler(ctx, { action: "save", project: music })).isError);
  const proxied = videoProject(path.join(dir, "clip.mp4"));
  proxied.assets.v1.proxyPath = "/etc/hosts";
  const refused = await byName.timeline_project.handler(ctx, { action: "save", project: proxied });
  assert.equal(refused.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 1);
});

test("timeline_render renders a saved project with real asset paths, charging a render after the plan check", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/timeline/render": QUEUED }, { project: videoProject(`/outputs/clip.mp4`) });
  const result = await byName.timeline_render.handler(ctx, { projectId: "tl_1", quality: "standard_1080p", captionEnergy: "calm" });
  assert.deepEqual(result.structuredContent, {
    kind: "timeline", id: "timeline-1", status: "queued", percent: 0, phase: "queued", output: null, error: null, ttsCharged: 0,
  });
  assert.deepEqual(routesCalled(calls), ["GET /api/timeline/projects/tl_1", "GET /api/billing/usage", "POST /api/timeline/render"]);
  const sent = calls[2].opts.body;
  assert.equal(sent.project.assets.v1.path, path.join(dir, "clip.mp4"));
  assert.equal(sent.quality, "standard_1080p");
  assert.equal(sent.captionEnergy, "calm");
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
});

test("timeline_render charges one daily tts per voiceover placeholder it will synthesise", async () => {
  const placeholder = { id: "vo1", kind: "audio", source: "chatterbox", label: "VO", prompt: "Welcome to church" };
  const hidden = { id: "vo2", kind: "audio", source: "fish", label: "Hidden VO", prompt: "Not drawn" };
  const project = PROJECT({ cap1: captionAsset, vo1: placeholder, vo2: hidden }, [
    PROJECT().tracks[0],
    { id: "t-vo", kind: "voiceover", label: "VO", clips: [{ id: "c2", assetId: "vo1", startSec: 0, durationSec: 3 }, { id: "c3", assetId: "vo1", startSec: 4, durationSec: 3 }] },
    { id: "t-vo2", kind: "voiceover", label: "VO 2", hidden: true, clips: [{ id: "c4", assetId: "vo2", startSec: 0, durationSec: 3 }] },
  ]);
  const { ctx, chargeCalls } = ctxWith({ "POST /api/timeline/render": QUEUED });
  const result = await byName.timeline_render.handler(ctx, { project });
  assert.equal(result.structuredContent.ttsCharged, 2);
  assert.deepEqual(chargeCalls, [{ renders: 1, tts: 2 }]);
});

test("timeline_render needs exactly one of projectId and project, and refuses bad assets and no quota before any charge", async () => {
  const both = ctxWith();
  assert.equal((await byName.timeline_render.handler(both.ctx, { projectId: "tl_1", project: PROJECT() })).structuredContent.error, "BAD_INPUT");
  assert.equal((await byName.timeline_render.handler(both.ctx, {})).structuredContent.error, "BAD_INPUT");
  mediaWith("clip.mp4");
  const outside = ctxWith({}, { project: videoProject("/etc/passwd") });
  assert.equal((await byName.timeline_render.handler(outside.ctx, { projectId: "tl_1" })).structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const spent = ctxWith({}, { usageBody: usage(SPENT) });
  assert.equal((await byName.timeline_render.handler(spent.ctx, { projectId: "tl_1" })).structuredContent.error, "QUOTA_EXCEEDED");
  for (const fake of [both, outside, spent]) {
    assert.ok(!routesCalled(fake.calls).includes("POST /api/timeline/render"));
    assert.deepEqual(fake.chargeCalls, []);
  }
});

// ---- through the real MCP client ----

test("tools/list shows both timeline tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const tool of timelineTools) assert.ok(names.includes(tool.name), tool.name);
});

test("a real project is saved, listed, read and rendered, and jobs_wait sees it done", async () => {
  _setScopeForTests(null);
  _setTimelineRendererForTest(async (plan, opts) => ({ ok: true, outputPath: path.join(opts.outputDir, "timeline", "x.mp4"), publicUrl: "/outputs/timeline/x.mp4" }));
  const project = { ...PROJECT(), id: "tl_real" };
  const saved = await client.callTool({ name: "timeline_project", arguments: { action: "save", project } });
  assert.ok(!saved.isError, JSON.stringify(saved.structuredContent));
  const listed = await client.callTool({ name: "timeline_project", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.projects.some((p) => p.id === "tl_real"));
  const got = await client.callTool({ name: "timeline_project", arguments: { action: "get", id: "tl_real" } });
  assert.equal(got.structuredContent.project.title, "Sunday reel");
  const before = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders.used;
  const started = await client.callTool({ name: "timeline_render", arguments: { projectId: "tl_real" } });
  assert.ok(!started.isError, JSON.stringify(started.structuredContent));
  assert.equal(started.structuredContent.kind, "timeline");
  const after = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders.used;
  assert.equal(after, before + 1);
  const done = await client.callTool({ name: "jobs_wait", arguments: { kind: "timeline", id: started.structuredContent.id, timeoutSec: 5 } });
  assert.equal(done.structuredContent.status, "done");
  assert.match(done.structuredContent.output.url, /\/outputs\/timeline\/x\.mp4$/);
});

test("a real render of a project with no renderable clips is refused by the app and the render cap is given back", async () => {
  const empty = { ...PROJECT({ cap1: captionAsset }, [{ id: "t", kind: "captions", label: "C", clips: [] }]), id: "tl_empty" };
  const before = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const result = await client.callTool({ name: "timeline_render", arguments: { project: empty } });
  assert.equal(result.isError, true);
  assert.deepEqual((await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders, before);
});

test("a real save naming another user's file is refused before the app sees it", async () => {
  const result = await client.callTool({ name: "timeline_project", arguments: { action: "save", project: { ...videoProject(path.join(testApp.dataDir, "users.json")), id: "tl_bad" } } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});
