import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildAmbientFfmpegArgs, wrapText, dimsFor, layOutCaption } from "./ambientRender.js";

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

test("drift motion passes the encoder fps to Ken Burns rather than its default 30", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ motion: "drift" }), io(dir));
  assert.match(filter, /zoompan/);
  // The zoompan must be built at 24: the default 30 runs the drift fast.
  assert.match(filter, /fps=24/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("still motion adds no zoompan at all", () => {
  const dir = work();
  const { filter } = buildAmbientFfmpegArgs(project({ motion: "still" }), io(dir));
  assert.ok(!/zoompan/.test(filter));
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

test("layOutCaption shrinks a long verse rather than letting it overflow", () => {
  const text = "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving "
    + "let your requests be made known unto God. And the peace of God, which passeth all "
    + "understanding, shall keep your hearts and minds through Christ Jesus.";
  const short = layOutCaption("The LORD is my shepherd; I shall not want.", 1080);
  const long = layOutCaption(text, 1080);
  assert.ok(long.size < short.size, "the long verse takes a smaller size");
  assert.ok(long.lines.length * long.size * 1.4 <= 1080 * 0.32, "and still fits its share of the frame");
  // Shrinking must never become truncating — scripture is burned verbatim.
  assert.equal(long.lines.join(" "), text.split(/\s+/).join(" "), "no words lost in the wrap");
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
