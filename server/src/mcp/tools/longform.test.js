import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import longformTools from "./longform.js";

const USER = { id: "u_longform", email: "longform@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  _setScopeForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(longformTools.map((t) => [t.name, t]));
const UNLIMITED = { ok: true, usage: { plan: "premium", buckets: { render: { used: 0, limit: -1, unlimited: true, remaining: null } } } };
const SPENT = { ok: true, usage: { plan: "free", buckets: { render: { used: 5, limit: 5, unlimited: false, remaining: 0 } } } };
const SECTIONS = [
  { heading: "Welcome", reference: null, verseText: "", text: "Welcome.", targetSec: 60 },
  { heading: "Psalm 23", reference: "Psalm 23:1", verseText: "The LORD is my shepherd.", text: "The LORD is my shepherd.", targetSec: 300 },
  { heading: "Closing", reference: null, verseText: "", text: "Sleep well.", targetSec: 60 },
];
const PROJECT = (fields = {}) => ({
  projectId: "p1", title: "Rest", status: "draft_script", aspect: "landscape", scenes: [],
  scene: { targetSceneSec: 150, maxScenes: 12, beatSec: 40 },
  longform: { templateId: "sleep-30", summary: "Slow psalms.", sections: SECTIONS },
  ...fields,
});

function ctxWith(responses, { usage = UNLIMITED } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usage, ...responses }, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);

function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "longform-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return fs.realpathSync(dir);
}

// ---- definitions ----

test("the longform file declares longform_project and longform_narrate on /api/longform", () => {
  assert.deepEqual(longformTools.map((t) => t.name), ["longform_project", "longform_narrate"]);
  for (const tool of longformTools) {
    assert.ok(tool.routes.includes("/api/longform"), tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.publish, undefined, tool.name);
    assert.equal(tool.requires, undefined, tool.name);
  }
  assert.match(byName.longform_narrate.description, /kind longform/);
  assert.match(byName.longform_narrate.description, /tts/);
  assert.match(byName.longform_narrate.description, /images/);
  assert.match(byName.longform_project.description, /render quota/);
  assert.match(byName.longform_project.description, /one daily render/);
});

// ---- longform_project ----

test("templates lists the formats", async () => {
  const { ctx, chargeCalls } = ctxWith({ "GET /api/longform/templates": { ok: true, templates: [{ id: "sleep-30" }] } });
  const result = await byName.longform_project.handler(ctx, { action: "templates" });
  assert.deepEqual(result.structuredContent, { templates: [{ id: "sleep-30" }] });
  assert.equal(chargeCalls.length, 0);
});

test("draft from a pasted script or an idea returns the outline as a longform project", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/longform/draft": { ok: true, project: PROJECT(), suggestion: { templateId: "sleep-30" } } });
  const result = await byName.longform_project.handler(ctx, { action: "draft", idea: "cannot sleep", templateId: "sleep-30", title: "Rest" });
  assert.deepEqual(calls[1].opts.body, { idea: "cannot sleep", templateId: "sleep-30", title: "Rest" });
  const { project, suggestion } = result.structuredContent;
  assert.equal(project.id, "p1");
  assert.equal(project.status, "draft_script");
  assert.deepEqual(project.longform.sections, SECTIONS);
  assert.equal(project.job.kind, "longform");
  assert.deepEqual(suggestion, { templateId: "sleep-30" });
  assert.deepEqual(chargeCalls, [{ renders: 1 }]);
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage", "POST /api/longform/draft"]);
});

