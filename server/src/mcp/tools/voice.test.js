import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import voiceTools from "./voice.js";

// Offline: Edge-TTS off, no Piper bridge, so provider calls fail fast without the network.
process.env.EDGE_TTS_ENABLED = "false";
process.env.PIPER_URL = "";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(voiceTools.map((t) => [t.name, t]));
const consent = { hasRights: true, noImpersonation: true, termsAccepted: true };

test("the voice file declares exactly these tools", () => {
  assert.deepEqual(voiceTools.map((t) => t.name).sort(), ["transcripts", "voice_clone", "voice_list", "voice_synthesize"]);
});

test("voice_list merges voices, providers, profiles and saved clones", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/tts/voices": { ok: true, provider: "edge", voices: [{ voice_id: "en-US-AriaNeural", name: "Aria" }] },
    "GET /api/tts/providers": { ok: true, providers: { edge: { available: true, priority: 5 } } },
    "GET /api/tts/profiles": { ok: true, profiles: [{ category: "devotional" }] },
    "GET /api/tts/chatterbox-voices": { ok: true, voices: [{ id: "cb:1", name: "Me", refPath: "/secret/ref.wav" }] },
  });
  const result = await byName.voice_list.handler(ctx, { provider: "edge" });
  const data = result.structuredContent;
  assert.equal(data.provider, "edge");
  assert.equal(data.voices[0].voice_id, "en-US-AriaNeural");
  assert.deepEqual(data.providers.edge, { available: true, priority: 5 });
  assert.equal(data.profiles[0].category, "devotional");
  assert.deepEqual(data.clonedVoices, [{ id: "cb:1", name: "Me" }]);
  assert.equal("ok" in data, false);
  assert.deepEqual(calls.find((c) => c.path === "/api/tts/voices").opts.query, { provider: "edge" });
});

test("voice_list defaults to edge voices and keeps going when the voice list fails", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/tts/voices": Object.assign(new Error("Edge-TTS disabled"), { name: "ApiError", code: "HTTP_400" }),
    "GET /api/tts/providers": { ok: true, providers: {} },
    "GET /api/tts/profiles": { ok: true, profiles: [] },
    "GET /api/tts/chatterbox-voices": { ok: true, voices: [] },
  });
  const result = await byName.voice_list.handler(ctx, {});
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent.voices, []);
  assert.equal(result.structuredContent.voicesError, "Edge-TTS disabled");
  assert.equal(calls.find((c) => c.path === "/api/tts/voices").opts.query.provider, "edge");
});

test("voice_list probe asks the providers route to check reachability", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/tts/voices": { ok: true, voices: [] },
    "GET /api/tts/providers": { ok: true, providers: {}, probed: true },
    "GET /api/tts/profiles": { ok: true, profiles: [] },
    "GET /api/tts/chatterbox-voices": { ok: true, voices: [] },
  });
  await byName.voice_list.handler(ctx, { probe: true });
  assert.deepEqual(calls.find((c) => c.path === "/api/tts/providers").opts.query, { probe: 1 });
});

test("voice_synthesize auto posts text and voiceId and returns url and path", async () => {
  const file = "C:/data/outputs/tts-edge-1.mp3";
  const { ctx, calls } = fakeMcpCtx({ "POST /api/tts/auto": { ok: true, file, provider: "edge", voice: "en-US-AriaNeural" } });
  const result = await byName.voice_synthesize.handler(ctx, { text: "Hello there", voiceId: "en-US-AriaNeural" });
  assert.deepEqual(calls[0], { method: "POST", path: "/api/tts/auto", opts: { body: { text: "Hello there", voiceId: "en-US-AriaNeural" } } });
  assert.deepEqual(result.structuredContent, {
    provider: "edge",
    voice: "en-US-AriaNeural",
    path: file,
    url: "http://host.test/outputs/tts-edge-1.mp3",
  });
});

test("voice_synthesize with a provider uses that provider's route and its own options", async () => {
  const answer = { ok: true, file: "/o/tts-x.mp3", provider: "x", voice: "v" };
  const routes = ["elevenlabs", "edge", "azure", "chatterbox", "fish", "piper"];
  const { ctx, calls } = fakeMcpCtx(Object.fromEntries(routes.map((r) => [`POST /api/tts/${r}`, answer])));
  const base = { text: "Peace be with you" };
  await byName.voice_synthesize.handler(ctx, { ...base, provider: "edge", voiceId: "v", rate: "+10%", pitch: "-2Hz", volume: "+5%", speed: 1.5 });
  await byName.voice_synthesize.handler(ctx, { ...base, provider: "chatterbox", voiceId: "cb:1", exaggeration: 0.7, cfgWeight: 0.4, rate: "+10%" });
  await byName.voice_synthesize.handler(ctx, { ...base, provider: "fish", speed: 1.2, withTimestamps: true, modelId: "m" });
  await byName.voice_synthesize.handler(ctx, { ...base, provider: "azure", withTimestamps: false });
  await byName.voice_synthesize.handler(ctx, { ...base, provider: "piper", withTimestamps: true });
  await byName.voice_synthesize.handler(ctx, { ...base, provider: "elevenlabs", voiceId: "e", modelId: "eleven_v2" });
  const bodies = Object.fromEntries(calls.map((c) => [c.path.split("/").pop(), c.opts.body]));
  assert.deepEqual(bodies.edge, { text: "Peace be with you", voiceId: "v", rate: "+10%", pitch: "-2Hz", volume: "+5%" });
  assert.deepEqual(bodies.chatterbox, { text: "Peace be with you", voiceId: "cb:1", exaggeration: 0.7, cfgWeight: 0.4 });
  assert.deepEqual(bodies.fish, { text: "Peace be with you", speed: 1.2, withTimestamps: true, modelId: "m" });
  assert.deepEqual(bodies.azure, { text: "Peace be with you", withTimestamps: false });
  assert.deepEqual(bodies.piper, { text: "Peace be with you", withTimestamps: true });
  assert.deepEqual(bodies.elevenlabs, { text: "Peace be with you", voiceId: "e", modelId: "eleven_v2" });
});

