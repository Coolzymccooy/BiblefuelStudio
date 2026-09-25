import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildAmbientFfmpegArgs, wrapText, dimsFor } from "./ambientRender.js";

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ambient-"));
}

const project = (over = {}) => ({
  aspect: "landscape",
  targetSec: 600,
  motion: "still",
  captions: "none",
  bed: { volume: 0.85 },
  duck: { threshold: 0.02, ratio: 8, attackMs: 20, releaseMs: 800 },
  movements: [
    { startMs: 0, endMs: 300_000 },
    { startMs: 300_000, endMs: 600_000 },
  ],
  ...over,
});

const io = (dir, over = {}) => ({
  bedPath: "/bed.m4a",
  images: ["/a.png", "/b.png"],
  drops: [],
  outPath: path.join(dir, "out.mp4"),
  workDir: dir,
  ...over,
});

test("dimsFor covers the three aspects", () => {
  assert.deepEqual(dimsFor("landscape"), { width: 1920, height: 1080 });
  assert.deepEqual(dimsFor("portrait"), { width: 1080, height: 1920 });
  assert.deepEqual(dimsFor("square"), { width: 1080, height: 1080 });
  assert.deepEqual(dimsFor(undefined), { width: 1920, height: 1080 }, "landscape is the default");
});

