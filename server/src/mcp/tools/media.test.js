import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import mediaTools from "./media.js";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };

const testApp = await startTestApp({ users: [USER] });
const { resolveScopeDirs } = await import("../../lib/paths.js");
const outputDir = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role }).outputDir;
fs.mkdirSync(outputDir, { recursive: true });

const key = testApp.keyFor(USER.id);
const client = await mcpClient(testApp.port, key);

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

function seed(name) {
  const file = path.join(outputDir, name);
  fs.writeFileSync(file, "x");
  return file.replace(/\\/g, "/");
}

test("tools/list includes the four media tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ["media_list", "media_import_url", "media_trim", "transcribe"]) assert.ok(names.includes(name), name);
});

test("media_list wraps the audio files in { items }", async () => {
  const file = seed("voice-note.mp3");
  const result = await client.callTool({ name: "media_list", arguments: { kind: "audio" } });
  assert.notEqual(result.isError, true);
  assert.ok(Array.isArray(result.structuredContent.items));
  assert.equal("ok" in result.structuredContent, false);
  const row = result.structuredContent.items.find((i) => i.name === "voice-note.mp3");
  assert.equal(row.path, file);
  assert.equal(row.size, 1);
});

test("media_list video lists videos only", async () => {
  seed("clip.mp4");
  const result = await client.callTool({ name: "media_list", arguments: { kind: "video" } });
  const names = result.structuredContent.items.map((i) => i.name);
  assert.ok(names.includes("clip.mp4"));
  assert.ok(!names.includes("voice-note.mp3"));
});

test("media_list rejects an unknown kind", async () => {
  const result = await client.callTool({ name: "media_list", arguments: { kind: "image" } });
  assert.equal(result.isError, true);
});

test("media_import_url refuses a private address with URL_PRIVATE", async () => {
  const result = await client.callTool({ name: "media_import_url", arguments: { url: "http://127.0.0.1:9/x" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /URL_PRIVATE/);
  assert.equal(result.structuredContent.error, "URL_PRIVATE");
});

test("media_import_url refuses a non-http scheme with URL_SCHEME", async () => {
  const result = await client.callTool({ name: "media_import_url", arguments: { url: "ftp://example.com/a.mp3" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "URL_SCHEME");
});

test("media_trim on a file outside the media folder is a tool error", async () => {
  const result = await client.callTool({
    name: "media_trim",
    arguments: { inputPath: path.join(testApp.dataDir, "users.json"), startSec: 0, endSec: 2 },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /outside your media folder/);
});

test("media_trim rejects a missing endSec before calling the API", async () => {
  const result = await client.callTool({ name: "media_trim", arguments: { inputPath: "a.mp3", startSec: 0 } });
  assert.equal(result.isError, true);
});

function toolNamed(name) {
  return mediaTools.find((t) => t.name === name);
}

test("transcribe posts mediaPath to /api/transcribe and drops the ok flag", async () => {
  const calls = [];
  const api = {
    async call(method, route, opts) {
      calls.push({ method, route, opts });
      return { ok: true, audioPath: "/o/a.mp3", durationMs: 1200, sttProvider: "whisper", words: [{ text: "hi", startMs: 0, endMs: 300 }] };
    },
  };
  const result = await toolNamed("transcribe").handler({ api }, { mediaPath: "/o/talk.mp4" });
  assert.deepEqual(calls, [{ method: "POST", route: "/api/transcribe", opts: { body: { mediaPath: "/o/talk.mp4" } } }]);
  assert.equal("ok" in result.structuredContent, false);
  assert.equal(result.structuredContent.durationMs, 1200);
  assert.equal(result.structuredContent.words.length, 1);
});

test("every media tool declares the routes it calls", () => {
  assert.deepEqual(toolNamed("media_list").routes, ["/api/media"]);
  assert.deepEqual(toolNamed("media_import_url").routes, ["/api/media"]);
  assert.deepEqual(toolNamed("media_trim").routes, ["/api/media"]);
  assert.deepEqual(toolNamed("transcribe").routes, ["/api/transcribe"]);
});
