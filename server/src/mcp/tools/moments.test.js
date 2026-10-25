import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import { MOMENT_OCCASIONS, MOMENT_STYLES, MOMENT_LENGTHS, MOMENT_DETAIL_FIELDS } from "../momentsView.js";
import { OCCASIONS, LENGTHS, DETAIL_FIELDS } from "../../lib/moments/occasions.js";
import { STYLE_IDS } from "../../lib/motion/styles.js";
import momentsTools from "./moments.js";

const USER = { id: "u_moments", email: "moments@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(momentsTools.map((t) => [t.name, t]));
const bucket = (fields) => ({ used: 0, limit: -1, unlimited: true, remaining: null, ...fields });
const usage = (fields = {}) => ({ ok: true, usage: { plan: "premium", buckets: { render: bucket(), tts: bucket(), scripts: bucket(), ...fields } } });
const SPENT = { used: 5, limit: 5, unlimited: false, remaining: 0 };
const UUID = "0b5a6c1e-1111-4222-8333-944455556666";

const photo = (n) => ({ ref: { kind: "upload", path: `bg-image-${n}.jpg` }, url: `/outputs/bg-image-${n}.jpg`, width: 800, height: 600 });
const MOMENT = (fields = {}) => ({
  projectId: "m-1", occasion: "birthday", details: { name: "Ada" }, photos: [photo(1), photo(2), photo(3)], heroIndex: 0,
  sound: { song: { ref: "library:gospel-fire", windowStartSec: null }, voiceover: null }, title: "Happy birthday, Ada!",
  statements: ["Another year of grace"], style: "celebrate", energy: 0.6, lengthSec: 15, seed: 7, plan: null, render: null, history: [],
  ...fields,
});

/** A fake ctx answering GET /api/moments/m-1 with `moment`; chargeCap records each call as one object. */
function ctxWith(responses = {}, { moment = MOMENT(), usageBody = usage() } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usageBody, "GET /api/moments/m-1": { ok: true, project: moment }, ...responses }, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);

