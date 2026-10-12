import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { frameCount, anchoredXY } from "./common.js";
import { filterNames, FFMPEG, ffmpegAvailable } from "../testkit.js";

const ctx = { w: 1080, h: 1920, fps: 30, frames: 45, dur: 1.5, prev: null };
const shot = (move, intensity = 0.5) => ({
  start: 0, end: 1.5, photo: 0, role: "body", move: { id: move, intensity }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 },
});
const MOVES = ["push", "punch", "shake", "still", "pan", "split2", "split3"];

test("every move is registered as a move", () => {
  assert.deepEqual(effectsOfKind("move").map((e) => e.id).sort(), [...MOVES].sort());
  for (const id of MOVES) assert.equal(getEffect(id).kind, "move");
});

test("getEffect ignores the prototype chain", () => {
  assert.equal(getEffect("constructor"), null);
  assert.equal(getEffect("__proto__"), null);
  assert.equal(getEffect("nope"), null);
});

for (const id of MOVES) {
  test(`${id} reads its input label, writes its output label, and uses only ffmpeg 5.1 filters`, () => {
    const g = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx, tag: "m" });
    assert.ok(g.length >= 1);
    assert.ok(g.some((s) => s.includes("[0:v]")), "reads the input");
    assert.ok(g.at(-1).endsWith("[mv]"), "ends at the output");
    for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  });
}

test("zoom moves make exactly the shot's frame count at the output size", () => {
  for (const id of ["push", "punch", "shake", "still"]) {
    const [g] = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx, tag: "m" });
    assert.ok(g.includes(":d=45:s=1080x1920:fps=30"), `${id}: ${g}`);
  }
});

