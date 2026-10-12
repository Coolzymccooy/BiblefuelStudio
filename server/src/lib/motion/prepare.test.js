import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { orientationOf, workImageArgs } from "./prepare.js";
import { mulberry32 } from "../kinetic/director.js";
import { ffmpegAvailable, FFMPEG } from "./testkit.js";

/** A minimal JPEG: SOI, an APP1 Exif block with one IFD0 entry (orientation), EOI. */
function jpegWithOrientation(value, littleEndian = true) {
  const tiff = Buffer.alloc(26);
  if (littleEndian) {
    tiff.write("II", 0, "ascii"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(value, 18);
  } else {
    tiff.write("MM", 0, "ascii"); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(value, 18);
  }
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(exif.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, exif, Buffer.from([0xff, 0xd9])]);
}

function tmpFile(buf, name = "p.jpg") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-prep-"));
  const f = path.join(dir, name);
  fs.writeFileSync(f, buf);
  return f;
}

test("reads EXIF orientation from little- and big-endian JPEGs", () => {
  assert.equal(orientationOf(tmpFile(jpegWithOrientation(6))), 6);
  assert.equal(orientationOf(tmpFile(jpegWithOrientation(8, false))), 8);
});

test("anything unreadable is orientation 1", () => {
  assert.equal(orientationOf(tmpFile(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "p.png")), 1);
  assert.equal(orientationOf(tmpFile(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]))), 1);
  assert.equal(orientationOf("/no/such/file.jpg"), 1);
  assert.equal(orientationOf(tmpFile(jpegWithOrientation(42))), 1);
});

test("a portrait photo becomes a 2160x3840 cover crop, upright, with autorotate off", () => {
  const { args, shape } = workImageArgs({ src: "in.jpg", out: "w.jpg", width: 1450, height: 2576, orientation: 1 });
  assert.equal(shape, "tall");
  assert.ok(args.indexOf("-noautorotate") < args.indexOf("-i"));
  const vf = args[args.indexOf("-vf") + 1];
  assert.match(vf, /scale=2160:3840:force_original_aspect_ratio=increase/);
  assert.match(vf, /crop=2160:3840:\(iw-ow\)\/2:\(ih-oh\)\*0\.38/);
});

test("rotation 6 turns a stored landscape into a tall, upright working image", () => {
  const { args, shape } = workImageArgs({ src: "in.jpg", out: "w.jpg", width: 4032, height: 3024, orientation: 6 });
  assert.equal(shape, "tall");
  assert.match(args[args.indexOf("-vf") + 1], /^transpose=1,/);
});

test("other rotations use the matching transform", () => {
  const vf = (o) => workImageArgs({ src: "a", out: "b", width: 100, height: 200, orientation: o }).args.find((a, i, all) => all[i - 1] === "-vf");
  assert.match(vf(3), /^hflip,vflip,/);
  assert.match(vf(8), /^transpose=2,/);
  assert.match(vf(2), /^hflip,/);
  assert.match(vf(4), /^vflip,/);
  assert.match(vf(5), /^transpose=0,/);
  assert.match(vf(7), /^transpose=3,/);
});

test("a landscape photo keeps its shape at height 2160", () => {
  const { args, shape } = workImageArgs({ src: "in.jpg", out: "w.jpg", width: 4000, height: 3000, orientation: 1 });
  assert.equal(shape, "wide");
  assert.equal(args[args.indexOf("-vf") + 1], "scale=-2:2160,setsar=1");
});

// ---- Robustness: orientationOf parses untrusted user uploads ----

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "motion-prep-fuzz-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let scratchCount = 0;
function scratchFile(buf) {
  scratchCount += 1;
  const f = path.join(scratch, `f${scratchCount}.jpg`);
  fs.writeFileSync(f, buf);
  return f;
}

/** Seeded junk: random bytes, half of them behind an SOI + APP1 "Exif" header. */
function fuzzBuffer(seed) {
  const rnd = mulberry32(seed);
  const bytes = (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(rnd() * 256)));
  const body = bytes(Math.floor(rnd() * 400));
  if (seed % 2 === 1) return body;
  const order = Buffer.from(seed % 4 === 0 ? "II" : "MM", "ascii");
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), order, body]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE((exif.length + 2) & 0xffff);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, exif]);
}

const isOrientation = (o) => Number.isInteger(o) && o >= 1 && o <= 8;

test("orientationOf returns 1..8 and never throws on seeded random bytes", () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const o = orientationOf(scratchFile(fuzzBuffer(seed)));
    assert.ok(isOrientation(o), `seed ${seed} gave ${o}`);
  }
});

test("every truncation of a valid JPEG reads as 1..8, and the whole file reads 6", () => {
  const full = jpegWithOrientation(6);
  for (let n = 0; n <= full.length; n += 1) {
    const o = orientationOf(scratchFile(full.subarray(0, n)));
    assert.ok(isOrientation(o), `length ${n} gave ${o}`);
  }
  assert.equal(orientationOf(scratchFile(full)), 6);
});

test("a missing file and a directory are orientation 1", () => {
  assert.equal(orientationOf(path.join(scratch, "does-not-exist.jpg")), 1);
  assert.equal(orientationOf(scratch), 1);
});

// ---- ffmpeg render: the args produce the working image the effects expect ----

const haveFfmpeg = ffmpegAvailable();
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");

function run(bin, args) {
  return spawnSync(bin, args, { encoding: "utf8" });
}

function makeSource(dir, name, width, height) {
  const f = path.join(dir, name);
  const r = run(FFMPEG, ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=1`, "-frames:v", "1", "-q:v", "2", f]);
  assert.equal(r.status, 0, r.stderr);
  return f;
}

function probe(file) {
  const r = run(FFPROBE, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", file]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout).streams[0];
  return { width: Number(s.width), height: Number(s.height), frames: Number(s.nb_read_frames) };
}

test("workImageArgs renders the expected working image with ffmpeg", { skip: !haveFfmpeg }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-prep-render-"));
  try {
    const cases = [
      { name: "tall, orientation 1", width: 1200, height: 1600, orientation: 1, want: { w: 2160, h: 3840 } },
      { name: "stored landscape, orientation 6 turns tall", width: 1600, height: 1200, orientation: 6, want: { w: 2160, h: 3840 } },
      { name: "stored landscape, orientation 8 turns tall", width: 1600, height: 1200, orientation: 8, want: { w: 2160, h: 3840 } },
      { name: "landscape, orientation 1 stays wide", width: 1600, height: 1200, orientation: 1, want: { w: 2880, h: 2160 } },
      { name: "tall stored, orientation 6 turns wide", width: 1200, height: 1600, orientation: 6, want: { w: 2880, h: 2160 } },
    ];
    for (const c of cases) {
      const src = makeSource(dir, `src-${c.orientation}-${c.width}x${c.height}.jpg`, c.width, c.height);
      const out = path.join(dir, `work-${c.orientation}-${c.width}x${c.height}.jpg`);
      const { args } = workImageArgs({ src, out, width: c.width, height: c.height, orientation: c.orientation });
      const r = run(FFMPEG, args);
      assert.equal(r.status, 0, `${c.name}: ${r.stderr}`);
      const got = probe(out);
      assert.equal(got.frames, 1, `${c.name}: frame count`);
      assert.deepEqual({ width: got.width, height: got.height }, { width: c.want.w, height: c.want.h }, c.name);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
