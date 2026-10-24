import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import ambientTools from "./ambient.js";

const USER = { id: "u_ambient", email: "ambient@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(ambientTools.map((t) => [t.name, t]));
const bucket = (name, fields) => ({ used: 0, limit: -1, unlimited: true, remaining: null, ...fields });
const usage = (fields = {}) => ({
  ok: true,
  usage: { plan: "premium", buckets: { render: bucket("render"), tts: bucket("tts"), imageGen: bucket("imageGen"), scripts: bucket("scripts"), ...fields } },
});
const SPENT = { used: 5, limit: 5, unlimited: false, remaining: 0 };

const SESSION = (fields = {}) => ({
  projectId: "a1", title: "Still Waters", theme: "rest", status: "draft", error: null, targetSec: 7200,
  aspect: "landscape", translation: "kjv", words: "verses", motion: "still", captions: "static",
  bed: { mode: "assemble", trackRefs: [], filePath: null, volume: 0.85, crossfadeSec: 6, order: "shuffle", allowUncleared: false },
  drops: [], movements: [{ id: "m1", imageStatus: "pending" }], render: { jobId: null, outputPath: null, status: "idle", percent: 0, phase: "" },
  ...fields,
});
const drop = (id, fields = {}) => ({ id, atMs: 1000, reference: "John 14:27", status: "pending", ...fields });
const movement = (id, fields = {}) => ({ id, imageStatus: "pending", imagePath: null, ...fields });

/** A fake ctx answering GET /api/ambient/a1 with `session`, whose chargeCap records each call as one object. */
function ctxWith(responses = {}, { session = SESSION(), usageBody = usage() } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usageBody, "GET /api/ambient/a1": { ok: true, project: session }, ...responses }, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);
const apiError = (status, message) => Object.assign(new Error(message), { name: "ApiError", status, code: "HTTP_ERROR" });

