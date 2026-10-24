import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import musicTools from "./music.js";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const { _setSeparatorImpl, _resetSeparatorImpl, _setDurationProbe } = await import("../../routes/music.js");
// No ffprobe needed: every bundled track reports a fixed length.
_setDurationProbe(async () => 90);

after(async () => {
  _resetSeparatorImpl();
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(musicTools.map((t) => [t.name, t]));

test("the music file declares the three tools on /api/music", () => {
  assert.deepEqual(musicTools.map((t) => t.name), ["music_library", "music_remove_vocals", "music_instrumental_decide"]);
  for (const tool of musicTools) assert.deepEqual(tool.routes, ["/api/music"]);
});

test("music_remove_vocals is capped at one render and says it takes minutes", () => {
  assert.deepEqual(byName.music_remove_vocals.caps, { renders: 1 });
  assert.match(byName.music_remove_vocals.description, /minutes/i);
  assert.match(byName.music_remove_vocals.description, /kind instrumental/);
});

test("music_library returns the tracks and filters by source", async () => {
  const tracks = [{ id: "a", source: "bundled" }, { id: "b", source: "upload" }];
  const { ctx, calls } = fakeMcpCtx({ "GET /api/music/library": { ok: true, tracks } });
  const all = await byName.music_library.handler(ctx, {});
  assert.deepEqual(all.structuredContent, { tracks });
  const mine = await byName.music_library.handler(ctx, { source: "upload" });
  assert.deepEqual(mine.structuredContent.tracks, [{ id: "b", source: "upload" }]);
  assert.equal(calls[0].method, "GET");
});

test("music_remove_vocals posts the id and returns an instrumental job handle", async () => {
  const { ctx, calls } = fakeMcpCtx({ "POST /api/music/prayer-piano/instrumental": { ok: true, jobId: "job-1" } });
  const result = await byName.music_remove_vocals.handler(ctx, { id: "prayer-piano", quality: "fast" });
  assert.deepEqual(calls[0].opts.body, { quality: "fast" });
  assert.deepEqual(result.structuredContent, {
    kind: "instrumental",
    id: "job-1",
    status: "running",
    percent: null,
    phase: null,
    output: null,
    error: null,
    where: "server",
    sourceId: "prayer-piano",
  });
});

test("music_remove_vocals on the laptop queue starts queued", async () => {
  const { ctx } = fakeMcpCtx({ "POST /api/music/x/instrumental": { ok: true, jobId: "job-2", where: "laptop" } });
  const result = await byName.music_remove_vocals.handler(ctx, { id: "x" });
  assert.equal(result.structuredContent.status, "queued");
  assert.equal(result.structuredContent.where, "laptop");
});

test("music_instrumental_decide keep and discard call their routes", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "POST /api/music/instrumental/j1/keep": { ok: true, track: { id: "t1", label: "X (instrumental)" } },
    "POST /api/music/instrumental/j1/discard": { ok: true },
  });
  const kept = await byName.music_instrumental_decide.handler(ctx, { jobId: "j1", decision: "keep" });
  assert.deepEqual(kept.structuredContent, { decision: "keep", track: { id: "t1", label: "X (instrumental)" } });
  const dropped = await byName.music_instrumental_decide.handler(ctx, { jobId: "j1", decision: "discard" });
  assert.deepEqual(dropped.structuredContent, { decision: "discard", discarded: true });
  assert.deepEqual(calls.map((c) => c.path), ["/api/music/instrumental/j1/keep", "/api/music/instrumental/j1/discard"]);
});

test("tools/list shows the three music tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ["music_library", "music_remove_vocals", "music_instrumental_decide"]) assert.ok(names.includes(name), name);
});

test("music_library lists the bundled tracks for real, each with a ref", async () => {
  const result = await client.callTool({ name: "music_library", arguments: { source: "bundled" } });
  assert.notEqual(result.isError, true);
  const { tracks } = result.structuredContent;
  assert.ok(tracks.length > 5);
  assert.ok(tracks.every((t) => t.source === "bundled" && t.ref.startsWith("library:")));
  assert.equal(tracks[0].durationSec, 90);
});

test("music_remove_vocals with no separator set up is a tool error", async () => {
  _setSeparatorImpl({ available: async () => ({ ok: false }) });
  const result = await client.callTool({ name: "music_remove_vocals", arguments: { id: "prayer-piano" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 409);
  assert.match(result.content[0].text, /vocal removal/);
});

test("music_remove_vocals for an unknown track is a tool error", async () => {
  _setSeparatorImpl({ available: async () => ({ ok: true }) });
  const result = await client.callTool({ name: "music_remove_vocals", arguments: { id: "no-such-track" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 404);
});

test("remove vocals, wait on the job, keep it, then discard a second one (separator faked)", async () => {
  _setSeparatorImpl({
    available: async () => ({ ok: true }),
    remove: async ({ outPath, onProgress }) => {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, "instrumental");
      onProgress(50);
    },
  });
  const started = await client.callTool({ name: "music_remove_vocals", arguments: { id: "prayer-piano" } });
  assert.notEqual(started.isError, true, started.content?.[0]?.text);
  const handle = started.structuredContent;
  assert.equal(handle.kind, "instrumental");

  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "instrumental", id: handle.id, timeoutSec: 30 } });
  assert.equal(waited.structuredContent.status, "done", JSON.stringify(waited.structuredContent));
  assert.ok(waited.structuredContent.output.path);

  const kept = await client.callTool({ name: "music_instrumental_decide", arguments: { jobId: handle.id, decision: "keep" } });
  assert.notEqual(kept.isError, true, kept.content?.[0]?.text);
  assert.match(kept.structuredContent.track.label, /instrumental/);
  const mine = await client.callTool({ name: "music_library", arguments: { source: "upload" } });
  assert.ok(mine.structuredContent.tracks.some((t) => t.id === kept.structuredContent.track.id));

  const dropped = await client.callTool({ name: "music_instrumental_decide", arguments: { jobId: handle.id, decision: "discard" } });
  assert.deepEqual(dropped.structuredContent, { decision: "discard", discarded: true });
  const after2 = await client.callTool({ name: "music_library", arguments: { source: "upload" } });
  assert.ok(!after2.structuredContent.tracks.some((t) => t.id === kept.structuredContent.track.id));
});

const rendersUsed = async () => (await client.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders.used;

test("music_remove_vocals spends one render from the agent's daily cap when it starts", async () => {
  _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async () => new Promise(() => {}) });
  const before = await rendersUsed();
  const started = await client.callTool({ name: "music_remove_vocals", arguments: { id: "prayer-piano" } });
  assert.notEqual(started.isError, true, started.content?.[0]?.text);
  assert.equal(await rendersUsed(), before + 1);
  await client.callTool({ name: "music_instrumental_decide", arguments: { jobId: started.structuredContent.id, decision: "discard" } });
});

test("music_remove_vocals refused by the app (409, no separator) gives the render back (R37)", async () => {
  _setSeparatorImpl({ available: async () => ({ ok: false }) });
  const before = await rendersUsed();
  const refused = await client.callTool({ name: "music_remove_vocals", arguments: { id: "prayer-piano" } });
  assert.equal(refused.structuredContent.status, 409);
  assert.equal(await rendersUsed(), before);
});

test("music_instrumental_decide keep on an unknown job is a tool error", async () => {
  const result = await client.callTool({ name: "music_instrumental_decide", arguments: { jobId: "nope", decision: "keep" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 404);
});
