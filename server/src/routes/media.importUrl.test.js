/**
 * POST /api/media/import-url — the network download is replaced through the
 * _setDownloader seam; everything after it (naming, validation, response
 * shape, cleanup) is the real route.
 * Run with: node --test server/src/routes/media.importUrl.test.js
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import mediaRouter from "./media.js";
import { _setDownloader, _resetDownloader } from "./mediaImportUrl.js";

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
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-import-url-"));
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: outDir, outputDir: outDir }; next(); });
  app.use("/api/media", mediaRouter);
});

afterEach(() => {
  _resetDownloader();
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
    _setDownloader(failing("HTTP 404"));
    const res = await post({ url: "https://cdn.example.com/missing.wav" });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, "DOWNLOAD_FAILED");
    assert.match(res.body.message, /HTTP 404/);
    assert.deepEqual(fs.readdirSync(outDir), []);
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
