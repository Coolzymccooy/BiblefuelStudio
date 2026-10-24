/**
 * POST /api/media/import-url — the network download is replaced through the
 * _setDownloader seam; everything after it (naming, validation, response
 * shape, cleanup) is the real route.
 * Run with: node --test server/src/routes/media.importUrl.test.js
 */

import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { spawnSync } from "node:child_process";
import mediaRouter, { isPlayableVideo } from "./media.js";
import { _setDownloader, _resetDownloader, _setHeadroomCheck, _resetHeadroomCheck, importTimeoutMs } from "./mediaImportUrl.js";

/** PCM16 mono WAV of silence, `seconds` long. */
function silentWav(seconds, rate = 8000) {
  const data = Buffer.alloc(seconds * rate * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256)]);
const WAV_BYTES = silentWav(60);

let outDir;
let app;
let calls;

/** A downloader that writes `bytes` to the destination and reports `contentType`. */
const serving = (bytes, contentType) => async (url, dest, opts) => {
  calls.push({ url, opts });
  fs.writeFileSync(dest, bytes);
  return { bytes: bytes.length, contentType, finalUrl: url };
};
const failing = (message, partial = Buffer.alloc(10)) => async (url, dest) => {
  fs.writeFileSync(dest, partial);
  throw new Error(message);
};

const post = (body) => request(app).post("/api/media/import-url").send(body);

beforeEach(() => {
  calls = [];
  // The real check reads this machine's free space; each test chooses it.
  _setHeadroomCheck(() => ({ ok: true, availableBytes: null }));
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-import-url-"));
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: outDir, outputDir: outDir }; next(); });
  app.use("/api/media", mediaRouter);
});

