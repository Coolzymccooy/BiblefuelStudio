/**
 * SSRF guards for the URL importer.
 * Run with: node --test server/src/lib/safeDownload.test.js
 *
 * Test bypass: fixtures listen on 127.0.0.1, which the real check refuses. The
 * fake hostname "public.test" is resolved by a stubbed `lookup` to 127.0.0.1 and
 * passed in `unvettedHostsForTests`, so ONLY that name skips the address check.
 * Literal 127.0.0.1 URLs (e.g. a redirect target) still hit the real check.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { isPublicAddress, downloadPublicUrl } from "./safeDownload.js";

const FAKE_HOST = "public.test";
const loopbackLookup = async () => ({ address: "127.0.0.1", family: 4 });
const BODY = Buffer.alloc(4096, 7);

let server;
let port;
let tmpDir;
let counter = 0;
let lookupCalls = [];

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-safedl-"));
  server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "Audio/MPEG; charset=binary" });
      res.end(BODY);
    } else if (req.url === "/chain") {
      res.writeHead(302, { location: "/chain2" }).end();
    } else if (req.url === "/chain2") {
      res.writeHead(301, { location: "/ok" }).end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" }).end();
    } else if (req.url === "/to-loopback") {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` }).end();
    } else if (req.url === "/to-ftp") {
      res.writeHead(302, { location: "ftp://example.com/x" }).end();
    } else if (req.url === "/big-chunked") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.write(Buffer.alloc(8192, 1));
      res.end(Buffer.alloc(8192, 1));
    } else if (req.url === "/big-declared") {
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": "16384" });
      res.end(Buffer.alloc(16384, 1));
    } else if (req.url.startsWith("/hop/")) {
      const n = Number(req.url.slice(5));
      if (n === 0) res.writeHead(200, { "content-type": "audio/mpeg" }).end(BODY);
      else res.writeHead(302, { location: `/hop/${n - 1}` }).end();
    } else if (req.url === "/stall") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.write(Buffer.alloc(1024, 3)); // one chunk, then silence: never ends
    } else if (req.url === "/missing") {
      res.writeHead(404).end("nope");
    } else {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const dest = () => path.join(tmpDir, `dl-${counter += 1}.bin`);
const reachable = (extra = {}) => ({
  maxBytes: 1024 * 1024,
  lookup: async (host) => { lookupCalls.push(host); return loopbackLookup(); },
  unvettedHostsForTests: [FAKE_HOST],
  ...extra,
});
const url = (p) => `http://${FAKE_HOST}:${port}${p}`;

describe("isPublicAddress", () => {
  test("private ranges false, 8.8.8.8 true, ::ffff:10.0.0.1 false", () => {
    for (const ip of [
      "127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "0.0.0.0", "0.1.2.3", "100.64.0.1",
      "192.0.2.1", "198.51.100.7", "203.0.113.200", "192.88.99.1",
      "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1",
      "::ffff:7f00:1", "::ffff:169.254.169.254",
    ]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });

  test("non-IP input is not public", () => {
    for (const bad of ["", "localhost", "example.com", "999.1.1.1", "1.2.3", null, undefined]) {
      assert.equal(isPublicAddress(bad), false, String(bad));
    }
  });
});

describe("downloadPublicUrl", () => {
  test("a private host is refused before connecting", async () => {
    lookupCalls = [];
    let fetched = false;
    const fetchImpl = async () => { fetched = true; throw new Error("should not connect"); };
    await assert.rejects(
      downloadPublicUrl("http://internal.example/x", dest(), {
        maxBytes: 1000,
        lookup: async () => ({ address: "10.0.0.5", family: 4 }),
        fetchImpl,
      }),
      { message: "URL_PRIVATE" },
    );
    await assert.rejects(
      downloadPublicUrl("http://[::1]/x", dest(), { maxBytes: 1000, fetchImpl }),
      { message: "URL_PRIVATE" },
    );
    await assert.rejects(
      downloadPublicUrl(`http://127.0.0.1:${port}/ok`, dest(), { maxBytes: 1000 }),
      { message: "URL_PRIVATE" },
    );
    assert.equal(fetched, false);
  });

  test("a non-http scheme is refused", async () => {
    for (const bad of ["ftp://example.com/a", "file:///etc/passwd", "not a url"]) {
      await assert.rejects(downloadPublicUrl(bad, dest(), { maxBytes: 1000 }), { message: "URL_SCHEME" }, bad);
    }
  });

  test("a redirect to 127.0.0.1 is refused", async () => {
    const file = dest();
    await assert.rejects(downloadPublicUrl(url("/to-loopback"), file, reachable()), { message: "URL_PRIVATE" });
    assert.equal(fs.existsSync(file), false);
  });

  test("a redirect to a non-http scheme is refused", async () => {
    await assert.rejects(downloadPublicUrl(url("/to-ftp"), dest(), reachable()), { message: "URL_SCHEME" });
  });

  test("more than 3 redirects is refused", async () => {
    await assert.rejects(downloadPublicUrl(url("/loop"), dest(), reachable()), { message: "URL_REDIRECTS" });
  });

  test("redirects within the limit are followed (relative Location) and the final URL reported", async () => {
    const file = dest();
    const result = await downloadPublicUrl(url("/chain"), file, reachable());
    assert.equal(result.finalUrl, url("/ok"));
    assert.equal(result.bytes, BODY.length);
  });

  test("exactly 3 redirects succeed; a 4th is refused", async () => {
    const ok = await downloadPublicUrl(url("/hop/3"), dest(), reachable());
    assert.equal(ok.finalUrl, url("/hop/0"));
    assert.equal(ok.bytes, BODY.length);
    const file = dest();
    await assert.rejects(downloadPublicUrl(url("/hop/4"), file, reachable()), { message: "URL_REDIRECTS" });
    assert.equal(fs.existsSync(file), false);
  });

  test("a body that stalls mid-transfer is aborted as URL_TIMEOUT and the file removed", async () => {
    const file = dest();
    await assert.rejects(downloadPublicUrl(url("/stall"), file, reachable({ idleMs: 50 })), { message: "URL_TIMEOUT" });
    assert.equal(fs.existsSync(file), false);
  });

  test("the overall deadline also reports URL_TIMEOUT", async () => {
    const file = dest();
    await assert.rejects(
      downloadPublicUrl(url("/stall"), file, reachable({ timeoutMs: 80, idleMs: 60_000 })),
      { message: "URL_TIMEOUT" },
    );
    assert.equal(fs.existsSync(file), false);
  });

  test("a body over maxBytes is aborted and the file removed", async () => {
    const file = dest();
    await assert.rejects(downloadPublicUrl(url("/big-chunked"), file, reachable({ maxBytes: 10_000 })), { message: "URL_TOO_LARGE" });
    assert.equal(fs.existsSync(file), false);
  });

  test("a Content-Length over maxBytes is refused before any file is written", async () => {
    const file = dest();
    await assert.rejects(downloadPublicUrl(url("/big-declared"), file, reachable({ maxBytes: 5000 })), { message: "URL_TOO_LARGE" });
    assert.equal(fs.existsSync(file), false);
  });

  test("a good download reports bytes and content type, via the pinned address", async () => {
    lookupCalls = [];
    const file = dest();
    // "public.test" does not resolve in real DNS: the request only succeeds
    // because the socket is pinned to the address our lookup returned.
    const result = await downloadPublicUrl(url("/ok"), file, reachable());
    assert.deepEqual(result, { bytes: BODY.length, contentType: "audio/mpeg", finalUrl: url("/ok") });
    assert.deepEqual(fs.readFileSync(file), BODY);
    assert.deepEqual(lookupCalls, [FAKE_HOST]);
  });

  test("an HTTP error status is a plain failure, not a guard code", async () => {
    await assert.rejects(downloadPublicUrl(url("/missing"), dest(), reachable()), { message: "HTTP 404" });
  });
});
