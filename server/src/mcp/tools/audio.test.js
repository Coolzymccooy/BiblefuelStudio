import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import audioTools from "./audio.js";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const { resolveScopeDirs } = await import("../../lib/paths.js");
const outputDir = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role }).outputDir;
fs.mkdirSync(outputDir, { recursive: true });

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(audioTools.map((t) => [t.name, t]));
const ffmpegPresent = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;

/** A media folder for unit tests, with the given empty files in it. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "unit-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return dir;
}

function tone(name, seconds = 1) {
  const file = path.join(outputDir, name);
  const made = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "libmp3lame", file]);
  assert.equal(made.status, 0, "ffmpeg could not make a test tone");
  return file;
}

test("the audio file declares audio_process and audio_advanced on their routers", () => {
  assert.deepEqual(audioTools.map((t) => t.name), ["audio_process", "audio_advanced"]);
  assert.deepEqual(byName.audio_process.routes, ["/api/audio"]);
  assert.deepEqual(byName.audio_advanced.routes, ["/api/audio-adv"]);
});

test("audio_process sends the resolved path and only the options given, and returns path and url", async () => {
  const dir = mediaWith("voice.mp3");
  const out = "C:/out/audio-processed-1.mp3";
  const { ctx, calls } = fakeMcpCtx({ "POST /api/audio/process": { ok: true, file: out, applied: { normalize: null }, filterChain: ["x"], loudnormMode: "two-pass" } });
  const result = await byName.audio_process.handler(ctx, { inputPath: path.join(dir, "voice.mp3"), preset: "podcast", normalize: { targetLUFS: -14 }, denoise: undefined });
  assert.deepEqual(calls[0].opts.body, { inputPath: fs.realpathSync(path.join(dir, "voice.mp3")), preset: "podcast", normalize: { targetLUFS: -14 } });
  assert.deepEqual(result.structuredContent, {
    path: out,
    url: "http://host.test/outputs/audio-processed-1.mp3",
    applied: { normalize: null },
    filterChain: ["x"],
    loudnormMode: "two-pass",
  });
});

test("audio_process refuses a file outside the media folder without calling the route", async () => {
  mediaWith();
  const { ctx, calls } = fakeMcpCtx({});
  const result = await byName.audio_process.handler(ctx, { inputPath: path.join(testApp.dataDir, "users.json") });
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

test("audio_advanced merge resolves inputs (references pass through) and posts the options", async () => {
  const dir = mediaWith("a.mp3");
  const { ctx, calls } = fakeMcpCtx({ "POST /api/audio-adv/merge": { ok: true, file: "/o/audio-merged-1.mp3", inputs: ["x"], filters: ["loudnorm=I=-16"] } });
  const result = await byName.audio_advanced.handler(ctx, {
    action: "merge",
    inputs: [path.join(dir, "a.mp3"), "library:calm-1"],
    fades: { outMs: 500 },
    normalizeLUFS: -16,
  });
  assert.deepEqual(calls[0].opts.body, { inputs: [fs.realpathSync(path.join(dir, "a.mp3")), "library:calm-1"], fades: { outMs: 500 }, normalizeLUFS: -16 });
  assert.deepEqual(result.structuredContent, { path: "/o/audio-merged-1.mp3", url: "http://host.test/outputs/audio-merged-1.mp3", filters: ["loudnorm=I=-16"] });
});

test("audio_advanced merge needs two inputs and refuses a URL input", async () => {
  mediaWith("a.mp3");
  const { ctx, calls } = fakeMcpCtx({});
  const few = await byName.audio_advanced.handler(ctx, { action: "merge", inputs: ["x"] });
  assert.equal(few.structuredContent.error, "BAD_INPUT");
  const url = await byName.audio_advanced.handler(ctx, { action: "merge", inputs: ["https://example.com/a.mp3", "library:x"] });
  assert.equal(url.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

test("audio_advanced timeline posts resolved clips with their trims", async () => {
  const dir = mediaWith("a.mp3");
  const { ctx, calls } = fakeMcpCtx({ "POST /api/audio-adv/timeline": { ok: true, file: "/o/audio-timeline-1.mp3", clips: [], filterComplex: "fc" } });
  const result = await byName.audio_advanced.handler(ctx, {
    action: "timeline",
    clips: [{ path: path.join(dir, "a.mp3"), startSec: 1, durationSec: 2 }, { path: "mylib:abc" }],
  });
  assert.deepEqual(calls[0].opts.body.clips, [{ path: fs.realpathSync(path.join(dir, "a.mp3")), startSec: 1, durationSec: 2 }, { path: "mylib:abc" }]);
  assert.equal(result.structuredContent.filterComplex, "fc");
  assert.equal("clips" in result.structuredContent, false);
});

test("audio_advanced timeline_preview resolves the background and returns the video", async () => {
  const dir = mediaWith("a.mp3", "bg.mp4");
  const { ctx, calls } = fakeMcpCtx({ "POST /api/audio-adv/timeline-preview": { ok: true, file: "/o/timeline-preview-1.mp4" } });
  const result = await byName.audio_advanced.handler(ctx, {
    action: "timeline_preview",
    clips: [{ path: path.join(dir, "a.mp3") }],
    backgroundPath: path.join(dir, "bg.mp4"),
  });
  assert.equal(calls[0].opts.body.backgroundPath, fs.realpathSync(path.join(dir, "bg.mp4")));
  assert.equal(result.structuredContent.url, "http://host.test/outputs/timeline-preview-1.mp4");
  const missing = await byName.audio_advanced.handler(ctx, { action: "timeline_preview", clips: [{ path: "x" }] });
  assert.equal(missing.structuredContent.error, "BAD_INPUT");
});

test("audio_advanced info returns the duration for a path inside the media folder only", async () => {
  const dir = mediaWith("a.mp3");
  const { ctx, calls } = fakeMcpCtx({ "GET /api/audio-adv/info": { ok: true, durationSec: 12.5 } });
  const result = await byName.audio_advanced.handler(ctx, { action: "info", inputPath: path.join(dir, "a.mp3") });
  assert.deepEqual(result.structuredContent, { durationSec: 12.5 });
  assert.deepEqual(calls[0].opts.query, { inputPath: fs.realpathSync(path.join(dir, "a.mp3")) });
  const outside = await byName.audio_advanced.handler(ctx, { action: "info", inputPath: path.join(testApp.dataDir, "users.json") });
  assert.equal(outside.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("a route answer without a file is NO_OUTPUT", async () => {
  const dir = mediaWith("voice.mp3");
  const { ctx } = fakeMcpCtx({ "POST /api/audio/process": { ok: true } });
  const result = await byName.audio_process.handler(ctx, { inputPath: path.join(dir, "voice.mp3") });
  assert.equal(result.structuredContent.error, "NO_OUTPUT");
});

test("tools/list shows audio_process and audio_advanced", async () => {
  _setScopeForTests(null);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("audio_process"));
  assert.ok(names.includes("audio_advanced"));
});

test("audio_process rejects a path outside the media folder for real", async () => {
  const result = await client.callTool({ name: "audio_process", arguments: { inputPath: path.join(testApp.dataDir, "users.json") } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("audio_process rejects an out-of-range option before any route", async () => {
  const result = await client.callTool({ name: "audio_process", arguments: { inputPath: "x", denoise: { strength: 5 } } });
  assert.equal(result.isError, true);
});

test("audio_process cleans a real tone with ffmpeg", { skip: !ffmpegPresent && "ffmpeg not installed" }, async () => {
  const input = tone("tone-a.mp3");
  const result = await client.callTool({ name: "audio_process", arguments: { inputPath: input, preset: "raw" } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.ok(fs.existsSync(result.structuredContent.path));
  assert.match(result.structuredContent.url, /\/outputs\/audio-processed-.*\.mp3$/);
});

test("audio_advanced info and merge work on real tones", { skip: !ffmpegPresent && "ffmpeg not installed" }, async () => {
  const one = tone("tone-b.mp3");
  const two = tone("tone-c.mp3", 2);
  const info = await client.callTool({ name: "audio_advanced", arguments: { action: "info", inputPath: two } });
  assert.notEqual(info.isError, true, info.content?.[0]?.text);
  assert.ok(Math.abs(info.structuredContent.durationSec - 2) < 0.3);
  const merged = await client.callTool({ name: "audio_advanced", arguments: { action: "merge", inputs: [one, two] } });
  assert.notEqual(merged.isError, true, merged.content?.[0]?.text);
  assert.ok(fs.existsSync(merged.structuredContent.path));
});
