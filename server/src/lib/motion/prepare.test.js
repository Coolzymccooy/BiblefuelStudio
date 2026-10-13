import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { orientationOf, workImageArgs } from "./prepare.js";
import { ffmpegAvailable, FFMPEG } from "./testkit.js";

// One temp directory for the whole file, removed when the file's tests finish.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "motion-prep-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let fileCount = 0;

/** Writes `buf` into the shared scratch directory and returns its path. */
function tmpFile(buf, name = "p.jpg") {
  fileCount += 1;
  const f = path.join(scratch, `${fileCount}-${name}`);
  fs.writeFileSync(f, buf);
  return f;
}

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

test("a panorama is cropped to 4:1 before it is scaled, after any rotation", () => {
  const vfOf = (width, height, orientation) => {
    const { args } = workImageArgs({ src: "a", out: "b", width, height, orientation });
    return args[args.indexOf("-vf") + 1];
  };
  assert.equal(vfOf(6000, 100, 1), "crop='min(iw,ih*4)':ih,scale=-2:2160,setsar=1");
  assert.equal(vfOf(100, 6000, 6), "transpose=1,crop='min(iw,ih*4)':ih,scale=-2:2160,setsar=1");
  assert.equal(vfOf(4000, 3000, 1), "scale=-2:2160,setsar=1");
});

// ---- Hostile input: orientationOf parses untrusted user uploads ----

const isOrientation = (o) => Number.isInteger(o) && o >= 1 && o <= 8;

const SOI = Buffer.from([0xff, 0xd8]);

/** A TIFF block: byte order, magic 42, IFD0 offset, then one entry (or `count` entries). */
function tiff({ le = true, ifdOff = 8, count = 1, tag = 0x0112, type = 3, cnt = 1, val = 6 } = {}) {
  const b = Buffer.alloc(8 + 2 + 12 * Math.min(Math.max(count, 1), 4));
  const w16 = (v, o) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (v, o) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  b.write(le ? "II" : "MM", 0, "ascii"); w16(42, 2); w32(ifdOff, 4);
  if (ifdOff === 8) { w16(count, 8); w16(tag, 10); w16(type, 12); w32(cnt, 14); w16(val, 18); }
  return b;
}

/** An APP segment: marker, big-endian length (body + 2 unless overridden), body. */
function seg(marker, body, lenOverride) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(lenOverride ?? body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
}

const exifSeg = (t, lenOverride) => seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "binary"), t]), lenOverride);

const HOSTILE = [
  ["valid little-endian orientation 6", () => Buffer.concat([SOI, exifSeg(tiff({ val: 6 }))]), 6],
  ["valid big-endian orientation 3", () => Buffer.concat([SOI, exifSeg(tiff({ le: false, val: 3 }))]), 3],
  ["JFIF APP0 before Exif", () => Buffer.concat([SOI, seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary")), exifSeg(tiff({ val: 8 }))]), 8],
  ["fill bytes before the APP1 marker", () => Buffer.concat([SOI, Buffer.from([0xff]), exifSeg(tiff({ val: 6 }))]), 6],
  ["segment length 0 repeated", () => Buffer.concat([SOI, ...Array(1000).fill(Buffer.from([0xff, 0xe2, 0, 0]))]), 1],
  ["segment length 1", () => Buffer.concat([SOI, ...Array(1000).fill(Buffer.from([0xff, 0xe2, 0, 1]))]), 1],
  ["segment length 0xFFFF past the end", () => Buffer.concat([SOI, Buffer.from([0xff, 0xe2, 0xff, 0xff]), Buffer.alloc(100)]), 1],
  ["Exif segment length 0xFFFF", () => Buffer.concat([SOI, exifSeg(tiff({ val: 6 }), 0xffff)]), 1],
  ["IFD offset 0", () => Buffer.concat([SOI, exifSeg(tiff({ ifdOff: 0 }))]), 1],
  ["IFD offset 0x7FFFFFFF (big-endian)", () => Buffer.concat([SOI, exifSeg(tiff({ ifdOff: 0x7fffffff, le: false }))]), 1],
  ["IFD offset 0xFFFFFFFF", () => Buffer.concat([SOI, exifSeg(tiff({ ifdOff: 0xffffffff }))]), 1],
  ["entry count 0", () => Buffer.concat([SOI, exifSeg(tiff({ count: 0 }))]), 1],
  ["entry count 0xFFFF with no entries behind it", () => Buffer.concat([SOI, exifSeg(tiff({ count: 0xffff, tag: 0x0100 }))]), 1],
  ["orientation value 0", () => Buffer.concat([SOI, exifSeg(tiff({ val: 0 }))]), 1],
  ["orientation value 9", () => Buffer.concat([SOI, exifSeg(tiff({ val: 9 }))]), 1],
  ["orientation value 0xFFFF", () => Buffer.concat([SOI, exifSeg(tiff({ val: 0xffff }))]), 1],
  ["Exif header with no TIFF block", () => Buffer.concat([SOI, seg(0xe1, Buffer.from("Exif\0\0", "binary"))]), 1],
  ["truncated Exif (header and two bytes)", () => Buffer.concat([SOI, seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "binary"), Buffer.from("II")]))]), 1],
  ["SOS before Exif", () => Buffer.concat([SOI, Buffer.from([0xff, 0xda, 0, 2]), exifSeg(tiff({ val: 6 }))]), 1],
  ["Exif beyond the 128 KB read", () => Buffer.concat([SOI, seg(0xe2, Buffer.alloc(60000)), seg(0xe2, Buffer.alloc(60000)), seg(0xe2, Buffer.alloc(60000)), exifSeg(tiff({ val: 6 }))]), 1],
  ["PNG header", () => Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), 1],
  ["WebP header", () => Buffer.from("RIFF\x24\0\0\0WEBPVP8X", "binary"), 1],
  ["HEIC header", () => Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "binary"), 1],
  ["empty file", () => Buffer.alloc(0), 1],
  ["SOI only", () => SOI, 1],
  ["1 MB of 0xFF", () => Buffer.alloc(1 << 20, 0xff), 1],
  ["SOI then 1 MB of 0xFF", () => Buffer.concat([SOI, Buffer.alloc(1 << 20, 0xff)]), 1],
];

