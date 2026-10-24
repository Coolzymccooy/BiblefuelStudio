/**
 * ensureLocalPath: remote inputs are downloaded through the SSRF guard.
 * Run with: node --test server/src/lib/remoteCache.test.js
 *
 * paths.js reads OUTPUT_DIR at import time, so it is pointed at a temp dir
 * BEFORE remoteCache.js is imported. Fixtures follow safeDownload.test.js: a
 * loopback server reached through the fake name "public.test", which a stub
 * lookup resolves to 127.0.0.1 and `unvettedHostsForTests` lets through.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-remotecache-"));
process.env.OUTPUT_DIR = outDir;
const { ensureLocalPath } = await import("./remoteCache.js");

const FAKE_HOST = "public.test";
const CLIP = Buffer.alloc(300 * 1024, 5); // above the 256 KB "plausibly complete" floor
const SMALL = Buffer.alloc(2048, 6);
const hits = new Map();
let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    if (req.url.startsWith("/clip")) {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": String(CLIP.length) }).end(CLIP);
    } else if (req.url === "/small.mp3") {
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(SMALL.length) }).end(SMALL);
    } else if (req.url === "/slow-clip.mp4") {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": String(CLIP.length) });
      res.write(CLIP.subarray(0, 1024));
      setTimeout(() => res.end(CLIP.subarray(1024)), 150);
    } else if (req.url === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(outDir, { recursive: true, force: true });
});

const reachable = (extra = {}) => ({
  lookup: async () => ({ address: "127.0.0.1", family: 4 }),
  unvettedHostsForTests: [FAKE_HOST],
  ...extra,
});
const url = (p) => `http://${FAKE_HOST}:${port}${p}`;
const cacheFiles = () => {
  const dir = path.join(outDir, "cache", "remote-bg");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

describe("ensureLocalPath", () => {
  test("local paths and empty values pass through untouched", async () => {
    assert.equal(await ensureLocalPath("C:/media/a.mp4"), "C:/media/a.mp4");
    assert.equal(await ensureLocalPath("/outputs/a.mp4"), "/outputs/a.mp4");
    assert.equal(await ensureLocalPath(""), "");
  });

  test("a private URL is refused with URL_PRIVATE and never requested", async () => {
    const before = cacheFiles().length;
    for (const bad of [
      `http://127.0.0.1:${port}/clip-private.mp4`,
      "http://169.254.169.254/latest/meta-data/x.mp4",
      "http://[::1]/x.mp4",
    ]) {
      await assert.rejects(ensureLocalPath(bad), (err) => err.code === "URL_PRIVATE", bad);
    }
    assert.equal(hits.get("/clip-private.mp4") || 0, 0);
    assert.equal(cacheFiles().length, before);
  });

  test("http: without // and other schemes are not mistaken for local paths", async () => {
    await assert.rejects(ensureLocalPath(`http:/127.0.0.1:${port}/clip-slash.mp4`), (err) => err.code === "URL_PRIVATE");
    await assert.rejects(ensureLocalPath(`http:127.0.0.1:${port}/clip-slash.mp4`), (err) => err.code === "URL_PRIVATE");
    await assert.rejects(ensureLocalPath(`tcp://127.0.0.1:${port}`), (err) => err.code === "URL_SCHEME");
    await assert.rejects(ensureLocalPath("gopher://x/y"), (err) => err.code === "URL_SCHEME");
    assert.equal(hits.get("/clip-slash.mp4") || 0, 0);
    assert.equal(await ensureLocalPath("D:/media/a.mp4"), "D:/media/a.mp4");
  });

  test("a redirect to a private address is refused once, not retried", async () => {
    await assert.rejects(ensureLocalPath(url("/to-metadata"), reachable()), (err) => err.code === "URL_PRIVATE");
    assert.equal(hits.get("/to-metadata"), 1);
  });

  test("a public URL is cached, then reused without a second download", async () => {
    const first = await ensureLocalPath(url("/clip-a.mp4"), reachable());
    assert.ok(first.startsWith(path.join(outDir, "cache", "remote-bg")), first);
    assert.deepEqual(fs.readFileSync(first), CLIP);
    const second = await ensureLocalPath(url("/clip-a.mp4"), reachable());
    assert.equal(second, first);
    assert.equal(hits.get("/clip-a.mp4"), 1);
    assert.equal(cacheFiles().some((f) => f.endsWith(".part")), false);
  });

  test("an oversized file is refused once with its declared size, and nothing is cached", async () => {
    const before = cacheFiles().length;
    await assert.rejects(
      ensureLocalPath(url("/clip-big.mp4"), reachable({ maxBytes: 100 * 1024 })),
      (err) => err.code === "URL_TOO_LARGE" && err.declaredBytes === CLIP.length,
    );
    assert.equal(hits.get("/clip-big.mp4"), 1);
    assert.equal(cacheFiles().length, before);
  });

  test("a file under the usable floor is refused by default but accepted with a lower minBytes", async () => {
    await assert.rejects(ensureLocalPath(url("/small.mp3"), reachable()), /too small/);
    const local = await ensureLocalPath(url("/small.mp3"), reachable({ minBytes: 1024 }));
    assert.equal(fs.statSync(local).size, SMALL.length);
  });

  test("a cached copy is not served for a URL whose host is now private", async () => {
    // Cached while the name answered with a vetted address...
    const first = await ensureLocalPath(url("/clip-cached.mp4"), reachable());
    assert.ok(fs.existsSync(first));
    // ...then the same name answers 127.0.0.1 with no test bypass.
    await assert.rejects(
      ensureLocalPath(url("/clip-cached.mp4"), { lookup: async () => ({ address: "127.0.0.1", family: 4 }) }),
      (err) => err.code === "URL_PRIVATE",
    );
  });

  test("a DNS outage does not refuse a copy that was cached after vetting", async () => {
    const first = await ensureLocalPath(url("/clip-offline.mp4"), reachable());
    const again = await ensureLocalPath(url("/clip-offline.mp4"), {
      lookup: async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); },
    });
    assert.equal(again, first);
  });

  test("a cache file planted for a metadata URL is never handed out", async () => {
    const bad = "http://169.254.169.254/latest/meta-data/x.mp4";
    const hash = crypto.createHash("sha1").update(bad).digest("hex").slice(0, 16);
    const planted = path.join(outDir, "cache", "remote-bg", `${hash}.mp4`);
    fs.mkdirSync(path.dirname(planted), { recursive: true });
    fs.writeFileSync(planted, CLIP);
    await assert.rejects(ensureLocalPath(bad), (err) => err.code === "URL_PRIVATE");
  });

  test("concurrent downloads of one URL each write their own temp file and both succeed", async (t) => {
    const parts = [];
    const real = fs.createWriteStream;
    t.mock.method(fs, "createWriteStream", (file, ...rest) => {
      if (String(file).includes(".part")) parts.push(String(file));
      return real(file, ...rest);
    });
    const [a, b] = await Promise.all([
      ensureLocalPath(url("/slow-clip.mp4"), reachable()),
      ensureLocalPath(url("/slow-clip.mp4"), reachable()),
    ]);
    assert.equal(a, b);
    assert.deepEqual(fs.readFileSync(a), CLIP);
    assert.equal(parts.length, 2, parts.join(" | "));
    assert.notEqual(parts[0], parts[1], "each download needs its own .part file");
    assert.equal(cacheFiles().some((f) => f.includes(".part")), false);
  });
});
