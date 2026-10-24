// A story project through the real MCP client and the real routes: what an
// agent reads at each idle point (nothing running must not read running).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { _setScopeForTests } from "../mediaPath.js";

const USER = { id: "u_story_life", email: "story-life@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));
// Imported after the app: server modules read env at import time.
const { _setLlmImpl, _resetLlmImpl } = await import("../../lib/story/sceneSegmenter.js");

const mediaDir = fs.mkdtempSync(path.join(testApp.dataDir, "story-life-media-"));
fs.writeFileSync(path.join(mediaDir, "narration.mp3"), "x");
_setScopeForTests(async () => ({ outputDir: mediaDir, sharedDir: path.join(mediaDir, "none") }));
// No LLM in tests: the segmenter falls back to even windows over the words.
_setLlmImpl(async () => { throw new Error("no LLM in tests"); });

after(async () => {
  _setScopeForTests(null);
  _resetLlmImpl();
  await client.close().catch(() => {});
  await testApp.close();
});

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent;
};

const SCRIPT = "The Lord is my shepherd I shall not want. He makes me lie down in green pastures. He leads me beside still waters.";

async function importedProject() {
  const audioPath = path.join(fs.realpathSync(mediaDir), "narration.mp3");
  const imported = await call("story_import_script", { script: SCRIPT, audioPath, durationMs: 20_000, title: "Psalm 23" });
  assert.ok(imported.project, JSON.stringify(imported));
  return imported.project;
}

/** The project's handle as story_project get and jobs_wait both report it, and story_cancel's answer. */
async function idleReadings(id) {
  const got = (await call("story_project", { action: "get", id })).project;
  const waited = await call("jobs_wait", { kind: "story", id, timeoutSec: 1 });
  const cancelled = await call("story_cancel", { id });
  const after = (await call("story_project", { action: "get", id })).project;
  return { got, waited, cancelled, after };
}

test("after story_import_script without autoStart the project reads done (a draft), and cancel changes nothing", async () => {
  const project = await importedProject();
  assert.equal(project.status, "draft");
  assert.equal(project.job.status, "done");
  const { got, waited, cancelled, after: later } = await idleReadings(project.id);
  assert.equal(got.job.status, "done");
  assert.equal(got.job.phase, "draft");
  assert.equal(waited.status, "done");
  assert.equal(cancelled.error, "NOTHING_RUNNING");
  assert.equal(later.status, "draft", "the cancel changed nothing");
});

test("after story_step segment the project reads done with phase needs_images, and cancel changes nothing", async () => {
  const project = await importedProject();
  const segmented = (await call("story_step", { id: project.id, step: "segment" })).project;
  assert.ok(segmented.sceneCount > 0, JSON.stringify(segmented));
  assert.equal(segmented.status, "generating_images");
  const { got, waited, cancelled, after: later } = await idleReadings(project.id);
  assert.equal(got.job.status, "done");
  assert.equal(got.job.phase, "needs_images");
  assert.equal(waited.status, "done");
  assert.equal(waited.phase, "needs_images");
  assert.equal(cancelled.error, "NOTHING_RUNNING");
  assert.equal(later.status, "generating_images", "the cancel did not mark it failed");
  assert.equal(later.error, null);
});