test("the bed leads the final mix so it sets the video length", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project(), io(dir, {
    drops: [{ atMs: 60_000, audioPath: "/d1.mp3", status: "done", durationMs: 4000, text: "x" }],
  }));
  // duration=first with [ducked] (the bed) first: the music decides the length,
  // not a four-second verse.
  assert.match(filter, /\[ducked\]\[vm\]amix=inputs=2:normalize=0:duration=first\[aout\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("each drop is offset to its own time and padded to full length", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project(), io(dir, {
    drops: [
      { atMs: 120_000, audioPath: "/d1.mp3", status: "done" },
      { atMs: 300_000, audioPath: "/d2.mp3", status: "done" },
    ],
  }));
  assert.match(filter, /adelay=120000:all=1/);
  assert.match(filter, /adelay=300000:all=1/);
  assert.match(filter, /apad=whole_dur=600/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("several drops are summed without amix's averaging", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project(), io(dir, {
    drops: [
      { atMs: 1000, audioPath: "/d1.mp3", status: "done" },
      { atMs: 2000, audioPath: "/d2.mp3", status: "done" },
      { atMs: 3000, audioPath: "/d3.mp3", status: "done" },
    ],
  }));
  // Without normalize=0 each sparse verse would play at a third of its level.
  assert.match(filter, /\[d0\]\[d1\]\[d2\]amix=inputs=3:normalize=0:duration=shortest\[voice\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a single drop skips the summing mix but still ducks", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project(), io(dir, {
    drops: [{ atMs: 1000, audioPath: "/d1.mp3", status: "done" }],
  }));
  assert.ok(!/amix=inputs=1/.test(filter), "one input needs no mix");
  assert.match(filter, /\[d0\]anull\[voice\]/);
  assert.match(filter, /sidechaincompress=threshold=0\.02:ratio=8:attack=20:release=800/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("no drops means no voice chain at all — the bed is the whole audio", () => {
  const dir = work();
  const { filter, args } = buildAmbientFfmpegArgs(project(), io(dir, { drops: [] }));
  assert.ok(!/sidechaincompress/.test(filter), "nothing to duck against");
  assert.ok(!/asplit/.test(filter));
  assert.ok(args.includes("[bed]"), "the bed maps straight to output");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("drops that failed to voice are left out of the graph", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project(), io(dir, {
    drops: [
      { atMs: 1000, audioPath: "/d1.mp3", status: "done" },
      { atMs: 2000, audioPath: null, status: "error" },
    ],
  }));
  assert.ok(!/adelay=2000/.test(filter), "an errored drop has no audio to place");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("no inline -filter_complex survives to the spawn", () => {
  const dir = work();
  const { args, scriptFile } = buildAmbientFfmpegArgs(project(), io(dir));
  assert.ok(!args.includes("-filter_complex"), "prod ffmpeg is 5.1");
  assert.ok(args.includes("-filter_complex_script"));
  assert.ok(scriptFile && fs.existsSync(scriptFile));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("drift moves each picture with a smooth perspective zoom at the encoder's frame rate", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ motion: "drift" }), io(dir));
  // zoompan snaps to whole pixels: on a slow move the picture sat still, then
  // jumped, every second or two. The perspective warp moves every frame.
  assert.ok(!/zoompan/.test(filter));
  assert.equal(filter.match(/perspective=/g)?.length, 2, "one per picture");
  // Frames reach the warp at 24 already, so its frame counter is the video's
  // own clock. The image demuxer's default 25 would run the breathing fast.
  for (const chain of filter.split(";\n").filter((c) => c.includes("perspective="))) {
    assert.ok(chain.indexOf("fps=24") < chain.indexOf("perspective="), chain);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("still motion adds no movement at all", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ motion: "still" }), io(dir));
  assert.ok(!/zoompan|perspective/.test(filter));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("captions burn only for drops that have text and a measured duration", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static" }), io(dir, {
    drops: [
      { atMs: 60_000, audioPath: "/d1.mp3", status: "done", text: "The LORD is my shepherd", durationMs: 4000 },
      { atMs: 120_000, audioPath: "/d2.mp3", status: "done", text: "no duration measured", durationMs: null },
    ],
  }));
  assert.equal(filter.match(/drawtext=/g)?.length, 1, "one line, one drawtext — and only the timeable drop");
  assert.match(filter, /enable='between\(t,60\.00,64\.00\)'/);
  assert.ok(!/enable='between\(t,120/.test(filter), "the untimed drop is not drawn");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a multi-line verse becomes one drawtext per line, each file free of newlines", () => {
  // A single textfile carrying a line break renders the break itself as a
  // missing-glyph box at the end of every line on this ffmpeg. Found by
  // looking at a rendered frame, not by a passing test.
  const dir = work();
  const text = "He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul.";
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static" }), io(dir, {
    drops: [{ atMs: 1000, audioPath: "/d1.mp3", status: "done", text, durationMs: 9000 }],
  }));
  const files = [...filter.matchAll(/textfile='([^']+)'/g)].map((m) => m[1]);
  assert.ok(files.length > 1, "a long verse wraps to several lines");
  for (const f of files) {
    const onDisk = f.replace(/\\:/g, ":"); // undo the drive-colon escaping
    assert.ok(!/[\r\n]/.test(fs.readFileSync(onDisk, "utf8")), `${onDisk} still carries a line break`);
  }
});

test("the caption block never runs off the bottom of the frame", () => {
  // y=h*0.72 pushed a four-line verse past 1080 and clipped the last line.
  const dir = work();
  const text = "Come unto me, all ye that labour and are heavy laden, and I will give you rest. "
    + "Take my yoke upon you, and learn of me; for I am meek and lowly in heart: "
    + "and ye shall find rest unto your souls.";
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static" }), io(dir, {
    drops: [{ atMs: 1000, audioPath: "/d1.mp3", status: "done", text, durationMs: 15000 }],
  }));
  const size = Number(filter.match(/fontsize=(\d+)/)[1]);
  const ys = [...filter.matchAll(/:y=(\d+):/g)].map((m) => Number(m[1]));
  assert.ok(ys.length > 1);
  assert.ok(Math.min(...ys) > 0, "the block must not start above the frame");
  assert.ok(Math.max(...ys) + size <= 1080, `last line at ${Math.max(...ys)} + ${size} overflows 1080`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("captions use the bundled serif, not ffmpeg's default monospace", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static" }), io(dir, {
    drops: [{ atMs: 1000, audioPath: "/d1.mp3", status: "done", text: "hello", durationMs: 2000 }],
  }));
  assert.match(filter, /fontfile='[^']*PlayfairDisplay-BoldItalic\.ttf'/);
  fs.rmSync(dir, { recursive: true, force: true });
});

