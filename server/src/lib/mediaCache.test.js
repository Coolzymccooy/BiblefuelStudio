import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { cacheControlForOutput, isRangeMedia, publicAssetHeaders } from "./mediaCache.js";

test("video and audio are range media; pictures and pages are not", () => {
  for (const name of ["a.mp4", "B.MOV", "c.webm", "d.m4v", "e.mp3", "f.wav", "g.m4a", "h.aac", "i.ogg"]) {
    assert.equal(isRangeMedia(name), true, name);
  }
  for (const name of ["a.jpg", "b.png", "index.html", "app.js", "", undefined]) {
    assert.equal(isRangeMedia(name), false, String(name));
  }
});

test("range media stays out of shared caches; other outputs may be edge-cached", () => {
  assert.equal(cacheControlForOutput("/x/moment.mp4"), "private, max-age=86400, no-transform");
  assert.equal(cacheControlForOutput("/x/poster.jpg"), "public, max-age=86400, no-transform");
});

// The Moments style previews ship in the client bundle and are served by the
// public static mount. Cloudflare stored them as public files and answered an
// iPhone's Range request with a full 200, so Safari drew nothing.
test("a bundled preview video is range-served and kept private", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-public-"));
  fs.mkdirSync(path.join(dir, "moments", "previews"), { recursive: true });
  fs.writeFileSync(path.join(dir, "moments", "previews", "glow.mp4"), Buffer.alloc(64, 1));
  fs.writeFileSync(path.join(dir, "logo.png"), Buffer.alloc(8, 2));
  const app = express();
  app.use("/", express.static(dir, { setHeaders: publicAssetHeaders }));

  const video = await request(app).get("/moments/previews/glow.mp4").set("Range", "bytes=0-1");
  assert.equal(video.status, 206);
  assert.equal(video.headers["content-range"], "bytes 0-1/64");
  assert.equal(video.headers["accept-ranges"], "bytes");
  assert.equal(video.headers["cache-control"], "private, max-age=86400, no-transform");

  const image = await request(app).get("/logo.png");
  assert.equal(image.status, 200);
  assert.doesNotMatch(String(image.headers["cache-control"]), /private/);
  fs.rmSync(dir, { recursive: true, force: true });
});
