/**
 * Defence in depth for #104: every media input the render routes hand to
 * ffmpeg/ffprobe carries `-protocol_whitelist file,pipe`, so even a URL that
 * slipped past the classifier (or a file whose bytes name other URLs) cannot
 * make ffmpeg open a network protocol.
 *
 * The real ffmpeg runs; FFREPORT (test/helpers/ffreport.js) records each
 * command line it was given.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { captureFfmpegReports, unguardedInputs, ffprobeGuarded } from "../helpers/ffreport.js";

// jobs.js and paths.js read DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ffguard-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: renderRouter } = await import("../../src/routes/render.js");
const { default: audioAdvRouter } = await import("../../src/routes/audio_advanced.js");
const { _setJobCtxForTest, _resetJobCtxForTest, _executeJobForTest, _renderVideoCoreForTest } =
  await import("../../src/routes/jobs.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const skip = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const out = process.env.OUTPUT_DIR;
const media = {};
let caseNo = 0;

before(() => {
  if (skip) return;
  const make = (file, args) => {
    const r = spawnSync(FF, ["-y", "-v", "error", ...args, file]);
    assert.equal(r.status, 0, String(r.stderr));
    return file;
  };
  media.tone = make(path.join(out, "tone.mp3"), ["-f", "lavfi", "-i", "sine=f=440:d=1"]);
  media.bed = make(path.join(out, "bed.mp3"), ["-f", "lavfi", "-i", "sine=f=220:d=1"]);
  media.clip = make(path.join(out, "clip.mp4"), ["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=1", "-pix_fmt", "yuv420p"]);
  media.still = make(path.join(out, "still.png"), ["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"]);
  _setJobCtxForTest({ userId: "u-guard", dataDir: process.env.DATA_DIR, outputDir: out });
});

after(() => {
  _resetJobCtxForTest();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "u-guard", dataDir: process.env.DATA_DIR, outputDir: out }; next(); });
  a.use("/api/render", renderRouter);
  a.use("/api/audio-adv", audioAdvRouter);
  return a;
}

/** Run `fn` with ffmpeg reports captured; returns the recorded commands. */
async function recorded(fn) {
  caseNo += 1;
  const cap = captureFfmpegReports(path.join(root, `reports-${caseNo}`));
  try {
    await fn();
    return cap.commands();
  } finally {
    cap.stop();
  }
}

/** Every recorded input is guarded, and `mustSee` paths were real ffmpeg inputs. */
function assertGuarded(commands, mustSee = []) {
  const ffmpeg = commands.filter((c) => c.program === "ffmpeg");
  assert.ok(ffmpeg.length > 0, "expected at least one ffmpeg run");
  for (const c of ffmpeg) assert.deepEqual(unguardedInputs(c.tokens), [], c.tokens.join(" "));
  for (const c of commands.filter((x) => x.program === "ffprobe")) assert.ok(ffprobeGuarded(c.tokens), c.tokens.join(" "));
  const inputs = ffmpeg.flatMap((c) => c.tokens.filter((_t, i) => c.tokens[i - 1] === "-i")).map((p) => path.resolve(p));
  for (const p of mustSee) assert.ok(inputs.includes(path.resolve(p)), `${p} was not an ffmpeg input: ${inputs.join(" | ")}`);
}