test("voice_synthesize passes word timings through and keeps fallback notes", async () => {
  const words = [{ text: "Hi", startMs: 0, endMs: 200 }];
  const { ctx } = fakeMcpCtx({
    "POST /api/tts/azure": { ok: true, file: "/o/tts-azure-1.mp3", provider: "azure", voice: "v", words, fallbackProvider: "edge" },
  });
  const result = await byName.voice_synthesize.handler(ctx, { text: "Hi there", provider: "azure" });
  assert.deepEqual(result.structuredContent.words, words);
  assert.equal(result.structuredContent.fallbackProvider, "edge");
});

test("voice_synthesize without a file in the answer is NO_AUDIO", async () => {
  const { ctx } = fakeMcpCtx({ "POST /api/tts/auto": { ok: true } });
  const result = await byName.voice_synthesize.handler(ctx, { text: "Hello there" });
  assert.equal(result.structuredContent.error, "NO_AUDIO");
});

test("voice_synthesize and voice_clone are capped at one tts per call", () => {
  assert.deepEqual(byName.voice_synthesize.caps, { tts: 1 });
  assert.deepEqual(byName.voice_clone.caps, { tts: 1 });
  assert.deepEqual(byName.voice_synthesize.routes, ["/api/tts"]);
});

test("voice_clone sends resolved sample paths, consent and the provider", async () => {
  const media = fs.mkdtempSync(path.join(testApp.dataDir, "clone-"));
  const sample = path.join(media, "me.wav");
  fs.writeFileSync(sample, "x");
  _setScopeForTests(async () => ({ outputDir: media, sharedDir: path.join(media, "shared") }));
  const { ctx, calls } = fakeMcpCtx({
    "POST /api/tts/clone-voice": { ok: true, provider: "chatterbox", voiceId: "cb:9", voice: { id: "cb:9", name: "Me", refPath: "/ref.wav" }, notes: "n" },
  });
  const result = await byName.voice_clone.handler(ctx, { name: "Me", samplePaths: [sample], provider: "chatterbox", consent });
  _setScopeForTests(null);
  assert.deepEqual(calls[0].opts.body, { provider: "chatterbox", name: "Me", samplePaths: [fs.realpathSync(sample)], consent });
  assert.deepEqual(result.structuredContent, { provider: "chatterbox", voiceId: "cb:9", voice: { id: "cb:9", name: "Me" }, notes: "n" });
});

test("voice_clone refuses a sample outside the media folder and never calls the route", async () => {
  const media = fs.mkdtempSync(path.join(testApp.dataDir, "clone-"));
  _setScopeForTests(async () => ({ outputDir: media, sharedDir: path.join(media, "shared") }));
  const { ctx, calls } = fakeMcpCtx({});
  const result = await byName.voice_clone.handler(ctx, { name: "Me", samplePaths: [path.join(testApp.dataDir, "users.json")], consent });
  _setScopeForTests(null);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(calls.length, 0);
});

test("transcripts list returns summaries without the word arrays", async () => {
  const item = { id: "t1", sourceFile: "a.mp3", label: "Hello", words: [{ text: "Hello" }], editedLines: ["Hello"], lineCount: 1, durationSec: 3, updatedAt: "now", createdAt: "then", typographyPreset: null, userId: "u" };
  const { ctx, calls } = fakeMcpCtx({ "GET /api/transcripts": { ok: true, items: [item] } });
  const result = await byName.transcripts.handler(ctx, { action: "list", limit: 5 });
  assert.deepEqual(calls[0].opts.query, { limit: 5 });
  const [row] = result.structuredContent.items;
  assert.equal(row.id, "t1");
  assert.equal(row.wordCount, 1);
  assert.deepEqual(row.editedLines, ["Hello"]);
  assert.equal("words" in row, false);
  assert.equal("userId" in row, false);
});