afterEach(() => {
  _resetDownloader();
  _resetHeadroomCheck();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("POST /api/media/import-url", () => {
  test("a 1-minute WAV imports and answers like /upload-audio", async () => {
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    const res = await post({ url: "https://cdn.example.com/talk" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.mime, "audio/wav");
    assert.match(res.body.file, /user-audio-[0-9a-f-]{36}\.wav$/);
    assert.equal(path.dirname(res.body.file), outDir.replace(/\\/g, "/"));
    assert.equal(fs.statSync(res.body.file).size, WAV_BYTES.length);
    assert.deepEqual(fs.readdirSync(outDir).filter((f) => f.endsWith(".part")), [], "no .part file is left behind");
  });

  test("the download is capped at MAX_INPUT_MB", async () => {
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    await post({ url: "https://cdn.example.com/talk.wav" });
    assert.equal(calls[0].url, "https://cdn.example.com/talk.wav");
    assert.equal(calls[0].opts.maxBytes, 200 * 1024 * 1024);
    assert.equal(calls[0].opts.timeoutMs, 10 * 60_000, "a large file gets minutes, not the lib's 60 s default");
  });

  test("audio bytes that ffprobe cannot read are refused and removed", async () => {
    _setDownloader(serving(Buffer.from("this is not audio ".repeat(100)), "audio/mpeg"));
    const res = await post({ url: "https://cdn.example.com/x.mp3", kind: "audio" });
    assert.equal(res.status, 400);
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("kind image with a text file is refused and removed", async () => {
    _setDownloader(serving(Buffer.from("plain text, not a picture"), "text/plain"));
    const res = await post({ url: "https://cdn.example.com/page.jpg", kind: "image" });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("a real JPEG imports as a background image", async () => {
    _setDownloader(serving(JPEG_BYTES, "image/jpeg"));
    const res = await post({ url: "https://cdn.example.com/photo", kind: "image" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.kind, "image");
    assert.equal(res.body.mime, "image/jpeg");
    assert.match(res.body.file, /bg-image-[0-9a-f-]{36}\.jpg$/);
    assert.ok(fs.existsSync(res.body.file));
  });

  test("the URL's extension is the fallback when the content type says nothing", async () => {
    _setDownloader(serving(WAV_BYTES, "application/octet-stream"));
    const res = await post({ url: "https://cdn.example.com/a/b/clip.wav?token=1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.file, /\.wav$/);
  });

  test("filename is only an extension hint: path parts are stripped", async () => {
    _setDownloader(serving(WAV_BYTES, "application/octet-stream"));
    const res = await post({ url: "https://cdn.example.com/blob", filename: "..\\..\\evil/../talk.wav" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(path.dirname(res.body.file), outDir.replace(/\\/g, "/"));
    assert.match(path.basename(res.body.file), /^user-audio-[0-9a-f-]{36}\.wav$/);
  });

  test("URL_TOO_LARGE answers 413 and leaves nothing behind", async () => {
    _setDownloader(failing("URL_TOO_LARGE"));
    const res = await post({ url: "https://cdn.example.com/huge.wav" });
    assert.equal(res.status, 413);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "URL_TOO_LARGE");
    assert.ok(res.body.message);
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("URL_TIMEOUT answers 504 with its code", async () => {
    _setDownloader(failing("URL_TIMEOUT"));
    const res = await post({ url: "https://cdn.example.com/slow.wav" });
    assert.equal(res.status, 504);
    assert.deepEqual(res.body, { ok: false, error: "URL_TIMEOUT", message: "download timed out" });
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("URL_PRIVATE, URL_SCHEME and URL_REDIRECTS answer 400 with their code", async () => {
    for (const code of ["URL_PRIVATE", "URL_SCHEME", "URL_REDIRECTS"]) {
      _setDownloader(failing(code));
      const res = await post({ url: "https://cdn.example.com/x.wav" });
      assert.equal(res.status, 400, code);
      assert.equal(res.body.error, code);
      assert.ok(res.body.message, code);
    }
  });

  test("any other download failure answers 502 DOWNLOAD_FAILED", async () => {
    const warn = mock.method(console, "warn", () => {});
    try {
      _setDownloader(failing("connect ECONNREFUSED 10.1.2.3:6379"));
      const res = await post({ url: "https://cdn.example.com/private/path.wav?token=secret" });
      assert.equal(res.status, 502);
      assert.deepEqual(res.body, { ok: false, error: "DOWNLOAD_FAILED", message: "could not download the file" });
      assert.deepEqual(fs.readdirSync(outDir), []);
      assert.equal(warn.mock.callCount(), 1);
      const [label, detail] = warn.mock.calls[0].arguments;
      assert.equal(label, "[media] import-url failed");
      assert.equal(detail.host, "cdn.example.com");
      assert.doesNotMatch(JSON.stringify(detail), /secret|private\/path/, "the full URL is not logged");
    } finally {
      warn.mock.restore();
    }
  });

  test("an unexpected error answers 500 IMPORT_FAILED instead of escaping the handler", async () => {
    const blocker = path.join(outDir, "a-regular-file");
    fs.writeFileSync(blocker, "x");
    const brokenApp = express();
    brokenApp.use(express.json());
    brokenApp.use((req, _res, next) => {
      req.ctx = { userId: "u1", dataDir: outDir, outputDir: path.join(blocker, "sub") };
      next();
    });
    brokenApp.use("/api/media", mediaRouter);
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    const res = await request(brokenApp).post("/api/media/import-url").send({ url: "https://cdn.example.com/a.wav" });
    assert.equal(res.status, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "IMPORT_FAILED");
    assert.ok(res.body.message);
    assert.equal(calls.length, 0, "nothing was downloaded");
  });

  test("bad input is rejected before any download", async () => {
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    const cases = [
      [{}, "INVALID_URL"],
      [{ url: "" }, "INVALID_URL"],
      [{ url: 42 }, "INVALID_URL"],
      [{ url: `https://cdn.example.com/${"a".repeat(2100)}` }, "INVALID_URL"],
      [{ url: "https://cdn.example.com/x", kind: "document" }, "INVALID_KIND"],
      [{ url: "https://cdn.example.com/x", filename: "f".repeat(201) }, "INVALID_FILENAME"],
      [{ url: "https://cdn.example.com/x", filename: 5 }, "INVALID_FILENAME"],
    ];
    for (const [body, code] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(res.body.error, code);
    }
    assert.equal(calls.length, 0);
  });
});

describe("POST /api/media/import-url — disk, concurrency and content checks", () => {
  test("no room for MAX_INPUT_MB answers 507 DISK_FULL before any download", async () => {
    const asked = [];
    _setHeadroomCheck((dir, bytes) => { asked.push(bytes); return { ok: false, error: "Not enough disk space" }; });
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    const res = await post({ url: "https://cdn.example.com/talk.wav" });
    assert.equal(res.status, 507);
    assert.deepEqual(res.body, { ok: false, error: "DISK_FULL", message: "Not enough disk space" });
    assert.deepEqual(asked, [200 * 1024 * 1024]);
    assert.equal(calls.length, 0, "nothing was downloaded");
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("the disk is checked again for the downloaded size before the rename", async () => {
    const asked = [];
    _setHeadroomCheck((dir, bytes) => {
      asked.push(bytes);
      return asked.length === 1 ? { ok: true } : { ok: false, error: "disk filled meanwhile" };
    });
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    const res = await post({ url: "https://cdn.example.com/talk.wav" });
    assert.equal(res.status, 507);
    assert.equal(res.body.error, "DISK_FULL");
    assert.deepEqual(asked, [200 * 1024 * 1024, WAV_BYTES.length]);
    assert.deepEqual(fs.readdirSync(outDir), [], "the downloaded part is removed");
  });

  test("a third concurrent import for one user answers 429 IMPORT_BUSY", async () => {
    const releases = [];
    _setDownloader(async (url, dest) => {
      calls.push({ url });
      await new Promise((resolve) => releases.push(resolve));
      fs.writeFileSync(dest, WAV_BYTES);
      return { bytes: WAV_BYTES.length, contentType: "audio/wav", finalUrl: url };
    });
    const first = post({ url: "https://cdn.example.com/1.wav" }).then((r) => r);
    const second = post({ url: "https://cdn.example.com/2.wav" }).then((r) => r);
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));

    const third = await post({ url: "https://cdn.example.com/3.wav" });
    assert.equal(third.status, 429);
    assert.deepEqual(third.body, {
      ok: false,
      error: "IMPORT_BUSY",
      message: "two imports are already running; wait for one to finish",
    });
    assert.equal(calls.length, 2, "the third import never started a download");

    releases.forEach((release) => release());
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);

    // Both slots are released once the imports finish.
    _setDownloader(serving(WAV_BYTES, "audio/wav"));
    const later = await post({ url: "https://cdn.example.com/4.wav" });
    assert.equal(later.status, 200, JSON.stringify(later.body));
  });

  test("a failed import releases its slot", async () => {
    _setDownloader(failing("URL_TIMEOUT"));
    for (let i = 0; i < 3; i++) {
      const res = await post({ url: "https://cdn.example.com/slow.wav" });
      assert.equal(res.status, 504, `attempt ${i + 1}`);
    }
  });

  test("an .html hint with an audio content type is refused and removed", async () => {
    _setDownloader(serving(Buffer.from("<script>alert(1)</script>".repeat(80)), "audio/x-unknown"));
    const res = await post({ url: "https://cdn.example.com/x", filename: "page.html" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "UNSUPPORTED_TYPE");
    assert.ok(res.body.message);
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("an image hint outside jpg/png/webp/gif is refused", async () => {
    _setDownloader(serving(JPEG_BYTES, "application/octet-stream"));
    const res = await post({ url: "https://cdn.example.com/x.svg", kind: "image" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "UNSUPPORTED_TYPE");
    assert.deepEqual(fs.readdirSync(outDir), []);
  });

  test("a .jpeg hint still imports as an image", async () => {
    _setDownloader(serving(JPEG_BYTES, "application/octet-stream"));
    const res = await post({ url: "https://cdn.example.com/photo.jpeg", kind: "image" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.file, /\.jpg$/);
  });

  test("a video that fails the ffprobe check is refused and removed", async () => {
    _setDownloader(serving(Buffer.from("not a video at all ".repeat(200)), "video/mp4"));
    const res = await post({ url: "https://cdn.example.com/clip.mp4", kind: "video" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "UNSUPPORTED_TYPE");
    assert.deepEqual(fs.readdirSync(outDir), []);
  });
});

describe("isPlayableVideo", () => {
  test("finds the video stream in a real clip and rejects audio-only and junk", (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-probe-video-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const clip = path.join(dir, "clip.mp4");
    const made = spawnSync(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
      "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=1",
      "-pix_fmt", "yuv420p", clip,
    ], { timeout: 30_000 });
    if (made.status !== 0) return t.skip("ffmpeg unavailable");
    assert.equal(isPlayableVideo(clip), true);

    const wav = path.join(dir, "talk.mp4");
    fs.writeFileSync(wav, WAV_BYTES);
    assert.equal(isPlayableVideo(wav), false, "audio under a video name has no video stream");

    const junk = path.join(dir, "junk.mp4");
    fs.writeFileSync(junk, Buffer.alloc(4096, 0x41));
    assert.equal(isPlayableVideo(junk), false);
    assert.equal(isPlayableVideo(path.join(dir, "missing.mp4")), false);
  });
});

test("IMPORT_URL_TIMEOUT_MS falls back to 10 minutes unless it is a finite positive number", () => {
  const DEFAULT = 10 * 60_000;
  for (const raw of [undefined, "", "abc", "0", "-5", "Infinity", "NaN"]) {
    assert.equal(importTimeoutMs(raw), DEFAULT, String(raw));
  }
  assert.equal(importTimeoutMs("90000"), 90_000);
  assert.equal(importTimeoutMs("1.5"), 1.5);
});