describe("render routes guard every ffmpeg input", { skip }, () => {
  test("/render/video", async () => {
    const commands = await recorded(() => request(app()).post("/api/render/video")
      .send({ backgroundPath: media.clip, audioPath: media.tone, musicPath: media.bed, lines: ["Peace"], durationSec: 1 }));
    assertGuarded(commands, [media.clip, media.tone, media.bed]);
  });

  test("/render/waveform", async () => {
    const commands = await recorded(() => request(app()).post("/api/render/waveform")
      .send({ backgroundPath: media.clip, audioPath: media.tone, musicPath: media.bed, lines: ["Peace"], durationSec: 1 }));
    assertGuarded(commands, [media.clip, media.tone, media.bed]);
  });

  test("/render/captioned-video: probes and the encode arg vector", async () => {
    const before = new Set(fs.readdirSync(out));
    const commands = await recorded(async () => {
      const res = await request(app()).post("/api/render/captioned-video").send({
        audioPath: media.tone, backgroundPaths: [media.clip, media.still], musicPaths: [media.bed, media.tone],
        words: [{ text: "Hi", startMs: 0, endMs: 500 }],
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    });
    for (const c of commands.filter((x) => x.program === "ffprobe")) assert.ok(ffprobeGuarded(c.tokens), c.tokens.join(" "));
    assert.ok(commands.some((c) => c.program === "ffprobe"), "the route probes its inputs");
    // The music-bed concat ran synchronously; the encode itself is dumped.
    for (const c of commands.filter((x) => x.program === "ffmpeg")) assert.deepEqual(unguardedInputs(c.tokens), [], c.tokens.join(" "));
    const dumpName = fs.readdirSync(out).find((f) => !before.has(f) && /^captioned-args-.*\.txt$/.test(f));
    assert.ok(dumpName, "expected the args dump");
    const args = fs.readFileSync(path.join(out, dumpName), "utf8").split(" ");
    assert.deepEqual(unguardedInputs(args), []);
    const resolved = args.map((a) => path.resolve(a));
    assert.ok(resolved.includes(path.resolve(media.clip)) && resolved.includes(path.resolve(media.still)), args.join(" "));
  });

  test("/render/captioned-video in video mode", async () => {
    const before = new Set(fs.readdirSync(out));
    const res = await request(app()).post("/api/render/captioned-video")
      .send({ videoPath: media.clip, musicPath: media.bed, words: [{ text: "Hi", startMs: 0, endMs: 500 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dumpName = fs.readdirSync(out).find((f) => !before.has(f) && /^captioned-args-.*\.txt$/.test(f));
    const args = fs.readFileSync(path.join(out, dumpName), "utf8").split(" ");
    assert.deepEqual(unguardedInputs(args), []);
    assert.ok(args.map((a) => path.resolve(a)).includes(path.resolve(media.clip)), args.join(" "));
  });
});

describe("audio-adv routes guard every ffmpeg input", { skip }, () => {
  test("/merge (the concat list input)", async () => {
    const commands = await recorded(() => request(app()).post("/api/audio-adv/merge").send({ inputs: [media.tone, media.bed] }));
    assertGuarded(commands);
  });

  test("/timeline", async () => {
    const commands = await recorded(() => request(app()).post("/api/audio-adv/timeline").send({ clips: [{ path: media.tone }, { path: media.bed }] }));
    assertGuarded(commands, [media.tone, media.bed]);
  });

  test("/timeline-preview", async () => {
    const commands = await recorded(() => request(app()).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: media.clip, clips: [{ path: media.tone }] }));
    assertGuarded(commands, [media.clip, media.tone]);
  });
});

describe("queued renders guard every ffmpeg/ffprobe input", { skip }, () => {
  test("render_waveform job", async () => {
    const commands = await recorded(() => _executeJobForTest({
      id: "g-wave", type: "render_waveform",
      payload: { audioPath: media.tone, backgroundPath: media.clip, musicPath: media.bed, lines: ["x"], durationSec: 1 },
    }));
    assertGuarded(commands, [media.tone, media.clip, media.bed]);
  });

  test("render_video, single background", async () => {
    const commands = await recorded(() => _renderVideoCoreForTest({
      backgroundPath: media.clip, audioPath: media.tone, musicPath: media.bed, lines: ["Peace"], durationSec: 1,
    }, "g-legacy"));
    assertGuarded(commands, [media.clip, media.tone, media.bed]);
  });

  test("render_video, scenes (advanced path)", async () => {
    const commands = await recorded(() => _renderVideoCoreForTest({
      scenes: [{ backgroundPath: media.clip, duration: 0.5 }, { backgroundPath: media.still, duration: 0.5, kind: "image" }],
      audioPath: media.tone, musicPath: media.bed, lines: ["Peace"], durationSec: 1,
    }, "g-scenes"));
    assertGuarded(commands, [media.clip, media.still, media.tone, media.bed]);
  });
});
