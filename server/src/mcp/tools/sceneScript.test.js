import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import sceneTools from "./sceneScript.js";

const USER = { id: "u_scene_user", email: "scene-user@example.com", role: "user", emailVerified: true };
const ADMIN = { id: "u_scene_admin", email: "scene-admin@example.com", role: "admin", emailVerified: true };
const testApp = await startTestApp({ users: [USER, ADMIN], superAdminEmail: ADMIN.email });
const userClient = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const adminClient = await mcpClient(testApp.port, testApp.keyFor(ADMIN.id));

after(async () => {
  await userClient.close().catch(() => {});
  await adminClient.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(sceneTools.map((t) => [t.name, t]));
const ID = "0b0c8f8e-1a2b-4c3d-8e9f-001122334455";
const BASE_PATH = `/api/scene-script/${ID}`;
const SCRIPT = [
  "TITLE: Be Still | Psalm 46:10",
  "### Scene 1 — Opening (0:00–0:06)",
  "*Visual: A man standing alone by a river at dawn.*",
  "**Narrator (calm):**",
  "\"Be still.\"",
].join("\n");

const PROJECT = (fields = {}) => ({
  id: ID, meta: { title: "Be Still" }, lines: [{ id: "l1", text: "Be still.", audio: { file: "l1.mp3", url: "/outputs/scene-scripts/x/voice/l1.mp3", words: [{ text: "Be" }] } }],
  shots: [{ id: "s1", prompt: "a river", clip: null, similar: [] }], cast: {}, music: { cues: [] }, voice: null, render: null,
  needsVoice: false, blockers: [], running: { voice: false, shots: false, render: false }, estimate: { clips: 1, usd: 0.4 },
  ...fields,
});
const answer = (project) => ({ ok: true, project });

function ctxWith(responses) {
  const chargeCalls = [];
  const fake = fakeMcpCtx(responses, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);

// ---- definitions ----

test("the scene script file declares five super-admin tools on /api/scene-script, charged in their handlers", () => {
  assert.deepEqual(sceneTools.map((t) => t.name), [
    "scene_script_project", "scene_script_step", "scene_script_shots", "scene_script_render", "scene_script_cancel",
  ]);
  for (const tool of sceneTools) {
    assert.deepEqual(tool.routes, ["/api/scene-script"], tool.name);
    assert.equal(tool.requires, "super_admin", tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.publish, undefined, tool.name);
  }
});

test("descriptions name the scene kind and the costs", () => {
  for (const name of ["scene_script_step", "scene_script_shots", "scene_script_render"]) {
    assert.match(byName[name].description, /kind scene/, name);
  }
  assert.match(byName.scene_script_step.description, /tts/);
  assert.match(byName.scene_script_shots.description, /aiVideoUsd/);
  assert.match(byName.scene_script_shots.description, /estimateOnly/);
  assert.match(byName.scene_script_render.description, /render/);
  assert.match(byName.scene_script_render.description, /never posts/i);
});

// ---- scene_script_project ----

test("list, voices and parse are plain reads", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/scene-script": { ok: true, projects: [{ id: ID, title: "Be Still" }] },
    "GET /api/scene-script/voices": { ok: true, voices: ["en-GB-RyanNeural"], ensemble: [], rooms: ["hall"] },
    "POST /api/scene-script/parse": { ok: true, preview: { meta: { title: "Be Still" } }, estimate: { clips: 1 } },
  });
  const listed = await byName.scene_script_project.handler(ctx, { action: "list" });
  assert.deepEqual(listed.structuredContent, { projects: [{ id: ID, title: "Be Still" }] });
  const voices = await byName.scene_script_project.handler(ctx, { action: "voices" });
  assert.deepEqual(voices.structuredContent.voices, ["en-GB-RyanNeural"]);
  assert.equal(voices.structuredContent.ok, undefined);
  const parsed = await byName.scene_script_project.handler(ctx, { action: "parse", markdown: SCRIPT });
  assert.deepEqual(parsed.structuredContent, { preview: { meta: { title: "Be Still" } }, estimate: { clips: 1 } });
  assert.deepEqual(calls[2].opts.body, { markdown: SCRIPT });
  assert.equal(chargeCalls.length, 0);
});

