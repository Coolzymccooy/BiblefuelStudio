import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderPlan, runFfmpeg } from "./render.js";
import { directMoment } from "./director.js";
import { pulseGrid } from "./cuts.js";
import { workImageArgs } from "./prepare.js";
import { ffmpegAvailable, FFMPEG } from "./testkit.js";
import { hasLibass } from "../kinetic/capability.js";

const shot = (start, end, entrance = "cut", overlays = []) => ({
  start, end, photo: 0, role: "body", move: { id: "push", intensity: 0.5 }, entrance: { id: entrance }, overlays, anchor: { x: 0.5, y: 0.38 },
});
const plan = () => ({
  version: 1, w: 1080, h: 1920, fps: 30, durationSec: 6, seed: 3, style: "glow", energy: 0.2,
  shots: [shot(0, 2), shot(2, 4, "crossfade"), shot(4, 6, "cut", [{ id: "sparkles" }])],
  captions: [{ text: "Grace", start: 0.2, end: 1.9, reveal: 0.5, holdUntil: 1.9 }],
});

// The mock writes a stub at each call's output (the last argument) like ffmpeg would, a partial
// one when the call fails, so the tests can see what renderPlan leaves behind.
function recorder({ failAt = -1 } = {}) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    const failed = calls.length - 1 === failAt;
    fs.writeFileSync(args.at(-1), failed ? "partial" : "stub");
    return failed ? { ok: false, code: 1, stderr: "boom: No such filter" } : { ok: true, code: 0, stderr: "" };
  };
  return { calls, runner };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "motion-render-"));

test("shots, the last frame before a crossfade, the join, then the finish", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const progress = [];
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, onProgress: (p) => progress.push(p), libass: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  // The finish stage now has two scripts (finish-video.txt, finish-audio.txt), not one finish.txt.
  const kinds = calls.map((a) => (a.includes("-sseof") ? "last" : a.includes("concat") ? "join" : a.some((x) => String(x).endsWith("finish-video.txt")) ? "finish" : "shot"));
  assert.deepEqual(kinds, ["shot", "last", "shot", "shot", "join", "finish"]);
  const list = fs.readFileSync(path.join(workDir, "list.txt"), "utf8");
  assert.equal(list.trim().split("\n").length, 3);
  assert.ok(fs.existsSync(path.join(workDir, "statements.ass")));
  assert.ok(fs.existsSync(path.join(workDir, "fx.ass")));
  assert.ok(fs.existsSync(path.join(workDir, "finish-video.txt")));
  assert.ok(fs.existsSync(path.join(workDir, "finish-audio.txt")));
  const fractions = progress.filter((p) => p.stage === "shots").map((p) => p.fraction);
  assert.deepEqual(fractions, [1 / 3, 2 / 3, 1]);
  assert.deepEqual(progress.at(-1), { stage: "finish", fraction: 1 });
  assert.ok(fs.existsSync(workDir), "renderPlan never deletes the work dir");
  assert.ok(fs.existsSync(path.join(workDir, "o.mp4")), "the finished file lands at out");
  assert.equal(fs.existsSync(path.join(workDir, "final.mp4")), false, "final.mp4 was moved, not copied");
  assert.ok(calls.at(-1).includes(path.join(workDir, "final.mp4")), "the finish renders into workDir/final.mp4");
  fs.rmSync(workDir, { recursive: true, force: true });
});

// ffmpeg's -progress output: key=value lines, one block per tick. out_time_us and out_time_ms are both microseconds.
const progressBlock = (us) => [`out_time_us=${us}`, `out_time_ms=${us}`, "progress=continue"];

