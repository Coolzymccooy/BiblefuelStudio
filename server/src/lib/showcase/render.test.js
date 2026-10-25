import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderShowcase, finishPlanOf, encodeFor, showcaseProps } from "./render.js";
import { directShowcase } from "./director.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-render-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const grid = { kind: "beats", marks: Array.from({ length: 100 }, (_, i) => ({ t: Math.round((i + 1) * 0.6 * 1000) / 1000, downbeat: i % 4 === 3, strong: false })), period: 0.6 };
const plan = (over = {}) => directShowcase({
  photos: Array.from({ length: 6 }, () => ({ shape: "tall" })), heroIndex: 0, grid, title: "Men Hangout", statements: ["One", "Two", "We meet again"],
  styleId: "premiere", energy: 0.5, lengthSec: 30, seed: 2, shape: "wide", details: { date: "21 November" }, ...over,
}).plan;
const images = Array.from({ length: 6 }, (_, i) => ({ card: path.join(tmp, `c${i}.jpg`), blur: path.join(tmp, `b${i}.jpg`), shape: "tall" }));

/** Fakes for ffmpeg, Remotion and the asset server, recording what they were asked. */
function fakes({ renderThrows = null, finishFails = false } = {}) {
  const calls = { ffmpeg: [], render: [], closed: 0, files: null };
  const runner = async (args, { onStdout } = {}) => {
    calls.ffmpeg.push(args);
    if (finishFails) return { ok: false, code: 1, stderr: "boom" };
    onStdout?.("out_time_us=15000000");
    fs.writeFileSync(args.at(-1), "video");
    return { ok: true, code: 0, stderr: "" };
  };
  const remotion = {
    serveUrl: async () => "http://bundle",
    render: async (opts) => {
      calls.render.push(opts);
      if (renderThrows) throw renderThrows;
      opts.onProgress?.(0.5);
      fs.writeFileSync(opts.outputLocation, "body");
    },
  };
  const startServer = async (files) => {
    calls.files = files;
    return { url: (n) => `http://127.0.0.1:1/${n}`, close: async () => { calls.closed += 1; } };
  };
  return { calls, deps: { runner, remotion, startServer, libass: true } };
}

const work = () => fs.mkdtempSync(path.join(tmp, "w-"));

test("encodeFor caps the bitrate only past 60 s", () => {
  assert.deepEqual(encodeFor(60), { crf: 19 });
  assert.deepEqual(encodeFor(61), { crf: 21, maxrate: "8M", bufsize: "16M" });
  assert.deepEqual(encodeFor(180), { crf: 21, maxrate: "8M", bufsize: "16M" });
});

test("the finish plan darkens the closing scene and carries the captions", () => {
  const p = plan();
  const f = finishPlanOf(p);
  assert.deepEqual(f.shots, [{ role: "end", start: p.scenes.at(-1).start, overlays: [] }]);
  assert.equal(f.captions, p.captions);
  assert.deepEqual([f.w, f.h, f.fps, f.durationSec, f.style, f.seed], [1920, 1080, 30, 30, "premiere", 2]);
});

test("the composition's props name each staged image by URL and carry the style's palette", () => {
  const p = plan();
  const props = showcaseProps(p, images, (n) => `u/${n}`);
  assert.equal(props.images.length, 6);
  assert.deepEqual(props.images[2], { card: "u/card-2.jpg", blur: "u/blur-2.jpg", shape: "tall" });
  assert.equal(props.fonts.display, "u/display.ttf");
  assert.equal(props.letterbox, true);
  assert.equal(props.palette.backdrop, "dark");
  assert.deepEqual(props.invite, { day: 21, label: "NOV" });
  assert.equal(props.scenes, p.scenes);
});

test("renders the picture with MomentShowcase, then finishes it into place", async () => {
  const { calls, deps } = fakes();
  const out = path.join(tmp, "out.mp4");
  const progress = [];
  const r = await renderShowcase({ plan: plan(), images, song: { file: "song.mp3", startSec: 20 }, voice: null, workDir: work(), out, onProgress: (p) => progress.push(p), ...deps });
  assert.deepEqual(r, { ok: true, file: out });
  assert.equal(fs.readFileSync(out, "utf8"), "video");
  assert.equal(calls.render[0].compositionId, "MomentShowcase");
  assert.equal(calls.render[0].inputProps.images.length, 6);
  assert.ok(Object.keys(calls.files).includes("card-5.jpg") && Object.keys(calls.files).includes("display.ttf"));
  const finish = calls.ffmpeg.at(-1);
  assert.ok(finish.includes(calls.render[0].outputLocation), "the finish reads the picture");
  assert.ok(finish.includes("song.mp3"));
  assert.ok(progress.some((p) => p.stage === "shots" && p.fraction === 0.5));
  assert.deepEqual(progress.at(-1), { stage: "finish", fraction: 1 });
  assert.equal(calls.closed, 1);
});

test("a long Moment's finish carries the bitrate cap", async () => {
  const { calls, deps } = fakes();
  await renderShowcase({ plan: plan({ lengthSec: 120, photos: Array.from({ length: 6 }, () => ({ shape: "tall" })) }), images, song: null, voice: null, workDir: work(), out: path.join(tmp, "long.mp4"), ...deps });
  assert.ok(calls.ffmpeg.at(-1).includes("-maxrate"));
});

test("a picture that fails reads as a friendly error, and the asset server still closes", async () => {
  const { calls, deps } = fakes({ renderThrows: new Error("Chrome crashed") });
  const r = await renderShowcase({ plan: plan(), images, song: null, voice: null, workDir: work(), out: path.join(tmp, "x.mp4"), ...deps });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Rendering failed at the picture.");
  assert.match(r.detail, /Chrome crashed/);
  assert.equal(calls.closed, 1);
  assert.equal(calls.ffmpeg.length, 0);
});

test("a cancel before or during the picture reads as cancelled", async () => {
  const before = new AbortController();
  before.abort();
  const { deps } = fakes();
  assert.deepEqual(await renderShowcase({ plan: plan(), images, song: null, voice: null, workDir: work(), out: path.join(tmp, "c.mp4"), signal: before.signal, ...deps }), { ok: false, error: "cancelled" });
  const during = new AbortController();
  const { calls, deps: d2 } = fakes({ renderThrows: new Error("renderMedia() got cancelled") });
  d2.remotion.render = async (opts) => { calls.render.push(opts); during.abort(); throw new Error("cancelled"); };
  const r = await renderShowcase({ plan: plan(), images, song: null, voice: null, workDir: work(), out: path.join(tmp, "c2.mp4"), signal: during.signal, ...d2 });
  assert.deepEqual(r, { ok: false, error: "cancelled" });
  assert.equal(calls.closed, 1);
});

test("a failed finish leaves nothing at out", async () => {
  const { deps } = fakes({ finishFails: true });
  const out = path.join(tmp, "never.mp4");
  const r = await renderShowcase({ plan: plan(), images, song: null, voice: null, workDir: work(), out, ...deps });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Rendering failed at the finishing pass.");
  assert.equal(fs.existsSync(out), false);
});

test("captions need libass", async () => {
  const { deps } = fakes();
  const r = await renderShowcase({ plan: plan(), images, song: null, voice: null, workDir: work(), out: path.join(tmp, "l.mp4"), ...deps, libass: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /libass/);
});