test("transcripts list with an id returns that transcript in full", async () => {
  const item = { id: "t1", sourceFile: "a.mp3", words: [{ text: "Hello", startMs: 0, endMs: 1 }], editedLines: ["Hello"], userId: "u" };
  const { ctx } = fakeMcpCtx({ "GET /api/transcripts": { ok: true, items: [item, { id: "t2", words: [], editedLines: [] }] } });
  const found = await byName.transcripts.handler(ctx, { action: "list", id: "t1" });
  assert.deepEqual(found.structuredContent.item.words, item.words);
  assert.equal("userId" in found.structuredContent.item, false);
  const missing = await byName.transcripts.handler(ctx, { action: "list", id: "zzz" });
  assert.equal(missing.structuredContent.error, "NOT_FOUND");
});

test("transcripts add posts the transcript and returns the saved item", async () => {
  const words = [{ text: "Hi", startMs: 0, endMs: 100 }];
  const { ctx, calls } = fakeMcpCtx({ "POST /api/transcripts": { ok: true, item: { id: "t9", sourceFile: "a.mp3", label: "Hi", words, editedLines: ["Hi"], userId: "u" } } });
  const result = await byName.transcripts.handler(ctx, { action: "add", sourceFile: "a.mp3", words, editedLines: ["Hi"], durationSec: 2 });
  assert.deepEqual(calls[0].opts.body, { sourceFile: "a.mp3", words, editedLines: ["Hi"], durationSec: 2 });
  assert.equal(result.structuredContent.item.id, "t9");
  assert.equal("words" in result.structuredContent.item, false);
  assert.equal(result.structuredContent.item.wordCount, 1);
});

test("transcripts add without sourceFile, words or editedLines is BAD_INPUT", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  const result = await byName.transcripts.handler(ctx, { action: "add", sourceFile: "a.mp3" });
  assert.equal(result.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("transcripts remove deletes by id and reports whether anything was removed", async () => {
  const { ctx, calls } = fakeMcpCtx({ "DELETE /api/transcripts/t%2F1": { ok: true, removed: true } });
  const result = await byName.transcripts.handler(ctx, { action: "remove", id: "t/1" });
  assert.deepEqual(result.structuredContent, { removed: true });
  assert.equal(calls[0].method, "DELETE");
  const missing = await byName.transcripts.handler(fakeMcpCtx({}).ctx, { action: "remove" });
  assert.equal(missing.structuredContent.error, "BAD_INPUT");
});

test("tools/list shows the four voice tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ["voice_list", "voice_synthesize", "voice_clone", "transcripts"]) assert.ok(names.includes(name), name);
});

test("voice_list works for real with Edge-TTS off: providers and profiles, voicesError set", async () => {
  const result = await client.callTool({ name: "voice_list", arguments: {} });
  assert.notEqual(result.isError, true);
  const data = result.structuredContent;
  assert.ok(Object.keys(data.providers).length > 0);
  assert.equal(typeof data.providers.edge.available, "boolean");
  assert.ok(Array.isArray(data.profiles) && data.profiles.length > 0);
  assert.deepEqual(data.voices, []);
  assert.match(data.voicesError, /disabled/i);
});

test("voice_synthesize with Piper not configured is a tool error, and the route's hint is kept", async () => {
  const result = await client.callTool({ name: "voice_synthesize", arguments: { text: "Peace be with you", provider: "piper" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No TTS provider|piper/i);
});

test("voice_synthesize counts against the agent's daily tts cap, even when the provider fails", async () => {
  const before = await client.callTool({ name: "whoami", arguments: {} });
  await client.callTool({ name: "voice_synthesize", arguments: { text: "Peace be with you", provider: "piper" } });
  const after2 = await client.callTool({ name: "whoami", arguments: {} });
  assert.equal(after2.structuredContent.caps.tts.used, before.structuredContent.caps.tts.used + 1);
});

test("voice_clone rejects a sample outside the media folder for real", async () => {
  const result = await client.callTool({
    name: "voice_clone",
    arguments: { name: "Me", samplePaths: [path.join(testApp.dataDir, "users.json")], consent },
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("voice_clone for a free account reaches the route and is FEATURE_LOCKED", async () => {
  const { resolveScopeDirs } = await import("../../lib/paths.js");
  const { outputDir } = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role });
  fs.mkdirSync(outputDir, { recursive: true });
  const sample = path.join(outputDir, "sample.wav");
  fs.writeFileSync(sample, "x");
  const result = await client.callTool({ name: "voice_clone", arguments: { name: "Me", samplePaths: [sample], consent } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "FEATURE_LOCKED");
  assert.equal(result.structuredContent.status, 403);
});

test("transcripts add, list and remove round trip through the real route", async () => {
  const words = [{ text: "Grace", startMs: 0, endMs: 400 }];
  const added = await client.callTool({ name: "transcripts", arguments: { action: "add", sourceFile: "grace.mp3", words, editedLines: ["Grace"] } });
  assert.notEqual(added.isError, true);
  const id = added.structuredContent.item.id;
  const listed = await client.callTool({ name: "transcripts", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.items.some((i) => i.id === id));
  const removed = await client.callTool({ name: "transcripts", arguments: { action: "remove", id } });
  assert.deepEqual(removed.structuredContent, { removed: true });
  const again = await client.callTool({ name: "transcripts", arguments: { action: "list" } });
  assert.ok(!again.structuredContent.items.some((i) => i.id === id));
});