test("the finish asks ffmpeg for progress on stdout, and the other runs do not", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: true });
  const finish = calls.at(-1);
  const at = finish.indexOf("-progress");
  assert.ok(at >= 0 && finish[at + 1] === "pipe:1" && finish.includes("-nostats"));
  assert.ok(at < finish.indexOf("-i"), "a global option, before the inputs");
  for (const c of calls.slice(0, -1)) assert.equal(c.includes("-progress"), false);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("finish progress climbs with ffmpeg's out_time, stays below 1, and ends at exactly 1", async () => {
  const workDir = tmp();
  const progress = [];
  const runner = async (args, opts) => {
    if (args.some((x) => String(x).endsWith("finish-video.txt"))) {
      // 6 s Moment. Includes noise a real ffmpeg emits: N/A, a negative start, a repeated tick, a part-line split, the end block.
      const lines = ["out_time_us=N/A", "out_time_us=-9223372036854775807", ...progressBlock(1_500_000), ...progressBlock(1_500_000),
        ...progressBlock(3_000_000), "frame=90", ...progressBlock(2_000_000), ...progressBlock(6_000_000), "progress=end"];
      for (const l of lines) opts.onStdout(l);
    }
    fs.writeFileSync(args.at(-1), "stub");
    return { ok: true, code: 0, stderr: "" };
  };
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, onProgress: (p) => progress.push(p), libass: true });
  assert.equal(r.ok, true);
  const fin = progress.filter((p) => p.stage === "finish").map((p) => p.fraction);
  assert.deepEqual(fin.slice(0, -1), [0.25, 0.5, 0.99]);
  assert.equal(fin.at(-1), 1);
  for (let i = 1; i < fin.length; i += 1) assert.ok(fin[i] > fin[i - 1], "strictly increasing");
  assert.ok(fin.slice(0, -1).every((f) => f >= 0 && f < 1));
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a runner that ignores onStdout still finishes with fraction 1", async () => {
  const workDir = tmp();
  const { runner } = recorder();
  const progress = [];
  await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, onProgress: (p) => progress.push(p), libass: true });
  assert.deepEqual(progress.filter((p) => p.stage === "finish"), [{ stage: "finish", fraction: 1 }]);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("runFfmpeg hands stdout to onStdout a line at a time, joining chunks that split a line", { skip: !ffmpegAvailable() }, async () => {
  const lines = [];
  const r = await runFfmpeg(["-hide_banner", "-v", "error", "-nostats", "-progress", "pipe:1", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=30:d=1", "-f", "null", "-"],
    { ffmpegPath: FFMPEG, onStdout: (l) => lines.push(l) });
  assert.equal(r.ok, true);
  assert.ok(lines.some((l) => /^out_time_us=\d+$/.test(l)), lines.join("|"));
  assert.equal(lines.at(-1), "progress=end");
  assert.ok(lines.every((l) => !/[\r\n]/.test(l)));
});

test("runFfmpeg's stdout buffer is bounded: a runaway line with no newline is dropped, not grown", async () => {
  const lines = [];
  // The "ffmpeg" here is node itself, writing 5 MB with no newline and then one real line.
  const r = await runFfmpeg(["-e", "process.stdout.write('x'.repeat(5_000_000) + '\\nout_time_us=7\\n')"], {
    ffmpegPath: process.execPath, onStdout: (l) => lines.push(l),
  });
  assert.equal(r.ok, true);
  assert.ok(lines.every((l) => l.length <= 8192), "no oversized line is delivered");
  assert.equal(lines.at(-1), "out_time_us=7", "the stream recovers at the next newline");
});

test("a failing finish leaves nothing at out", async () => {
  const workDir = tmp();
  const out = path.join(workDir, "o.mp4");
  const { calls, runner } = recorder({ failAt: 5 });
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out, runner, libass: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /finishing pass/);
  assert.equal(calls.length, 6);
  assert.equal(fs.existsSync(out), false, "no partial file at out");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a failing last-frame grab stops the render with a clear error", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder({ failAt: 1 });
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /last frame of shot 1 of 3/);
  assert.match(r.detail, /No such filter/);
  assert.equal(calls.length, 2, "nothing runs after the failure");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a crossfade shot gets the previous shot's last frame, and shot 0 gets none", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const p = { ...plan(), shots: [shot(0, 2, "crossfade"), shot(2, 4, "crossfade"), shot(4, 6, "cut")] };
  const r = await renderPlan({ plan: p, workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const inputs = (a) => a.flatMap((x, i) => (a[i - 1] === "-i" ? [x] : []));
  const last0 = path.join(workDir, "last-000.png");
  assert.deepEqual(inputs(calls[0]), ["w0.jpg"], "shot 0 has no previous frame even with a crossfade entrance");
  assert.ok(calls[1].includes("-sseof") && calls[1].at(-1) === last0, "last frame of shot 0 is grabbed for shot 1");
  assert.deepEqual(inputs(calls[2]), ["w0.jpg", last0]);
  assert.deepEqual(inputs(calls[3]), ["w0.jpg"], "a cut after a crossfade takes no previous frame, and nothing was grabbed for it");
  assert.equal(calls.filter((a) => a.includes("-sseof")).length, 1, "only the shot before a crossfade is grabbed");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("ASS overlays alone need libass too: refuse up front, run nothing", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const p = { ...plan(), captions: [], shots: [shot(0, 2), shot(2, 4), shot(4, 6, "cut", [{ id: "sparkles" }])] };
  const r = await renderPlan({ plan: p, workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /libass/);
  assert.equal(calls.length, 0);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a plan with no ASS at all renders without libass", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const p = { ...plan(), captions: [], shots: [shot(0, 2), shot(2, 4), shot(4, 6)] };
  const r = await renderPlan({ plan: p, workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(calls.length, 5);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a failure detail is capped at 2000 characters", async () => {
  const workDir = tmp();
  const runner = async () => ({ ok: false, code: 1, stderr: `${"x".repeat(10_000)}\nend` });
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: true });
  assert.equal(r.ok, false);
  assert.ok(r.detail.length <= 2000, `detail ${r.detail.length}`);
  assert.match(r.detail, /end$/);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("runFfmpeg resolves ok:false, never throws, when ffmpeg is missing", async () => {
  const r = await runFfmpeg(["-version"], { ffmpegPath: path.join(os.tmpdir(), "no-such-ffmpeg-binary") });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, "string");
  assert.notEqual(r.error, "cancelled");
});

test("a failing shot stops the render with a friendly error and the detail", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder({ failAt: 2 });
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /shot 2 of 3/);
  assert.match(r.detail, /No such filter/);
  assert.equal(calls.length, 3, "nothing runs after the failure");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("without libass the render refuses rather than dropping the statements", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /statements/i);
  assert.equal(calls.length, 0);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("an already-aborted signal renders nothing", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const ac = new AbortController();
  ac.abort();
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, signal: ac.signal, libass: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /cancelled/);
  assert.equal(calls.length, 0);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a cancelled run reports cancelled even when the runner is mid-flight", async () => {
  const workDir = tmp();
  const ac = new AbortController();
  const runner = async (args, { signal }) => {
    ac.abort();
    return runFfmpeg(["-hide_banner"], { signal });
  };
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, signal: ac.signal, libass: true });
  assert.deepEqual(r, { ok: false, error: "cancelled" });
  fs.rmSync(workDir, { recursive: true, force: true });
});

