// server/src/lib/lyricVideo/lyricRender.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderSize, buildLyricRenderArgs, runLyricRender } from "./lyricRender.js";
import { createJob, getJob, cancelJob } from "../renderJobs.js";
import { bandGeometry, planBranding } from "./brandingPlan.js";
import { brandingEvents } from "./brandingAss.js";
import { resolveLook } from "../kinetic/looks.js";

const LOGO = { file: "/b/logo.png", width: 64, height: 64, opacity: 0.85 };
const GEOMETRY = bandGeometry({ w: 720, h: 1280, logo: LOGO });
const PLAN_EXTENDED = {
  totalSec: 15.5,
  audio: { inputSec: 12.5, padToSec: 15.5, fadeFromSec: 0, fadeSec: 0 },
  bandPieces: [[0, 4], [6, 11.5]], intro: [], wordmark: [], showLogo: true, endCard: { start: 11.5, end: 15.5 },
};
const PLAN_FADED = { ...PLAN_EXTENDED, audio: { inputSec: 12.5, padToSec: 15.5, fadeFromSec: 11, fadeSec: 1.5 } };
const PLAN_TRIM = {
  ...PLAN_EXTENDED, totalSec: 10, audio: { inputSec: 10, padToSec: 10, fadeFromSec: 7, fadeSec: 3 }, endCard: { start: 6, end: 10 }, bandPieces: [[0, 6]],
};
const PLAN_PLAIN = { ...PLAN_EXTENDED, totalSec: 12.5, audio: { inputSec: 12.5, padToSec: 12.5, fadeFromSec: 0, fadeSec: 0 }, endCard: null };
const withPlan = (plan, logo = LOGO, geometry = GEOMETRY) => ({ plan, geometry, logo });

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
    // Only the song's first sound track: a file with several would otherwise put them all in the video.
    assert.match(s, /-map 1:a:0 /);
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
    assert.ok(!/\[1:a\]|aresample|apad|atrim|afade/.test(graph));
    // With a plan the audio is shaped by -af, its own simple graph, and still never by the complex one.
    const planned = buildLyricRenderArgs({ ...base, background: null, ...withPlan(PLAN_EXTENDED) });
    const plannedGraph = planned[planned.indexOf("-filter_complex") + 1];
    assert.ok(!/\[1:a\]|aresample|apad|atrim|afade/.test(plannedGraph));
    assert.match(planned[planned.indexOf("-af") + 1], /^apad=/);
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

