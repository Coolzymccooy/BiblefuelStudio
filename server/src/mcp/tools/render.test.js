import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import renderTools from "./render.js";

const USER = { id: "u_render", email: "render@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(renderTools.map((t) => [t.name, t]));
const LIBRARY = { ok: true, library: { items: [{ id: "pexels_123" }, { id: "agent_abc-1" }] } };
const QUEUED = (body) => ({ ok: true, job: { id: "job_new", type: body.type, status: "queued", payload: body.payload } });
const AUTO_ON = { ok: true, enabled: true, platforms: ["tiktok"] };
const AUTO_OFF = { ok: true, enabled: false, platforms: [] };

/** A media folder for unit tests, with the given empty files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "render-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return dir;
}

/** A fake ctx whose chargeCap records each call as one object, so atomic charges are visible. */
function ctxWith(responses, { agentKey, refuse } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx(responses, {
    chargeCap: async (bucketOrAmounts, amount) => {
      const amounts = typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts;
      chargeCalls.push(amounts);
      return refuse ? { isError: true, structuredContent: { error: "MCP_CAP_REACHED", bucket: refuse } } : null;
    },
  });
  return { ...fake, ctx: { ...fake.ctx, ...(agentKey ? { agentKey } : {}) }, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);

// ---- definitions ----

test("the render file declares render_short, render_captioned and render_cancel", () => {
  assert.deepEqual(renderTools.map((t) => t.name), ["render_short", "render_captioned", "render_cancel"]);
  assert.deepEqual(byName.render_short.routes, ["/api/jobs", "/api/library"]);
  assert.deepEqual(byName.render_captioned.routes, ["/api/render", "/api/library"]);
  assert.deepEqual(byName.render_cancel.routes, ["/api/render"]);
  assert.deepEqual(byName.render_captioned.caps, { renders: 1 });
  // render_short charges its render together with any publish in one atomic call (R31), so it declares none.
  assert.equal(byName.render_short.caps, undefined);
  for (const def of renderTools) assert.notEqual(def.publish, true, `${def.name} is not registry-publish`);
});

test("render_short and render_captioned refuse a voiceId or preset that could be a path", () => {
  const short = z.object(byName.render_short.inputSchema);
  assert.equal(short.safeParse({ lines: ["a"], autoBackground: true, voiceId: "../../voices/x.wav" }).success, false);
  assert.equal(short.safeParse({ lines: ["a"], autoBackground: true, voiceId: "en-US-AriaNeural" }).success, true);
  assert.equal(short.safeParse({ lines: ["a"], autoBackground: true, typographyPreset: "../x" }).success, false);
  const captioned = z.object(byName.render_captioned.inputSchema);
  assert.equal(captioned.safeParse({ videoPath: "a.mp4", typographyPreset: "a/b" }).success, false);
});

// ---- render_short: consent and auto-publish (R30) ----

test("render_short without consent enqueues with auto-publish suppressed and charges only a render", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/library": LIBRARY,
    "POST /api/jobs/enqueue": (_m, _p, opts) => QUEUED(opts.body),
  }, { agentKey: { publishAllowed: false } });
  const result = await byName.render_short.handler(ctx, { lines: ["The Lord is my shepherd"], backgrounds: ["pexels_123"] });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(routesCalled(calls), ["GET /api/library", "POST /api/jobs/enqueue"]);
  const body = calls[1].opts.body;
  assert.equal(body.type, "render_video");
  assert.equal(body.autoPublish, false);
  assert.equal(body.payload.backgroundPath, "pexels_123");
  assert.deepEqual(body.payload.lines, ["The Lord is my shepherd"]);
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
  assert.equal(result.structuredContent.kind, "job");
  assert.equal(result.structuredContent.id, "job_new");
  assert.equal(result.structuredContent.autoPublish, "suppressed");
  assert.equal(result.structuredContent.ok, undefined);
});

test("render_short with no agentKey at all fails closed: auto-publish suppressed", async () => {
  const { ctx, calls } = ctxWith({ "GET /api/library": LIBRARY, "POST /api/jobs/enqueue": (_m, _p, opts) => QUEUED(opts.body) });
  await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: ["pexels_123"] });
  assert.equal(calls.at(-1).opts.body.autoPublish, false);
});

test("render_short with consent and auto-publish on charges a render and a publish in one call", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/library": LIBRARY,
    "GET /api/postiz/auto-publish": AUTO_ON,
    "POST /api/jobs/enqueue": (_m, _p, opts) => QUEUED(opts.body),
  }, { agentKey: { publishAllowed: true } });
  const result = await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: ["pexels_123"] });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(chargeCalls, [{ renders: 1, publishes: 1 }]);
  assert.equal(Object.hasOwn(calls.at(-1).opts.body, "autoPublish"), false);
  assert.equal(result.structuredContent.autoPublish, "on");
});