test("create and parse need markdown; get, update and delete need an id", async () => {
  const { ctx, calls } = ctxWith({});
  for (const action of ["create", "parse"]) {
    const result = await byName.scene_script_project.handler(ctx, { action });
    assert.equal(result.structuredContent.error, "BAD_INPUT", action);
  }
  for (const action of ["get", "update", "delete"]) {
    const result = await byName.scene_script_project.handler(ctx, { action });
    assert.equal(result.structuredContent.error, "BAD_INPUT", action);
  }
  const nothing = await byName.scene_script_project.handler(ctx, { action: "update", id: ID });
  assert.equal(nothing.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("get returns the project without word timings, with a scene job handle and the month's spend", async () => {
  const { ctx } = ctxWith({ [`GET ${BASE_PATH}`]: { ok: true, project: PROJECT(), month: { spentUsd: 1 }, seedance: true } });
  const result = await byName.scene_script_project.handler(ctx, { action: "get", id: ID });
  const { project, month, seedance } = result.structuredContent;
  assert.equal(project.id, ID);
  assert.equal(project.lines[0].audio.words, undefined);
  assert.equal(project.lines[0].audio.url, "http://host.test/outputs/scene-scripts/x/voice/l1.mp3");
  assert.equal(project.job.kind, "scene");
  assert.equal(project.job.id, ID);
  assert.deepEqual(month, { spentUsd: 1 });
  assert.equal(seedance, true);
});

test("create posts the markdown; update sends only the fields given; delete answers deleted", async () => {
  const { ctx, calls } = ctxWith({
    "POST /api/scene-script": answer(PROJECT()),
    [`PATCH ${BASE_PATH}`]: answer(PROJECT({ meta: { title: "Renamed" } })),
    [`DELETE ${BASE_PATH}`]: { ok: true },
  });
  const made = await byName.scene_script_project.handler(ctx, { action: "create", markdown: SCRIPT });
  assert.equal(made.structuredContent.project.id, ID);
  const edits = { title: "Renamed", lines: [{ id: "l1", retake: true }], cues: [{ id: "c1", bed: "library:calm" }] };
  const updated = await byName.scene_script_project.handler(ctx, { action: "update", id: ID, ...edits });
  assert.equal(updated.structuredContent.project.meta.title, "Renamed");
  assert.deepEqual(calls[1].opts.body, edits);
  const gone = await byName.scene_script_project.handler(ctx, { action: "delete", id: ID });
  assert.deepEqual(gone.structuredContent, { id: ID, deleted: true });
  assert.deepEqual(routesCalled(calls), ["POST /api/scene-script", `PATCH ${BASE_PATH}`, `DELETE ${BASE_PATH}`]);
});

test("a cue bed must be a library or mylib ref, never a path", () => {
  const schema = byName.scene_script_project.inputSchema.cues;
  assert.equal(schema.safeParse([{ id: "c1", bed: "library:calm-1" }]).success, true);
  assert.equal(schema.safeParse([{ id: "c1", bed: "C:\\data\\song.mp3" }]).success, false);
  assert.equal(schema.safeParse([{ id: "c1", bed: "https://example.com/a.mp3" }]).success, false);
});

// ---- scene_script_step ----

test("step voice charges one tts and starts voicing; a project already voiced starts nothing", async () => {
  const needs = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ needsVoice: true })), [`POST ${BASE_PATH}/voice`]: answer(PROJECT()) });
  const started = await byName.scene_script_step.handler(needs.ctx, { id: ID, step: "voice" });
  assert.deepEqual(needs.chargeCalls, [{ tts: 1 }]);
  assert.equal(started.structuredContent.kind, "scene");
  assert.equal(started.structuredContent.status, "running");
  assert.equal(started.structuredContent.phase, "voicing");
  assert.equal(started.structuredContent.ttsCharged, 1);

  const voiced = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ needsVoice: false, voice: { status: "done" } })) });
  const nothing = await byName.scene_script_step.handler(voiced.ctx, { id: ID, step: "voice" });
  assert.equal(voiced.chargeCalls.length, 0);
  assert.equal(nothing.structuredContent.ttsCharged, 0);
  assert.equal(nothing.structuredContent.kind, "scene");
  assert.deepEqual(routesCalled(voiced.calls), [`GET ${BASE_PATH}`]);
});

test("step voice is refused while the project renders or voices, before any charge", async () => {
  for (const running of [{ render: true }, { voice: true }]) {
    const { ctx, calls, chargeCalls } = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ needsVoice: true, running })) });
    const result = await byName.scene_script_step.handler(ctx, { id: ID, step: "voice" });
    assert.equal(result.structuredContent.error, "PROJECT_BUSY");
    assert.equal(chargeCalls.length, 0);
    assert.equal(calls.length, 1);
  }
});

