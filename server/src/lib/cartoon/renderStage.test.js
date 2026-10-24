import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, updateProject, projectOutputDir } from "./store.js";
import { cartoonFromScript } from "./model.js";
import {
  startCartoonRender, isRenderingCartoon, cancelCartoonRender, cartoonRenderBlockers, cartoonRenderWarnings,
  recoverInterruptedCartoonRender, COMPOSITION_ID,
} from "./renderStage.js";
import { addClip } from "../visualLibrary/store.js";

const SCRIPT = `# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, curly dark hair. Voice: bright and eager.
- Pip: a small fluffy white lamb with one black ear. Voice: tiny and soft.

Scene: A rocky hillside at dusk
Eli: "Pip? Pip, where are you?"
Pip: "I'm stuck, Eli!"

Scene: Behind the rock, close-up
(Eli lifts Pip free of the thorns.)
Eli: "I came for you."
`;

const LOUDNESS = `[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-19.40",
	"input_tp" : "-3.10",
	"input_lra" : "5.20",
	"input_thresh" : "-29.60",
	"output_i" : "-14.00",
	"output_tp" : "-1.00",
	"output_lra" : "4.90",
	"output_thresh" : "-24.10",
	"normalization_type" : "dynamic",
	"target_offset" : "0.10"
}`;

