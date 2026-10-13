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
import { frameCount } from "./effects/common.js";

const shot = (over = {}) => ({
  start: 1, end: 1.6, photo: 0, role: "body", move: { id: "push", intensity: 0.6 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 }, ...over,
});

test("the graph runs move, then overlays, then entrance, then trims to the frame count", () => {
  const g = shotGraph({ shot: shot({ entrance: { id: "flash" }, overlays: [{ id: "lightLeak" }] }), w: 1080, h: 1920, fps: 30, hasPrev: false });
  const iMove = g.indexOf("zoompan");
  const iLeak = g.indexOf("blend=all_mode=screen");
  const iFlash = g.indexOf("fade=t=in");
  assert.ok(iMove >= 0 && iMove < iLeak && iLeak < iFlash, g);
  assert.match(g, /format=yuv420p,setparams=range=tv:colorspace=bt470bg,trim=end_frame=18,setpts=N\/30\/TB\[v\]$/);
});

test("every clip is tagged limited-range BT.601 in its frames, whatever path made it", () => {
  // ffmpeg 5.1 (production) does not carry these tags through every move: a tall push came out
  // untagged while a wide pan was tv/bt470bg, so the clips no longer matched for the join.
  for (const over of [{}, { move: { id: "pan", intensity: 0.5 } }, { entrance: { id: "flash" } }, { overlays: [{ id: "lightLeak" }] }]) {
    for (const hasPrev of [false, true]) {
      const g = shotGraph({ shot: shot(over), w: 1080, h: 1920, fps: 30, hasPrev });
      const last = g.split(";").at(-1);
      assert.match(last, /,setparams=range=tv:colorspace=bt470bg,trim=end_frame=/, last);
    }
  }
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
  assert.ok(a.includes("-update") && !a.includes("-frames:v"), "every frame after the seek overwrites the still, so the last one wins");
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
  assert.equal(Number(p.nb_read_frames), frameCount(s, FPS), `${label}: frame count`);
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

// ---- fix round 1 ----

/** md5 of a still's decoded pixels, so two PNGs compare by content. */
function pixelMd5(png) {
  const r = spawnSync(FFMPEG, ["-v", "error", "-i", png, "-f", "md5", "-"], { encoding: "utf8" });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout.trim();
}

/** Frame n of a clip as a PNG. */
function frameAsPng(clip, n, png) {
  run(["-hide_banner", "-v", "error", "-y", "-i", clip, "-vf", `select=eq(n\\,${n})`, "-vsync", "0", "-frames:v", "1", png]);
}

/** A clip of `frames` distinct frames (testsrc2 carries a running counter). */
function distinctClip(dir, name, frames) {
  const out = path.join(dir, name);
  run(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=216x384:r=30:d=${frames / 30}`, "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", out]);
  assert.equal(Number(probe(out).nb_read_frames), frames);
  return out;
}

test("lastFrameArgs keeps the true last frame of a long clip", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-last-"));
  try {
    const clip = distinctClip(dir, "long.mp4", 60);
    const last = path.join(dir, "last.png");
    run(lastFrameArgs(clip, last));
    const want = path.join(dir, "f59.png");
    frameAsPng(clip, 59, want);
    const early = path.join(dir, "f54.png");
    frameAsPng(clip, 54, early);
    assert.notEqual(pixelMd5(want), pixelMd5(early), "the fixture's frames must be distinct");
    assert.equal(pixelMd5(last), pixelMd5(want), "the still must be frame 59, not the first frame after the seek");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lastFrameArgs on a clip shorter than the seek still yields the last frame", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-last-"));
  try {
    const clip = distinctClip(dir, "short.mp4", 5);
    const last = path.join(dir, "last.png");
    run(lastFrameArgs(clip, last));
    const want = path.join(dir, "f4.png");
    frameAsPng(clip, 4, want);
    assert.equal(pixelMd5(last), pixelMd5(want));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Bands at 0/16/128/235/255 survive both the plain path and the RGB (lightLeak) path.
const BANDS = [0, 16, 128, 235, 255];

function bandsImage(dir) {
  const src = path.join(dir, "bands-src.jpg");
  const v = "if(lt(Y,H/5),0,if(lt(Y,2*H/5),16,if(lt(Y,3*H/5),128,if(lt(Y,4*H/5),235,255))))";
  run(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=1200x1600:d=1", "-vf", `format=gbrp,geq=r='${v}':g='${v}':b='${v}'`,
    "-frames:v", "1", "-q:v", "1", src]);
  const out = path.join(dir, "bands-work.jpg");
  const { args } = workImageArgs({ src, out, width: 1200, height: 1600, orientation: 1 });
  run(args);
  return out;
}

/** Mean RGB at the centre of each of the five bands, in the clip's last frame. */
function bandLevels(clip, frames) {
  const r = spawnSync(FFMPEG, ["-v", "error", "-i", clip, "-vf", `select=eq(n\\,${frames - 1})`, "-vsync", "0", "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(r.stdout.length, W * H * 3);
  return BANDS.map((_, k) => {
    const y = Math.round(H * (k + 0.5) / BANDS.length);
    const x = Math.round(W * 0.9);
    const o = (y * W + x) * 3;
    return (r.stdout[o] + r.stdout[o + 1] + r.stdout[o + 2]) / 3;
  });
}

test("levels survive the shot render: bands within +/-3 on the plain and the RGB overlay paths", { skip, timeout: 300000 }, () => {
  const fx = fixture();
  try {
    const image = bandsImage(fx.dir);
    // 1.2 s: the leak is over by the last frame, so this checks the RGB round trip, not the leak's own light.
    for (const overlays of [[], ["lightLeak"]]) {
      const s = shot({ start: 0, end: 1.2, entrance: { id: "cut" }, overlays: overlays.map((id) => ({ id })) });
      const clip = renderClip(fx, image, s, `bands push cut ${overlays.join("+")}`);
      const levels = bandLevels(clip.out, frameCount(s, FPS));
      levels.forEach((got, k) => assert.ok(Math.abs(got - BANDS[k]) <= 3, `${overlays.join("+") || "plain"}: band ${BANDS[k]} came out ${got}`));
    }
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("irregular durations render exactly their frame count and stay concat-safe", { skip, timeout: 300000 }, () => {
  const fx = fixture();
  try {
    const clips = [renderClip(fx, fx.tall, matrixShot("push", "cut"), "baseline")];
    for (const [end, want] of [[1.35, 11], [2.27, 38]]) {
      for (const [move, entrance] of [["push", "cut"], ["split2", "flash"], ["punch", "crossfade"]]) {
        const s = shot({ start: 1, end, move: { id: move, intensity: 0.7 }, entrance: { id: entrance } });
        assert.equal(frameCount(s, FPS), want);
        clips.push(renderClip(fx, fx.tall, s, `${move} ${entrance} ${want} frames`));
      }
    }
    assertConcatSafe(clips);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});
