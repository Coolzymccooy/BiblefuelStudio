import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import lyricTools from "./lyric.js";

const USER = { id: "u_lyric", email: "lyric@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(lyricTools.map((t) => [t.name, t]));
const bucket = (fields) => ({ used: 0, limit: -1, unlimited: true, remaining: null, ...fields });
const usage = (render = {}) => ({ ok: true, usage: { plan: "premium", buckets: { render: bucket(render) } } });
const SPENT = { used: 5, limit: 5, unlimited: false, remaining: 0 };

const timedLine = (id, start, fields = {}) => ({
  id, sectionId: "s1", kind: "lead", text: `line ${id}`, effect: "auto", locked: false,
  words: [{ text: "word", start, end: start + 1 }], start, end: start + 1, confidence: 0.9, flag: null, ...fields,
});
const SONG = (fields = {}) => ({
  projectId: "lv_1", title: "Grace", artist: "Sthill", song: { file: "/srv/u/outputs/song.mp3", durationSec: 180, coverStill: null },
  sheet: { raw: "line", parsedAt: null }, sections: [{ id: "s1", kind: "verse", label: "VERSE 1" }],
  lines: [timedLine("l1", 1), timedLine("l2", 3)], timing: { status: "done" },
  look: { id: "studio-lagos-night", energy: "wild", seed: 1 }, branding: { logo: null, intro: true, endCard: true },
  background: null, renders: [], failedRenders: [], ...fields,
});

/** A fake ctx answering GET /api/lyric-video/lv_1 with `song`; chargeCap records each call as one object. */
function ctxWith(responses = {}, { song = SONG(), usageBody = usage() } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usageBody, "GET /api/lyric-video/lv_1": { project: song }, ...responses }, {
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
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "lyric-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return fs.realpathSync(dir);
}

test("the lyric file declares seven tools on /api/lyric-video, charged in their handlers", () => {
  assert.deepEqual(Object.keys(byName).sort(), [
    "lyric_align", "lyric_background", "lyric_line_update", "lyric_project", "lyric_render", "lyric_set_lyrics", "lyric_set_song",
  ]);
  for (const tool of lyricTools) {
    assert.deepEqual(tool.routes, ["/api/lyric-video"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.publish, undefined, tool.name);
    assert.equal(tool.requires, undefined, tool.name);
  }
});

test("descriptions name the job kinds, the costs and what to call next", () => {
  assert.match(byName.lyric_align.description, /kind lyric_align/);
  assert.match(byName.lyric_align.description, /plan's render quota/);
  assert.match(byName.lyric_render.description, /kind lyric_render/);
  assert.match(byName.lyric_render.description, /projectId/);
  assert.match(byName.lyric_render.description, /one daily render/);
  assert.match(byName.lyric_render.description, /never posts/);
  assert.match(byName.lyric_set_song.description, /media_import_url/);
});

// ---- lyric_project -----------------------------------------------------------

test("lyric_project list and create read their routes", async () => {
  const { ctx, calls } = ctxWith({
    "GET /api/lyric-video": { projects: [{ projectId: "lv_1", title: "Grace" }] },
    "POST /api/lyric-video": { project: SONG({ song: null, lines: [], timing: { status: "idle" } }) },
  });
  const listed = await byName.lyric_project.handler(ctx, { action: "list" });
  assert.deepEqual(listed.structuredContent.projects, [{ projectId: "lv_1", title: "Grace" }]);
  const made = await byName.lyric_project.handler(ctx, { action: "create", title: "Grace", artist: "Sthill" });
  assert.equal(made.structuredContent.project.id, "lv_1");
  assert.deepEqual(calls[1].opts.body, { title: "Grace", artist: "Sthill" });
});

test("lyric_project get shows the song, lines without word timings, and an align handle", async () => {
  const { ctx } = ctxWith();
  const { project } = (await byName.lyric_project.handler(ctx, { action: "get", id: "lv_1" })).structuredContent;
  assert.equal(project.id, "lv_1");
  assert.deepEqual(project.song, { path: "/srv/u/outputs/song.mp3", url: "http://host.test/outputs/song.mp3", durationSec: 180 });
  assert.equal(project.lines.length, 2);
  assert.equal(project.lines[0].words, undefined);
  assert.equal(project.lines[0].start, 1);
  assert.equal(project.timing.status, "done");
  assert.equal(project.alignJob.kind, "lyric_align");
  assert.equal(project.alignJob.status, "done");
  assert.equal(project.renderingJobId, null);
});

test("lyric_project get lists finished renders with their video as url and /outputs path", async () => {
  const renders = [{ jobId: "j1", aspect: "portrait", quality: "720p", file: "/srv/u/outputs/lyric-a.mp4", durationSec: 180, at: "2026-10-24T00:00:00Z" }];
  const { ctx } = ctxWith({}, { song: SONG({ renders }) });
  const { project } = (await byName.lyric_project.handler(ctx, { action: "get", id: "lv_1" })).structuredContent;
  assert.deepEqual(project.renders[0].video, { url: "http://host.test/outputs/lyric-a.mp4", path: "/outputs/lyric-a.mp4" });
  assert.equal(project.renders[0].file, undefined);
});

test("lyric_project renders, publish_draft, cancel_render and delete call their routes", async () => {
  const { ctx, calls } = ctxWith({
    "GET /api/lyric-video/renders": { renders: [{ projectId: "lv_1", jobId: "j1", status: "done", file: "/srv/u/outputs/lyric-a.mp4" }] },
    "GET /api/lyric-video/lv_1/publish-draft": { draft: { title: "Grace (Lyric Video)", tags: [] } },
    "POST /api/lyric-video/lv_1/render/j1/cancel": {},
    "DELETE /api/lyric-video/lv_1": {},
  });
  const history = await byName.lyric_project.handler(ctx, { action: "renders" });
  assert.deepEqual(history.structuredContent.renders[0].video, { url: "http://host.test/outputs/lyric-a.mp4", path: "/outputs/lyric-a.mp4" });
  const draft = await byName.lyric_project.handler(ctx, { action: "publish_draft", id: "lv_1" });
  assert.equal(draft.structuredContent.draft.title, "Grace (Lyric Video)");
  const cancelled = await byName.lyric_project.handler(ctx, { action: "cancel_render", id: "lv_1", jobId: "j1" });
  assert.deepEqual(cancelled.structuredContent, { kind: "lyric_render", id: "j1", projectId: "lv_1", cancelled: true });
  const gone = await byName.lyric_project.handler(ctx, { action: "delete", id: "lv_1" });
  assert.deepEqual(gone.structuredContent, { id: "lv_1", deleted: true });
  assert.deepEqual(routesCalled(calls), [
    "GET /api/lyric-video/renders", "GET /api/lyric-video/lv_1/publish-draft", "POST /api/lyric-video/lv_1/render/j1/cancel", "DELETE /api/lyric-video/lv_1",
  ]);
});

test("lyric_project actions that name a song need its id; cancel_render needs the job id", async () => {
  const { ctx, calls } = ctxWith();
  for (const action of ["get", "delete", "publish_draft", "cancel_render"]) {
    const result = await byName.lyric_project.handler(ctx, { action });
    assert.equal(result.structuredContent.error, "BAD_INPUT", action);
  }
  const noJob = await byName.lyric_project.handler(ctx, { action: "cancel_render", id: "lv_1" });
  assert.equal(noJob.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

// ---- song, lyrics, lines -----------------------------------------------------

test("lyric_set_song confines the path to the media folder and sends the real path", async () => {
  const dir = mediaWith("song.mp3");
  const { ctx, calls } = ctxWith({ "POST /api/lyric-video/lv_1/song": { project: SONG() } });
  const result = await byName.lyric_set_song.handler(ctx, { id: "lv_1", path: path.join(dir, "song.mp3") });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.deepEqual(calls[0].opts.body, { path: path.join(dir, "song.mp3") });
});

test("lyric_set_song refuses a URL or a path outside the media folder before the route", async () => {
  mediaWith("song.mp3");
  const { ctx, calls } = ctxWith();
  const url = await byName.lyric_set_song.handler(ctx, { id: "lv_1", path: "https://example.com/song.mp3" });
  assert.equal(url.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const outside = await byName.lyric_set_song.handler(ctx, { id: "lv_1", path: path.join(testApp.dataDir, "users.json") });
  assert.equal(outside.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

test("lyric_set_lyrics sends the sheet; lyric_line_update patches one line", async () => {
  const { ctx, calls } = ctxWith({
    "PUT /api/lyric-video/lv_1/sheet": { project: SONG() },
    "PATCH /api/lyric-video/lv_1/lines/l2": { project: SONG() },
  });
  await byName.lyric_set_lyrics.handler(ctx, { id: "lv_1", sheet: "[CHORUS]\nAmazing grace" });
  assert.deepEqual(calls[0].opts.body, { sheet: "[CHORUS]\nAmazing grace" });
  await byName.lyric_line_update.handler(ctx, { id: "lv_1", lineId: "l2", start: 4.5, effect: "slam" });
  assert.deepEqual(calls[1].opts.body, { start: 4.5, effect: "slam" });
  const nothing = await byName.lyric_line_update.handler(ctx, { id: "lv_1", lineId: "l2" });
  assert.equal(nothing.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 2);
});

test("lyric_align charges one daily render after the plan check and returns a lyric_align handle (R47)", async () => {
  const running = SONG({ timing: { status: "running", progress: { step: "preparing" } } });
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/lyric-video/lv_1/align": { project: running } });
  const result = await byName.lyric_align.handler(ctx, { id: "lv_1" });
  assert.deepEqual(result.structuredContent, {
    kind: "lyric_align", id: "lv_1", status: "running", percent: null, phase: "preparing", output: null, error: null,
  });
  assert.deepEqual(routesCalled(calls), ["GET /api/lyric-video/lv_1", "GET /api/billing/usage", "POST /api/lyric-video/lv_1/align"]);
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
});

test("lyric_align is refused without a song, without lyrics, while timing runs or without plan quota, before any charge (R47)", async () => {
  const cases = [
    [{ song: SONG({ song: null }) }, "NO_SONG"],
    [{ song: SONG({ lines: [] }) }, "NO_LYRICS"],
    [{ song: SONG({ timing: { status: "running", progress: { step: "listening" } } }) }, "ALREADY_RUNNING"],
    [{ usageBody: usage(SPENT) }, "QUOTA_EXCEEDED"],
  ];
  for (const [options, code] of cases) {
    const { ctx, calls, chargeCalls } = ctxWith({}, options);
    const result = await byName.lyric_align.handler(ctx, { id: "lv_1" });
    assert.equal(result.structuredContent.error, code);
    assert.ok(!routesCalled(calls).includes("POST /api/lyric-video/lv_1/align"));
    assert.deepEqual(chargeCalls, []);
  }
});

// ---- lyric_background --------------------------------------------------------

test("lyric_background confines a picture, and sets the look and branding through their routes", async () => {
  const dir = mediaWith("bg.jpg");
  const { ctx, calls } = ctxWith({
    "PUT /api/lyric-video/lv_1/background": { project: SONG() },
    "PUT /api/lyric-video/lv_1/look": { project: SONG() },
    "PUT /api/lyric-video/lv_1/branding": { project: SONG() },
  });
  const result = await byName.lyric_background.handler(ctx, {
    id: "lv_1", path: path.join(dir, "bg.jpg"), fit: "cover", look: { id: "studio-gospel-gold", energy: "calm" }, branding: { logo: false },
  });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.deepEqual(routesCalled(calls), ["PUT /api/lyric-video/lv_1/background", "PUT /api/lyric-video/lv_1/look", "PUT /api/lyric-video/lv_1/branding"]);
  assert.deepEqual(calls[0].opts.body, { path: path.join(dir, "bg.jpg"), fit: "cover" });
  assert.deepEqual(calls[1].opts.body, { id: "studio-gospel-gold", energy: "calm" });
  assert.deepEqual(calls[2].opts.body, { logo: false });
});

test("lyric_background with path null clears it; with nothing to change it is refused", async () => {
  const { ctx, calls } = ctxWith({ "PUT /api/lyric-video/lv_1/background": { project: SONG() } });
  await byName.lyric_background.handler(ctx, { id: "lv_1", path: null });
  assert.deepEqual(calls[0].opts.body, { path: null });
  const nothing = await byName.lyric_background.handler(ctx, { id: "lv_1" });
  assert.equal(nothing.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 1);
});

test("lyric_background refuses a path outside the media folder before changing anything", async () => {
  mediaWith("bg.jpg");
  const { ctx, calls } = ctxWith();
  const result = await byName.lyric_background.handler(ctx, { id: "lv_1", path: "/etc/passwd", look: { energy: "calm" } });
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

// ---- lyric_render ------------------------------------------------------------

test("lyric_render charges one daily render after the plan check and returns a lyric_render handle", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/lyric-video/lv_1/render": { jobId: "job-7" } });
  const result = await byName.lyric_render.handler(ctx, { id: "lv_1", aspect: "landscape", quality: "1080p", shortsTrim: false });
  assert.deepEqual(result.structuredContent, {
    kind: "lyric_render", id: "job-7", projectId: "lv_1", status: "running", percent: null, phase: null, output: null, error: null,
  });
  assert.deepEqual(routesCalled(calls), ["GET /api/lyric-video/lv_1", "GET /api/billing/usage", "POST /api/lyric-video/lv_1/render"]);
  assert.deepEqual(calls[2].opts.body, { aspect: "landscape", quality: "1080p", shortsTrim: false });
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
});

test("lyric_render is refused without a song, without timing, or while busy, before any charge", async () => {
  const cases = [
    [SONG({ song: null }), "NO_SONG"],
    [SONG({ lines: [{ id: "l1", text: "untimed" }] }), "NOT_TIMED"],
    [SONG({ timing: { status: "running", progress: { step: "listening" } } }), "SONG_BUSY"],
    [SONG({ render: { activeJobId: "job-1", aspect: "portrait", quality: "720p" } }), "SONG_BUSY"],
  ];
  for (const [song, code] of cases) {
    const { ctx, calls, chargeCalls } = ctxWith({}, { song });
    const result = await byName.lyric_render.handler(ctx, { id: "lv_1" });
    assert.equal(result.structuredContent.error, code);
    assert.deepEqual(routesCalled(calls), ["GET /api/lyric-video/lv_1"]);
    assert.deepEqual(chargeCalls, []);
  }
});

test("lyric_render without plan render quota is refused before any charge", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({}, { usageBody: usage(SPENT) });
  const result = await byName.lyric_render.handler(ctx, { id: "lv_1" });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.ok(!routesCalled(calls).includes("POST /api/lyric-video/lv_1/render"));
  assert.deepEqual(chargeCalls, []);
});

// ---- through the real MCP client ----

test("tools/list shows every lyric tool", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const tool of lyricTools) assert.ok(names.includes(tool.name), tool.name);
});

test("a real song is created, given lyrics, read, refused where it is not ready, listed and deleted", async () => {
  _setScopeForTests(null);
  const made = await client.callTool({ name: "lyric_project", arguments: { action: "create", title: "Real song", artist: "Tester" } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  const id = made.structuredContent.project.id;
  const lyrics = await client.callTool({ name: "lyric_set_lyrics", arguments: { id, sheet: "[VERSE 1]\nAmazing grace\nHow sweet the sound" } });
  assert.ok(!lyrics.isError, JSON.stringify(lyrics.structuredContent));
  assert.equal(lyrics.structuredContent.project.lines.length, 2);
  const lineId = lyrics.structuredContent.project.lines[0].id;
  const effect = await client.callTool({ name: "lyric_line_update", arguments: { id, lineId, effect: "slam" } });
  assert.equal(effect.structuredContent.project.lines[0].effect, "slam");
  const rendersBefore = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const align = await client.callTool({ name: "lyric_align", arguments: { id } });
  assert.equal(align.structuredContent.error, "NO_SONG");
  assert.deepEqual((await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders, rendersBefore);
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "lyric_align", id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "failed");
  assert.match(waited.structuredContent.error, /lyric_align/);
  const before = (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const render = await client.callTool({ name: "lyric_render", arguments: { id } });
  assert.equal(render.structuredContent.error, "NO_SONG");
  assert.deepEqual((await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders, before);
  const listed = await client.callTool({ name: "lyric_project", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.projects.some((p) => p.projectId === id));
  const gone = await client.callTool({ name: "lyric_project", arguments: { action: "delete", id } });
  assert.deepEqual(gone.structuredContent, { id, deleted: true });
});

test("a real lyric_set_song naming another user's file is refused before the app sees it", async () => {
  const made = await client.callTool({ name: "lyric_project", arguments: { action: "create", title: "Paths" } });
  const id = made.structuredContent.project.id;
  const result = await client.callTool({ name: "lyric_set_song", arguments: { id, path: path.join(testApp.dataDir, "users.json") } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("a real jobs_wait on a lyric_render without its projectId is refused", async () => {
  const result = await client.callTool({ name: "jobs_wait", arguments: { kind: "lyric_render", id: "job-1", timeoutSec: 1 } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "BAD_INPUT");
});