test("render_short with consent and auto-publish off charges only a render and still suppresses auto-publish", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/library": LIBRARY,
    "GET /api/postiz/auto-publish": AUTO_OFF,
    "POST /api/jobs/enqueue": (_m, _p, opts) => QUEUED(opts.body),
  }, { agentKey: { publishAllowed: true } });
  const result = await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: ["pexels_123"] });
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
  assert.equal(calls.at(-1).opts.body.autoPublish, false);
  assert.equal(result.structuredContent.autoPublish, "off");
});

test("render_short refused by a cap never enqueues", async () => {
  const { ctx, calls } = ctxWith({ "GET /api/library": LIBRARY, "GET /api/postiz/auto-publish": AUTO_ON }, {
    agentKey: { publishAllowed: true },
    refuse: "publishes",
  });
  const result = await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: ["pexels_123"] });
  assert.equal(result.structuredContent.error, "MCP_CAP_REACHED");
  assert.equal(routesCalled(calls).includes("POST /api/jobs/enqueue"), false);
});

test("render_short with autoBackground also charges four images in the same call", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/jobs/enqueue": (_m, _p, opts) => QUEUED(opts.body) });
  await byName.render_short.handler(ctx, { lines: ["x"], autoBackground: true });
  assert.deepEqual(chargeCalls, [{ renders: 1, images: 4 }]);
  assert.equal(calls.at(-1).opts.body.payload.autoBackground, true);
  assert.equal(Object.hasOwn(calls.at(-1).opts.body.payload, "backgroundPath"), false);
});

// ---- render_short: inputs ----

test("render_short sends media paths as real paths, several backgrounds as scenes with an image kind", async () => {
  const dir = mediaWith("voice.mp3", "a.mp4", "b.png");
  const { ctx, calls } = ctxWith({ "GET /api/library": LIBRARY, "POST /api/jobs/enqueue": (_m, _p, opts) => QUEUED(opts.body) });
  const result = await byName.render_short.handler(ctx, {
    lines: ["x", "y"],
    backgrounds: [path.join(dir, "a.mp4"), "pexels_123", path.join(dir, "b.png")],
    audioPath: path.join(dir, "voice.mp3"),
    musicPath: "library:peaceful-worship",
    durationSec: 30,
    aspect: "square",
  });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  const payload = calls.at(-1).opts.body.payload;
  assert.equal(payload.audioPath, fs.realpathSync(path.join(dir, "voice.mp3")));
  assert.equal(payload.musicPath, "library:peaceful-worship");
  assert.equal(payload.aspect, "square");
  assert.equal(Object.hasOwn(payload, "backgroundPath"), false);
  assert.deepEqual(payload.scenes, [
    { backgroundPath: fs.realpathSync(path.join(dir, "a.mp4")), duration: 10, kind: "video" },
    { backgroundPath: "pexels_123", duration: 10, kind: "video" },
    { backgroundPath: fs.realpathSync(path.join(dir, "b.png")), duration: 10, kind: "image" },
  ]);
});

test("render_short refuses a URL or outside path as a background and charges nothing", async () => {
  mediaWith();
  for (const bad of ["https://example.com/bg.mp4", "C:/Windows/win.ini", "\\\\server\\share\\a.mp4", "../../secret.mp4"]) {
    const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/library": LIBRARY });
    const result = await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: [bad] });
    assert.equal(result.isError, true, bad);
    assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA", bad);
    assert.deepEqual(chargeCalls, []);
    assert.equal(routesCalled(calls).includes("POST /api/jobs/enqueue"), false);
  }
});

test("render_short refuses a library id that is not in the library", async () => {
  mediaWith();
  const { ctx, chargeCalls } = ctxWith({ "GET /api/library": LIBRARY });
  const result = await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: ["pexels_999"] });
  assert.equal(result.structuredContent.error, "BACKGROUND_NOT_FOUND");
  assert.match(result.structuredContent.message, /library_items/);
  assert.deepEqual(chargeCalls, []);
});

