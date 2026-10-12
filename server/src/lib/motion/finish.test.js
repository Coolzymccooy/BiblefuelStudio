import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { statementsAss, fxAss, finishArgs } from "./finish.js";
import { shotArgs } from "./shotArgs.js";
import { filterNames, ffmpegAvailable, FFMPEG } from "./testkit.js";
import { FFMPEG_51_FILTERS } from "./effects/index.js";

const plan = (over = {}) => ({
  version: 1, w: 1080, h: 1920, fps: 30, durationSec: 15, seed: 5, style: "celebrate", energy: 0.8,
  shots: [
    { start: 0, end: 7, photo: 0, role: "open", move: { id: "push", intensity: 0.6 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 } },
    { start: 7, end: 12, photo: 1, role: "body", move: { id: "punch", intensity: 0.6 }, entrance: { id: "flash" }, overlays: [{ id: "sparkles" }], anchor: { x: 0.5, y: 0.38 } },
    { start: 12, end: 15, photo: 0, role: "end", move: { id: "push", intensity: 0.6 }, entrance: { id: "whip" }, overlays: [{ id: "rayBurst" }], anchor: { x: 0.5, y: 0.38 } },
  ],
  captions: [
    { text: "HAPPY 40TH", start: 0.15, end: 6.9, reveal: 1, holdUntil: 6.9, effect: "title" },
    { text: "Celebrate!", start: 12.15, end: 14.9, reveal: 0.5, holdUntil: 14.9 },
  ],
  ...over,
});

test("statements come from the kinetic engine in the style's look", () => {
  const ass = statementsAss(plan());
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Knewave|Permanent Marker/, "Lagos Night fonts");
  // The kinetic engine upper-cases text and gives each word its own event.
  assert.ok(ass.includes("HAPPY") && ass.includes("40TH") && ass.includes("CELEBRATE!"));
});

test("no captions, no statements file", () => {
  assert.equal(statementsAss(plan({ captions: [] })), "");
});

test("captions' reveal and holdUntil reach the kinetic engine", () => {
  const held = (holdUntil) => statementsAss(plan({ captions: [{ text: "ONE TWO", start: 1, end: 3, reveal: 0.5, holdUntil }] }));
  assert.notEqual(held(3), held(9), "holdUntil changes when the statement leaves");
  const quick = statementsAss(plan({ captions: [{ text: "ONE TWO", start: 1, end: 3, reveal: 0.2, holdUntil: 3 }] }));
  const slow = statementsAss(plan({ captions: [{ text: "ONE TWO", start: 1, end: 3, reveal: 2, holdUntil: 3 }] }));
  assert.notEqual(quick, slow, "reveal changes how fast the words land");
});

test("FX gathers every shot's ASS overlay events, deterministically", () => {
  const a = fxAss(plan());
  assert.match(a, /Style: FX,/);
  assert.ok((a.match(/^Dialogue: /gm) || []).length > 48, "sparkles plus 48 rays");
  assert.equal(fxAss(plan()), a);
  assert.equal(fxAss(plan({ shots: plan().shots.map((s) => ({ ...s, overlays: [] })) })), "");
});

const common = { body: "body.mp4", out: "out.mp4", workDir: "wd", statementsPath: "wd/s.ass", fxPath: "wd/fx.ass" };
const graphOf = (r) => r.sideFiles[0].text;

test("song only: trimmed from its window, padded to length, faded, loudness-normalised", () => {
  const r = finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 42.5 }, voice: null });
  const a = r.args;
  assert.deepEqual(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 4), ["-ss", "42.500", "-i", "song.mp3"]);
  assert.match(graphOf(r), /\[1:a\]aresample=48000,apad,atrim=0:15\.000,afade=t=in:d=0\.3,afade=t=out:st=13\.800:d=1\.2,loudnorm=I=-14:TP=-1\.5:LRA=11\[a\]/);
  assert.equal(a[a.indexOf("-filter_complex_script") + 1], path.join("wd", "finish.txt"));
  assert.deepEqual(a.slice(a.indexOf("-t"), a.indexOf("-t") + 2), ["-t", "15.000"]);
});

test("song plus voice: the song ducks under the voice", () => {
  const g = graphOf(finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 0 }, voice: { file: "vo.mp3" } }));
  assert.match(g, /sidechaincompress=threshold=0\.01:ratio=12:attack=5:release=350:makeup=2/);
  assert.match(g, /amix=inputs=2:duration=first/);
});

test("voice only and silence both give a full-length audio track", () => {
  const v = graphOf(finishArgs({ ...common, plan: plan(), song: null, voice: { file: "vo.mp3" } }));
  assert.match(v, /\[1:a\]aresample=48000,apad,atrim=0:15\.000/);
  const s = finishArgs({ ...common, plan: plan(), song: null, voice: null });
  assert.ok(s.args.join(" ").includes("anullsrc=r=48000:cl=stereo"));
});

test("the picture is graded, then statements, then FX, with escaped paths", () => {
  const g = graphOf(finishArgs({ ...common, statementsPath: "C:\\w\\s.ass", fxPath: "C:\\w\\fx.ass", plan: plan(), song: null, voice: null }));
  const v = g.split(";")[0];
  assert.ok(v.startsWith("[0:v]eq=saturation=1.2:contrast=1.05,ass=filename='C\\:/w/s.ass'"), v);
  assert.ok(v.includes(",ass=filename='C\\:/w/fx.ass'"), v);
  assert.ok(v.endsWith("[v]"));
});

test("missing statements and FX files are simply left out", () => {
  const g = graphOf(finishArgs({ ...common, statementsPath: null, fxPath: null, plan: plan(), song: null, voice: null }));
  assert.ok(!g.includes("ass="));
});