/** A media folder for unit tests, with the given files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "moments-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return fs.realpathSync(dir);
}

test("the moments file declares four tools on /api/moments, charged in their handlers", () => {
  assert.deepEqual(Object.keys(byName).sort(), ["moments_cancel", "moments_project", "moments_render", "moments_step"]);
  for (const tool of momentsTools) {
    assert.deepEqual(tool.routes, ["/api/moments"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.publish, undefined, tool.name);
  }
});

test("the occasion, style, length and detail lists match the app's", () => {
  assert.deepEqual(MOMENT_OCCASIONS, Object.keys(OCCASIONS));
  assert.deepEqual(MOMENT_STYLES, [...STYLE_IDS]);
  assert.deepEqual(MOMENT_LENGTHS, [...LENGTHS]);
  assert.deepEqual(MOMENT_DETAIL_FIELDS, [...DETAIL_FIELDS]);
});

test("descriptions name the job kind, the costs and the photo rule", () => {
  assert.match(byName.moments_render.description, /kind moments/);
  assert.match(byName.moments_render.description, /one daily render/);
  assert.match(byName.moments_render.description, /never posts/);
  assert.match(byName.moments_step.description, /one daily tts/);
  assert.match(byName.moments_project.description, /media_import_url/);
});

// ---- moments_project ---------------------------------------------------------

test("moments_project list, create, get and delete read their routes; get shows the view", async () => {
  const { ctx, calls } = ctxWith({
    "GET /api/moments": { ok: true, projects: [{ projectId: "m-1", occasion: "birthday", title: "Hi", updatedAt: 1, thumb: "/outputs/bg-image-1.jpg", lastFile: "/outputs/moment-a.mp4" }] },
    "POST /api/moments": { ok: true, project: MOMENT() },
    "DELETE /api/moments/m-1": { ok: true },
  });
  const listed = (await byName.moments_project.handler(ctx, { action: "list" })).structuredContent.projects;
  assert.deepEqual(listed, [{
    id: "m-1", occasion: "birthday", title: "Hi", updatedAt: 1, thumbUrl: "http://host.test/outputs/bg-image-1.jpg",
    lastVideo: { url: "http://host.test/outputs/moment-a.mp4", path: "/outputs/moment-a.mp4" },
  }]);
  const made = await byName.moments_project.handler(ctx, { action: "create", occasion: "birthday" });
  assert.deepEqual(calls[1].opts.body, { occasion: "birthday" });
  assert.equal(made.structuredContent.project.id, "m-1");
  const { project } = (await byName.moments_project.handler(ctx, { action: "get", id: "m-1" })).structuredContent;
  assert.equal(project.photos.length, 3);
  assert.equal(project.photos[0].url, "http://host.test/outputs/bg-image-1.jpg");
  assert.deepEqual(project.song, { ref: "library:gospel-fire", windowStartSec: null });
  assert.equal(project.job, null);
  const gone = await byName.moments_project.handler(ctx, { action: "delete", id: "m-1" });
  assert.deepEqual(gone.structuredContent, { id: "m-1", deleted: true });
});

test("moments_project get shows the voiceover and past videos as url and path, and the render handle", async () => {
  const moment = MOMENT({
    sound: { song: null, voiceover: { script: "Happy day", voiceId: null, file: "moment-vo-1.mp3" } },
    render: { jobId: "j", status: "done", percent: 100, stage: "done", file: "/outputs/moment-a.mp4" },
    history: [{ jobId: "j", file: "/outputs/moment-a.mp4", createdAt: 5, seed: 7 }],
  });
  const { ctx } = ctxWith({}, { moment });
  const { project } = (await byName.moments_project.handler(ctx, { action: "get", id: "m-1" })).structuredContent;
  assert.deepEqual(project.voiceover, { script: "Happy day", voiceId: null, url: "http://host.test/outputs/moment-vo-1.mp3", path: "/outputs/moment-vo-1.mp3" });
  assert.deepEqual(project.history[0].video, { url: "http://host.test/outputs/moment-a.mp4", path: "/outputs/moment-a.mp4" });
  assert.equal(project.job.kind, "moments");
  assert.equal(project.job.status, "done");
});

test("moments_project meta returns the choices and the image library", async () => {
  const { ctx } = ctxWith({
    "GET /api/moments/meta": { ok: true, occasions: [{ id: "birthday" }], styles: [{ id: "glow" }], lengths: [15, 30, 60], limits: { minPhotos: 3 } },
    "GET /api/moments/library-images": { ok: true, images: [{ id: "img1", url: "/outputs/x.png" }] },
  });
  const meta = (await byName.moments_project.handler(ctx, { action: "meta" })).structuredContent;
  assert.deepEqual(meta.occasions, [{ id: "birthday" }]);
  assert.deepEqual(meta.limits, { minPhotos: 3 });
  assert.deepEqual(meta.libraryImages, [{ id: "img1", url: "/outputs/x.png" }]);
  assert.equal(meta.ok, undefined);
});

test("moments_project update maps photos, song and voiceover removal onto the route's fields", async () => {
  const dir = mediaWith(`bg-image-${UUID}.jpg`, "song.mp3");
  const { ctx, calls } = ctxWith({ "PUT /api/moments/m-1": { ok: true, project: MOMENT() } });
  const result = await byName.moments_project.handler(ctx, {
    action: "update", id: "m-1", title: "Ada at 40", lengthSec: 30,
    photos: [{ path: path.join(dir, `bg-image-${UUID}.jpg`) }, { libraryId: "img1" }],
    song: { path: path.join(dir, "song.mp3"), windowStartSec: 12 }, removeVoiceover: true,
  });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.deepEqual(calls[0].opts.body, {
    title: "Ada at 40", lengthSec: 30,
    photos: [{ kind: "upload", path: `bg-image-${UUID}.jpg` }, { kind: "library", id: "img1" }],
    sound: { song: { ref: path.join(dir, "song.mp3"), windowStartSec: 12 }, voiceover: null },
  });
});

test("moments_project update passes a Showcase style, a long length and the shape through", async () => {
  const { ctx, calls } = ctxWith({ "PUT /api/moments/m-1": { ok: true, project: MOMENT() } });
  const result = await byName.moments_project.handler(ctx, { action: "update", id: "m-1", style: "premiere", lengthSec: 120, shape: "wide" });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.deepEqual(calls[0].opts.body, { style: "premiere", lengthSec: 120, shape: "wide" });
});

test("moments_project update passes a library song ref through and clears the song with null", async () => {
  const { ctx, calls } = ctxWith({ "PUT /api/moments/m-1": { ok: true, project: MOMENT() } });
  await byName.moments_project.handler(ctx, { action: "update", id: "m-1", song: { ref: "library:hopeful" } });
  assert.deepEqual(calls[0].opts.body, { sound: { song: { ref: "library:hopeful" } } });
  await byName.moments_project.handler(ctx, { action: "update", id: "m-1", song: null });
  assert.deepEqual(calls[1].opts.body, { sound: { song: null } });
});

test("moments_project update refuses photos outside the media folder, wrong photo files and an empty update", async () => {
  const dir = mediaWith("holiday.jpg", `bg-image-${UUID}.jpg`);
  const { ctx, calls } = ctxWith();
  const outside = await byName.moments_project.handler(ctx, { action: "update", id: "m-1", photos: [{ path: "/etc/passwd" }] });
  assert.equal(outside.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const named = await byName.moments_project.handler(ctx, { action: "update", id: "m-1", photos: [{ path: path.join(dir, "holiday.jpg") }] });
  assert.equal(named.structuredContent.error, "BAD_PHOTO");
  assert.match(named.structuredContent.message || named.content[0].text, /media_import_url/);
  const song = await byName.moments_project.handler(ctx, { action: "update", id: "m-1", song: { path: "https://x.test/a.mp3" } });
  assert.equal(song.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const both = await byName.moments_project.handler(ctx, { action: "update", id: "m-1", photos: [{ path: path.join(dir, `bg-image-${UUID}.jpg`), libraryId: "x" }] });
  assert.equal(both.structuredContent.error, "BAD_INPUT");
  const empty = await byName.moments_project.handler(ctx, { action: "update", id: "m-1" });
  assert.equal(empty.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("moments_project update refuses a shared voice file as the song: the render reads songs only from your own folder", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(testApp.dataDir, "moments-own-")));
  const shared = fs.realpathSync(fs.mkdtempSync(path.join(testApp.dataDir, "moments-shared-")));
  fs.writeFileSync(path.join(shared, "tts-edge-abc.mp3"), "x");
  fs.writeFileSync(path.join(dir, "song.mp3"), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: shared }));
  const { ctx, calls } = ctxWith({ "PUT /api/moments/m-1": { ok: true, project: MOMENT() } });
  const refused = await byName.moments_project.handler(ctx, { action: "update", id: "m-1", song: { path: path.join(shared, "tts-edge-abc.mp3") } });
  assert.equal(refused.structuredContent.error, "BAD_INPUT");
  assert.equal(refused.structuredContent.message, "A Moment's song takes only files in your own media folder (your uploads, imports and renders, see media_list).");
  assert.equal(calls.length, 0);
  // The caller's own file still goes through.
  await byName.moments_project.handler(ctx, { action: "update", id: "m-1", song: { path: path.join(dir, "song.mp3") } });
  assert.deepEqual(calls[0].opts.body, { sound: { song: { ref: path.join(dir, "song.mp3") } } });
});

test("moments_project actions that name a Moment need its id, and create an occasion", async () => {
  const { ctx, calls } = ctxWith();
  for (const action of ["get", "update", "delete"]) {
    assert.equal((await byName.moments_project.handler(ctx, { action })).structuredContent.error, "BAD_INPUT", action);
  }
  assert.equal((await byName.moments_project.handler(ctx, { action: "create" })).structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

// ---- moments_step ------------------------------------------------------------

test("moments_step statements suggests lines and charges no daily cap", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/moments/m-1/statements": { ok: true, suggestion: { title: "Hi", statements: ["a", "b"] } } });
  const result = await byName.moments_step.handler(ctx, { id: "m-1", step: "statements" });
  assert.deepEqual(result.structuredContent, { suggestion: { title: "Hi", statements: ["a", "b"] } });
  assert.deepEqual(routesCalled(calls), ["POST /api/moments/m-1/statements"]);
  assert.deepEqual(chargeCalls, []);
});

test("moments_step voiceover charges one daily tts after the plan tts check", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/moments/m-1/voiceover": { ok: true, project: MOMENT() } });
  const result = await byName.moments_step.handler(ctx, { id: "m-1", step: "voiceover", script: "Happy birthday Ada", voiceId: "en-US-AriaNeural" });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.deepEqual(routesCalled(calls), ["GET /api/moments/m-1", "GET /api/billing/usage", "POST /api/moments/m-1/voiceover"]);
  assert.deepEqual(calls[2].opts.body, { script: "Happy birthday Ada", voiceId: "en-US-AriaNeural" });
  assert.deepEqual(chargeCalls, [{ tts: 1 }]);
});

test("moments_step voiceover is refused without words, while rendering and without plan tts quota, charging nothing", async () => {
  const cases = [
    [{ id: "m-1", step: "voiceover" }, {}, "BAD_INPUT"],
    [{ id: "m-1", step: "voiceover", idea: "hi" }, {}, "BAD_INPUT"],
    [{ id: "m-1", step: "voiceover", idea: "a warm blessing" }, { moment: MOMENT({ render: { jobId: "j", status: "running", percent: 5, stage: "drawing" } }) }, "MOMENT_BUSY"],
    [{ id: "m-1", step: "voiceover", idea: "a warm blessing" }, { usageBody: usage({ tts: SPENT }) }, "QUOTA_EXCEEDED"],
  ];
  for (const [input, options, code] of cases) {
    const { ctx, calls, chargeCalls } = ctxWith({}, options);
    const result = await byName.moments_step.handler(ctx, input);
    assert.equal(result.structuredContent.error, code, JSON.stringify(input));
    assert.ok(!routesCalled(calls).includes("POST /api/moments/m-1/voiceover"));
    assert.deepEqual(chargeCalls, []);
  }
});

// ---- moments_render / moments_cancel -----------------------------------------

test("moments_render charges one daily render after the plan check and returns a moments handle", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/moments/m-1/render": { ok: true, jobId: "job-3" } });
  const result = await byName.moments_render.handler(ctx, { id: "m-1", seed: 42 });
  assert.deepEqual(result.structuredContent, {
    kind: "moments", id: "m-1", jobId: "job-3", status: "running", percent: null, phase: "waiting", output: null, error: null,
  });
  assert.deepEqual(calls.at(-1).opts.body, { seed: 42 });
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
});

test("moments_render is refused with too few photos, while rendering or without quota, before any charge", async () => {
  const cases = [
    [{ moment: MOMENT({ photos: [photo(1)] }) }, "NEEDS_PHOTOS"],
    [{ moment: MOMENT({ render: { jobId: "j", status: "running", percent: 5 } }) }, "MOMENT_BUSY"],
    [{ usageBody: usage({ render: SPENT }) }, "QUOTA_EXCEEDED"],
  ];
  for (const [options, code] of cases) {
    const { ctx, calls, chargeCalls } = ctxWith({}, options);
    const result = await byName.moments_render.handler(ctx, { id: "m-1" });
    assert.equal(result.structuredContent.error, code);
    assert.ok(!routesCalled(calls).includes("POST /api/moments/m-1/render"));
    assert.deepEqual(chargeCalls, []);
  }
});

test("moments_cancel stops a running render and leaves an idle Moment alone", async () => {
  const running = MOMENT({ render: { jobId: "j", status: "running", percent: 5, stage: "drawing" } });
  const busy = ctxWith({ "POST /api/moments/m-1/cancel": { ok: true } }, { moment: running });
  const result = await byName.moments_cancel.handler(busy.ctx, { id: "m-1" });
  assert.deepEqual(result.structuredContent, { kind: "moments", id: "m-1", cancelled: true });
  const idle = ctxWith();
  assert.equal((await byName.moments_cancel.handler(idle.ctx, { id: "m-1" })).structuredContent.error, "NOTHING_RUNNING");
  assert.deepEqual(routesCalled(idle.calls), ["GET /api/moments/m-1"]);
});

// ---- through the real MCP client ----

test("tools/list shows every moments tool", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const tool of momentsTools) assert.ok(names.includes(tool.name), tool.name);
});

test("a real Moment is created, edited, read, refused a render without photos (cap given back) and deleted", async () => {
  _setScopeForTests(null);
  const meta = await client.callTool({ name: "moments_project", arguments: { action: "meta" } });
  assert.ok(meta.structuredContent.occasions.some((o) => o.id === "birthday"));
  const made = await client.callTool({ name: "moments_project", arguments: { action: "create", occasion: "birthday" } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  const id = made.structuredContent.project.id;
  const edited = await client.callTool({ name: "moments_project", arguments: { action: "update", id, title: "Ada at 40", details: { name: "Ada" }, lengthSec: 30 } });
  assert.ok(!edited.isError, JSON.stringify(edited.structuredContent));
  assert.equal(edited.structuredContent.project.title, "Ada at 40");
  assert.equal(edited.structuredContent.project.lengthSec, 30);
  const before = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const render = await client.callTool({ name: "moments_render", arguments: { id } });
  assert.equal(render.structuredContent.error, "NEEDS_PHOTOS");
  assert.deepEqual((await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders, before);
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "moments", id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "failed");
  assert.match(waited.structuredContent.error, /moments_render/);
  const idle = await client.callTool({ name: "moments_cancel", arguments: { id } });
  assert.equal(idle.structuredContent.error, "NOTHING_RUNNING");
  const listed = await client.callTool({ name: "moments_project", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.projects.some((p) => p.id === id));
  const gone = await client.callTool({ name: "moments_project", arguments: { action: "delete", id } });
  assert.deepEqual(gone.structuredContent, { id, deleted: true });
});

test("a real update naming another user's file as a photo is refused before the app sees it", async () => {
  const made = await client.callTool({ name: "moments_project", arguments: { action: "create", occasion: "fun" } });
  const id = made.structuredContent.project.id;
  const result = await client.callTool({ name: "moments_project", arguments: { action: "update", id, photos: [{ path: path.join(testApp.dataDir, "users.json") }] } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});