for (const [name, make, want] of HOSTILE) {
  test(`hostile fixture: ${name} reads as ${want}`, () => {
    assert.equal(orientationOf(tmpFile(make())), want);
  });
}

test("every truncation of a valid JPEG reads as 1..8, and the whole file reads 6", () => {
  const full = jpegWithOrientation(6);
  for (let n = 0; n <= full.length; n += 1) {
    const o = orientationOf(tmpFile(full.subarray(0, n)));
    assert.ok(isOrientation(o), `length ${n} gave ${o}`);
  }
  assert.equal(orientationOf(tmpFile(full)), 6);
});

test("a missing file, a directory and non-path arguments are orientation 1", () => {
  assert.equal(orientationOf(path.join(scratch, "does-not-exist.jpg")), 1);
  assert.equal(orientationOf(scratch), 1);
  for (const x of [undefined, null, 42, "", "\0bad"]) assert.equal(orientationOf(x), 1, String(x));
});

// ---- ffmpeg render: the args produce the working image the effects expect ----

const haveFfmpeg = ffmpegAvailable();
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");

function run(bin, args) {
  return spawnSync(bin, args, { encoding: "utf8" });
}

function runFfmpeg(args) {
  const r = run(FFMPEG, args);
  assert.equal(r.status, 0, r.stderr);
}