/** A media folder for unit tests, with the given files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "ambient-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return fs.realpathSync(dir);
}

// ---- definitions ----

test("the ambient file declares six tools on /api/ambient, charged in their handlers", () => {
  assert.deepEqual(ambientTools.map((t) => t.name), [
    "ambient_project", "ambient_plan", "ambient_step", "ambient_update", "ambient_render", "ambient_cancel",
  ]);
  for (const tool of ambientTools) {
    assert.deepEqual(tool.routes, ["/api/ambient"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.publish, undefined, tool.name);
    assert.equal(tool.requires, undefined, tool.name);
  }
});

test("descriptions name the job kind, the costs, the long render and the deploy restart", () => {
  for (const name of ["ambient_step", "ambient_render"]) assert.match(byName[name].description, /kind ambient/, name);
  assert.match(byName.ambient_render.description, /hour/);
  assert.match(byName.ambient_render.description, /deploy/);
  assert.match(byName.ambient_render.description, /never posts/i);
  assert.match(byName.ambient_step.description, /tts/);
  assert.match(byName.ambient_step.description, /images/);
  assert.match(byName.ambient_plan.description, /replaces/i);
});

// ---- ambient_project ----

test("ambient_project list, get and delete read their routes; get shows the view and the handle", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/ambient": { ok: true, projects: [{ projectId: "a1", title: "Still Waters", status: "draft" }] },
    "DELETE /api/ambient/a1": { ok: true },
  });
  const list = await byName.ambient_project.handler(ctx, { action: "list" });
  assert.deepEqual(list.structuredContent, { projects: [{ projectId: "a1", title: "Still Waters", status: "draft" }] });
  const got = await byName.ambient_project.handler(ctx, { action: "get", id: "a1" });
  assert.equal(got.structuredContent.project.id, "a1");
  assert.equal(got.structuredContent.project.job.kind, "ambient");
  const gone = await byName.ambient_project.handler(ctx, { action: "delete", id: "a1" });
  assert.deepEqual(gone.structuredContent, { id: "a1", deleted: true });
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient", "GET /api/ambient/a1", "DELETE /api/ambient/a1"]);
  assert.equal(chargeCalls.length, 0);
});

test("ambient_project create sends only the fields given", async () => {
  const { ctx, calls } = ctxWith({ "POST /api/ambient": { ok: true, project: SESSION() } });
  const made = await byName.ambient_project.handler(ctx, { action: "create", title: "Still Waters", targetSec: 3600, aspect: "portrait" });
  assert.deepEqual(calls[0].opts.body, { title: "Still Waters", targetSec: 3600, aspect: "portrait" });
  assert.equal(made.structuredContent.project.id, "a1");
});

test("ambient_project mark_published records an upload made elsewhere", async () => {
  const { ctx, calls } = ctxWith({ "POST /api/ambient/a1/published": { ok: true, project: SESSION({ status: "done", published: [{ videoId: "abcdefghijk" }] }) } });
  const result = await byName.ambient_project.handler(ctx, { action: "mark_published", id: "a1", videoId: "abcdefghijk", privacyStatus: "unlisted" });
  assert.deepEqual(routesCalled(calls), ["POST /api/ambient/a1/published"]);
  assert.deepEqual(calls[0].opts.body, { videoId: "abcdefghijk", privacyStatus: "unlisted" });
  assert.equal(result.structuredContent.project.published.length, 1);
});

test("ambient_project actions that name a session need its id, and mark_published a videoId", async () => {
  const { ctx, calls } = ctxWith();
  for (const action of ["get", "delete", "mark_published"]) {
    const result = await byName.ambient_project.handler(ctx, { action });
    assert.equal(result.structuredContent.error, "BAD_INPUT", action);
  }
  const noVideo = await byName.ambient_project.handler(ctx, { action: "mark_published", id: "a1" });
  assert.equal(noVideo.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

// ---- ambient_plan ----

test("ambient_plan suggests verses and spends no daily cap", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/ambient/a1/plan": { ok: true, project: SESSION({ drops: [drop("d1")] }) } });
  const result = await byName.ambient_plan.handler(ctx, { id: "a1", count: 4 });
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1", "POST /api/ambient/a1/plan"]);
  assert.deepEqual(calls[1].opts.body, { count: 4 });
  assert.equal(result.structuredContent.project.verses, 1);
  assert.equal(chargeCalls.length, 0);
});

test("ambient_plan refuses a session that is busy, before the route", async () => {
  const { ctx, calls } = ctxWith({}, { session: SESSION({ status: "voicing" }) });
  const result = await byName.ambient_plan.handler(ctx, { id: "a1" });
  assert.equal(result.structuredContent.error, "SESSION_BUSY");
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1"]);
});

// ---- ambient_step voice ----

test("ambient_step voice charges one daily tts per verse it will speak, after the plan tts check", async () => {
  const session = SESSION({ drops: [drop("d1"), drop("d2", { status: "error" }), drop("d3", { status: "done", audioPath: "/a.mp3" })] });
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/ambient/a1/voice": { ok: true, project: { ...session, status: "voicing" } } }, { session });
  const result = await byName.ambient_step.handler(ctx, { id: "a1", step: "voice" });
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1", "GET /api/billing/usage", "POST /api/ambient/a1/voice"]);
  assert.deepEqual(chargeCalls, [{ tts: 2 }]);
  assert.deepEqual(result.structuredContent, {
    kind: "ambient", id: "a1", status: "running", percent: null, phase: "voicing", output: null, error: null, ttsCharged: 2,
  });
});

test("ambient_step voice is refused for music-only sessions, sessions without verses and an empty plan tts quota", async () => {
  const musicOnly = ctxWith({}, { session: SESSION({ words: "none", drops: [drop("d1")] }) });
  assert.equal((await byName.ambient_step.handler(musicOnly.ctx, { id: "a1", step: "voice" })).structuredContent.error, "MUSIC_ONLY");
  const empty = ctxWith({}, { session: SESSION({ drops: [] }) });
  assert.equal((await byName.ambient_step.handler(empty.ctx, { id: "a1", step: "voice" })).structuredContent.error, "NO_VERSES");
  const spent = ctxWith({}, { session: SESSION({ drops: [drop("d1")] }), usageBody: usage({ tts: SPENT }) });
  const refused = await byName.ambient_step.handler(spent.ctx, { id: "a1", step: "voice" });
  assert.equal(refused.structuredContent.error, "QUOTA_EXCEEDED");
  assert.equal(refused.structuredContent.bucket, "tts");
  for (const fake of [musicOnly, empty, spent]) {
    assert.equal(fake.chargeCalls.length, 0);
    assert.ok(!routesCalled(fake.calls).includes("POST /api/ambient/a1/voice"));
  }
});

test("ambient_step voice with every verse already voiced starts nothing and charges nothing", async () => {
  const session = SESSION({ status: "ready_to_render", drops: [drop("d1", { status: "done", audioPath: "/a.mp3" })] });
  const { ctx, calls, chargeCalls } = ctxWith({}, { session });
  const result = await byName.ambient_step.handler(ctx, { id: "a1", step: "voice" });
  assert.equal(result.structuredContent.ttsCharged, 0);
  assert.equal(result.structuredContent.kind, "ambient");
  assert.equal(result.structuredContent.status, "done");
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1"]);
  assert.equal(chargeCalls.length, 0);
});

// ---- ambient_step images ----

test("ambient_step images charges the pictures it will make, after the plan image check", async () => {
  const session = SESSION({ movements: [movement("m1"), movement("m2", { imageStatus: "done", imagePath: "/p.png" }), movement("m3", { imageStatus: "error" })] });
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/ambient/a1/images": { ok: true, project: session } }, { session });
  const result = await byName.ambient_step.handler(ctx, { id: "a1", step: "images" });
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1", "GET /api/billing/usage", "POST /api/ambient/a1/images"]);
  assert.deepEqual(calls[2].opts.body, {});
  assert.deepEqual(chargeCalls, [{ images: 2 }]);
  assert.equal(result.structuredContent.phase, "generating_images");
  assert.equal(result.structuredContent.imagesCharged, 2);
});

test("ambient_step images with force remakes all; with movementId remakes that one", async () => {
  const session = SESSION({ movements: [movement("m1", { imageStatus: "done", imagePath: "/a.png" }), movement("m2", { imageStatus: "done", imagePath: "/b.png" })] });
  const forced = ctxWith({ "POST /api/ambient/a1/images": { ok: true, project: session } }, { session });
  await byName.ambient_step.handler(forced.ctx, { id: "a1", step: "images", force: true });
  assert.deepEqual(forced.chargeCalls, [{ images: 2 }]);
  assert.deepEqual(forced.calls[2].opts.body, { force: true });
  const one = ctxWith({ "POST /api/ambient/a1/images": { ok: true, project: session } }, { session });
  await byName.ambient_step.handler(one.ctx, { id: "a1", step: "images", movementId: "m2" });
  assert.deepEqual(one.chargeCalls, [{ images: 1 }]);
  assert.deepEqual(one.calls[2].opts.body, { movementId: "m2" });
});

test("ambient_step images refuses an unknown movement, a busy session and an empty plan image quota, charging nothing", async () => {
  const unknown = ctxWith();
  assert.equal((await byName.ambient_step.handler(unknown.ctx, { id: "a1", step: "images", movementId: "nope" })).structuredContent.error, "MOVEMENT_NOT_FOUND");
  const busy = ctxWith({}, { session: SESSION({ status: "rendering" }) });
  assert.equal((await byName.ambient_step.handler(busy.ctx, { id: "a1", step: "images" })).structuredContent.error, "SESSION_BUSY");
  const spent = ctxWith({}, { usageBody: usage({ imageGen: SPENT }) });
  const refused = await byName.ambient_step.handler(spent.ctx, { id: "a1", step: "images" });
  assert.equal(refused.structuredContent.error, "QUOTA_EXCEEDED");
  assert.equal(refused.structuredContent.bucket, "imageGen");
  for (const fake of [unknown, busy, spent]) {
    assert.equal(fake.chargeCalls.length, 0);
    assert.ok(!routesCalled(fake.calls).includes("POST /api/ambient/a1/images"));
  }
});

test("ambient_step images with every picture in starts nothing", async () => {
  const session = SESSION({ movements: [movement("m1", { imageStatus: "done", imagePath: "/a.png" })] });
  const { ctx, calls, chargeCalls } = ctxWith({}, { session });
  const result = await byName.ambient_step.handler(ctx, { id: "a1", step: "images" });
  assert.equal(result.structuredContent.imagesCharged, 0);
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1"]);
  assert.equal(chargeCalls.length, 0);
});

// ---- ambient_update ----

test("ambient_update sends each section to its PATCH route, with the route's field names", async () => {
  const answer = { ok: true, project: SESSION() };
  const { ctx, calls, chargeCalls } = ctxWith({
    "PATCH /api/ambient/a1/drops": answer,
    "PATCH /api/ambient/a1/motion": answer,
    "PATCH /api/ambient/a1/words": answer,
    "PATCH /api/ambient/a1/captions": answer,
  });
  const drops = [{ id: "d1", atMs: 600000, reference: "Psalms 23:1-3" }, { atMs: 1200000, reference: "John 14:27", translation: "web" }];
  await byName.ambient_update.handler(ctx, { id: "a1", section: "drops", patch: { drops } });
  await byName.ambient_update.handler(ctx, { id: "a1", section: "motion", patch: { motion: "drift" } });
  await byName.ambient_update.handler(ctx, { id: "a1", section: "words", patch: { words: "none" } });
  const result = await byName.ambient_update.handler(ctx, { id: "a1", section: "captions", patch: { mode: "none", span: "spoken", seed: 7 } });
  const patches = calls.filter((c) => c.method === "PATCH");
  assert.deepEqual(patches.map((c) => c.path), ["/api/ambient/a1/drops", "/api/ambient/a1/motion", "/api/ambient/a1/words", "/api/ambient/a1/captions"]);
  assert.deepEqual(patches[0].opts.body, { drops });
  assert.deepEqual(patches[1].opts.body, { motion: "drift" });
  assert.deepEqual(patches[2].opts.body, { words: "none" });
  assert.deepEqual(patches[3].opts.body, { captions: "none", captionSpan: "spoken", captionSeed: 7 });
  assert.equal(result.structuredContent.project.id, "a1");
  assert.equal(chargeCalls.length, 0);
});

test("ambient_update refuses a patch that does not fit its section, and an empty one", async () => {
  const { ctx, calls } = ctxWith();
  const wrong = await byName.ambient_update.handler(ctx, { id: "a1", section: "motion", patch: { words: "none" } });
  assert.equal(wrong.structuredContent.error, "BAD_INPUT");
  const empty = await byName.ambient_update.handler(ctx, { id: "a1", section: "captions", patch: {} });
  assert.equal(empty.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

test("ambient_update drops and bed refuse a busy session (its stage would overwrite them)", async () => {
  for (const [section, patch] of [["drops", { drops: [] }], ["bed", { volume: 1 }]]) {
    const { ctx, calls } = ctxWith({}, { session: SESSION({ status: "generating_images" }) });
    const result = await byName.ambient_update.handler(ctx, { id: "a1", section, patch });
    assert.equal(result.structuredContent.error, "SESSION_BUSY", section);
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
  }
});

test("ambient_update bed confines file paths to the media folder and passes library refs through", async () => {
  const dir = mediaWith("song.mp3");
  const { ctx, calls } = ctxWith({ "PATCH /api/ambient/a1/bed": { ok: true, project: SESSION() } });
  await byName.ambient_update.handler(ctx, {
    id: "a1", section: "bed",
    patch: { trackRefs: ["library:peaceful-worship", "mylib:0b7c6f1e-4a2d", path.join(dir, "song.mp3")], order: "fixed", crossfadeSec: 4, volume: 0.9 },
  });
  const sent = calls.find((c) => c.method === "PATCH").opts.body;
  assert.deepEqual(sent, { trackRefs: ["library:peaceful-worship", "mylib:0b7c6f1e-4a2d", path.join(dir, "song.mp3")], order: "fixed", crossfadeSec: 4, volume: 0.9 });
});

test("ambient_update bed refuses a path outside the media folder or a URL before the route", async () => {
  mediaWith("song.mp3");
  for (const patch of [
    { trackRefs: ["C:\\Windows\\win.ini"] },
    { mode: "file", filePath: "/etc/passwd" },
    { trackRefs: ["https://example.com/a.mp3"] },
    { filePath: "\\\\evil\\share\\a.mp3" },
  ]) {
    const { ctx, calls } = ctxWith();
    const result = await byName.ambient_update.handler(ctx, { id: "a1", section: "bed", patch });
    assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA", JSON.stringify(patch));
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
  }
});

test("ambient_update bed: clearing the file sends null; an unlicensed track is explained", async () => {
  mediaWith();
  const cleared = ctxWith({ "PATCH /api/ambient/a1/bed": { ok: true, project: SESSION() } });
  await byName.ambient_update.handler(cleared.ctx, { id: "a1", section: "bed", patch: { mode: "assemble", filePath: null } });
  assert.deepEqual(cleared.calls.find((c) => c.method === "PATCH").opts.body, { mode: "assemble", filePath: null });
  const uncleared = ctxWith({ "PATCH /api/ambient/a1/bed": apiError(409, "some tracks have no recorded licence") });
  const result = await byName.ambient_update.handler(uncleared.ctx, { id: "a1", section: "bed", patch: { trackRefs: ["mylib:t1"] } });
  assert.equal(result.structuredContent.error, "UNCLEARED_TRACKS");
  assert.match(result.content[0].text, /allowUncleared/);
});

// ---- ambient_render / ambient_cancel ----

test("ambient_render charges one daily render after the plan render check and returns an ambient handle", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/ambient/a1/render": { ok: true, jobId: "rj1" } });
  const result = await byName.ambient_render.handler(ctx, { id: "a1" });
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage", "POST /api/ambient/a1/render"]);
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
  assert.deepEqual(result.structuredContent, {
    kind: "ambient", id: "a1", status: "running", percent: null, phase: "assembling", output: null, error: null, jobId: "rj1",
  });
});

test("ambient_render without plan quota is refused before any charge", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({}, { usageBody: usage({ render: SPENT }) });
  const result = await byName.ambient_render.handler(ctx, { id: "a1" });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage"]);
  assert.equal(chargeCalls.length, 0);
});

test("ambient_cancel stops a busy session for free", async () => {
  const { ctx, calls, chargeCalls } = ctxWith(
    { "POST /api/ambient/a1/cancel": { ok: true, project: SESSION({ status: "error", error: "Cancelled." }) } },
    { session: SESSION({ status: "rendering" }) },
  );
  const result = await byName.ambient_cancel.handler(ctx, { id: "a1" });
  assert.deepEqual(result.structuredContent, { kind: "ambient", id: "a1", cancelled: true });
  assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1", "POST /api/ambient/a1/cancel"]);
  assert.equal(chargeCalls.length, 0);
});

test("ambient_cancel leaves an idle or finished session alone (cancelling marks it failed)", async () => {
  for (const status of ["draft", "ready_to_render", "done", "error"]) {
    const { ctx, calls } = ctxWith({}, { session: SESSION({ status }) });
    const result = await byName.ambient_cancel.handler(ctx, { id: "a1" });
    assert.equal(result.structuredContent.error, "NOTHING_RUNNING", status);
    assert.deepEqual(routesCalled(calls), ["GET /api/ambient/a1"]);
  }
});

// ---- through the real MCP client ----

test("tools/list shows every ambient tool", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const tool of ambientTools) assert.ok(names.includes(tool.name), tool.name);
});

test("a real session is created, edited, read, listed, cancelled and deleted", async () => {
  _setScopeForTests(null);
  const made = await client.callTool({ name: "ambient_project", arguments: { action: "create", title: "Real one", targetSec: 1800 } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  const id = made.structuredContent.project.id;
  const drops = await client.callTool({
    name: "ambient_update",
    arguments: { id, section: "drops", patch: { drops: [{ atMs: 300000, reference: "Psalms 23:1-3" }, { atMs: 900000, reference: "John 14:27" }] } },
  });
  assert.ok(!drops.isError, JSON.stringify(drops.structuredContent));
  assert.equal(drops.structuredContent.project.verses, 2);
  assert.equal(drops.structuredContent.project.movements.length, 2);
  const look = await client.callTool({ name: "ambient_update", arguments: { id, section: "motion", patch: { motion: "drift" } } });
  assert.equal(look.structuredContent.project.motion, "drift");
  const bed = await client.callTool({ name: "ambient_update", arguments: { id, section: "bed", patch: { trackRefs: ["library:peaceful-worship"] } } });
  assert.ok(!bed.isError, JSON.stringify(bed.structuredContent));
  assert.deepEqual(bed.structuredContent.project.bed.tracks, ["library:peaceful-worship"]);
  const listed = await client.callTool({ name: "ambient_project", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.projects.some((p) => p.projectId === id));
  const idle = await client.callTool({ name: "ambient_cancel", arguments: { id } });
  assert.equal(idle.structuredContent.error, "NOTHING_RUNNING");
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "ambient", id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "done");
  assert.equal(waited.structuredContent.phase, "draft");
  const gone = await client.callTool({ name: "ambient_project", arguments: { action: "delete", id } });
  assert.deepEqual(gone.structuredContent, { id, deleted: true });
});

test("a real ambient_render on a session without pictures is refused, and the render cap is given back", async () => {
  const made = await client.callTool({ name: "ambient_project", arguments: { action: "create", title: "No pictures" } });
  const id = made.structuredContent.project.id;
  const before = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const result = await client.callTool({ name: "ambient_render", arguments: { id } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /every movement needs an image/);
  const afterCall = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  assert.deepEqual(afterCall, before);
});

test("a real bed change naming another user's file is refused before the app sees it", async () => {
  const made = await client.callTool({ name: "ambient_project", arguments: { action: "create", title: "Paths" } });
  const id = made.structuredContent.project.id;
  const result = await client.callTool({ name: "ambient_update", arguments: { id, section: "bed", patch: { filePath: path.join(testApp.dataDir, "users.json") } } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

/** The stored file of a session, wherever the test app keeps this user's data. */
function sessionFile(id) {
  const found = fs.readdirSync(testApp.dataDir, { recursive: true }).find((f) => f.split(/[\\/]/).slice(-2).join("/") === `ambient/${id}.json`);
  assert.ok(found, `no stored file for ${id}`);
  return path.join(testApp.dataDir, found);
}

