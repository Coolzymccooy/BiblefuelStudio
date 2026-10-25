import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { statementsAss, fxAss, finishArgs, LOUDNESS } from "./finish.js";
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
// Picture and sound are separate graphs (see finish.js); joined, the picture comes first.
const graphOf = (r) => r.sideFiles.map((f) => f.text).join(";");

test("song only: trimmed from its window, padded to length, faded, loudness-normalised", () => {
  const r = finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 42.5 }, voice: null });
  const a = r.args;
  assert.deepEqual(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 6), ["-ss", "42.500", "-t", "15.000", "-i", "song.mp3"]);
  assert.match(graphOf(r), /\[1:a\]aresample=48000,apad=whole_dur=15\.000,atrim=0:15\.000,afade=t=in:d=0\.3,afade=t=out:st=13\.500:d=1\.5,loudnorm=I=-14:TP=-1\.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo\[a\]/);
  const scripts = a.flatMap((x, i) => (x === "-filter_complex_script" ? [a[i + 1]] : []));
  assert.deepEqual(scripts, [path.join("wd", "finish-video.txt"), path.join("wd", "finish-audio.txt")]);
  assert.deepEqual(r.sideFiles.map((f) => f.path), scripts);
  // Length is bounded inside the graphs, not by an output -t that could race the audio flush.
  assert.ok(a.lastIndexOf("-t") < a.lastIndexOf("-i"), "-t only appears before an input, never on the output");
  assert.match(graphOf(r), /\[0:v\][^;]*,setparams=range=tv:colorspace=bt470bg,trim=end_frame=450,setpts=N\/30\/TB\[v\]/);
});

test("every audio input is bounded at the demuxer, so the graph sees a natural EOF", () => {
  const a = finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 42.5 }, voice: { file: "vo.mp3" } }).args;
  const i = a.indexOf("-ss");
  assert.deepEqual(a.slice(i, i + 10), ["-ss", "42.500", "-t", "15.000", "-i", "song.mp3", "-t", "15.000", "-i", "vo.mp3"]);
  const v = finishArgs({ ...common, plan: plan(), song: null, voice: { file: "vo.mp3" } }).args;
  assert.deepEqual(v.slice(v.indexOf("vo.mp3") - 3, v.indexOf("vo.mp3") + 1), ["-t", "15.000", "-i", "vo.mp3"]);
});

test("song plus voice: the song ducks under the voice", () => {
  const g = graphOf(finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 0 }, voice: { file: "vo.mp3" } }));
  assert.match(g, /sidechaincompress=threshold=0\.01:ratio=12:attack=5:release=350:makeup=2/);
  assert.match(g, /amix=inputs=2:duration=first/);
  assert.match(g, /dropout_transition=2,afade=t=out:st=13\.500:d=1\.5,/, "a voice-over Moment ends like a song-only one");
});

test("voice only and silence both give a full-length audio track", () => {
  const v = graphOf(finishArgs({ ...common, plan: plan(), song: null, voice: { file: "vo.mp3" } }));
  assert.match(v, /\[1:a\]aresample=48000,apad=whole_dur=15\.000,atrim=0:15\.000/);
  const s = finishArgs({ ...common, plan: plan(), song: null, voice: null });
  assert.ok(s.args.join(" ").includes("anullsrc=r=48000:cl=stereo"));
});

test("every audio graph ends back at 48 kHz stereo (loudnorm emits 192 kHz)", () => {
  // ffmpeg 5.1 (production) loses the channel layout through loudnorm, and the AAC encoder then
  // cannot pick one ("Cannot select channel layout"): the layout is set explicitly at the end.
  for (const [song, voice] of [[{ file: "s", startSec: 0 }, null], [{ file: "s", startSec: 0 }, { file: "v" }], [null, { file: "v" }], [null, null]]) {
    const g = graphOf(finishArgs({ ...common, plan: plan(), song, voice }));
    assert.ok(g.endsWith(",aresample=48000,aformat=channel_layouts=stereo[a]"), g);
    if (song || voice) assert.ok(g.endsWith(`${LOUDNESS},aresample=48000,aformat=channel_layouts=stereo[a]`), "resample comes after loudnorm");
  }
});

