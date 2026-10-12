import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { filterNames, FFMPEG, ffmpegAvailable } from "../testkit.js";

const ctx = (over = {}) => ({ w: 1080, h: 1920, fps: 30, frames: 45, dur: 1.5, prev: null, ...over });
const shot = { start: 1, end: 2.5, photo: 0, role: "body", move: { id: "push", intensity: 0.5 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 } };
const IDS = ["cut", "flash", "whip", "glitch", "crossfade"];

test("every entrance is registered as an entrance", () => {
  assert.deepEqual(effectsOfKind("entrance").map((e) => e.id).sort(), [...IDS].sort());
});

for (const id of IDS) {
  test(`${id} reads its input, writes its output, and uses only ffmpeg 5.1 filters`, () => {
    for (const c of [ctx(), ctx({ prev: "[1:v]" })]) {
      const g = getEffect(id).graph({ input: "[ov]", output: "[en]", shot, ctx: c, tag: "e" });
      assert.ok(g.some((s) => s.includes("[ov]")));
      assert.ok(g.at(-1).endsWith("[en]"));
      for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
    }
  });
}

test("cut passes the picture through unchanged", () => {
  assert.deepEqual(getEffect("cut").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx(), tag: "e" }), ["[ov]null[en]"]);
});

test("flash fades in from white at the start of the shot", () => {
  const [g] = getEffect("flash").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx(), tag: "e" });
  assert.match(g, /fade=t=in:st=0:d=0\.\d+:color=white/);
});

test("crossfade blends from the previous shot's last frame", () => {
  const g = getEffect("crossfade").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx({ prev: "[1:v]" }), tag: "e" }).join(";");
  assert.match(g, /\[1:v\]scale=1080:1920/);
  assert.match(g, /xfade=transition=fade:duration=0\.500:offset=0\[en\]/);
});

test("crossfade with no previous frame is a cut", () => {
  assert.deepEqual(getEffect("crossfade").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx(), tag: "e" }), ["[ov]null[en]"]);
});

test("a short shot gets a shorter crossfade", () => {
  const g = getEffect("crossfade").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx({ prev: "[1:v]", dur: 0.5, frames: 15 }), tag: "e" }).join(";");
  assert.match(g, /duration=0\.200/);
});

test("flash and glitch are strong; cut, whip and crossfade are not", () => {
  assert.deepEqual(IDS.filter((id) => getEffect(id).strong).sort(), ["flash", "glitch"]);
});

// Real renders: a 15-frame 1080x1920 clip in, exactly 15 frames out at the output size.
// Gated on ffmpeg/ffprobe. Crossfade is also rendered with a single-frame previous still as input 1.
const probeBin = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
const renderable = ffmpegAvailable() && spawnSync(probeBin, ["-version"]).status === 0;
const RENDER_CTX = { w: 1080, h: 1920, fps: 30, frames: 15, dur: 0.5, prev: null };

function run(args) {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

const RENDER_CASES = [
  ...IDS.filter((id) => id !== "crossfade").map((id) => ({ name: id, id, withPrev: false })),
  { name: "crossfade without a previous frame", id: "crossfade", withPrev: false },
  { name: "crossfade with a previous frame", id: "crossfade", withPrev: true },
];

for (const c of RENDER_CASES) {
  test(`${c.name} renders exactly ${RENDER_CTX.frames} frames at 1080x1920`, { skip: !renderable }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-entrance-"));
    try {
      const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=0.5"];
      const renderCtx = { ...RENDER_CTX, prev: c.withPrev ? "[1:v]" : null };
      if (c.withPrev) {
        const still = path.join(dir, "prev.png");
        run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=1080x1920:d=1", "-frames:v", "1", still]);
        args.push("-i", still);
      }
      const graph = getEffect(c.id).graph({ input: "[0:v]", output: "[en]", shot, ctx: renderCtx, tag: "e" });
      const script = path.join(dir, "graph.txt");
      fs.writeFileSync(script, graph.join(";\n"));
      const out = path.join(dir, "out.nut"); // NUT carries raw video; Matroska rejects it
      run([...args, "-filter_complex_script", script, "-map", "[en]", "-an", "-c:v", "rawvideo", out]);
      const probe = spawnSync(probeBin, ["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      assert.equal(probe.stdout.trim(), `1080,1920,${RENDER_CTX.frames}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
