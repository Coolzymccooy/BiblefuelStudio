import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { projectFromMarkdown } from "./model.js";
import { withTimeline } from "./voiceStage.js";
import { createProject, readProject, updateProject, projectOutputDir } from "./projectStore.js";
import { startRender, isRendering, cancelRender, recoverInterruptedRender, COMPOSITION_ID } from "./renderStage.js";
import { addClip } from "../visualLibrary/store.js";
import { onRenderFailure } from "../ops/renderFailures.js";

/**
 * Pins Scene script's render behaviour (it shares its lifecycle with
 * Cartoon): the composition it renders, the file it writes, how failures and
 * cancels are recorded, and that it does not (yet) delete a previous render.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

async function until(fn) {
  for (let i = 0; i < 400 && fn(); i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("scene script render stage", () => {
  let root;
  let ctx;
  let calls;
  let failures;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "scene-render-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    calls = { ffmpeg: [], render: [] };
    failures = [];
    onRenderFailure((f) => failures.push(f));
  });

  afterEach(() => {
    onRenderFailure(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function voicedProject() {
    const p = projectFromMarkdown(fs.readFileSync(path.join(here, "__fixtures__", "grace-made-me.md"), "utf8"));
    const lines = p.lines.map((l) => ({ ...l, audio: { file: `line-${l.id}.wav`, durationSec: 2, words: [{ text: "w", start: 0, end: 0.4 }] } }));
    const shots = p.shots.map((s, i) => {
      const file = path.join(root, `clip-${i}.mp4`);
      fs.writeFileSync(file, "mp4");
      const clip = addClip(ctx, { file, prompt: `shot ${i}`, durationSec: 8 });
      return { ...s, clip: { status: "done", libraryId: clip.id, url: clip.url, durationSec: 8 } };
    });
    return createProject(ctx.dataDir, withTimeline({ ...p, lines, shots, voice: { status: "done" } }));
  }

  const deps = (over = {}) => ({
    ffmpeg: async (args) => {
      calls.ffmpeg.push(args);
      if (args.at(-1) === "-") return { ok: true, stderr: "" };
      fs.writeFileSync(args.at(-1), "media");
      return { ok: true, stderr: "" };
    },
    probe: async () => 88,
    serveUrl: async () => "http://bundle.invalid",
    render: async (args) => {
      calls.render.push(args);
      fs.writeFileSync(args.outputLocation, "raw");
    },
    ...over,
  });

  test("renders the SceneScript composition to <slug>-<id8>.mp4 and keeps an older file", async () => {
    const p = voicedProject();
    const outDir = projectOutputDir(ctx.outputDir, p.id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "old-title-12345678.mp4"), "old");
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, render: { status: "done", file: "old-title-12345678.mp4" } }));

    const marked = startRender(ctx, p.id, { deps: deps() });
    assert.deepEqual(Object.keys(marked.render).sort(), ["error", "progress", "startedAt", "status"]);
    assert.equal(startRender(ctx, p.id, { deps: deps() }), null);
    await until(() => isRendering(p.id));

    const done = readProject(ctx.dataDir, p.id).render;
    const name = `grace-made-me-${p.id.slice(0, 8)}.mp4`;
    assert.equal(done.status, "done", JSON.stringify(done));
    assert.equal(done.file, name);
    assert.equal(done.url, `/outputs/scene-scripts/${p.id}/${name}`);
    assert.equal(done.durationSec, 88);
    assert.equal(done.progress, 100);
    assert.ok(fs.existsSync(path.join(outDir, name)));
    // Issue #123: Scene script does not remove a previous render yet.
    assert.ok(fs.existsSync(path.join(outDir, "old-title-12345678.mp4")));
    assert.equal(fs.existsSync(path.join(outDir, "stage")), false);
    assert.deepEqual(fs.readdirSync(outDir).sort(), [name, "old-title-12345678.mp4"].sort(), "no temp files left");

    assert.equal(calls.render.length, 1);
    assert.equal(calls.render[0].compositionId ?? COMPOSITION_ID, "SceneScript");
    assert.equal(calls.render[0].inputProps.title, "Grace Made Me");
    assert.ok(calls.ffmpeg.some((a) => a.some((x) => /loudnorm=I=-14/.test(x))));
  });

  test("a failed render is an error and is reported; a cancel is not", async () => {
    const p = voicedProject();
    startRender(ctx, p.id, { deps: deps({ render: async () => { throw new Error("chrome crashed"); } }) });
    await until(() => isRendering(p.id));
    const failed = readProject(ctx.dataDir, p.id).render;
    assert.deepEqual({ status: failed.status, error: failed.error, progress: failed.progress }, { status: "error", error: "chrome crashed", progress: 0 });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].kind, "scene-script");

    startRender(ctx, p.id, { deps: deps() });
    cancelRender(p.id);
    await until(() => isRendering(p.id));
    assert.equal(readProject(ctx.dataDir, p.id).render.status, "cancelled");
    assert.equal(failures.length, 1);
  });

  test("a failed finish leaves no partial file behind", async () => {
    const p = voicedProject();
    const failing = deps({
      ffmpeg: async (args) => {
        calls.ffmpeg.push(args);
        if (args.at(-1) === "-") return { ok: true, stderr: "" };
        fs.writeFileSync(args.at(-1), "partial");
        return args.includes("-c:v") && args.includes("copy") ? { ok: false, stderr: "disk full" } : { ok: true, stderr: "" };
      },
    });
    startRender(ctx, p.id, { deps: failing });
    await until(() => isRendering(p.id));
    assert.equal(readProject(ctx.dataDir, p.id).render.status, "error");
    assert.deepEqual(fs.readdirSync(projectOutputDir(ctx.outputDir, p.id)), []);
  });

  test("a render left running by a restart shows as stopped", () => {
    const r = recoverInterruptedRender({ id: "x", render: { status: "rendering" } });
    assert.equal(r.render.status, "error");
    assert.match(r.render.error, /restart/);
  });

  // From master (a6a54d02): the agent's scene handle reads when a run started and ended.
  test("a failed render keeps when it started and records when it ended", async () => {
    const p = voicedProject();
    const marked = startRender(ctx, p.id, { deps: deps({ render: async () => { throw new Error("no renderer"); } }) });
    const startedAt = marked.render.startedAt;
    await until(() => isRendering(p.id));
    const render = readProject(ctx.dataDir, p.id).render;
    assert.equal(render.status, "error");
    assert.equal(render.startedAt, startedAt);
    assert.ok(render.finishedAt >= startedAt);
  });

  test("a render a restart interrupted keeps when it started", () => {
    const recovered = recoverInterruptedRender({ id: "gone", render: { status: "rendering", startedAt: 123, progress: 40 } });
    assert.equal(recovered.render.status, "error");
    assert.equal(recovered.render.startedAt, 123);
  });
});
