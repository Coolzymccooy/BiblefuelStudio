import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { sniffImage, imageHeaderSize } from "./imageSniff.js";

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

test("the size every format declares is read from its header, without decoding", { skip: !hasFfmpeg && "ffmpeg not installed" }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sniff-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases = [
    ["a.png", []],
    ["a.jpg", []],
    ["lossy.webp", ["-lossless", "0"]],
    ["lossless.webp", ["-lossless", "1"]],
  ];
  for (const [name, extra] of cases) {
    const file = path.join(dir, name);
    const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=red:s=1234x568", "-frames:v", "1", ...extra, file]);
    assert.equal(r.status, 0, String(r.stderr));
    const size = imageHeaderSize(file, sniffImage(file));
    assert.equal(size?.w, 1234, name);
    assert.equal(size?.h, 568, name);
    assert.ok(!size.animated, name);
  }
});

test("a JPEG with a big EXIF block before its frame header is still read", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sniff-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app1 = Buffer.alloc(4 + 60000);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(60002, 2);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x0b, 0xb8]); // 4000 high, 3000 wide
  const file = path.join(dir, "phone.jpg");
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.alloc(16)]));
  assert.deepEqual(imageHeaderSize(file, "jpeg"), { w: 3000, h: 4000 });
});

test("a truncated or foreign header reads as null, never a guess", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sniff-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "bad.png");
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
  assert.equal(imageHeaderSize(file, "png"), null);
  assert.equal(imageHeaderSize(path.join(dir, "missing.jpg"), "jpeg"), null);
});