test("a real render a restart stopped reads failed, and ambient_cancel clears it", async () => {
  const made = await client.callTool({ name: "ambient_project", arguments: { action: "create", title: "Restarted" } });
  const id = made.structuredContent.project.id;
  const file = sessionFile(id);
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...stored, status: "rendering", render: { jobId: "gone", status: "running", percent: 40, phase: "rendering" }, updatedAt: Date.now() - 3600_000 }));
  const stopped = await client.callTool({ name: "jobs_wait", arguments: { kind: "ambient", id, timeoutSec: 1 } });
  assert.equal(stopped.structuredContent.status, "failed");
  assert.match(stopped.structuredContent.error, /server restarted/);
  const busy = await client.callTool({ name: "ambient_step", arguments: { id, step: "images" } });
  assert.equal(busy.structuredContent.error, "SESSION_BUSY");
  const cancelled = await client.callTool({ name: "ambient_cancel", arguments: { id } });
  assert.ok(!cancelled.isError, JSON.stringify(cancelled.structuredContent));
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "ambient", id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "cancelled");
});

/** An unlicensed upload in this test user's own media folder and music library. */
async function unlicensedUpload(name) {
  const { resolveScopeDirs } = await import("../../lib/paths.js");
  const { registerTrack } = await import("../../lib/musicLibraryStore.js");
  const { dataDir, outputDir } = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role });
  const file = path.join(outputDir, name);
  fs.writeFileSync(file, "x");
  return { file: fs.realpathSync(file), track: registerTrack(dataDir, { file: fs.realpathSync(file), label: name, durationSec: 60 }) };
}

test("a real bed naming an unlicensed upload by its path, or as the one file, is refused", async () => {
  _setScopeForTests(null);
  const { file, track } = await unlicensedUpload("unlicensed-bare.mp3");
  const made = await client.callTool({ name: "ambient_project", arguments: { action: "create", title: "Licence" } });
  const id = made.structuredContent.project.id;
  for (const patch of [{ trackRefs: [file] }, { mode: "file", filePath: `mylib:${track.id}` }, { mode: "file", filePath: file }]) {
    const result = await client.callTool({ name: "ambient_update", arguments: { id, section: "bed", patch } });
    assert.equal(result.structuredContent.error, "UNCLEARED_TRACKS", JSON.stringify(patch));
  }
});