test("the output is a social-ready MP4", () => {
  const { args } = finishArgs({ ...common, plan: plan(), song: null, voice: null });
  for (const flag of [["-c:v", "libx264"], ["-pix_fmt", "yuv420p"], ["-c:a", "aac"], ["-b:a", "192k"], ["-ar", "48000"], ["-movflags", "+faststart"]]) {
    assert.equal(args[args.indexOf(flag[0]) + 1], flag[1]);
  }
  assert.equal(args.at(-1), "out.mp4");
});

test("the finish keeps the body's colour tags: no matrix conversion or retag", () => {
  const { args, sideFiles } = finishArgs({ ...common, plan: plan(), song: { file: "s", startSec: 0 }, voice: { file: "v" } });
  assert.ok(!/colorspace|colormatrix|bt709/i.test(args.join(" ") + sideFiles[0].text));
});

test("the finish graph uses only ffmpeg 5.1 filters", () => {
  for (const [song, voice] of [[{ file: "s", startSec: 0 }, null], [{ file: "s", startSec: 0 }, { file: "v" }], [null, { file: "v" }], [null, null]]) {
    const g = finishArgs({ ...common, plan: plan(), song, voice }).sideFiles[0].text;
    for (const name of filterNames([g])) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  }
});

// End to end in real ffmpeg: a body made by the shot stage, then every audio combination.
const skip = ffmpegAvailable() ? false : "ffmpeg not available";
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  assert.equal(r.status, 0, `${bin} ${args.join(" ")}\n${r.stderr}`);
  return r;
}

function probe(file) {
  const r = run(FFPROBE, [
    "-v", "error", "-count_frames",
    "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,sample_rate,color_range,color_space,nb_read_frames,duration",
    "-show_entries", "format=duration", "-of", "json", file,
  ]);
  const j = JSON.parse(r.stdout);
  return {
    format: Number(j.format.duration),
    video: j.streams.find((s) => s.codec_type === "video"),
    audio: j.streams.filter((s) => s.codec_type === "audio"),
  };
}

function meanVolume(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
  assert.ok(m, r.stderr);
  return m[1] === "-inf" ? -Infinity : Number(m[1]);
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-finish-"));
  const sine = (name, hz, sec) => {
    const file = path.join(dir, name);
    run(FFMPEG, ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${sec}:sample_rate=44100`, file]);
    return file;
  };
  const photo = path.join(dir, "photo.jpg");
  run(FFMPEG, ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:d=1", "-frames:v", "1", photo]);
  const e2ePlan = plan({
    durationSec: 3,
    shots: [{ start: 0, end: 3, photo: 0, role: "open", move: { id: "push", intensity: 0.6 }, entrance: { id: "cut" }, overlays: [{ id: "sparkles" }], anchor: { x: 0.5, y: 0.38 } }],
    captions: [{ text: "HAPPY 40TH", start: 0.2, end: 2.8, reveal: 0.8, holdUntil: 3 }],
  });
  const body = path.join(dir, "body.mp4");
  const shot = shotArgs({ shot: e2ePlan.shots[0], index: 0, workImage: photo, prevFrame: null, out: body, w: 1080, h: 1920, fps: 30, workDir: dir });
  for (const f of shot.sideFiles) fs.writeFileSync(f.path, f.text);
  run(FFMPEG, shot.args);
  const statementsPath = path.join(dir, "statements.ass");
  const fxPath = path.join(dir, "fx.ass");
  fs.writeFileSync(statementsPath, statementsAss(e2ePlan));
  fs.writeFileSync(fxPath, fxAss(e2ePlan));
  return { dir, body, plan: e2ePlan, statementsPath, fxPath, song: sine("song.wav", 440, 10), voice: sine("voice.wav", 880, 2) };
}

const fx = skip ? null : fixture();
after(() => { if (fx) fs.rmSync(fx.dir, { recursive: true, force: true }); });

for (const [label, withSong, withVoice] of [["song and voice", true, true], ["song only", true, false], ["voice only", false, true], ["neither", false, false]]) {
  test(`finish end to end, ${label}`, { skip }, () => {
    const out = path.join(fx.dir, `out-${label.replace(/\s+/g, "-")}.mp4`);
    const { args, sideFiles } = finishArgs({
      body: fx.body, out, plan: fx.plan, statementsPath: fx.statementsPath, fxPath: fx.fxPath,
      song: withSong ? { file: fx.song, startSec: 1.5 } : null,
      voice: withVoice ? { file: fx.voice } : null,
      workDir: fx.dir,
    });
    for (const f of sideFiles) fs.writeFileSync(f.path, f.text);
    run(FFMPEG, args);
    const p = probe(out);
    assert.ok(Math.abs(p.format - 3) <= 0.05, `duration ${p.format}`);
    assert.equal(Number(p.video.nb_read_frames), 90);
    assert.equal(`${p.video.width}x${p.video.height}`, "1080x1920");
    assert.equal(p.video.pix_fmt, "yuv420p");
    assert.equal(p.audio.length, 1, "exactly one audio track, always present");
    assert.equal(p.audio[0].codec_name, "aac");
    assert.equal(p.audio[0].sample_rate, "48000");
    assert.ok(Math.abs(Number(p.audio[0].duration) - 3) <= 0.1, `audio duration ${p.audio[0].duration}`);
    // Colour tags stay as the shot stage wrote them: BT.601 matrix, limited range.
    assert.ok(["bt470bg", undefined, "unknown"].includes(p.video.color_space), `color_space ${p.video.color_space}`);
    assert.equal(p.video.color_range, "tv");
    const mean = meanVolume(out);
    if (withSong || withVoice) assert.ok(mean > -50, `audible, got ${mean} dB`);
    else assert.ok(mean < -70, `silent, got ${mean} dB`);
  });
}