// Real ffmpeg from here on.
const skip = ffmpegAvailable() && hasLibass() ? false : "ffmpeg with libass not available";

/** True when a process whose command line holds `marker` is still alive. */
function processAlive(marker) {
  if (process.platform === "win32") {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.Name -like 'ffmpeg*' } | Measure-Object).Count`], { encoding: "utf8" });
    return Number(String(r.stdout).trim()) > 0;
  }
  const r = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

test("aborting a running ffmpeg resolves cancelled quickly and leaves no process", { skip }, async () => {
  const marker = `motion-cancel-${process.pid}-${Date.now()}`;
  const ac = new AbortController();
  const pending = runFfmpeg(["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30", "-metadata", `title=${marker}`, "-f", "null", "-"], { signal: ac.signal, ffmpegPath: FFMPEG });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(processAlive(marker), true, "the child is running before the abort");
  const t0 = Date.now();
  ac.abort();
  const r = await pending;
  assert.equal(r.ok, false);
  assert.equal(r.error, "cancelled");
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.equal(processAlive(marker), false, "the child has exited");
});

test("aborting renderPlan mid-shots resolves cancelled within 2 s", { skip, timeout: 60_000 }, async () => {
  const dir = tmp();
  try {
    const img = path.join(dir, "w0.jpg");
    assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=2160x3840:d=1", "-frames:v", "1", img]).status, 0);
    const workDir = path.join(dir, "work");
    fs.mkdirSync(workDir);
    const ac = new AbortController();
    let abortedAt = 0;
    const r = await renderPlan({
      plan: plan(), workImages: [img], song: null, voice: null, workDir, out: path.join(dir, "o.mp4"), signal: ac.signal,
      onProgress: () => {},
      runner: (args, opts) => {
        if (!abortedAt) setTimeout(() => { abortedAt = Date.now(); ac.abort(); }, 400);
        return runFfmpeg(args, opts);
      },
    });
    const took = Date.now() - abortedAt;
    assert.deepEqual(r, { ok: false, error: "cancelled" });
    assert.ok(abortedAt > 0 && took < 2000, `resolved ${took} ms after the abort`);
    assert.equal(fs.existsSync(path.join(dir, "o.mp4")), false, "no finished file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Real ffmpeg, abort once the run reaches `stage`: "join" aborts as the concat starts,
 * "finish" aborts `delayMs` into the finishing pass. Nothing may be left at `out`.
 */
async function cancelDuring(stage, delayMs) {
  const dir = tmp();
  try {
    const img = path.join(dir, "w0.jpg");
    assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=2160x3840:d=1", "-frames:v", "1", img]).status, 0);
    const workDir = path.join(dir, "work");
    fs.mkdirSync(workDir);
    const out = path.join(dir, "o.mp4");
    const ac = new AbortController();
    let reached = 0;
    let abortedAt = 0;
    const r = await renderPlan({
      plan: plan(), workImages: [img], song: null, voice: null, workDir, out, signal: ac.signal,
      runner: (args, opts) => {
        const isJoin = args.includes("concat");
        const isFinish = args.some((x) => String(x).endsWith("finish-video.txt"));
        if ((stage === "join" && isJoin) || (stage === "finish" && isFinish)) {
          reached += 1;
          const abort = () => { abortedAt = Date.now(); ac.abort(); };
          if (delayMs) setTimeout(abort, delayMs); else abort();
        }
        return runFfmpeg(args, opts);
      },
    });
    const took = Date.now() - abortedAt;
    assert.equal(reached, 1, `the ${stage} stage was reached`);
    assert.deepEqual(r, { ok: false, error: "cancelled" });
    assert.ok(took < 2000, `resolved ${took} ms after the abort`);
    assert.equal(fs.existsSync(out), false, "no partial file at out");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("aborting during the join resolves cancelled and leaves no out", { skip, timeout: 60_000 }, () => cancelDuring("join", 0));
test("aborting during the finish resolves cancelled and leaves no out", { skip, timeout: 60_000 }, () => cancelDuring("finish", 800));

// The smoke render: real ffmpeg, a real 15 s Moment.
test("smoke: a 15 s Moment from 4 photos and a tone is a 1080x1920, 15 s MP4", { skip, timeout: 300_000 }, async () => {
  const dir = tmp();
  try {
    const colours = ["red", "green", "blue", "orange"];
    const workImages = colours.map((c, i) => {
      const src = path.join(dir, `p${i}.png`);
      assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=${i === 3 ? "640x360" : "360x640"}:d=1`, "-frames:v", "1", src]).status, 0);
      const out = path.join(dir, `w${i}.jpg`);
      const { args } = workImageArgs({ src, out, width: i === 3 ? 640 : 360, height: i === 3 ? 360 : 640, orientation: 1 });
      assert.equal(spawnSync(FFMPEG, args).status, 0);
      return out;
    });
    const tone = path.join(dir, "tone.m4a");
    // Longer than the Moment: a 3 s tone is padded with digital silence, and the AAC encoder emits
    // legitimate 4-byte packets for that, which the "no tiny packet" tail check below would flag.
    assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=16", "-c:a", "aac", tone]).status, 0);
    const photos = [{ shape: "tall" }, { shape: "tall" }, { shape: "tall" }, { shape: "wide" }];
    const { plan: p } = directMoment({
      photos, heroIndex: 0, grid: pulseGrid(15), title: "Happy birthday", statements: ["Blessed", "Celebrate"],
      styleId: "celebrate", energy: 0.7, lengthSec: 15, seed: 21,
    });
    const workDir = path.join(dir, "work");
    fs.mkdirSync(workDir);
    const out = path.join(dir, "moment.mp4");
    const progress = [];
    const r = await renderPlan({ plan: p, workImages, song: { file: tone, startSec: 0 }, voice: null, workDir, out, onProgress: (e) => progress.push(e) });
    assert.equal(r.ok, true, JSON.stringify(r));
    const fin = progress.filter((e) => e.stage === "finish").map((e) => e.fraction);
    assert.ok(fin.some((f) => f > 0 && f < 1), `finish reports progress before it is done: ${fin}`);
    assert.equal(fin.at(-1), 1);
    for (let i = 1; i < fin.length; i += 1) assert.ok(fin[i] > fin[i - 1], "finish progress never goes back");
    const probe = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), ["-v", "error", "-show_entries", "stream=width,height,codec_type:format=duration", "-of", "json", out], { encoding: "utf8" });
    if (probe.status === 0) {
      const info = JSON.parse(probe.stdout);
      const v = info.streams.find((s) => s.codec_type === "video");
      assert.equal(v.width, 1080);
      assert.equal(v.height, 1920);
      assert.ok(info.streams.some((s) => s.codec_type === "audio"));
      assert.ok(Math.abs(Number(info.format.duration) - 15) <= 0.1, `duration ${info.format.duration}`);
      const probeBin = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
      const frames = spawnSync(probeBin, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" });
      assert.equal(Number(frames.stdout.trim()), Math.round(15 * 30), "exactly 450 video frames");
      const packets = spawnSync(probeBin, ["-v", "error", "-select_streams", "a:0", "-show_packets", "-show_entries", "packet=pts_time,size", "-of", "csv=p=0", out], { encoding: "utf8" });
      const rows = packets.stdout.trim().split("\n").map((l) => l.split(",").map(Number));
      const tiny = rows.filter(([t, size]) => t < 14.9 && size < 20);
      assert.deepEqual(tiny, [], "no AAC packet under 20 bytes before 14.9 s");
      assert.ok(rows.at(-1)[0] > 14.9, `the audio runs to the end (last packet ${rows.at(-1)[0]})`);
    } else {
      assert.ok(fs.statSync(out).size > 10_000);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
