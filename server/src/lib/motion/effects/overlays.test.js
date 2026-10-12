import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mulberry32 } from "../../kinetic/director.js";
import { escapeFontPath, FONT_DIR } from "../../videoFilters.js";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { filterNames, FFMPEG, ffmpegAvailable } from "../testkit.js";

const ctx = { w: 1080, h: 1920, fps: 30, frames: 60, dur: 2, prev: null };
const shot = { start: 10, end: 12, photo: 0, role: "body", move: { id: "push", intensity: 0.7 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 } };

test("every overlay is registered as an overlay", () => {
  assert.deepEqual(effectsOfKind("overlay").map((e) => e.id).sort(), ["doodles", "lightLeak", "rayBurst", "sparkles", "viewfinder"]);
});

for (const id of ["lightLeak", "viewfinder"]) {
  test(`${id} is a video overlay using only ffmpeg 5.1 filters`, () => {
    const g = getEffect(id).graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" });
    assert.ok(g.some((s) => s.includes("[mv]")));
    assert.ok(g.at(-1).endsWith("[ov]"));
    for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  });
}

test("the light leak blends in planar RGB (a YUV screen blend tints magenta)", () => {
  const g = getEffect("lightLeak").graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" }).join(";");
  assert.match(g, /\[mv\]format=gbrp/);
  assert.match(g, /blend=all_mode=screen:eof_action=pass,format=yuv420p\[ov\]/, "the output is back to yuv420p");
  assert.match(g, /color=c=black:s=270x480/, "the leak is drawn small and scaled up");
});

test("the viewfinder draws its labels in Anton with an escaped running clock", () => {
  const g = getEffect("viewfinder").graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" }).join(";");
  assert.match(g, /fontfile='[^']*Anton\.ttf'/);
  assert.ok(g.includes("text='%{pts\\:hms}'"), "the colon in pts:hms is escaped");
});

test("time-gated video overlays reset their input timestamps, so a late-starting input keeps its clock", () => {
  const v = getEffect("viewfinder").graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" })[0];
  assert.ok(v.startsWith("[mv]setpts=N/30/TB,"), v);
  const l = getEffect("lightLeak").graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" }).join(";");
  assert.match(l, /\[mv\]format=gbrp,setpts=N\/30\/TB\[lbo0\]/, "the leak's clock starts with the picture's");
});

for (const id of ["sparkles", "doodles", "rayBurst"]) {
  test(`${id} writes FX Dialogue lines inside the shot's own time`, () => {
    const lines = getEffect(id).assEvents({ shot, ctx, rnd: mulberry32(4) });
    assert.ok(lines.length > 0);
    for (const l of lines) {
      assert.match(l, /^Dialogue: \d,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,FX,,0,0,0,,/);
      const [, a, b] = l.match(/^Dialogue: \d,(\d:\d\d:\d\d\.\d\d),(\d:\d\d:\d\d\.\d\d)/);
      const sec = (t) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
      assert.ok(sec(a) >= 10 - 1e-9 && sec(b) <= 12 + 1e-9, l);
    }
  });
}

test("ASS overlays are deterministic for a seed", () => {
  const a = getEffect("sparkles").assEvents({ shot, ctx, rnd: mulberry32(4) });
  const b = getEffect("sparkles").assEvents({ shot, ctx, rnd: mulberry32(4) });
  assert.deepEqual(a, b);
});

test("more intensity means more sparkles", () => {
  const n = (i) => getEffect("sparkles").assEvents({ shot: { ...shot, move: { id: "push", intensity: i } }, ctx, rnd: mulberry32(1) }).length;
  assert.ok(n(1) > n(0));
});

// Real renders, gated on ffmpeg/ffprobe. Same harness as entrances.test.js: NUT output, probed frame count and size.
const probeBin = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
const renderable = ffmpegAvailable() && spawnSync(probeBin, ["-version"]).status === 0;
const RENDER_CTX = { w: 1080, h: 1920, fps: 30, frames: 15, dur: 0.5, prev: null };
const CLIP_ARGS = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=0.5"];