async function until(fn) {
  for (let i = 0; i < 400 && fn(); i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("cartoon render stage", () => {
  let root;
  let ctx;
  let calls;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-render-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    calls = { ffmpeg: [], render: [] };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** A library clip with a real file behind it. */
  function libraryClip(name) {
    const file = path.join(root, `${name}.mp4`);
    fs.writeFileSync(file, `mp4-${name}`);
    return addClip(ctx, { file, prompt: name, durationSec: 4, source: { kind: "cartoon" } });
  }

  /** The Lost Lamb with every shot filmed (or only the first `filmedCount`). */
  function filmedCartoon({ filmedCount = Infinity, seconds } = {}) {
    const fields = cartoonFromScript(SCRIPT);
    const shots = fields.shots.map((s, i) => {
      const planned = seconds ?? s.seconds;
      if (i >= filmedCount) return { ...s, seconds: planned };
      const clip = libraryClip(`clip-${i}`);
      return {
        ...s,
        seconds: planned,
        clip: { status: "done", libraryId: clip.id, url: clip.url, durationSec: planned, windows: [{ from: 0.4, to: 1.8 }], speech: null, stale: false },
      };
    });
    return createProject(ctx.dataDir, { ...fields, shots, endCard: { text: "He came for you." } });
  }

  const deps = (over = {}) => ({
    ffmpeg: async (args) => {
      calls.ffmpeg.push(args);
      if (args.at(-1) === "-") return { ok: true, stderr: LOUDNESS };
      fs.writeFileSync(args.at(-1), "media");
      return { ok: true, stderr: "" };
    },
    probe: async () => 21.5,
    serveUrl: async () => "http://bundle.invalid",
    render: async (args) => {
      calls.render.push(args);
      args.onProgress?.(0.5);
      fs.writeFileSync(args.outputLocation, "raw");
    },
    ...over,
  });

  test("blockers name missing clips and a too-long film", () => {
    const partial = filmedCartoon({ filmedCount: 2 });
    const blockers = cartoonRenderBlockers(ctx, partial);
    assert.ok(blockers.some((b) => /2 shots have no clip yet/.test(b)), JSON.stringify(blockers));

    const long = filmedCartoon({ seconds: 12 });
    const tooLong = cartoonRenderBlockers(ctx, long);
    assert.ok(tooLong.some((b) => /40 s/.test(b)), JSON.stringify(tooLong));

    const ready = filmedCartoon();
    assert.deepEqual(cartoonRenderBlockers(ctx, ready), []);
  });

  test("a clip removed from the library or an unplayable bed blocks the render", () => {
    const p = filmedCartoon();
    const lost = { ...p, shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip: { ...s.clip, libraryId: "00000000-0000-4000-8000-000000000000" } } : s)) };
    assert.ok(cartoonRenderBlockers(ctx, lost).some((b) => /removed from the library/.test(b)));
    const badBed = { ...p, music: { bed: "mylib:gone" } };
    assert.ok(cartoonRenderBlockers(ctx, badBed).some((b) => /music bed/i.test(b)));
    assert.deepEqual(cartoonRenderBlockers(ctx, { ...p, music: { bed: null } }), []);
  });

  test("a stale shot is a warning, not a blocker", () => {
    const p = filmedCartoon();
    const stale = { ...p, shots: p.shots.map((s, i) => (i === 1 ? { ...s, clip: { ...s.clip, stale: true } } : s)) };
    assert.deepEqual(cartoonRenderBlockers(ctx, stale), []);
    const warnings = cartoonRenderWarnings(stale);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Shot 2/);
  });

  test("render stage renders composition Cartoon and finishes at -14 LUFS", async () => {
    const p = filmedCartoon();
    const outDir = projectOutputDir(ctx.outputDir, p.id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "old-title-12345678.mp4"), "old");
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, render: { status: "done", file: "old-title-12345678.mp4" } }));

    const marked = startCartoonRender(ctx, p.id, { deps: deps() });
    assert.equal(marked.render.status, "queued");
    assert.equal(isRenderingCartoon(p.id), true);
    assert.equal(startCartoonRender(ctx, p.id, { deps: deps() }), null, "a second start is refused");
    await until(() => isRenderingCartoon(p.id));

    const done = readProject(ctx.dataDir, p.id);
    assert.equal(done.render.status, "done", JSON.stringify(done.render));
    const name = `the-lost-lamb-${p.id.slice(0, 8)}.mp4`;
    assert.equal(done.render.file, name);
    assert.equal(done.render.url, `/outputs/cartoons/${p.id}/${name}`);
    assert.equal(done.render.durationSec, 21.5);
    assert.ok(fs.existsSync(path.join(outDir, name)));
    assert.equal(fs.existsSync(path.join(outDir, "old-title-12345678.mp4")), false, "the previous render goes once the new one is safe");
    assert.equal(fs.existsSync(path.join(outDir, "stage")), false, "the stage is cleaned up");

    assert.equal(calls.render.length, 1);
    const call = calls.render[0];
    assert.equal(call.compositionId, COMPOSITION_ID);
    assert.equal(COMPOSITION_ID, "Cartoon");
    assert.equal(call.inputProps.shots.length, 4);
    assert.match(call.inputProps.shots[0].src, /^http:\/\/127\.0\.0\.1:\d+\/clip-sh1\.mp4$/);
    assert.ok(call.inputProps.bed, "the default bed is staged");
    assert.match(call.inputProps.bed.src, /bed\.wav$/);
    assert.equal(call.inputProps.endCard.text, "He came for you.");

    const bedCut = calls.ffmpeg.find((a) => a.includes("-stream_loop"));
    assert.ok(bedCut, "the bed is cut to the film's length");
    assert.equal(bedCut[bedCut.indexOf("-t") + 1], call.inputProps.total.toFixed(3));
    const measured = calls.ffmpeg.find((a) => a.at(-1) === "-" && a.some((x) => /loudnorm=I=-14/.test(x)));
    assert.ok(measured, "loudness is measured");
    const normalised = calls.ffmpeg.find((a) => a.some((x) => /loudnorm=I=-14:.*measured_I=-19\.40/.test(x)));
    assert.ok(normalised, "the second pass applies the measured loudness");
  });

  test("no bed renders without music", async () => {
    const p = filmedCartoon();
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, music: { bed: null } }));
    startCartoonRender(ctx, p.id, { deps: deps() });
    await until(() => isRenderingCartoon(p.id));
    assert.equal(readProject(ctx.dataDir, p.id).render.status, "done");
    assert.equal(calls.render[0].inputProps.bed, null);
    assert.equal(calls.ffmpeg.some((a) => a.includes("-stream_loop")), false);
  });

  test("a failed render is recorded with its reason; a cancelled one is not an error", async () => {
    const p = filmedCartoon();
    startCartoonRender(ctx, p.id, { deps: deps({ render: async () => { throw new Error("chrome crashed"); } }) });
    await until(() => isRenderingCartoon(p.id));
    const failed = readProject(ctx.dataDir, p.id).render;
    assert.equal(failed.status, "error");
    assert.match(failed.error, /chrome crashed/);

    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = deps({
      render: async ({ signal }) => {
        await gate;
        if (signal.aborted) throw new Error("cancelled");
      },
    });
    startCartoonRender(ctx, p.id, { deps: slow });
    assert.equal(cancelCartoonRender(p.id), true);
    release();
    await until(() => isRenderingCartoon(p.id));
    assert.equal(readProject(ctx.dataDir, p.id).render.status, "cancelled");
    assert.equal(cancelCartoonRender(p.id), false, "nothing left to stop");
  });

  test("a render left running by a restart shows as stopped", () => {
    const p = { id: "c0ffee00-0000-4000-8000-000000000001", render: { status: "rendering", progress: 40 } };
    const recovered = recoverInterruptedCartoonRender(p);
    assert.equal(recovered.render.status, "error");
    assert.match(recovered.render.error, /restart/);
    const idle = { id: p.id, render: { status: "done" } };
    assert.equal(recoverInterruptedCartoonRender(idle), idle);
  });
});