test("render_short refuses an audio or music path outside the media folder", async () => {
  mediaWith();
  const { ctx, chargeCalls } = ctxWith({});
  const audio = await byName.render_short.handler(ctx, { lines: ["x"], autoBackground: true, audioPath: "https://evil.test/a.mp3" });
  assert.equal(audio.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const music = await byName.render_short.handler(ctx, { lines: ["x"], autoBackground: true, musicPath: "C:/Windows/win.ini" });
  assert.equal(music.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.deepEqual(chargeCalls, []);
});

test("render_short needs exactly one of backgrounds or autoBackground", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({});
  const neither = await byName.render_short.handler(ctx, { lines: ["x"] });
  assert.equal(neither.structuredContent.error, "BAD_INPUT");
  const both = await byName.render_short.handler(ctx, { lines: ["x"], backgrounds: ["pexels_123"], autoBackground: true });
  assert.equal(both.structuredContent.error, "BAD_INPUT");
  assert.deepEqual(calls, []);
  assert.deepEqual(chargeCalls, []);
});

// ---- render_captioned ----

test("render_captioned in video mode sends the real video path and the words", async () => {
  const dir = mediaWith("clip.mp4");
  const words = [{ text: "Grace", startMs: 0, endMs: 400 }];
  const { ctx, calls } = ctxWith({ "POST /api/render/captioned-video": { ok: true, jobId: "cap_1", durationSec: 12, backgroundIds: [] } });
  const result = await byName.render_captioned.handler(ctx, { videoPath: path.join(dir, "clip.mp4"), words, typographyPreset: "bold" });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(calls[0].opts.body, { videoPath: fs.realpathSync(path.join(dir, "clip.mp4")), words, typographyPreset: "bold" });
  assert.equal(result.structuredContent.kind, "captioned");
  assert.equal(result.structuredContent.id, "cap_1");
  assert.equal(result.structuredContent.durationSec, 12);
});

test("render_captioned in audio mode sends audio, backgrounds and music, and never the wait flag", async () => {
  const dir = mediaWith("voice.mp3", "bg.mp4");
  const { ctx, calls } = ctxWith({
    "GET /api/library": LIBRARY,
    "POST /api/render/captioned-video": { ok: true, jobId: "cap_2", durationSec: 20 },
  });
  await byName.render_captioned.handler(ctx, {
    audioPath: path.join(dir, "voice.mp3"),
    backgrounds: ["agent_abc-1", path.join(dir, "bg.mp4")],
    musicPaths: ["mylib:hymn"],
    captions: false,
  });
  const call = calls.at(-1);
  assert.equal(call.opts.query, undefined);
  assert.deepEqual(call.opts.body, {
    audioPath: fs.realpathSync(path.join(dir, "voice.mp3")),
    backgroundPaths: ["agent_abc-1", fs.realpathSync(path.join(dir, "bg.mp4"))],
    musicPaths: ["mylib:hymn"],
    captions: false,
  });
});

test("render_captioned needs a video, or audio with backgrounds, and words unless captions are off", async () => {
  mediaWith("voice.mp3");
  const { ctx, calls } = ctxWith({});
  const none = await byName.render_captioned.handler(ctx, { words: [{ text: "a", startMs: 0, endMs: 1 }] });
  assert.equal(none.structuredContent.error, "BAD_INPUT");
  const both = await byName.render_captioned.handler(ctx, { videoPath: "a.mp4", audioPath: "b.mp3", backgrounds: ["pexels_123"] });
  assert.equal(both.structuredContent.error, "BAD_INPUT");
  const noWords = await byName.render_captioned.handler(ctx, { videoPath: "a.mp4" });
  assert.equal(noWords.structuredContent.error, "BAD_INPUT");
  assert.deepEqual(calls, []);
});

test("render_captioned refuses a URL video", async () => {
  mediaWith();
  const { ctx, calls } = ctxWith({});
  const result = await byName.render_captioned.handler(ctx, { videoPath: "http://169.254.169.254/latest", captions: false });
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.deepEqual(calls, []);
});

// ---- render_cancel ----

test("render_cancel posts the cancel route for that job", async () => {
  const { ctx, calls } = ctxWith({ "POST /api/render/captioned-video/cap%2F1/cancel": { ok: true } });
  const result = await byName.render_cancel.handler(ctx, { id: "cap/1" });
  assert.deepEqual(routesCalled(calls), ["POST /api/render/captioned-video/cap%2F1/cancel"]);
  assert.deepEqual(result.structuredContent, { kind: "captioned", id: "cap/1", status: "cancelled" });
});

// ---- through the real MCP client ----

const { resolveScopeDirs } = await import("../../lib/paths.js");
const { writeLibrary } = await import("../../lib/library.js");

function readJobRows() {
  return JSON.parse(fs.readFileSync(path.join(testApp.dataDir, "jobs.json"), "utf-8")).jobs;
}

test("tools/list shows the render tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ["render_short", "render_captioned", "render_cancel"]) assert.ok(names.includes(name), name);
});

test("render_short through MCP on a key without consent queues a render that cannot auto-post", async () => {
  _setScopeForTests(null);
  const { dataDir } = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role });
  writeLibrary(dataDir, { items: [{ id: "pexels_77", url: "http://127.0.0.1:1/bg.mp4" }] });
  const result = await client.callTool({ name: "render_short", arguments: { lines: ["Be still"], backgrounds: ["pexels_77"] } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(result.structuredContent.kind, "job");
  const row = readJobRows().find((j) => j.id === result.structuredContent.id);
  assert.equal(row.type, "render_video");
  assert.equal(row.suppressAutoPublish, true);
  const who = await client.callTool({ name: "whoami", arguments: {} });
  assert.equal(who.structuredContent.caps.renders.used, 1);
  assert.equal(who.structuredContent.caps.publishes.used, 0);
});

test("render_cancel through MCP on an unknown job is a tool error", async () => {
  const result = await client.callTool({ name: "render_cancel", arguments: { id: "nope" } });
  assert.equal(result.isError, true);
});
