import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { buildThumbnailArgs, prepareThumbnail, drawableTitle, THUMBNAIL_MAX_BYTES } from "./youtubeThumbnail.js";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "thumb-"));

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [width, height] = r.stdout.trim().split(",").map(Number);
  return { width, height };
}

/** A big, noisy PNG — the kind that blows YouTube's 2 MB thumbnail limit. */
function bigPng(where, w = 3000, h = 2000) {
  const file = path.join(where, "photo.png");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `nullsrc=s=${w}x${h},geq=random(1)*255:128:128`, "-frames:v", "1", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

test("any picture becomes a 1280x720 JPEG under YouTube's 2 MB limit", async () => {
  const d = dir();
  const src = bigPng(d);
  assert.ok(fs.statSync(src).size > THUMBNAIL_MAX_BYTES, "the fixture must start over the limit");
  const out = await prepareThumbnail(src, { workDir: d });
  assert.ok(out && out !== src);
  const head = fs.readFileSync(out).subarray(0, 3);
  assert.deepEqual([...head], [0xff, 0xd8, 0xff], "JPEG");
  assert.ok(fs.statSync(out).size <= THUMBNAIL_MAX_BYTES);
  assert.deepEqual(probe(out), { width: 1280, height: 720 });
  fs.rmSync(d, { recursive: true, force: true });
});

test("a portrait photo is cropped to fill the frame, not letterboxed", async () => {
  const d = dir();
  const out = await prepareThumbnail(bigPng(d, 800, 1400), { workDir: d });
  assert.deepEqual(probe(out), { width: 1280, height: 720 });
  fs.rmSync(d, { recursive: true, force: true });
});

test("the title can be drawn onto the thumbnail, from a file rather than the command line", () => {
  const { args } = buildThumbnailArgs("in.png", "out.jpg", { titleFiles: [path.join(os.tmpdir(), "t.txt")] });
  const vf = args[args.indexOf("-vf") + 1];
  assert.match(vf, /drawtext=textfile=/);
  assert.ok(!args.join(" ").includes("God got me"), "title text never reaches argv");
  const bare = buildThumbnailArgs("in.png", "out.jpg", {}).args;
  assert.ok(!bare[bare.indexOf("-vf") + 1].includes("drawtext"));
});

test("with a title, a real thumbnail still comes out right", async () => {
  const d = dir();
  const out = await prepareThumbnail(bigPng(d), { workDir: d, title: "God got me, everlasting love — a long title that needs two lines" });
  assert.ok(out);
  assert.deepEqual(probe(out), { width: 1280, height: 720 });
  fs.rmSync(d, { recursive: true, force: true });
});

test("a file that isn't a picture is left for YouTube to judge, not thrown", async () => {
  const d = dir();
  const junk = path.join(d, "t.png");
  fs.writeFileSync(junk, "not an image");
  assert.equal(await prepareThumbnail(junk, { workDir: d }), null);
  fs.rmSync(d, { recursive: true, force: true });
});

test("a title is drawn as plain text: % and backslash are not ffmpeg expansions", () => {
  // "100% Faith" failed to draw at all; "%{localtime}" printed the server clock.
  const { args } = buildThumbnailArgs("in.png", "out.jpg", { titleFiles: [path.join(os.tmpdir(), "t.txt")] });
  assert.match(args[args.indexOf("-vf") + 1], /expansion=none/);
});

test("a title with % in it still comes out on a real thumbnail", async () => {
  const d = dir();
  const out = await prepareThumbnail(bigPng(d, 1600, 900), { workDir: d, title: "100% Faith %{localtime} AC\DC" });
  assert.ok(out);
  fs.rmSync(d, { recursive: true, force: true });
});

test("the source is read as one still picture, never a pattern or a playlist", () => {
  const { args } = buildThumbnailArgs("in.png", "out.jpg", {});
  const i = args.indexOf("-i");
  const before = args.slice(0, i);
  assert.ok(before.includes("-max_pixels"), "a huge declared size is refused before it is decoded");
  assert.deepEqual(before.slice(before.indexOf("-f"), before.indexOf("-f") + 2), ["-f", "image2"]);
  assert.deepEqual(before.slice(before.indexOf("-pattern_type"), before.indexOf("-pattern_type") + 2), ["-pattern_type", "none"]);
});

test("a picture too big to decode safely is refused, and nothing is left behind", async () => {
  const d = dir();
  const huge = path.join(d, "huge.png");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=9000x6000", "-frames:v", "1", huge]);
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(await prepareThumbnail(huge, { workDir: d, title: "T" }), null);
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.startsWith("yt-thumb-")), []);
  fs.rmSync(d, { recursive: true, force: true });
});

test("ffmpeg that runs too long is stopped, and nothing is left behind", async () => {
  const d = dir();
  assert.equal(await prepareThumbnail(bigPng(d), { workDir: d, title: "T", timeoutMs: 1 }), null);
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.startsWith("yt-thumb-")), []);
  fs.rmSync(d, { recursive: true, force: true });
});

test("emoji are left off the picture — the font has no glyph for them", () => {
  assert.equal(drawableTitle("Peaceful Sleep 🌙 | Psalms ✨"), "Peaceful Sleep | Psalms");
  assert.equal(drawableTitle("  God got me,   everlasting love "), "God got me, everlasting love");
});