test("step suggest_shots asks for prompts (free) and passes shotIds", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ [`POST ${BASE_PATH}/suggest-shots`]: answer(PROJECT()) });
  const result = await byName.scene_script_step.handler(ctx, { id: ID, step: "suggest_shots", shotIds: ["s1"] });
  assert.equal(result.structuredContent.project.id, ID);
  assert.deepEqual(calls[0].opts.body, { shotIds: ["s1"] });
  assert.equal(chargeCalls.length, 0);
});

// ---- scene_script_shots ----

const ESTIMATE = (fields = {}) => ({ ok: true, estimate: { clips: 2, refetch: 0, seconds: 12, usd: 0.833, shotIds: ["s1", "s2"], totalUsd: 0.833, benchmarkUsd: 5, overBenchmark: false, ...fields }, month: { spentUsd: 3 } });

test("shots estimateOnly prices it and orders nothing", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ [`POST ${BASE_PATH}/shots/estimate`]: ESTIMATE() });
  const result = await byName.scene_script_shots.handler(ctx, { id: ID, estimateOnly: true, only: ["s1"] });
  assert.equal(result.structuredContent.estimate.usd, 0.833);
  assert.deepEqual(result.structuredContent.month, { spentUsd: 3 });
  assert.deepEqual(calls[0].opts.body, { only: ["s1"] });
  assert.equal(chargeCalls.length, 0);
  assert.equal(calls.length, 1);
});

test("shots charges the estimate's dollars rounded up to the cent, then orders", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    [`POST ${BASE_PATH}/shots/estimate`]: ESTIMATE(),
    [`POST ${BASE_PATH}/shots`]: answer(PROJECT()),
  });
  const result = await byName.scene_script_shots.handler(ctx, { id: ID });
  assert.deepEqual(chargeCalls, [{ aiVideoUsd: 0.84 }]);
  assert.deepEqual(routesCalled(calls), [`POST ${BASE_PATH}/shots/estimate`, `POST ${BASE_PATH}/shots`]);
  assert.deepEqual(calls[1].opts.body, {});
  assert.equal(result.structuredContent.kind, "scene");
  assert.equal(result.structuredContent.phase, "making_shots");
  assert.equal(result.structuredContent.usdCharged, 0.84);
  assert.equal(result.structuredContent.clips, 2);
});

test("shots sends only and the benchmark confirmation when given", async () => {
  const { ctx, calls } = ctxWith({
    [`POST ${BASE_PATH}/shots/estimate`]: ESTIMATE({ overBenchmark: true }),
    [`POST ${BASE_PATH}/shots`]: answer(PROJECT()),
  });
  await byName.scene_script_shots.handler(ctx, { id: ID, only: ["s2"], confirmOverBenchmark: true });
  assert.deepEqual(calls[1].opts.body, { only: ["s2"], confirmOverBenchmark: true });
});

test("shots over the benchmark without confirmation is refused before any charge", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ [`POST ${BASE_PATH}/shots/estimate`]: ESTIMATE({ overBenchmark: true, totalUsd: 6.5 }) });
  const result = await byName.scene_script_shots.handler(ctx, { id: ID });
  assert.equal(result.structuredContent.error, "OVER_BENCHMARK");
  assert.match(result.content[0].text, /6\.50/);
  assert.equal(chargeCalls.length, 0);
  assert.equal(calls.length, 1);
});

test("shots with nothing to order, or only free refetches, charges nothing", async () => {
  const none = ctxWith({ [`POST ${BASE_PATH}/shots/estimate`]: ESTIMATE({ clips: 0, refetch: 0, usd: 0, shotIds: [] }) });
  const nothing = await byName.scene_script_shots.handler(none.ctx, { id: ID });
  assert.equal(nothing.structuredContent.error, "NOTHING_TO_ORDER");
  assert.equal(none.chargeCalls.length, 0);
  const free = ctxWith({ [`POST ${BASE_PATH}/shots/estimate`]: ESTIMATE({ clips: 0, refetch: 1, usd: 0 }), [`POST ${BASE_PATH}/shots`]: answer(PROJECT()) });
  const refetched = await byName.scene_script_shots.handler(free.ctx, { id: ID });
  assert.equal(free.chargeCalls.length, 0);
  assert.equal(refetched.structuredContent.usdCharged, 0);
});