function makeSource(dir, name, width, height) {
  const f = path.join(dir, name);
  runFfmpeg(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=1`, "-frames:v", "1", "-q:v", "2", f]);
  return f;
}

function probe(file) {
  const r = run(FFPROBE, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", file]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout).streams[0];
  return { width: Number(s.width), height: Number(s.height), frames: Number(s.nb_read_frames) };
}

test("workImageArgs renders the expected working image with ffmpeg", { skip: !haveFfmpeg }, () => {
  const dir = fs.mkdtempSync(path.join(scratch, "render-"));
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
    runFfmpeg(args);
    const got = probe(out);
    assert.equal(got.frames, 1, `${c.name}: frame count`);
    assert.deepEqual({ width: got.width, height: got.height }, { width: c.want.w, height: c.want.h }, c.name);
  }
});

// Pixel check: the four quadrants of an upright reference must come out in the
// same places, so a sideways or mirrored result of the right size still fails.
const COLOURS = { R: [255, 0, 0], B: [0, 0, 255], G: [0, 200, 0], Y: [255, 255, 0] };

function nearestColour(rgb) {
  let best = "?";
  let bestDistance = Infinity;
  for (const [name, c] of Object.entries(COLOURS)) {
    const d = c.reduce((acc, v, i) => acc + (v - rgb[i]) ** 2, 0);
    if (d < bestDistance) { bestDistance = d; best = name; }
  }
  return bestDistance < 6000 ? best : `?(${rgb.join(",")})`;
}

/** Upright reference: top-left red, top-right blue, bottom-left green, bottom-right yellow. */
function uprightReference(width, height) {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = y < height / 2 ? (x < width / 2 ? COLOURS.R : COLOURS.B) : (x < width / 2 ? COLOURS.G : COLOURS.Y);
      px.set(c, (y * width + x) * 3);
    }
  }
  return px;
}

/**
 * EXIF semantics: where the stored pixel at row r, column c is displayed
 * (x, y), given the stored width ws and height hs.
 */
const DISPLAY_OF = {
  1: (r, c) => [c, r],
  2: (r, c, ws) => [ws - 1 - c, r],
  3: (r, c, ws, hs) => [ws - 1 - c, hs - 1 - r],
  4: (r, c, ws, hs) => [c, hs - 1 - r],
  5: (r, c) => [r, c],
  6: (r, c, ws, hs) => [hs - 1 - r, c],
  7: (r, c, ws, hs) => [hs - 1 - r, ws - 1 - c],
  8: (r, c, ws) => [r, ws - 1 - c],
};

/** The stored image for an upright reference: the inverse of the EXIF transform. */
function storedFor(upright, width, height, orientation) {
  const swap = orientation >= 5;
  const ws = swap ? height : width;
  const hs = swap ? width : height;
  const stored = Buffer.alloc(ws * hs * 3);
  for (let r = 0; r < hs; r += 1) {
    for (let c = 0; c < ws; c += 1) {
      const [x, y] = DISPLAY_OF[orientation](r, c, ws, hs);
      upright.copy(stored, (r * ws + c) * 3, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return { stored, ws, hs };
}

const PIXEL_REFERENCES = [
  { label: "tall", width: 1200, height: 1600, shape: "tall", out: { width: 2160, height: 3840 } },
  { label: "wide", width: 1600, height: 1200, shape: "wide", out: { width: 2880, height: 2160 } },
];

for (const ref of PIXEL_REFERENCES) {
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    test(`orientation ${orientation} renders the ${ref.label} reference upright`, { skip: !haveFfmpeg }, () => {
      const dir = fs.mkdtempSync(path.join(scratch, "pixels-"));
      const { stored, ws, hs } = storedFor(uprightReference(ref.width, ref.height), ref.width, ref.height, orientation);
      const ppm = path.join(dir, "stored.ppm");
      fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${ws} ${hs}\n255\n`), stored]));
      const src = path.join(dir, "stored.jpg");
      runFfmpeg(["-hide_banner", "-v", "error", "-y", "-i", ppm, "-q:v", "2", src]);

      const out = path.join(dir, "work.jpg");
      const { args, shape } = workImageArgs({ src, out, width: ws, height: hs, orientation });
      assert.equal(shape, ref.shape);
      runFfmpeg(args);

      const got = probe(out);
      assert.deepEqual({ width: got.width, height: got.height }, ref.out);
      const raw = path.join(dir, "work.rgb");
      runFfmpeg(["-hide_banner", "-v", "error", "-y", "-i", out, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
      const pixels = fs.readFileSync(raw);
      const at = (x, y) => nearestColour([...pixels.subarray((y * got.width + x) * 3, (y * got.width + x) * 3 + 3)]);
      const m = 150;
      const corners = at(m, m) + at(got.width - m, m) + at(m, got.height - m) + at(got.width - m, got.height - m);
      assert.equal(corners, "RBGY", "top-left, top-right, bottom-left, bottom-right");
    });
  }
}

test("an extreme panorama is capped at 4:1 and renders to 8640x2160", { skip: !haveFfmpeg }, () => {
  const dir = fs.mkdtempSync(path.join(scratch, "pano-"));
  const src = makeSource(dir, "pano.jpg", 6000, 100);
  const out = path.join(dir, "pano-work.jpg");
  const { args, shape } = workImageArgs({ src, out, width: 6000, height: 100, orientation: 1 });
  assert.equal(shape, "wide");
  runFfmpeg(args);
  assert.deepEqual(probe(out), { width: 8640, height: 2160, frames: 1 });
});

test("a tall sliver rotated by EXIF into a panorama is capped too",{ skip: !haveFfmpeg }, () => {
  const dir = fs.mkdtempSync(path.join(scratch, "pano-rot-"));
  const src = makeSource(dir, "sliver.jpg", 100, 6000);
  const out = path.join(dir, "sliver-work.jpg");
  const { args, shape } = workImageArgs({ src, out, width: 100, height: 6000, orientation: 6 });
  assert.equal(shape, "wide");
  runFfmpeg(args);
  assert.deepEqual(probe(out), { width: 8640, height: 2160, frames: 1 });
});
