import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shotGraph, shotArgs, lastFrameArgs } from "./shotArgs.js";
import { ffmpegAvailable, FFMPEG } from "./testkit.js";
import { workImageArgs } from "./prepare.js";
import { getEffect } from "./effects/index.js";

const shot = (over = {}) => ({
  start: 1, end: 1.6, photo: 0, role: "body", move: { id: "push", intensity: 0.6 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 }, ...over,
});

test("the graph runs move, then overlays, then entrance, then trims to the frame count", () => {
  const g = shotGraph({ shot: shot({ entrance: { id: "flash" }, overlays: [{ id: "lightLeak" }] }), w: 1080, h: 1920, fps: 30, hasPrev: false });
  const iMove = g.indexOf("zoompan");
  const iLeak = g.indexOf("blend=all_mode=screen");
  const iFlash = g.indexOf("fade=t=in");
  assert.ok(iMove >= 0 && iMove < iLeak && iLeak < iFlash, g);
  assert.match(g, /format=yuv420p,trim=end_frame=18,setpts=N\/30\/TB\[v\]$/);
});

test("ASS overlays add nothing to the shot graph (the finish stage draws them)", () => {
  const g = shotGraph({ shot: shot({ overlays: [{ id: "sparkles" }] }), w: 1080, h: 1920, fps: 30, hasPrev: false });
  assert.ok(!g.includes("sparkles"));
  assert.equal(g, shotGraph({ shot: shot(), w: 1080, h: 1920, fps: 30, hasPrev: false }));
});

test("labels never collide between the move, the overlays and the entrance", () => {
  const g = shotGraph({
    shot: shot({ move: { id: "split3", intensity: 0.5 }, entrance: { id: "glitch" }, overlays: [{ id: "lightLeak" }, { id: "viewfinder" }] }),
    w: 1080, h: 1920, fps: 30, hasPrev: false,
  });
  // Every label is produced once and consumed once, so a collision shows as a count above 2.
  const counts = new Map();
  for (const m of g.matchAll(/\[([^\]]+)\]/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  for (const [label, n] of counts) {
    const external = label === "0:v" || label === "v";
    assert.equal(n, external ? 1 : 2, `label [${label}] used ${n} times`);
  }
});

test("a crossfade with no previous frame never reads input 1", () => {
  const g = shotGraph({ shot: shot({ entrance: { id: "crossfade" } }), w: 1080, h: 1920, fps: 30, hasPrev: false });
  assert.ok(!g.includes("[1:v]"), g);
});

test("shotArgs writes the graph to a script file and reads the previous frame only for a crossfade", () => {
  const plain = shotArgs({ shot: shot(), index: 3, workImage: "w.jpg", prevFrame: "last.png", out: "s.mp4", w: 1080, h: 1920, fps: 30, workDir: "wd" });
  assert.equal(plain.args.filter((a) => a === "-i").length, 1, "no previous frame without a crossfade");
  assert.equal(plain.args[plain.args.indexOf("-filter_complex_script") + 1], path.join("wd", "shot-3.txt"));
  assert.equal(plain.sideFiles[0].path, path.join("wd", "shot-3.txt"));
  assert.ok(!plain.args.includes("-filter_complex"));
  assert.ok(!plain.args.includes("-loop"), "the working image is fed as a single frame");
  assert.deepEqual(plain.args.slice(plain.args.indexOf("-frames:v"), plain.args.indexOf("-frames:v") + 2), ["-frames:v", "18"]);
  const xf = shotArgs({ shot: shot({ entrance: { id: "crossfade" } }), index: 3, workImage: "w.jpg", prevFrame: "last.png", out: "s.mp4", w: 1080, h: 1920, fps: 30, workDir: "wd" });
  assert.equal(xf.args.filter((a) => a === "-i").length, 2);
  assert.match(xf.sideFiles[0].text, /\[1:v\]scale=/);
  const first = shotArgs({ shot: shot({ entrance: { id: "crossfade" } }), index: 0, workImage: "w.jpg", prevFrame: null, out: "s.mp4", w: 1080, h: 1920, fps: 30, workDir: "wd" });
  assert.equal(first.args.filter((a) => a === "-i").length, 1, "the first shot has no previous frame to blend from");
});

test("lastFrameArgs grabs the final frame as a still", () => {
  const a = lastFrameArgs("s.mp4", "last.png");
  assert.ok(a.includes("-sseof") && a.includes("s.mp4") && a.at(-1) === "last.png");
});

// Every effect's graph must actually run in ffmpeg, from a real working image.
const skip = ffmpegAvailable() ? false : "ffmpeg not available";
const W = 1080;
const H = 1920;
const FPS = 30;
const FRAMES = 15;
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");

function run(args) {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}`);
}

function probe(file) {
  const r = spawnSync(FFPROBE, [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,profile,pix_fmt,color_range,color_space,color_transfer,color_primaries,width,height,time_base,r_frame_rate,sample_aspect_ratio,nb_read_frames",
    "-show_entries", "format=nb_streams", "-of", "json", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, String(r.stderr));
  const j = JSON.parse(r.stdout);
  return { ...j.streams[0], nb_streams: j.format.nb_streams };
}

/** A real working image, made the way the preparation stage makes it. */
function workingImage(dir, name, srcSize, width, height) {
  const src = path.join(dir, `${name}-src.jpg`);
  run(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=${srcSize}:d=1`, "-frames:v", "1", src]);
  const out = path.join(dir, `${name}-work.jpg`);
  const { shape, args } = workImageArgs({ src, out, width, height, orientation: 1 });
  run(args);
  return { path: out, shape };
}