// ---- scene_script_render ----

test("render charges one render and starts it", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT()), [`POST ${BASE_PATH}/render`]: answer(PROJECT()) });
  const result = await byName.scene_script_render.handler(ctx, { id: ID });
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
  assert.deepEqual(routesCalled(calls), [`GET ${BASE_PATH}`, `POST ${BASE_PATH}/render`]);
  assert.equal(result.structuredContent.kind, "scene");
  assert.equal(result.structuredContent.phase, "rendering");
});

test("render is refused, uncharged, when the project is not ready", async () => {
  const blocked = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ blockers: ["1 shot(s) have no clip yet."] })) });
  const result = await byName.scene_script_render.handler(blocked.ctx, { id: ID });
  assert.equal(result.structuredContent.error, "NOT_READY");
  assert.deepEqual(result.structuredContent.blockers, ["1 shot(s) have no clip yet."]);
  const stale = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ needsVoice: true })) });
  const restale = await byName.scene_script_render.handler(stale.ctx, { id: ID });
  assert.equal(restale.structuredContent.error, "NOT_READY");
  const busy = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ running: { shots: true } })) });
  const busyResult = await byName.scene_script_render.handler(busy.ctx, { id: ID });
  assert.equal(busyResult.structuredContent.error, "PROJECT_BUSY");
  assert.equal(blocked.chargeCalls.length + stale.chargeCalls.length + busy.chargeCalls.length, 0);
});

// ---- scene_script_cancel ----

test("cancel stops what runs, and refuses with NOTHING_RUNNING otherwise", async () => {
  const shots = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ running: { shots: true } })), [`POST ${BASE_PATH}/shots/cancel`]: { ok: true } });
  const stopped = await byName.scene_script_cancel.handler(shots.ctx, { id: ID, what: "shots" });
  assert.deepEqual(stopped.structuredContent, { kind: "scene", id: ID, cancelled: "shots" });
  const render = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT({ render: { status: "rendering" } })), [`POST ${BASE_PATH}/render/cancel`]: { ok: true } });
  const rendered = await byName.scene_script_cancel.handler(render.ctx, { id: ID, what: "render" });
  assert.equal(rendered.structuredContent.cancelled, "render");
  const idle = ctxWith({ [`GET ${BASE_PATH}`]: answer(PROJECT()) });
  const nothing = await byName.scene_script_cancel.handler(idle.ctx, { id: ID, what: "render" });
  assert.equal(nothing.structuredContent.error, "NOTHING_RUNNING");
  assert.deepEqual(routesCalled(idle.calls), [`GET ${BASE_PATH}`]);
});

// ---- through the real MCP client ----

test("the scene script tools are listed for a super-admin key and hidden from a normal one", async () => {
  const userNames = (await userClient.listTools()).tools.map((t) => t.name);
  const adminNames = (await adminClient.listTools()).tools.map((t) => t.name);
  for (const name of Object.keys(byName)) {
    assert.ok(!userNames.includes(name), name);
    assert.ok(adminNames.includes(name), name);
  }
});

test("a real scene script: parse, create, get, a refused render that gives the cap back, then delete", async () => {
  const parsed = await adminClient.callTool({ name: "scene_script_project", arguments: { action: "parse", markdown: SCRIPT } });
  assert.ok(!parsed.isError, JSON.stringify(parsed.structuredContent));
  assert.ok(parsed.structuredContent.preview);
  const made = await adminClient.callTool({ name: "scene_script_project", arguments: { action: "create", markdown: SCRIPT } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  const id = made.structuredContent.project.id;
  const got = await adminClient.callTool({ name: "scene_script_project", arguments: { action: "get", id } });
  assert.equal(got.structuredContent.project.job.kind, "scene");
  const before = (await adminClient.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  const refused = await adminClient.callTool({ name: "scene_script_render", arguments: { id } });
  assert.equal(refused.structuredContent.error, "NOT_READY");
  const afterCall = (await adminClient.callTool({ name: "whoami", arguments: {} })).structuredContent.caps.renders;
  assert.deepEqual(afterCall, before);
  const waited = await adminClient.callTool({ name: "jobs_wait", arguments: { kind: "scene", id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "done");
  assert.equal(waited.structuredContent.phase, "not_ready");
  const gone = await adminClient.callTool({ name: "scene_script_project", arguments: { action: "delete", id } });
  assert.deepEqual(gone.structuredContent, { id, deleted: true });
});