function run(args) {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

test("the two video overlays render exactly 15 frames at 1080x1920", { skip: !renderable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-overlay-"));
  try {
    for (const id of ["lightLeak", "viewfinder"]) {
      const graph = getEffect(id).graph({ input: "[0:v]", output: "[ov]", shot, ctx: RENDER_CTX, tag: "o" });
      const script = path.join(dir, `${id}.txt`);
      fs.writeFileSync(script, graph.join(";\n"));
      const out = path.join(dir, `${id}.nut`); // NUT carries raw video; Matroska rejects it
      run([...CLIP_ARGS, "-filter_complex_script", script, "-map", "[ov]", "-an", "-c:v", "rawvideo", out]);
      const probe = spawnSync(probeBin, ["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_read_frames,pix_fmt", "-of", "csv=p=0", out], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      // ffprobe prints the fields in its own order: width,height,pix_fmt,frames.
      assert.equal(probe.stdout.trim(), `1080,1920,yuv420p,${RENDER_CTX.frames}`, id);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the viewfinder's centre cross is lit at the centre and empty in the top-left corner", { skip: !renderable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-overlay-cross-"));
  try {
    const graph = getEffect("viewfinder").graph({ input: "[0:v]", output: "[ov]", shot, ctx: RENDER_CTX, tag: "o" });
    graph.push("[ov]format=gray[gray]");
    const script = path.join(dir, "cross.txt");
    fs.writeFileSync(script, graph.join(";\n"));
    const out = path.join(dir, "cross.gray");
    run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=0.5",
      "-filter_complex_script", script, "-map", "[gray]", "-frames:v", "1", "-f", "rawvideo", out]);
    const px = fs.readFileSync(out);
    assert.equal(px.length, 1080 * 1920, "one gray 1080x1920 frame");
    const at = (x, y) => px[y * 1080 + x];
    assert.ok(at(540, 960) > 100, `centre pixel ${at(540, 960)} should be lit by the cross`);
    let corner = 0;
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) corner = Math.max(corner, at(x, y));
    assert.ok(corner < 30, `top-left 4x4 block peaks at ${corner}; the cross must not be drawn there`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The ASS overlays' Dialogue lines must parse under libass: burn them onto black and check ink appears mid-shot.
const ASS_HEADER = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "PlayResX: 1080",
  "PlayResY: 1920",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: FX,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];

test("the ASS overlays' Dialogue lines parse under libass and draw on a 1.5 s shot", { skip: !renderable }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-overlay-ass-"));
  try {
    const assShot = { ...shot, start: 0, end: 1.5 };
    const lines = ["sparkles", "doodles", "rayBurst"].flatMap((id) => getEffect(id).assEvents({ shot: assShot, ctx: RENDER_CTX, rnd: mulberry32(4) }));
    const assPath = path.join(dir, "fx.ass");
    fs.writeFileSync(assPath, [...ASS_HEADER, ...lines].join("\n") + "\n");
    const graph = [
      `[0:v]ass=filename='${escapeFontPath(assPath)}':fontsdir='${escapeFontPath(FONT_DIR)}',format=gray[gray]`,
    ];
    const script = path.join(dir, "graph.txt");
    fs.writeFileSync(script, graph.join(";\n"));
    const out = path.join(dir, "fx.gray");
    const SHOT_FRAMES = 45; // 1.5 s at 30 fps, the full shot
    run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=1080x1920:r=30:d=${SHOT_FRAMES / 30}`,
      "-filter_complex_script", script, "-map", "[gray]", "-f", "rawvideo", out]);
    const bytes = fs.readFileSync(out);
    const frameBytes = 1080 * 1920;
    assert.equal(bytes.length, frameBytes * SHOT_FRAMES, "45 gray frames at 1080x1920");
    const peak = (n) => bytes.subarray(n * frameBytes, (n + 1) * frameBytes).reduce((m, v) => Math.max(m, v), 0);
    assert.ok(peak(7) > 40, "frame 7 (0.23 s): early events draw something visible");
    assert.ok(peak(40) > 40, "frame 40 (1.33 s): later sparkles draw something visible");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
