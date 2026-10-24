import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject } from "./projectStore.js";
import { projectFromMarkdown } from "./model.js";
import { startRender, isRendering, recoverInterruptedRender } from "./renderStage.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-render-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
const SCRIPT = ["### Scene 1 — Opening (0:00–0:06)", "*Visual: A river at dawn.*", "**Narrator:**", "\"Be still.\""].join("\n");

async function settle(id) {
  for (let i = 0; i < 400 && isRendering(id); i += 1) await new Promise((r) => setTimeout(r, 5));
}

test("a failed render keeps when it started and records when it ended", async () => {
  const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
  const failing = { ffmpeg: async () => ({ ok: false, error: "no ffmpeg" }), probe: async () => 1, serveUrl: async () => "x", render: async () => { throw new Error("no renderer"); } };
  const marked = startRender(ctx, project.id, { deps: failing });
  const startedAt = marked.render.startedAt;
  await settle(project.id);
  const render = readProject(ctx.dataDir, project.id).render;
  assert.equal(render.status, "error");
  assert.equal(render.startedAt, startedAt);
  assert.ok(render.finishedAt >= startedAt);
});

test("a render a restart interrupted keeps when it started", () => {
  const recovered = recoverInterruptedRender({ id: "gone", render: { status: "rendering", startedAt: 123, progress: 40 } });
  assert.equal(recovered.render.status, "error");
  assert.equal(recovered.render.startedAt, 123);
});
