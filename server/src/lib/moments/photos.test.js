import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePhoto, resolvePhotos, resolveSong } from "./photos.js";

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let ctx;
beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-photos-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  ctx = { dataDir, outputDir };
});
afterEach(() => fs.rmSync(ctx.dataDir, { recursive: true, force: true }));

function upload(buf = PNG, ext = "png") {
  const name = `bg-image-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(ctx.outputDir, name), buf);
  return name;
}

test("an own upload resolves to its file, URL and size", () => {
  const name = upload();
  const r = resolvePhoto(ctx, { kind: "upload", path: name }, { items: [] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.url, `/outputs/${name}`);
  assert.deepEqual([r.width, r.height], [1, 1]);
  assert.equal(r.file, fs.realpathSync(path.join(ctx.outputDir, name)));
});

test("an upload path that leaves the outputs folder is refused", () => {
  const r = resolvePhoto(ctx, { kind: "upload", path: "../../etc/passwd" }, { items: [] });
  assert.equal(r.ok, false);
});

test("a file that isn't a picture is refused with the format message", () => {
  const name = upload(Buffer.from("not an image at all"), "jpg");
  const r = resolvePhoto(ctx, { kind: "upload", path: name }, { items: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /format/);
});

test("a library item resolves through the user's own library", () => {
  const file = path.join(ctx.outputDir, "pool-abc.png");
  fs.writeFileSync(file, PNG);
  const items = [{ id: "lib1", path: file, publicUrl: "/outputs/pool-abc.png" }];
  const r = resolvePhoto(ctx, { kind: "library", id: "lib1" }, { items });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.url, "/outputs/pool-abc.png");
  assert.equal(resolvePhoto(ctx, { kind: "library", id: "nope" }, { items }).ok, false);
});

test("an unknown ref kind is refused", () => {
  assert.equal(resolvePhoto(ctx, { kind: "url", path: "http://x" }, { items: [] }).ok, false);
  assert.equal(resolvePhoto(ctx, null, { items: [] }).ok, false);
});

// The 1x1 PNG with its IHDR width and height replaced (the header is not checksummed on read).
function pngWithSize(w, h) {
  const buf = Buffer.from(PNG);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

// A WebP whose VP8X header says animated (flag 0x02), w x h.
function animatedWebp(w, h) {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBPVP8X", 8, "ascii");
  buf.writeUInt32LE(10, 16);
  buf[20] = 0x02;
  buf.writeUIntLE(w - 1, 24, 3);
  buf.writeUIntLE(h - 1, 27, 3);
  return buf;
}

test("a header declaring a zero width or height is refused as undecodable", () => {
  for (const [w, h] of [[0, 0], [0, 5], [5, 0]]) {
    const name = upload(pngWithSize(w, h));
    const r = resolvePhoto(ctx, { kind: "upload", path: name }, { items: [] });
    assert.equal(r.ok, false, `${w}x${h}`);
    assert.match(r.error, /format/);
  }
});

test("a picture over the side limit is refused", () => {
  const r = resolvePhoto(ctx, { kind: "upload", path: upload(pngWithSize(9000, 10)) }, { items: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/);
});

function libraryItem(name, buf) {
  const file = path.join(ctx.outputDir, name);
  fs.writeFileSync(file, buf);
  return { id: `id-${name}`, path: file, publicUrl: `/outputs/${name}` };
}

test("a library item whose file is gone is refused as not found", () => {
  const item = libraryItem("pool-gone.png", PNG);
  fs.rmSync(item.path);
  const r = resolvePhoto(ctx, { kind: "library", id: item.id }, { items: [item] });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});

test("an animated library item is refused like an upload", () => {
  const item = libraryItem("pool-anim.webp", animatedWebp(4, 4));
  const r = resolvePhoto(ctx, { kind: "library", id: item.id }, { items: [item] });
  assert.equal(r.ok, false);
  assert.match(r.error, /animated/);
});

test("an oversized library item is refused like an upload", () => {
  const item = libraryItem("pool-big.png", pngWithSize(9000, 10));
  const r = resolvePhoto(ctx, { kind: "library", id: item.id }, { items: [item] });
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/);
  const zero = libraryItem("pool-zero.png", pngWithSize(0, 0));
  assert.equal(resolvePhoto(ctx, { kind: "library", id: zero.id }, { items: [zero] }).ok, false);
});

test("resolvePhotos names the photo that failed", () => {
  const good = upload();
  const r = resolvePhotos(ctx, [{ kind: "upload", path: good }, { kind: "upload", path: "bg-image-00000000-0000-0000-0000-000000000000.png" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /^Photo 2:/);
  const ok = resolvePhotos(ctx, [{ kind: "upload", path: good }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.photos[0]).sort(), ["height", "ref", "url", "width"]);
});

test("resolveSong accepts bundled library refs and refuses forgotten ones", () => {
  assert.ok(resolveSong(ctx, "library:hopeful"));
  assert.equal(resolveSong(ctx, "library:not-a-track"), null);
  assert.equal(resolveSong(ctx, "mylib:00000000-0000-0000-0000-000000000000"), null);
  assert.equal(resolveSong(ctx, "/etc/passwd"), null);
});