test("a stronger push zooms further", () => {
  const z = (i) => getEffect("push").graph({ input: "[0:v]", output: "[mv]", shot: shot("push", i), ctx, tag: "m" })[0].match(/z='1\+([\d.]+)\*on/)[1];
  assert.ok(Number(z(1)) > Number(z(0)));
});

test("the zoom stays anchored where the faces are", () => {
  assert.deepEqual(anchoredXY({ x: 0.5, y: 0.38 }), { x: "(iw-iw/zoom)*0.500", y: "(ih-ih/zoom)*0.380" });
});

test("pan travels a 9:16 window across a wide photo", () => {
  const [g] = getEffect("pan").graph({ input: "[0:v]", output: "[mv]", shot: shot("pan"), ctx, tag: "m" });
  assert.match(g, /crop=w='ih\*1080\/1920':h=ih/);
  assert.match(g, /x='\(iw-ow\)\*\(0\.15\+0\.7\*t\/1\.500\)'/);
  assert.match(g, /scale=1080:1920/);
});

test("split panels crop to the panel's own shape, so wide photos are never squashed", () => {
  const g = getEffect("split3").graph({ input: "[0:v]", output: "[mv]", shot: shot("split3"), ctx, tag: "m" }).join(";");
  // Panels at h=1920 with 4 px gaps: 1080x636, 1080x636, and the last takes the remainder, 1080x640.
  // Each crop keeps its panel's own w:h whichever side limits it.
  assert.match(g, /crop=w='min\(iw,ih\*1080\/636\)':h='min\(ih,iw\*636\/1080\)'/);
  assert.match(g, /crop=w='min\(iw,ih\*1080\/640\)':h='min\(ih,iw\*640\/1080\)'/);
  assert.equal((g.match(/zoompan=/g) || []).length, 3);
});

const GAP = 4;
const EXPECTED_HEIGHTS = { 2: [958, 958], 3: [636, 636, 640] };
const panelHeights = (g) => [...g.matchAll(/zoompan=.*?:s=1080x(\d+):fps=/g)].map((m) => Number(m[1]));
const panelYs = (g) => [...g.matchAll(/overlay=0:(\d+):/g)].map((m) => Number(m[1]));

for (const n of [2, 3]) {
  test(`split${n} panels and their ${GAP} px gaps fill the frame exactly`, () => {
    const g = getEffect(`split${n}`).graph({ input: "[0:v]", output: "[mv]", shot: shot(`split${n}`), ctx, tag: "m" }).join(";");
    const heights = panelHeights(g);
    const ys = panelYs(g);
    assert.equal(heights.length, n);
    assert.equal(ys.length, n);
    assert.deepEqual(heights, EXPECTED_HEIGHTS[n], "even panel heights, last panel takes the remainder");
    assert.equal(heights.reduce((a, b) => a + b, 0) + (n - 1) * GAP, ctx.h, "panels plus gaps = frame height");
    // yuv420p snaps odd overlay offsets to the even row below, which would shrink one divider and widen another.
    ys.forEach((y, k) => assert.equal(y % 2, 0, `panel ${k} at y=${y} is on an even row`));
    ys.forEach((y, k) => assert.equal(y, k === 0 ? 0 : ys[k - 1] + heights[k - 1] + GAP, `panel ${k} sits one gap below the last`));
    assert.equal(ys.at(-1) + heights.at(-1), ctx.h, "last panel ends at the bottom");
    heights.forEach((h) => assert.ok(g.includes(`crop=w='min(iw,ih*1080/${h})':h='min(ih,iw*${h}/1080)'`), `panel ${h}px crops to its own height`));
  });
}

test("split backgrounds emit exactly ctx.frames frames", () => {
  const c = { ...ctx, frames: 15, dur: 0.51 };
  const g = getEffect("split2").graph({ input: "[0:v]", output: "[mv]", shot: shot("split2"), ctx: c, tag: "m" });
  const bg = g.find((s) => s.startsWith("color="));
  const d = Number(bg.match(/:d=([\d.]+)/)[1]);
  assert.equal(Math.ceil(d * c.fps), c.frames, `d=${d} at ${c.fps} fps`);
});

test("pan counts time in frames, on a 1/fps timebase", () => {
  const c = { ...ctx, frames: 15, dur: 0.51 };
  const [g] = getEffect("pan").graph({ input: "[0:v]", output: "[mv]", shot: shot("pan"), ctx: c, tag: "m" });
  assert.match(g, /settb=1\/30,setpts=N,/);
  assert.match(g, /\(0\.15\+0\.7\*t\/0\.500\)/);
});

// Real renders: one photo frame in, ctx.frames frames out at the output size. Gated on ffmpeg/ffprobe.
const probeBin = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
const renderable = ffmpegAvailable() && spawnSync(probeBin, ["-version"]).status === 0;
const RENDER_CTX = { w: 1080, h: 1920, fps: 30, frames: 15, dur: 0.51, prev: null };

function run(args) {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

for (const id of MOVES) {
  for (const shape of getEffect(id).shapes) {
    test(`${id} on a ${shape} photo renders exactly ${RENDER_CTX.frames} frames at 1080x1920`, { skip: !renderable }, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-move-"));
      try {
        const [w, h] = shape === "wide" ? [3840, 2160] : [2160, 3840];
        const photo = path.join(dir, "photo.png");
        // A PNG input: image2 gives it the default 1/25 timebase (no -framerate), which the moves must cope with.
        run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=gray:s=${w}x${h}:d=1`, "-frames:v", "1", photo]);
        const graph = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx: RENDER_CTX, tag: "m" });
        const script = path.join(dir, "graph.txt");
        fs.writeFileSync(script, graph.join(";\n"));
        const out = path.join(dir, "out.nut"); // NUT carries raw video; Matroska rejects it
        run(["-hide_banner", "-loglevel", "error", "-i", photo, "-filter_complex_script", script, "-map", "[mv]", "-an", "-c:v", "rawvideo", out]);
        const probe = spawnSync(probeBin, ["-v", "error", "-count_frames", "-select_streams", "v:0",
          "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        assert.equal(probe.stdout.trim(), `1080,1920,${RENDER_CTX.frames}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

test("split3 dividers are exactly 4 black rows, at rows 636 and 1276", { skip: !renderable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-split-"));
  try {
    const photo = path.join(dir, "photo.png");
    run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=2160x3840:d=1", "-frames:v", "1", photo]);
    // Column 540 of the composed frame, as one gray byte per row. Panel 2 enters at 0.3 s, so the
    // last frame (0.47 s) is the first with all three panels showing.
    const graph = getEffect("split3").graph({ input: "[0:v]", output: "[mv]", shot: shot("split3"), ctx: RENDER_CTX, tag: "m" });
    // A 2 px crop: yuv420p cannot crop to 1 px wide. Both columns carry the same luma, so take the first.
    graph.push("[mv]crop=2:1920:540:0,format=gray[col]");
    const script = path.join(dir, "graph.txt");
    fs.writeFileSync(script, graph.join(";\n"));
    const out = path.join(dir, "col.gray");
    run(["-hide_banner", "-loglevel", "error", "-i", photo, "-filter_complex_script", script, "-map", "[col]", "-pix_fmt", "gray", "-f", "rawvideo", out]);
    const bytes = fs.readFileSync(out);
    const frameBytes = 2 * 1920;
    assert.equal(bytes.length, frameBytes * RENDER_CTX.frames, "two 1920-row columns per frame");
    const last = bytes.length - frameBytes;
    const col = Buffer.from(Array.from({ length: 1920 }, (_, r) => bytes[last + 2 * r]));
    // Runs of near-black rows (black is luma 16 in limited range).
    const runs = [];
    for (let y = 0; y < col.length;) {
      if (col[y] < 20) {
        let e = y;
        while (e < col.length && col[e] < 20) e += 1;
        runs.push([y, e - y]);
        y = e;
      } else {
        y += 1;
      }
    }
    assert.deepEqual(runs, [[636, 4], [1276, 4]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only pan and the splits take wide photos", () => {
  const wide = MOVES.filter((id) => getEffect(id).shapes.includes("wide")).sort();
  assert.deepEqual(wide, ["pan", "split2", "split3"]);
});

test("splits are strong; zoom moves are not", () => {
  assert.equal(getEffect("split2").strong, true);
  assert.equal(getEffect("split3").strong, true);
  assert.equal(getEffect("push").strong, false);
});

test("frameCount tiles consecutive shots exactly", () => {
  const a = { start: 0, end: 0.517 };
  const b = { start: 0.517, end: 1.033 };
  assert.equal(frameCount(a, 30) + frameCount(b, 30), Math.round(1.033 * 30));
});
