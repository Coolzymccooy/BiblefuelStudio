/**
 * Unit tests for the media upload helpers (raw streaming + base64 fallback).
 * Run with: node --test server/src/routes/media.upload.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  audioMimeToExt,
  getUploadLimits,
  hasDiskHeadroomForUpload,
  getVideoProxyStatus,
  startVideoProxyGeneration,
  receiveUploadToFile,
} from "./media.js";

const tmp = (name) => path.join(os.tmpdir(), `bf-upload-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);

/** Minimal mock of an Express request as a binary Readable with headers. */
function mockReq(buf, headers = {}) {
  const r = new Readable({ read() {} });
  r.headers = headers;
  process.nextTick(() => { r.push(buf); r.push(null); });
  return r;
}

describe("upload limits and disk headroom", () => {
  test("defaults resumable uploads to 1GB so 700MB videos are allowed through the large-upload path", () => {
    const old = process.env.RESUMABLE_UPLOAD_MAX_MB;
    delete process.env.RESUMABLE_UPLOAD_MAX_MB;
    try {
      const limits = getUploadLimits();
      assert.equal(limits.resumableMaxMb, 1024);
      assert.equal(limits.resumableMaxBytes, 1024 * 1024 * 1024);
      assert.equal(limits.allowsLargeFileBytes(700 * 1024 * 1024), true);
    } finally {
      if (old == null) delete process.env.RESUMABLE_UPLOAD_MAX_MB;
      else process.env.RESUMABLE_UPLOAD_MAX_MB = old;
    }
  });

  test("supports environment overrides for production storage policy", () => {
    const old = process.env.RESUMABLE_UPLOAD_MAX_MB;
    process.env.RESUMABLE_UPLOAD_MAX_MB = "1536";
    try {
      assert.equal(getUploadLimits().resumableMaxMb, 1536);
    } finally {
      if (old == null) delete process.env.RESUMABLE_UPLOAD_MAX_MB;
      else process.env.RESUMABLE_UPLOAD_MAX_MB = old;
    }
  });

  test("disk headroom guard rejects uploads that would leave too little local space", () => {
    const result = hasDiskHeadroomForUpload("/tmp", 800, {
      statfs: () => ({ bavail: 1000, bsize: 1 }),
      minFreeAfterBytes: 300,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Not enough disk space/i);
  });
});

describe("source-video proxy generation", () => {
  test("starts a low-res proxy transcode beside the uploaded original", () => {
    const calls = [];
    const proxy = startVideoProxyGeneration("C:/tmp/source-video-123.mov", {
      spawnImpl: (bin, args) => {
        calls.push({ bin, args });
        return { stderr: { on() {} }, on(event, cb) { if (event === 'close') cb(0); return this; } };
      },
    });
    assert.equal(proxy.proxyPath, "C:/tmp/source-video-123-proxy.mp4");
    assert.equal(proxy.status, "pending");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), ["-movflags", "+faststart", "C:/tmp/source-video-123-proxy.mp4"]);
    assert.match(calls[0].args.join(" "), /scale=854:480/);
  });

  test("reports proxy status from file existence", () => {
    const dest = tmp("proxy.mp4");
    assert.equal(getVideoProxyStatus(dest).status, "pending");
    fs.writeFileSync(dest, Buffer.alloc(2048, 1));
    assert.equal(getVideoProxyStatus(dest).status, "ready");
    fs.unlinkSync(dest);
  });
});

describe("audioMimeToExt", () => {
  test("maps common container/codec mimes", () => {
    assert.equal(audioMimeToExt("audio/mpeg", ""), "mp3");
    assert.equal(audioMimeToExt("audio/mp4", ""), "m4a");
    assert.equal(audioMimeToExt("audio/x-m4a", ""), "m4a");
    assert.equal(audioMimeToExt("audio/wav", ""), "wav");
    assert.equal(audioMimeToExt("audio/ogg", ""), "ogg");
    assert.equal(audioMimeToExt("audio/webm", ""), "webm");
    assert.equal(audioMimeToExt("audio/flac", ""), "flac");
    assert.equal(audioMimeToExt("audio/aac", ""), "aac");
  });

  test("falls back to the filename hint for generic mimes", () => {
    assert.equal(audioMimeToExt("application/octet-stream", "m4a"), "m4a");
    assert.equal(audioMimeToExt("", "wav"), "wav");
    assert.equal(audioMimeToExt("", ""), "bin");
  });
});

describe("receiveUploadToFile — base64 fallback", () => {
  test("writes decoded bytes and reports size", async () => {
    const dest = tmp("b64.bin");
    const payload = Buffer.alloc(256, 7);
    const res = await receiveUploadToFile({ headers: {} }, dest, { b64: payload.toString("base64"), mime: "audio/mpeg" });
    assert.equal(res.ok, true);
    assert.equal(res.bytes, 256);
    assert.deepEqual(fs.readFileSync(dest), payload);
    fs.unlinkSync(dest);
  });

  test("rejects payloads over the cap and leaves no file", async () => {
    const dest = tmp("b64-big.bin");
    const payload = Buffer.alloc(500, 1);
    const res = await receiveUploadToFile({ headers: {} }, dest, { b64: payload.toString("base64"), maxBytes: 100 });
    assert.equal(res.ok, false);
    assert.equal(res.status, 413);
    assert.equal(fs.existsSync(dest), false);
  });

  test("rejects empty/too-small payloads", async () => {
    const dest = tmp("b64-tiny.bin");
    const res = await receiveUploadToFile({ headers: {} }, dest, { b64: Buffer.alloc(10).toString("base64") });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
  });
});

describe("receiveUploadToFile — raw streaming", () => {
  test("streams the request body to disk and captures the mime", async () => {
    const dest = tmp("raw.bin");
    const payload = Buffer.alloc(2048, 9);
    const req = mockReq(payload, { "content-type": "audio/mp4" });
    const res = await receiveUploadToFile(req, dest, {});
    assert.equal(res.ok, true);
    assert.equal(res.bytes, 2048);
    assert.equal(res.mime, "audio/mp4");
    assert.deepEqual(fs.readFileSync(dest), payload);
    fs.unlinkSync(dest);
  });

  test("enforces the byte cap mid-stream and cleans up the partial file", async () => {
    const dest = tmp("raw-big.bin");
    const req = mockReq(Buffer.alloc(1000, 5), { "content-type": "audio/mpeg" });
    const res = await receiveUploadToFile(req, dest, { maxBytes: 100 });
    assert.equal(res.ok, false);
    assert.equal(res.status, 413);
    assert.equal(fs.existsSync(dest), false);
  });

  test("rejects an empty raw body", async () => {
    const dest = tmp("raw-empty.bin");
    const req = mockReq(Buffer.alloc(0), {});
    const res = await receiveUploadToFile(req, dest, {});
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(dest), false);
  });
});