const PHIL = [
  "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.",
  "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.",
];
const captionTexts = (filter) => [...filter.matchAll(/textfile='([^']+)'/g)]
  .map((m) => fs.readFileSync(m[1].replace(/\\:/g, ":"), "utf8"));

test("a passage is shown a verse at a time, each on at most two lines, taking turns", () => {
  // Six boxed lines parked mid-frame read as a notice pinned over the picture.
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse({ reference: "Philippians 4:6-7", text: PHIL.join(" "), verses: PHIL })],
  }));
  const drawn = [...filter.matchAll(/textfile='([^']+)'[^,]*?enable='between\(t,([\d.]+),([\d.]+)\)'/g)]
    .map((m) => ({ text: fs.readFileSync(m[1].replace(/\\:/g, ":"), "utf8"), start: Number(m[2]), end: Number(m[3]) }));
  const byWindow = new Map();
  for (const d of drawn) byWindow.set(`${d.start}-${d.end}`, [...(byWindow.get(`${d.start}-${d.end}`) || []), d.text]);
  const pages = [...byWindow.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  assert.equal(pages.length, 2, `one page per verse: ${JSON.stringify(pages)}`);
  const [first, second] = pages.map(([, texts]) => texts);
  assert.ok(first.join(" ").startsWith("Be careful for nothing"));
  assert.ok(second.join(" ").startsWith("And the peace of God"));
  for (const texts of [first, second]) {
    const lines = texts.filter((t) => t !== "Philippians 4:6-7");
    assert.ok(lines.length <= 2, `at most two lines: ${JSON.stringify(lines)}`);
  }
  const [w1, w2] = pages.map(([k]) => k.split("-").map(Number));
  assert.equal(w1[0], 0);
  // Back to back, but never both on screen in the same frame: between() is
  // inclusive at both ends.
  assert.ok(w1[1] < w2[0] && w2[0] - w1[1] <= 0.05, `the second verse follows the first: ${w1} ${w2}`);
  assert.equal(w2[1], 300, "and the pair fills the section");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("captions have no boxes: white text lifted by a soft shadow", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse()],
  }));
  assert.ok(!/box=1/.test(filter), "no box behind the lines");
  assert.match(filter, /shadowcolor=black@/);
  // Scripture is drawn as written: no %{...} or backslash expansion.
  assert.match(filter, /expansion=none/);
  assert.match(filter, /borderw=\d+:bordercolor=black@/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("every word of the passage is drawn, in order", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse({ reference: "Philippians 4:6-7", text: PHIL.join(" "), verses: PHIL })],
  }));
  const body = captionTexts(filter).filter((t) => t !== "Philippians 4:6-7").join(" ");
  assert.equal(body, PHIL.join(" "));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("portrait keeps lines short enough for the narrow frame", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ aspect: "portrait", captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse({ text: PHIL.join(" "), verses: PHIL })],
  }));
  for (const t of captionTexts(filter)) assert.ok(t.length <= 48, `"${t}" is too long for 1080 wide`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the caption path has its drive colon escaped", () => {
  // A bare "C:" terminates the drawtext option and ffmpeg rejects the entire
  // filtergraph with "No option name near ...". This cost a failed render.
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static" }), io(dir, {
    drops: [{ atMs: 1000, audioPath: "/d1.mp3", status: "done", text: "hello", durationMs: 2000 }],
  }));
  const m = filter.match(/textfile='([^']+)'/);
  assert.ok(m, "a caption should have been drawn");
  assert.ok(!/(^|[^\\]):/.test(m[1]), `unescaped colon in ${m[1]}`);
  assert.ok(!m[1].includes("\\\\"), "backslashes should have become forward slashes");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("captions off means no drawtext even when drops carry text", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "none" }), io(dir, {
    drops: [{ atMs: 60_000, audioPath: "/d1.mp3", status: "done", text: "hello", durationMs: 4000 }],
  }));
  assert.ok(!/drawtext/.test(filter));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a missing bed is fatal — there is no video without it", () => {
  const dir = work();
  assert.throws(
    () => buildAmbientFfmpegArgs(project(), io(dir, { bedPath: null })),
    /no bed/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("wrapText breaks long verses into readable lines", () => {
  const lines = wrapText("The LORD is my shepherd I shall not want He maketh me to lie down in green pastures", 30);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.length <= 30));
  assert.equal(lines.join(" ").split(/\s+/).length, 18, "no words lost in the wrap");
});