describe("buildLyricRenderArgs with a branding plan", () => {
  const base = { songPath: "/s/song.m4a", assPath: "/w/c.ass", width: 720, height: 1280, durationSec: 12.5, outPath: "/o/out.mp4", background: null };
  const graphOf = (args) => args[args.indexOf("-filter_complex") + 1];
  const afOf = (args) => (args.includes("-af") ? args[args.indexOf("-af") + 1] : null);
  const inputT = (args) => args.map((a, i) => (a === "-i" ? args[args.slice(0, i).lastIndexOf("-t") + 1] : null)).filter(Boolean);

  test("the picture runs for the plan's length and the song for its own input length", () => {
    assert.deepEqual(inputT(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) })), ["15.5", "12.5"]);
    assert.deepEqual(inputT(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_TRIM) })), ["10", "10"]);
    for (const background of [{ file: "/b/clip.mp4", kind: "video", fit: "cover" }, { file: "/b/a.jpg", kind: "image", fit: "cover" }]) {
      assert.deepEqual(inputT(buildLyricRenderArgs({ ...base, background, ...withPlan(PLAN_EXTENDED) })), ["15.5", "12.5"]);
    }
  });

  test("-af pads the song, fades it, or both, and is absent when neither applies", () => {
    assert.equal(afOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) })), "apad=whole_dur=15.5");
    assert.equal(afOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_FADED) })), "apad=whole_dur=15.5,afade=t=out:st=11:d=1.5");
    assert.equal(afOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_TRIM) })), "afade=t=out:st=7:d=3");
    assert.equal(afOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_PLAIN) })), null);
    const args = buildLyricRenderArgs({ ...base, ...withPlan(PLAN_FADED) });
    // The shaping applies to the mapped song, after the maps and before the encoder settings.
    assert.ok(args.indexOf("-af") > args.indexOf("1:a:0") && args.indexOf("-af") < args.indexOf("-c:a"));
  });

  test("no plan means no -af", () => {
    for (const background of [null, { file: "/b/clip.mp4", kind: "video", fit: "cover" }, { file: "/b/a.jpg", kind: "image", fit: "cover" }]) {
      assert.ok(!buildLyricRenderArgs({ ...base, background }).includes("-af"));
    }
  });

  test("the small logo, its time mask and the end card logo, in order", () => {
    const graph = graphOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) }));
    const order = ["ass=filename=", "movie=", "geq=lum=", "alphamerge", `overlay=x=${GEOMETRY.logo.x}:y=${GEOMETRY.logo.y}:shortest=1`, "fade=t=in:st=11.5:d=0.4:alpha=1", "enable='gte(t,11.5)'", "setparams=range=tv:colorspace=bt470bg,format=yuv420p[v]"];
    const at = order.map((s) => graph.indexOf(s));
    at.forEach((i, k) => assert.ok(i >= 0, `${order[k]} missing from ${graph}`));
    assert.deepEqual([...at].sort((a, b) => a - b), at, `out of order: ${graph}`);
    // The mask fades the logo in and out over each band piece, at the logo's opacity.
    assert.match(graph, /geq=lum='255\*0\.85\*\(clip\(\(T-0\)\/0\.25,0,1\)\*clip\(\(4-T\)\/0\.25,0,1\)\+clip\(\(T-6\)\/0\.25,0,1\)\*clip\(\(11\.5-T\)\/0\.25,0,1\)\)'/);
    assert.match(graph, new RegExp(`color=c=white:s=16x16:r=30:d=15\\.5,format=gray,geq=.*,scale=${GEOMETRY.logo.w}:${GEOMETRY.logo.h},setsar=1\\[`));
    assert.match(graph, /alphaextract/);
    assert.match(graph, /blend=all_mode=multiply/);
  });

  test("both logo streams count frames in a clean 1/30 time base", () => {
    const graph = graphOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) }));
    // setpts=N/(30*TB) in a PNG's 1/25 time base would give frames equal timestamps.
    assert.equal(graph.split("loop=loop=-1:size=1:start=0,settb=1/30,setpts=N,").length - 1, 2, graph);
    assert.doesNotMatch(graph, /setpts=N\//);
  });

  test("everything blend and alphamerge read has square pixels", () => {
    const graph = graphOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) }));
    const { w, h } = GEOMETRY.logo;
    assert.ok(graph.includes(`,scale=${w}:${h},setsar=1[bm]`), graph);
    assert.ok(graph.includes("[bla]alphaextract,setsar=1[ba0]"), graph);
    assert.ok(graph.includes("setsar=1,split=2[blg][bla]"), graph);
  });

  test("the logo chains appear only when the plan calls for them", () => {
    const has = (args) => {
      const g = graphOf(args);
      return { movie: g.includes("movie="), alphamerge: g.includes("alphamerge"), fade: g.includes("fade=t=in:st=") };
    };
    assert.deepEqual(has(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) })), { movie: true, alphamerge: true, fade: true });
    assert.deepEqual(has(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_PLAIN) })), { movie: true, alphamerge: true, fade: false });
    assert.deepEqual(has(buildLyricRenderArgs({ ...base, ...withPlan({ ...PLAN_EXTENDED, bandPieces: [] }) })), { movie: true, alphamerge: false, fade: true });
    assert.deepEqual(has(buildLyricRenderArgs({ ...base, ...withPlan({ ...PLAN_EXTENDED, showLogo: false }) })), { movie: false, alphamerge: false, fade: false });
    assert.deepEqual(has(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED, null) })), { movie: false, alphamerge: false, fade: false });
  });

  test("a plan without a logo keeps the captions chain exactly as before", () => {
    const plain = graphOf(buildLyricRenderArgs(base));
    assert.equal(graphOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED, null) })), plain);
    assert.equal(graphOf(buildLyricRenderArgs({ ...base, ...withPlan({ ...PLAN_EXTENDED, showLogo: false }) })), plain);
  });

  test("the logo path is escaped for the graph, drive colon and all", () => {
    const graph = graphOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED, { ...LOGO, file: "C:\\brand\\o'brien\\logo.png" }) }));
    assert.ok(graph.includes("movie=C\\\\:/brand/o\\\\\\'brien/logo.png,"), graph);
  });

  test("the end card logo is centred a little above the middle: 0.40 h tall, 0.36 h wide", () => {
    const tall = graphOf(buildLyricRenderArgs({ ...base, ...withPlan(PLAN_EXTENDED) }));
    assert.match(tall, /scale=260:260:force_original_aspect_ratio=decrease,format=rgba,loop=/);
    assert.doesNotMatch(tall, /pad=260/, "the overlay centres the end card logo itself");
    assert.match(tall, /overlay=x=\(main_w-overlay_w\)\/2:y=512-overlay_h\/2:enable='gte\(t,11\.5\)':shortest=1/);
    const wideGeometry = bandGeometry({ w: 1280, h: 720, logo: LOGO });
    const wide = graphOf(buildLyricRenderArgs({ ...base, width: 1280, height: 720, ...withPlan(PLAN_EXTENDED, LOGO, wideGeometry) }));
    assert.match(wide, /y=259-overlay_h\/2:/);
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

// ---- Branding plan, rendered for real ----

function putRedLogo(dir, size = "64x64") {
  const file = path.join(dir, `logo-${size}.png`);
  const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=red:s=${size}`, "-frames:v", "1", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

/** RGB of one pixel of the frame at `t` seconds. */
function pixelAt(video, x, y, t) {
  const r = spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1",
    "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
  assert.equal(r.status, 0, String(r.stderr));
  return [...r.stdout.subarray(0, 3)];
}

/** The loudest sample, in dB, of the audio that `inputArgs` select from `file`. */
function maxVolume(file, inputArgs) {
  const r = spawnSync(FF, ["-hide_banner", ...inputArgs, "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr.toString());
  assert.ok(m, `volumedetect reported no level: ${r.stderr.toString().slice(-400)}`);
  return m[1] === "-inf" ? -Infinity : Number(m[1]);
}

const isRed = ([r, g, b]) => r > 180 && g < 90 && b < 90;

async function renderPlanned(dir, { song, background = null, ass, plan, geometry, logo, name = "out" }) {
  const out = path.join(dir, `${name}.mp4`);
  const job = createJob("u1", { durationSec: plan.totalSec });
  const r = await runLyricRender({
    jobId: job.jobId, songPath: song, background, assPath: ass, width: 360, height: 640,
    durationSec: plan.audio.inputSec, outPath: out, plan, geometry, logo,
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(getJob(job.jobId).status, "done");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("filter-")), []);
  return out;
}

/** The fixture captions plus the branding lines for `plan`, as the render reads them. */
function brandedAss(dir, plan, geometry) {
  const lines = brandingEvents({ plan, geometry, look: resolveLook("studio-lagos-night"), title: "Grace", artist: "Sthill Waters", w: 360, h: 640 });
  const file = path.join(dir, "branded.ass");
  fs.writeFileSync(file, `${ASS.slice(0, -1)}\n${lines.join("\n")}\n`);
  return file;
}

const SKIP = !hasFfmpeg && "ffmpeg not installed";

test("a song that ends right after its last line gets 3 s more picture and silence", { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-brand-"));
  try {
    const { song } = makeFixtures(dir);
    const file = putRedLogo(dir);
    const logo = { file, width: 64, height: 64, opacity: 0.85 };
    const geometry = bandGeometry({ w: 360, h: 640, logo });
    const plan = planBranding({
      // captions end 1.8 s in, so the card (0.2 s later, 3 s long) lands exactly 3 s past the song
      durationSec: 2, audibleEnd: 2, captionsEnd: 1.8, hideWindows: [], options: { logo: true, intro: true, endCard: true },
      hasLogo: true, artist: "Sthill Waters", shortsTrim: false, aspect: "portrait", lines: [],
    });
    assert.equal(plan.totalSec, 5);
    const out = await renderPlanned(dir, { song, ass: brandedAss(dir, plan, geometry), plan, geometry, logo });
    const d = streamDurations(out);
    assert.ok(Math.abs(d.video - 5) <= 0.1, `video duration ${d.video}`);
    assert.ok(Math.abs(d.audio - 5) <= 0.1, `audio duration ${d.audio}`);
    const tail = maxVolume(out, ["-sseof", "-1"]);
    assert.ok(tail <= -60, `the last second should be silent, max_volume ${tail} dB`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the logo shows during its band pieces and steps aside between them", { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-brand-"));
  try {
    const { song, ass } = makeFixtures(dir);
    const file = putRedLogo(dir);
    const logo = { file, width: 64, height: 64, opacity: 1 };
    const geometry = bandGeometry({ w: 360, h: 640, logo });
    const plan = {
      totalSec: 3.2, audio: { inputSec: 2, padToSec: 3.2, fadeFromSec: 0, fadeSec: 0 },
      bandPieces: [[0, 0.8], [1.6, 3]], intro: [], wordmark: [], showLogo: true, endCard: null,
    };
    const out = await renderPlanned(dir, { song, ass, plan, geometry, logo });
    const x = geometry.logo.x + Math.round(geometry.logo.w / 4);
    const y = geometry.logo.y + Math.round(geometry.logo.h / 4);
    assert.ok(isRed(pixelAt(out, x, y, 0.4)), `logo at 0.4 s: ${pixelAt(out, x, y, 0.4)}`);
    assert.ok(!isRed(pixelAt(out, x, y, 1.2)), `no logo at 1.2 s: ${pixelAt(out, x, y, 1.2)}`);
    assert.ok(isRed(pixelAt(out, x, y, 2.5)), `logo at 2.5 s: ${pixelAt(out, x, y, 2.5)}`);
    const d = streamDurations(out);
    assert.ok(Math.abs(d.video - 3.2) <= 0.1 && Math.abs(d.audio - 3.2) <= 0.1, JSON.stringify(d));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the end card dims the picture and shows the big logo, centred", { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-brand-"));
  try {
    const { song } = makeFixtures(dir);
    // A tall, narrow logo: only centred does it cover the middle of the frame.
    const file = putRedLogo(dir, "32x96");
    const white = path.join(dir, "white.png");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=360x640", "-frames:v", "1", white]);
    const logo = { file, width: 32, height: 96, opacity: 0.85 };
    const geometry = bandGeometry({ w: 360, h: 640, logo });
    const plan = planBranding({
      durationSec: 2, audibleEnd: 2, captionsEnd: 1.9, hideWindows: [], options: { logo: true, intro: true, endCard: true },
      hasLogo: true, artist: "Sthill Waters", shortsTrim: false, aspect: "portrait", lines: [],
    });
    const background = { file: white, kind: "image", fit: "cover" };
    const out = await renderPlanned(dir, { song, background, ass: brandedAss(dir, plan, geometry), plan, geometry, logo });
    const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];
    const before = sum(pixelAt(out, 20, 620, 0.5));
    const after = sum(pixelAt(out, 20, 620, plan.totalSec - 0.3));
    assert.ok(after <= 0.2 * before, `the end card should dim the picture: ${before} -> ${after}`);
    const centre = [180, Math.round(0.4 * 640)];
    assert.ok(isRed(pixelAt(out, ...centre, plan.totalSec - 0.3)), "the end card logo is drawn");
    assert.ok(!isRed(pixelAt(out, ...centre, 1)), "the end card logo waits for the end card");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a very wide logo at half opacity is fitted and padded to its box", { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-brand-"));
  try {
    const { song, ass } = makeFixtures(dir);
    const file = putRedLogo(dir, "200x40");
    const logo = { file, width: 200, height: 40, opacity: 0.5 };
    const geometry = bandGeometry({ w: 360, h: 640, logo });
    // 5:1 is wider than the 3:1 box, so the fit leaves padding above and below the logo.
    const { x, y, w, h } = geometry.logo;
    assert.ok(w / h < 5, `the box ${w}x${h} is narrower than the logo`);
    const plan = {
      totalSec: 2, audio: { inputSec: 2, padToSec: 2, fadeFromSec: 0, fadeSec: 0 },
      bandPieces: [[0, 2]], intro: [], wordmark: [], showLogo: true, endCard: null,
    };
    // Rendering at all proves blend and alphamerge got equal sizes.
    const out = await renderPlanned(dir, { song, ass, plan, geometry, logo });
    const [r, g] = pixelAt(out, x + Math.round(w / 4), y + Math.round(h / 2), 1);
    assert.ok(r > 100 && r < 180 && g < 60, `half-red logo inside its box: ${r},${g}`);
    const pad = pixelAt(out, x + Math.round(w / 4), y + 1, 1);
    assert.ok(!isRed(pad) && pad[0] < 60, `the padding stays clear: ${pad}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the Shorts trim cuts the song and fades it out", { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-brand-"));
  try {
    const { ass } = makeFixtures(dir);
    const song = path.join(dir, "four.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:a", "aac", song]);
    const plan = {
      totalSec: 3, audio: { inputSec: 3, padToSec: 3, fadeFromSec: 2, fadeSec: 1 },
      bandPieces: [], intro: [], wordmark: [], showLogo: false, endCard: null,
    };
    const out = await renderPlanned(dir, { song, ass, plan, geometry: bandGeometry({ w: 360, h: 640, logo: null }), logo: null });
    const d = streamDurations(out);
    assert.ok(Math.abs(d.video - 3) <= 0.1, `video duration ${d.video}`);
    assert.ok(Math.abs(d.audio - 3) <= 0.1, `audio duration ${d.audio}`);
    const middle = maxVolume(out, ["-ss", "0.5", "-t", "1"]);
    const end = maxVolume(out, ["-sseof", "-0.2"]);
    assert.ok(end <= middle - 12, `the end should be faded: middle ${middle} dB, end ${end} dB`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