test("the picture is graded, then the closing scrim, then statements, then FX, with escaped paths", () => {
  const g = graphOf(finishArgs({ ...common, statementsPath: "C:\\w\\s.ass", fxPath: "C:\\w\\fx.ass", plan: plan(), song: null, voice: null }));
  const v = g.split(";")[0];
  assert.ok(v.startsWith("[0:v]eq=saturation=1.2:contrast=1.05,drawbox="), v);
  assert.ok(v.includes("'gte(t,12.000)',ass=filename='C\\:/w/s.ass'"), v);
  assert.ok(v.includes(",ass=filename='C\\:/w/fx.ass'"), v);
  assert.ok(v.endsWith("[v]"));
});

test("the closing card darkens behind its words from its first frame, under the statements", () => {
  const v = graphOf(finishArgs({ ...common, plan: plan(), song: null, voice: null })).split(";")[0];
  const scrim = "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:t=fill:enable='gte(t,12.000)'";
  assert.ok(v.includes(`eq=saturation=1.2:contrast=1.05,${scrim},ass=filename='wd/s.ass'`), v);
});

test("the picture fades to black over the last 0.8 s, after the words and FX", () => {
  const v = graphOf(finishArgs({ ...common, plan: plan(), song: null, voice: null })).split(";")[0];
  assert.ok(v.includes("ass=filename='wd/fx.ass':fontsdir="), v);
  assert.match(v, /fx\.ass'[^,]*,fade=t=out:st=14\.200:d=0\.8,setparams=range=tv:colorspace=bt470bg,trim=end_frame=450/);
});

test("a Moment with no closing card is neither darkened nor sent to black early", () => {
  const one = plan({ shots: [{ ...plan().shots[0], end: 15 }] });
  const v = graphOf(finishArgs({ ...common, plan: one, song: null, voice: null })).split(";")[0];
  assert.ok(!v.includes("drawbox"), v);
  assert.match(v, /fade=t=out:st=14\.200:d=0\.8/, "the fade to black still closes it");
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

test("the classic encode is crf 19 with no rate cap; a capped encode adds maxrate and bufsize", () => {
  const classic = finishArgs({ ...common, plan: plan(), song: null, voice: null }).args;
  assert.equal(classic[classic.indexOf("-crf") + 1], "19");
  assert.ok(!classic.includes("-maxrate"));
  const capped = finishArgs({ ...common, plan: plan(), song: null, voice: null, encode: { crf: 21, maxrate: "8M", bufsize: "16M" } }).args;
  assert.equal(capped[capped.indexOf("-crf") + 1], "21");
  assert.equal(capped[capped.indexOf("-maxrate") + 1], "8M");
  assert.equal(capped[capped.indexOf("-bufsize") + 1], "16M");
  assert.equal(capped.at(-1), "out.mp4");
});

test("the finish keeps the body's colour tags: no matrix conversion or retag", () => {
  const r = finishArgs({ ...common, plan: plan(), song: { file: "s", startSec: 0 }, voice: { file: "v" } });
  const all = r.args.join(" ") + graphOf(r);
  // No conversion filter, and nothing but the body's own tags (limited range, BT.601) re-applied.
  assert.ok(!/(^|[,;\]\s])(colorspace|colormatrix)=|bt709/i.test(all), all);
  assert.match(all, /setparams=range=tv:colorspace=bt470bg,/);
});

test("the finish graph uses only ffmpeg 5.1 filters", () => {
  for (const [song, voice] of [[{ file: "s", startSec: 0 }, null], [{ file: "s", startSec: 0 }, { file: "v" }], [null, { file: "v" }], [null, null]]) {
    const g = graphOf(finishArgs({ ...common, plan: plan(), song, voice }));
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

// Measured audio. A small silent-picture body per length keeps these quick: only the sound is under test.
const bodies = new Map();
function bodyOf(sec) {
  if (!bodies.has(sec)) {
    const file = path.join(fx.dir, `plain-${sec}.mp4`);
    run(FFMPEG, ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=270x480:r=30:d=${sec}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
    bodies.set(sec, file);
  }
  return bodies.get(sec);
}

/** A file of consecutive sine tones: [[hz, seconds], ...]. */
function tones(name, parts) {
  const file = path.join(fx.dir, name);
  const srcs = parts.map(([hz, sec], i) => `sine=frequency=${hz}:duration=${sec}:sample_rate=44100[t${i}]`);
  const graph = `${srcs.join(";")};${parts.map((_, i) => `[t${i}]`).join("")}concat=n=${parts.length}:v=0:a=1[a]`;
  run(FFMPEG, ["-hide_banner", "-v", "error", "-y", "-filter_complex", graph, "-map", "[a]", file]);
  return file;
}

function finishAudio({ sec, song, voice, name }) {
  const out = path.join(fx.dir, `${name}.mp4`);
  const p = plan({ durationSec: sec, captions: [], shots: [] });
  const { args, sideFiles } = finishArgs({ body: bodyOf(sec), out, plan: p, statementsPath: null, fxPath: null, song, voice, workDir: fx.dir });
  for (const f of sideFiles) fs.writeFileSync(f.path, f.text);
  run(FFMPEG, args);
  return out;
}

/** Mean volume (dB) of [from, from + len) after an optional audio filter. */
function windowVolume(file, from, len, filter = "anull") {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-ss", String(from), "-t", String(len), "-i", file, "-map", "0:a:0", "-af", `${filter},volumedetect`, "-f", "null", "-"], { encoding: "utf8" });
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
  assert.ok(m, r.stderr);
  return m[1] === "-inf" ? -Infinity : Number(m[1]);
}

const band = (hz) => `bandpass=f=${hz}:width_type=q:w=8`;

test("the mixed audio keeps sounding to the end of the video", { skip }, () => {
  const song = tones("tail-song.wav", [[440, 8]]);
  const voice = tones("tail-voice.wav", [[880, 3]]);
  for (const [label, vo] of [["3 s voice", voice], ["voice as long as the video", tones("tail-voice8.wav", [[880, 8]])]]) {
    const out = finishAudio({ sec: 8, song: { file: song, startSec: 0 }, voice: { file: vo }, name: `tail-${label.replace(/\W+/g, "-")}` });
    const mean = windowVolume(out, 6, 0.5);
    assert.ok(mean > -50, `${label}: the song should still play at 6.0-6.5 s, got ${mean} dB`);
    const late = windowVolume(out, 7.0, 0.5); // inside the 1.5 s fade-out, so quieter but never silent
    assert.ok(late > -45, `${label}: the tail should fade, not drop out, at 7.0-7.5 s, got ${late} dB`);
  }
});

test("song only lands on the -14 LUFS target", { skip }, () => {
  const out = finishAudio({ sec: 8, song: { file: tones("loud-song.wav", [[440, 10]]), startSec: 0 }, voice: null, name: "loud" });
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", out, "-map", "0:a:0", "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const m = /Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/.exec(r.stderr);
  assert.ok(m, r.stderr);
  assert.ok(Math.abs(Number(m[1]) + 14) <= 1, `integrated loudness ${m[1]} LUFS`);
});

test("the song plays from its start window", { skip }, () => {
  // 440 Hz for 10 s then 880 Hz; starting at 8 s, the tone changes 2 s into the output.
  const out = finishAudio({ sec: 4, song: { file: tones("window-song.wav", [[440, 10], [880, 10]]), startSec: 8 }, voice: null, name: "window" });
  const low = [windowVolume(out, 0.5, 1, band(440)), windowVolume(out, 0.5, 1, band(880))];
  const high = [windowVolume(out, 2.5, 0.3, band(440)), windowVolume(out, 2.5, 0.3, band(880))];
  assert.ok(low[0] - low[1] > 15, `before 2 s it is 440 Hz: ${low}`);
  assert.ok(high[1] - high[0] > 15, `after 2 s it is 880 Hz: ${high}`);
});

test("the song ducks while the voice speaks", { skip }, () => {
  // Song at 440 Hz all through; the voice (1320 Hz) speaks for the first 2 s of 6.
  const out = finishAudio({
    sec: 6, song: { file: tones("duck-song.wav", [[440, 10]]), startSec: 0 }, voice: { file: tones("duck-voice.wav", [[1320, 2]]) }, name: "duck",
  });
  const under = windowVolume(out, 0.7, 1, band(440));
  const clear = windowVolume(out, 3.2, 1, band(440));
  assert.ok(clear - under >= 6, `song band should drop at least 6 dB under the voice: ${under} vs ${clear}`);
});

// A timing race, not a logic error: with the output bounded by -t, the muxer could close the audio
// before loudnorm's end-of-stream flush arrived, and the AAC went to silence packets near the end.
// It only shows when ffmpeg is busy, so the same render runs several times at once.
const spawnAsync = (bin, args) => new Promise((resolve) => {
  const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (status) => resolve({ status, stderr }));
});

// Opt-in: FINISH_STRESS=1 (heavy: 8 parallel 1080x1920 renders per case, a lot of RAM).
// FINISH_STRESS_RUNS sets the parallel renders (default 8); FINISH_STRESS_LOAD sets extra dummy
// x264 encodes running alongside (default 0).
const stressSkip = skip || (process.env.FINISH_STRESS === "1" ? false : "heavy stress test: run with FINISH_STRESS=1");

function startLoad(count) {
  const procs = Array.from({ length: count }, () => spawn(FFMPEG, [
    "-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=600", "-c:v", "libx264", "-preset", "medium", "-f", "null", "-",
  ], { stdio: "ignore" }));
  return () => procs.forEach((c) => c.kill());
}

let stressFixture = null;
function stressInputs() {
  if (stressFixture) return stressFixture;
  const SEC = 8;
  const gen = (name, expr, sec) => {
    const file = path.join(fx.dir, name);
    run(FFMPEG, ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=${sec}`, "-ac", "1", "-c:a", "pcm_s16le", file]);
    return file;
  };
  const song = gen("stress-song.wav", "'0.3*sin(2*PI*t*(300+300*gte(t,10)))'", 30);
  const voices = Object.fromEntries([3, 8, 10].map((s) => [s, gen(`stress-voice-${s}.wav`, "'0.3*sin(2*PI*1500*t)*between(t,2,5)'", s)]));
  const p = plan({ durationSec: SEC, shots: [{ ...plan().shots[0], start: 0, end: SEC, overlays: [] }], captions: [] });
  const body = path.join(fx.dir, "stress-body.mp4");
  const shot = shotArgs({ shot: p.shots[0], index: 0, workImage: path.join(fx.dir, "photo.jpg"), prevFrame: null, out: body, w: 1080, h: 1920, fps: 30, workDir: fx.dir });
  for (const f of shot.sideFiles) fs.writeFileSync(f.path, f.text);
  run(FFMPEG, shot.args);
  stressFixture = { SEC, song, voices, p, body };
  return stressFixture;
}

// A flag is an AAC packet under 20 bytes before D - 0.1 s, or the 7.55-7.9 s window below -60 dB.
for (const voiceSec of [3, 8, 10]) {
  test(`under load the mixed audio never drops out before the end (${voiceSec} s voice)`, { skip: stressSkip }, async () => {
    const { SEC, song, voices, p, body } = stressInputs();
    const RUNS = Number(process.env.FINISH_STRESS_RUNS) || 8;
    const stopLoad = startLoad(Number(process.env.FINISH_STRESS_LOAD) || 0);
    let results;
    try {
      results = await Promise.all(Array.from({ length: RUNS }, async (_, i) => {
        const workDir = path.join(fx.dir, `stress-${voiceSec}-${i}`);
        fs.mkdirSync(workDir);
        const out = path.join(workDir, "out.mp4");
        const { args, sideFiles } = finishArgs({ body, out, plan: p, statementsPath: null, fxPath: null, song: { file: song, startSec: 8 }, voice: { file: voices[voiceSec] }, workDir });
        for (const f of sideFiles) fs.writeFileSync(f.path, f.text);
        const r = await spawnAsync(FFMPEG, args);
        return { i, out, ...r };
      }));
    } finally {
      stopLoad();
    }
    const flags = [];
    for (const r of results) {
      assert.equal(r.status, 0, `run ${r.i}\n${r.stderr}`);
      const pk = run(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "packet=pts_time,size", "-of", "json", r.out]);
      const tiny = JSON.parse(pk.stdout).packets.filter((x) => Number(x.pts_time) < SEC - 0.1 && Number(x.size) < 20);
      if (tiny.length) flags.push(`run ${r.i}: silence packets from ${tiny[0].pts_time} s`);
      const tail = windowVolume(r.out, 7.55, 0.35);
      if (!(tail > -60)) flags.push(`run ${r.i}: 7.55-7.9 s at ${tail} dB`);
    }
    assert.deepEqual(flags, [], `${flags.length} flags in ${RUNS} runs`);
  });
}
