/**
 * Shared handling for remote (http/https) render inputs.
 * Run with: node --test server/src/lib/remoteInputs.test.js
 *
 * OUTPUT_DIR is pointed at a temp dir BEFORE import (paths.js reads env at
 * import time), because localiseInput caches downloads under it.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-remoteinputs-"));
process.env.OUTPUT_DIR = outDir;
const { localiseInput, remoteInputFailure, backgroundFetchFailure } = await import("./remoteInputs.js");

const coded = (code, extra = {}) => Object.assign(new Error(code), { code }, extra);
const VOICE = Buffer.alloc(4096, 9); // a short voice clip: far under the 256 KB video floor
let server;
let port;
let hits = 0;

before(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(VOICE.length) }).end(VOICE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("localiseInput", () => {
  test("local paths, library ids and nullish values pass through", async () => {
    assert.equal(await localiseInput("/outputs/a.mp3"), "/outputs/a.mp3");
    assert.equal(await localiseInput("C:/x/a.mp3"), "C:/x/a.mp3");
    assert.equal(await localiseInput("12345"), "12345");
    assert.equal(await localiseInput(null), null);
    assert.equal(await localiseInput(""), "");
  });

  test("a private URL is refused with URL_PRIVATE and never requested", async () => {
    hits = 0;
    await assert.rejects(localiseInput(`http://127.0.0.1:${port}/a.mp3`), (err) => err.code === "URL_PRIVATE");
    await assert.rejects(localiseInput("http://169.254.169.254/latest/meta-data/"), (err) => err.code === "URL_PRIVATE");
    assert.equal(hits, 0);
  });

  test("a short public audio file is localised (no 256 KB video floor)", async () => {
    const local = await localiseInput(`http://public.test:${port}/voice.mp3`, {
      lookup: async () => ({ address: "127.0.0.1", family: 4 }),
      unvettedHostsForTests: ["public.test"],
    });
    assert.ok(local.startsWith(outDir), local);
    assert.deepEqual(fs.readFileSync(local), VOICE);
  });
});

describe("remoteInputFailure", () => {
  test("a refusal is a 400 whose error starts with the code", () => {
    for (const code of ["URL_SCHEME", "URL_PRIVATE", "URL_REDIRECTS", "URL_TOO_LARGE"]) {
      const out = remoteInputFailure(coded(code), "music track 1");
      assert.equal(out.status, 400, code);
      assert.ok(out.error.startsWith(`${code}: `) && out.error.length > code.length + 2, code);
    }
  });

  test("a network failure stays a 502 naming the input", () => {
    const out = remoteInputFailure(new Error("download failed for x: ECONNRESET"), "video");
    assert.equal(out.status, 502);
    assert.equal(out.error, "Failed to fetch video: download failed for x: ECONNRESET");
  });
});

describe("backgroundFetchFailure", () => {
  test("an oversized background names the clip, its declared size and the limit", () => {
    const out = backgroundFetchFailure(coded("URL_TOO_LARGE", { declaredBytes: 300 * 1048576 }), 1, "https://cdn.example/big.mp4", 200);
    assert.equal(out.status, 400);
    assert.equal(out.error, 'Background 2 "big.mp4" (300MB) exceeds the 200MB limit. Remove it in the Background panel, or pick a smaller clip.');
  });

  test("an oversized background with no declared size still gets the friendly message", () => {
    const out = backgroundFetchFailure(coded("URL_TOO_LARGE"), 0, "https://cdn.example/big.mp4", 200);
    assert.equal(out.status, 400);
    assert.match(out.error, /^Background 1 "big\.mp4" exceeds the 200MB limit/);
  });

  test("other refusals are 400 with the code; network failures 502 naming the background", () => {
    assert.match(backgroundFetchFailure(coded("URL_PRIVATE"), 2, "x", 200).error, /^URL_PRIVATE: /);
    assert.equal(backgroundFetchFailure(coded("URL_PRIVATE"), 2, "x", 200).status, 400);
    const net = backgroundFetchFailure(new Error("ECONNRESET"), 2, "x", 200);
    assert.deepEqual(net, { status: 502, error: "Failed to fetch background 3: ECONNRESET" });
  });
});
