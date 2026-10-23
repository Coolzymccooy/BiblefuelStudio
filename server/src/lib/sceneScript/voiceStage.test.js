import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, updateProject } from "./projectStore.js";
import { startVoicing, isVoicing, recoverInterruptedVoicing } from "./voiceStage.js";
import { projectFromMarkdown } from "./model.js";

const SCRIPT = [
  "### Scene 1 — Opening (0:00–0:10)",
  "*Visual: A river at dawn.*",
  "**Narrator:**",
  "\"Be still.\"",
  "\"**AND KNOW.**\"",
  "### Scene 2 — Answer (0:10–0:20)",
  "*Visual: A mountain.*",
  "**Scripture:**",
  "'I am God.'",
  "## What would make this especially powerful?",
  "An ensemble of adults and children can softly repeat:",
  "> \"Be still.\"",
].join("\n");

function fakeDeps({ failText } = {}) {
  const calls = { synth: [], ffmpeg: [] };
  return {
    calls,
    deps: {
      sleep: async () => {},
      synth: async ({ ssml }) => {
        calls.synth.push(ssml);
        if (failText && ssml.includes(failText)) throw new Error("Azure synthesis failed: boom");
        return { audio: Buffer.from("RIFFfake"), boundaries: [{ text: "Be", audioOffsetTicks: 1e6, durationTicks: 2e6, boundaryType: "Word" }, { text: "still", audioOffsetTicks: 3e6, durationTicks: 3e6, boundaryType: "Word" }] };
      },
      ffmpeg: async (args) => {
        calls.ffmpeg.push(args);
        fs.writeFileSync(args.at(-1), "wav");
        return { ok: true };
      },
      probe: async () => 1.5,
    },
  };
}

async function waitDone(ctx, id) {
  for (let i = 0; i < 200 && isVoicing(id); i += 1) await new Promise((r) => setTimeout(r, 5));
  return readProject(ctx.dataDir, id);
}

describe("startVoicing", () => {
  let ctx;
  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-voice-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
  });
  afterEach(() => fs.rmSync(path.dirname(ctx.dataDir), { recursive: true, force: true }));

  test("voices every line, mixes the chant from every ensemble voice and builds the timeline", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const { deps, calls } = fakeDeps();
    assert.ok(startVoicing(ctx, project.id, { deps }));
    const done = await waitDone(ctx, project.id);
    assert.equal(done.voice.status, "done");
    assert.ok(done.lines.every((l) => l.audio && l.audio.durationSec === 1.5));
    const chants = done.lines.filter((l) => l.kind === "chant").length;
    const layers = done.cast.Ensemble.ensemble.length;
    assert.equal(calls.synth.length, done.lines.length - chants + chants * layers);
    assert.ok(done.timeline.total > 0);
    assert.deepEqual(done.lines[0].audio.words.map((w) => w.text), ["Be", "still."]);
    assert.match(done.lines[0].audio.url, new RegExp(`^/outputs/scene-scripts/${done.id}/voice/l1-`));
  });

  test("sends capitals in sentence case and the scripture in its own voice", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const { deps, calls } = fakeDeps();
    startVoicing(ctx, project.id, { deps });
    await waitDone(ctx, project.id);
    assert.ok(calls.synth.some((x) => x.includes(">And know.<")));
    assert.ok(calls.synth.some((x) => x.includes("Ava") && x.includes("I am God.")));
  });

  test("re-voices only the line whose words changed", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const first = fakeDeps();
    startVoicing(ctx, project.id, { deps: first.deps });
    await waitDone(ctx, project.id);
    updateProject(ctx.dataDir, project.id, (p) => ({ ...p, lines: p.lines.map((l) => (l.id === "l1" ? { ...l, text: "Be very still." } : l)) }));
    const second = fakeDeps();
    startVoicing(ctx, project.id, { deps: second.deps });
    const done = await waitDone(ctx, project.id);
    assert.equal(second.calls.synth.length, 1);
    assert.match(second.calls.synth[0], /Be very still\./);
    assert.equal(done.voice.status, "done");
  });

  test("records a failed line and reports the run as failed", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const { deps } = fakeDeps({ failText: "I am God." });
    startVoicing(ctx, project.id, { deps });
    const done = await waitDone(ctx, project.id);
    assert.equal(done.voice.status, "error");
    const line = done.lines.find((l) => l.text === "I am God.");
    assert.match(line.audioError, /boom/);
    assert.equal(line.audio, null);
  });

  test("refuses a second run while one is going", () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const { deps } = fakeDeps();
    assert.ok(startVoicing(ctx, project.id, { deps }));
    assert.equal(startVoicing(ctx, project.id, { deps }), null);
  });

  test("a run left running by a restart can be started again", () => {
    const stale = recoverInterruptedVoicing({ id: "x", voice: { status: "running" } });
    assert.equal(stale.voice.status, "error");
  });
});