test("draft needs a script, an idea or a voice note", async () => {
  const { ctx, calls } = ctxWith({});
  const result = await byName.longform_project.handler(ctx, { action: "draft" });
  assert.equal(result.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("a voice note must be in the user's media folder; it is sent as its real path", async () => {
  const dir = mediaWith("note.m4a");
  const { ctx, calls } = ctxWith({ "POST /api/longform/draft": { ok: true, project: PROJECT() } });
  await byName.longform_project.handler(ctx, { action: "draft", audioPath: path.join(dir, "note.m4a") });
  assert.equal(calls[1].opts.body.audioPath, path.join(dir, "note.m4a"));
  const outside = ctxWith({});
  const refused = await byName.longform_project.handler(outside.ctx, { action: "draft", audioPath: path.join(testApp.dataDir, "users.json") });
  assert.equal(refused.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const url = await byName.longform_project.handler(outside.ctx, { action: "draft", audioPath: "https://example.com/a.mp3" });
  assert.equal(url.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(outside.calls.length, 0);
});

test("R56: a draft is refused before any charge when the plan's render quota is used up", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({}, { usage: SPENT });
  const result = await byName.longform_project.handler(ctx, { action: "draft", idea: "rest" });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.equal(chargeCalls.length, 0);
  assert.deepEqual(routesCalled(calls), ["GET /api/billing/usage"]);
});

test("sections and reopen need an id and go to their routes", async () => {
  const { ctx, calls } = ctxWith({
    "PATCH /api/longform/p1/sections": { ok: true, project: PROJECT() },
    "POST /api/longform/p1/reopen": { ok: true, project: PROJECT() },
  });
  const missing = await byName.longform_project.handler(ctx, { action: "reopen" });
  assert.equal(missing.structuredContent.error, "BAD_INPUT");
  const noSections = await byName.longform_project.handler(ctx, { action: "sections", id: "p1" });
  assert.equal(noSections.structuredContent.error, "BAD_INPUT");
  await byName.longform_project.handler(ctx, { action: "sections", id: "p1", sections: SECTIONS });
  assert.deepEqual(calls[0].opts.body, { sections: SECTIONS });
  const reopened = await byName.longform_project.handler(ctx, { action: "reopen", id: "p1" });
  assert.equal(reopened.structuredContent.project.status, "draft_script");
  assert.deepEqual(routesCalled(calls), ["PATCH /api/longform/p1/sections", "POST /api/longform/p1/reopen"]);
});

// ---- longform_narrate ----

test("narrate charges one tts per section and the pictures the story pipeline will make, together", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/story/p1": { ok: true, project: PROJECT() },
    "POST /api/longform/p1/narrate": { ok: true, project: PROJECT({ status: "narrating" }) },
  });
  const result = await byName.longform_narrate.handler(ctx, { id: "p1", voiceId: "en-GB-RyanNeural" });
  assert.deepEqual(chargeCalls, [{ tts: 3, images: 12 }]);
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1", "GET /api/billing/usage", "POST /api/longform/p1/narrate"]);
  assert.deepEqual(calls[2].opts.body, { voiceId: "en-GB-RyanNeural" });
  const data = result.structuredContent;
  assert.equal(data.kind, "longform");
  assert.equal(data.id, "p1");
  assert.equal(data.phase, "narrating");
  assert.deepEqual(data.charged, { tts: 3, images: 12 });
});

test("narrate after scenes exist charges only the missing pictures", async () => {
  const scenes = [{ id: "scene-001", imageStatus: "done", imagePath: "/x.png" }, { id: "scene-002", imageStatus: "error" }];
  const { ctx, chargeCalls } = ctxWith({
    "GET /api/story/p1": { ok: true, project: PROJECT({ status: "error", scenes }) },
    "POST /api/longform/p1/narrate": { ok: true, project: PROJECT({ status: "narrating" }) },
  });
  await byName.longform_narrate.handler(ctx, { id: "p1" });
  assert.deepEqual(chargeCalls, [{ tts: 3, images: 1 }]);
});

test("narrate is refused before any charge: no sections, plan quota spent, or work already running", async () => {
  const cases = [
    [PROJECT({ longform: { templateId: "sleep-30", sections: [] } }), UNLIMITED, "NO_SECTIONS"],
    [PROJECT(), SPENT, "QUOTA_EXCEEDED"],
    [PROJECT({ status: "narrating", longform: { sections: SECTIONS, progress: { done: 1, total: 4, alive: true } } }), UNLIMITED, "PROJECT_BUSY"],
    // A picture being made: generating_images with none being made is idle (slice 3) and may be narrated.
    [PROJECT({ status: "generating_images", scenes: [{ id: "scene-001", imageStatus: "generating" }] }), UNLIMITED, "PROJECT_BUSY"],
  ];
  for (const [project, usage, code] of cases) {
    const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project } }, { usage });
    const result = await byName.longform_narrate.handler(ctx, { id: "p1" });
    assert.equal(result.structuredContent.error, code);
    assert.equal(chargeCalls.length, 0, code);
    assert.ok(!routesCalled(calls).includes("POST /api/longform/p1/narrate"), code);
  }
});

test("L5: narrate is refused SESSION_BUSY, uncharged, while AI clips are being made for the project", async () => {
  const scenes = [{ id: "scene-001", imageStatus: "done", imagePath: "/x.png", aiVideoStatus: "generating" }];
  const { ctx, calls, chargeCalls } = ctxWith({ "GET /api/story/p1": { ok: true, project: PROJECT({ status: "ready_to_render", scenes }) } });
  const result = await byName.longform_narrate.handler(ctx, { id: "p1" });
  assert.equal(result.structuredContent.error, "SESSION_BUSY");
  assert.match(result.content[0].text, /story_cancel/);
  assert.equal(chargeCalls.length, 0);
  assert.deepEqual(routesCalled(calls), ["GET /api/story/p1"]);
});

test("a narration a restart stopped can be narrated again", async () => {
  const { ctx, chargeCalls } = ctxWith({
    "GET /api/story/p1": { ok: true, project: PROJECT({ status: "narrating", longform: { sections: SECTIONS, progress: { done: 1, total: 4, alive: false } } }) },
    "POST /api/longform/p1/narrate": { ok: true, project: PROJECT({ status: "narrating" }) },
  });
  const result = await byName.longform_narrate.handler(ctx, { id: "p1" });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.equal(chargeCalls.length, 1);
});

// ---- through the real MCP client ----

test("the longform tools are listed and a real templates call answers", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("longform_project"));
  assert.ok(names.includes("longform_narrate"));
  const result = await client.callTool({ name: "longform_project", arguments: { action: "templates" } });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  assert.ok(result.structuredContent.templates.some((t) => t.id === "sleep-30"));
});

test("a real draft from a pasted script: an idle draft handle, an outline edit, and a reopen refused for a draft", async () => {
  const script = "Welcome. Breathe slowly and rest.\n\nThe night is quiet. Let your shoulders fall.\n\nSleep well.";
  const made = await client.callTool({ name: "longform_project", arguments: { action: "draft", script, templateId: "sleep-30", title: "Quiet" } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  const { project } = made.structuredContent;
  assert.equal(project.status, "draft_script");
  assert.ok(project.longform.sections.length >= 1);
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "longform", id: project.id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "done");
  assert.equal(waited.structuredContent.phase, "draft_script");
  const edited = await client.callTool({ name: "longform_project", arguments: { action: "sections", id: project.id, sections: [{ heading: "One", text: "Rest now." }] } });
  assert.ok(!edited.isError, JSON.stringify(edited.structuredContent));
  assert.equal(edited.structuredContent.project.longform.sections.length, 1);
  const reopen = await client.callTool({ name: "longform_project", arguments: { action: "reopen", id: project.id } });
  assert.equal(reopen.isError, true);
});