const KEYS = ["codec_name", "profile", "pix_fmt", "color_range", "color_space", "color_transfer", "color_primaries", "width", "height", "time_base", "r_frame_rate", "sample_aspect_ratio", "nb_read_frames", "nb_streams"];

function renderClip(fx, image, s, label) {
  const out = path.join(fx.dir, `clip-${fx.n += 1}.mp4`);
  const { args, sideFiles } = shotArgs({ shot: s, index: fx.n, workImage: image, prevFrame: fx.prev, out, w: W, h: H, fps: FPS, workDir: fx.dir });
  for (const f of sideFiles) fs.writeFileSync(f.path, f.text);
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  assert.equal(r.status, 0, `${label}\n${r.stderr}`);
  const p = probe(out);
  assert.equal(Number(p.nb_read_frames), FRAMES, `${label}: frame count`);
  assert.equal(`${p.width}x${p.height}`, `${W}x${H}`, `${label}: size`);
  assert.equal(p.pix_fmt, "yuv420p", `${label}: pix_fmt`);
  assert.equal(p.nb_streams, 1, `${label}: no audio`);
  return { label, out, params: Object.fromEntries(KEYS.map((k) => [k, p[k]])) };
}

function assertConcatSafe(clips) {
  const ref = clips[0];
  for (const c of clips) {
    for (const k of ["codec_name", "profile", "pix_fmt", "color_range", "color_space", "color_transfer", "color_primaries", "width", "height", "time_base", "r_frame_rate", "sample_aspect_ratio"]) {
      assert.equal(c.params[k], ref.params[k], `${c.label} differs from ${ref.label} on ${k}`);
    }
  }
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-shot-"));
  const tall = workingImage(dir, "tall", "1200x1600", 1200, 1600);
  const wide = workingImage(dir, "wide", "1920x1080", 1920, 1080);
  assert.equal(tall.shape, "tall");
  assert.equal(wide.shape, "wide");
  const prev = path.join(dir, "prev.png");
  run(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=s=${W}x${H}:d=1`, "-frames:v", "1", prev]);
  return { dir, tall: tall.path, wide: wide.path, prev, n: 0 };
}

const MOVES = ["push", "punch", "shake", "still", "pan", "split2", "split3"];
const ENTRANCES = [
  { id: "cut", prev: true },
  { id: "flash", prev: true },
  { id: "crossfade", prev: true },
  { id: "crossfade", prev: false },
];
const DUR = FRAMES / FPS;
const matrixShot = (move, entrance, overlays = []) => shot({
  start: 0, end: DUR, move: { id: move, intensity: 0.7 }, entrance: { id: entrance }, overlays: overlays.map((id) => ({ id })),
});

test("every move x entrance renders to an identical clip format in real ffmpeg", { skip, timeout: 600000 }, () => {
  const fx = fixture();
  try {
    const clips = [];
    for (const [shape, image] of [["tall", fx.tall], ["wide", fx.wide]]) {
      for (const m of MOVES) {
        if (!getEffect(m).shapes.includes(shape)) continue;
        for (const e of ENTRANCES) {
          fx.prev = e.prev ? path.join(fx.dir, "prev.png") : null;
          clips.push(renderClip(fx, image, matrixShot(m, e.id), `${shape} ${m} ${e.id}${e.prev ? "" : " (no prev)"}`));
        }
      }
    }
    fx.prev = path.join(fx.dir, "prev.png");
    for (const e of ["whip", "glitch"]) clips.push(renderClip(fx, fx.tall, matrixShot("push", e), `tall push ${e}`));
    assertConcatSafe(clips);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("each overlay renders on push, and ASS overlays are skipped cleanly", { skip, timeout: 600000 }, () => {
  const fx = fixture();
  try {
    const clips = [renderClip(fx, fx.tall, matrixShot("push", "cut"), "tall push cut (baseline)")];
    for (const o of ["lightLeak", "viewfinder", "sparkles", "doodles", "rayBurst"]) {
      clips.push(renderClip(fx, fx.tall, matrixShot("push", "cut", [o]), `tall push cut + ${o}`));
    }
    clips.push(renderClip(fx, fx.tall, matrixShot("push", "crossfade", ["lightLeak", "viewfinder"]), "tall push crossfade + lightLeak + viewfinder"));
    assertConcatSafe(clips);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("lastFrameArgs makes a still the next shot's crossfade can read, and clips concat with -c copy", { skip, timeout: 600000 }, () => {
  const fx = fixture();
  try {
    const a = renderClip(fx, fx.tall, matrixShot("push", "cut"), "first");
    const still = path.join(fx.dir, "last.png");
    run(lastFrameArgs(a.out, still));
    assert.ok(fs.statSync(still).size > 0);
    fx.prev = still;
    const b = renderClip(fx, fx.wide, matrixShot("pan", "crossfade"), "second");
    const list = path.join(fx.dir, "list.txt");
    fs.writeFileSync(list, [a.out, b.out].map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    const joined = path.join(fx.dir, "joined.mp4");
    run(["-hide_banner", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
    assert.equal(Number(probe(joined).nb_read_frames), FRAMES * 2);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});
