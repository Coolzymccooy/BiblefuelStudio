// server/src/lib/lyricVideo/lyricRender.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderSize, buildLyricRenderArgs, runLyricRender } from "./lyricRender.js";
import { createJob, getJob, cancelJob } from "../renderJobs.js";

describe("renderSize", () => {
  test("720p and 1080p for each frame", () => {
    assert.deepEqual(renderSize("portrait", "720p"), { width: 720, height: 1280 });
    assert.deepEqual(renderSize("portrait", "1080p"), { width: 1080, height: 1920 });
    assert.deepEqual(renderSize("landscape", "720p"), { width: 1280, height: 720 });
    assert.deepEqual(renderSize("square", "1080p"), { width: 1080, height: 1080 });
    assert.deepEqual(renderSize("nonsense", "nope"), { width: 720, height: 1280 });
  });
});

describe("buildLyricRenderArgs", () => {
  const base = { songPath: "/s/song.m4a", assPath: "/w/c.ass", width: 720, height: 1280, durationSec: 12.5, outPath: "/o/out.mp4" };

  // Every input is bounded on the input side, and there is no output-side -t:
  // ffmpeg 8 can silently drop the end of the audio under load otherwise.
  test("a looping video background, captions, the song's audio", () => {
    const args = buildLyricRenderArgs({ ...base, background: { file: "/b/clip.mp4", kind: "video", fit: "contain" } });
    const s = args.join(" ");
    assert.match(s, /-stream_loop -1 -t 12\.5 -i \/b\/clip\.mp4/);
    assert.match(s, /-t 12\.5 -i \/s\/song\.m4a/);
    assert.match(s, /boxblur/);
    assert.match(s, /ass=filename=/);
    assert.match(s, /setparams=range=tv:colorspace=bt470bg,format=yuv420p/);
    assert.match(s, /-map 1:a/);
    assert.match(s, /-c:a aac -b:a 192k -ac 2/);
    assert.match(s, /-movflags \+faststart/);
  });

  test("every -i has its own input-side -t and there is no output-side -t", () => {
    for (const background of [
      { file: "/b/clip.mp4", kind: "video", fit: "cover" },
      { file: "/b/a.jpg", kind: "image", fit: "cover" },
      null,
    ]) {
      const args = buildLyricRenderArgs({ ...base, background });
      const inputs = args.map((a, i) => (a === "-i" ? i : -1)).filter((i) => i >= 0);
      assert.equal(inputs.length, 2);
      for (const i of inputs) {
        assert.ok(args.slice(0, i).lastIndexOf("-t") > (i > 0 ? args.slice(0, i).lastIndexOf("-i") : -1), `input at ${i} lacks -t`);
        assert.equal(args[args.slice(0, i).lastIndexOf("-t") + 1], "12.5");
      }
      const lastInput = inputs[inputs.length - 1];
      assert.ok(!args.slice(lastInput + 2).includes("-t"), "no output-side -t");
      assert.ok(!args.includes("-shortest"));
      assert.ok(!args.includes("-filter_complex_script"));
    }
  });

  test("the audio is not in the filter graph", () => {
    const args = buildLyricRenderArgs({ ...base, background: null });
    const graph = args[args.indexOf("-filter_complex") + 1];
    assert.ok(!/\[1:a\]|aresample|apad|atrim/.test(graph));
  });

  test("a still image loops; no background uses a dark colour", () => {
    assert.match(
      buildLyricRenderArgs({ ...base, background: { file: "/b/a.jpg", kind: "image", fit: "cover" } }).join(" "),
      /-loop 1 -framerate 30 -t 12\.5 -i \/b\/a\.jpg/,
    );
    assert.match(
      buildLyricRenderArgs({ ...base, background: null }).join(" "),
      /-f lavfi -t 12\.5 -i color=c=0x101820:s=720x1280/,
    );
  });
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FP = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

const ASS =
  "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Kinetic,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.20,0:00:01.80,Kinetic,,0,0,0,,{\\pos(180,300)}HELLO\n";

function streamDurations(file) {
  const out = spawnSync(FP, ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", file]).stdout.toString();
  const result = {};
  for (const line of out.trim().split(/\r?\n/)) {
    const [type, dur] = line.split(",");
    result[type] = Number(dur);
  }
  return result;
}

function makeFixtures(dir) {
  const song = path.join(dir, "song.m4a");
  const bg = path.join(dir, "bg.mp4");
  spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:a", "aac", song]);
  spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:d=1:r=30", bg]);
  const ass = path.join(dir, "c.ass");
  fs.writeFileSync(ass, ASS);
  return { song, bg, ass };
}

test("renders a real 2-second video with captions", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
  try {
    const { song, bg, ass } = makeFixtures(dir);
    const out = path.join(dir, "out.mp4");
    const job = createJob("u1", { durationSec: 2 });
    const r = await runLyricRender({ jobId: job.jobId, songPath: song, background: { file: bg, kind: "video", fit: "auto" }, assPath: ass, width: 360, height: 640, durationSec: 2, outPath: out });
    assert.equal(r.ok, true, r.error);
    const probe = spawnSync(FP, ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", out]).stdout.toString();
    assert.match(probe, /video,360,640/);
    assert.match(probe, /audio/);

    // Both streams run the full length, and the song's last moments are not silent.
    const d = streamDurations(out);
    assert.ok(Math.abs(d.video - 2) <= 0.1, `video duration ${d.video}`);
    assert.ok(Math.abs(d.audio - 2) <= 0.1, `audio duration ${d.audio}`);
    const tail = spawnSync(FF, ["-hide_banner", "-sseof", "-0.3", "-i", out, "-af", "volumedetect", "-f", "null", "-"]);
    const max = /max_volume:\s*(-?[\d.]+) dB/.exec(tail.stderr.toString());
    assert.ok(max, "volumedetect reported no level for the final 0.3 s");
    assert.ok(Number(max[1]) > -60, `tail max_volume ${max[1]} dB`);

    // The filter script is removed when the render ends.
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("filter-")), []);
    assert.equal(getJob(job.jobId).status, "done");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a still-image and a dark-colour background render too", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
  try {
    const { song, ass } = makeFixtures(dir);
    const img = path.join(dir, "bg.png");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=200x300:d=1:r=1", "-frames:v", "1", img]);
    for (const [name, background] of [["img", { file: img, kind: "image", fit: "auto" }], ["none", null]]) {
      const out = path.join(dir, `${name}.mp4`);
      const job = createJob("u1", { durationSec: 2 });
      const r = await runLyricRender({ jobId: job.jobId, songPath: song, background, assPath: ass, width: 360, height: 640, durationSec: 2, outPath: out });
      assert.equal(r.ok, true, `${name}: ${r.error}`);
      const d = streamDurations(out);
      assert.ok(Math.abs(d.video - 2) <= 0.1 && Math.abs(d.audio - 2) <= 0.1, `${name}: ${JSON.stringify(d)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed render reports an error and still removes the filter script", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
  try {
    const { ass } = makeFixtures(dir);
    const out = path.join(dir, "out.mp4");
    const job = createJob("u1", { durationSec: 2 });
    const r = await runLyricRender({ jobId: job.jobId, songPath: path.join(dir, "missing.m4a"), background: null, assPath: ass, width: 360, height: 640, durationSec: 2, outPath: out });
    assert.equal(r.ok, false);
    assert.equal(getJob(job.jobId).status, "error");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("filter-")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a cancelled render reports Render cancelled and keeps the cancelled state", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
  try {
    const { song, ass } = makeFixtures(dir);
    const out = path.join(dir, "out.mp4");
    const job = createJob("u1", { durationSec: 2 });
    const pending = runLyricRender({ jobId: job.jobId, songPath: song, background: null, assPath: ass, width: 360, height: 640, durationSec: 2, outPath: out });
    cancelJob(job.jobId);
    const r = await pending;
    assert.equal(r.ok, false);
    assert.equal(r.error, "Render cancelled");
    assert.ok(getJob(job.jobId).cancelled);
    assert.notEqual(getJob(job.jobId).status, "done");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("filter-")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cancelling while ffmpeg is running reports Render cancelled and cleans up", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
  try {
    const { ass } = makeFixtures(dir);
    const song = path.join(dir, "long.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=120", "-c:a", "aac", song]);
    const out = path.join(dir, "out.mp4");
    const job = createJob("u1", { durationSec: 120 });
    const pending = runLyricRender({ jobId: job.jobId, songPath: song, background: null, assPath: ass, width: 720, height: 1280, durationSec: 120, outPath: out });
    const started = Date.now();
    while (getJob(job.jobId).status !== "running" && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 300));
    cancelJob(job.jobId);
    const r = await pending;
    assert.equal(r.ok, false);
    assert.equal(r.error, "Render cancelled");
    assert.equal(getJob(job.jobId).error, "Render cancelled");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("filter-")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