// "Whole section": a verse stays up for as long as its picture does, not
// only for the ten seconds it is spoken. Otherwise a ten-minute session shows
// ten seconds of scripture and nine minutes fifty of a bare image.
const verse = (over = {}) => ({
  atMs: 60_000, audioPath: "/d1.mp3", status: "done", reference: "Psalms 46:1-2", translation: "kjv",
  text: "God is our refuge and strength, a very present help in trouble.", durationMs: 8000, ...over,
});
const windows = (filter) => [...filter.matchAll(/enable='between\(t,([\d.]+),([\d.]+)\)'/g)].map((m) => [Number(m[1]), Number(m[2])]);

test("section span holds each verse for its whole movement", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse({ atMs: 60_000 }), verse({ atMs: 420_000, reference: "Isaiah 26:3", audioPath: "/d2.mp3" })],
  }));
  const spans = new Set(windows(filter).map(([a, b]) => `${a}-${b}`));
  assert.ok(spans.has("0-300"), `first verse spans the first movement: ${[...spans]}`);
  assert.ok(spans.has("300-600"), `second verse spans the second movement: ${[...spans]}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("section span fades in and out rather than popping on and off", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse()],
  }));
  assert.match(filter, /alpha='if\(lt\(t,1\.50\),\(t-0\.00\)\/1\.50,if\(gt\(t,298\.50\),\(300\.00-t\)\/1\.50,1\)\)'/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("section span names the verse beneath it, in the same window", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse()],
  }));
  const texts = [...filter.matchAll(/textfile='([^']+)'/g)].map((m) => fs.readFileSync(m[1].replace(/\\:/g, ":"), "utf8"));
  // KJV is the default and is named in the description; a modern translation
  // is named on screen, since its publisher requires the attribution.
  assert.ok(texts.includes("Psalms 46:1-2"), `reference line missing: ${JSON.stringify(texts)}`);
  const niv = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "section" }), io(dir, {
    drops: [verse({ translation: "niv" })],
  }));
  assert.ok(captionTexts(niv.filter).includes("Psalms 46:1-2 · NIV"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("spoken span is unchanged: the verse shows only while it is heard", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "static", captionSpan: "spoken" }), io(dir, {
    drops: [verse()],
  }));
  assert.ok(windows(filter).every(([a, b]) => a === 60 && b === 68), JSON.stringify(windows(filter)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("centre position sits the block in the middle of the frame", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(
    project({ captions: "static", captionSpan: "section", captionPosition: "centre" }),
    io(dir, { drops: [verse()] }),
  );
  const ys = [...filter.matchAll(/:y=(\d+):/g)].map((m) => Number(m[1]));
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  assert.ok(Math.abs(mid - 540) < 120, `block centred near 540, got ${Math.min(...ys)}..${Math.max(...ys)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("captions off still draws nothing, whatever the span says", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ captions: "none", captionSpan: "section" }), io(dir, {
    drops: [verse()],
  }));
  assert.ok(!/drawtext/.test(filter));
  fs.rmSync(dir, { recursive: true, force: true });
});
