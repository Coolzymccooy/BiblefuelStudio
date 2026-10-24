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
import { isPublicAddress, downloadPublicUrl, assertPublicHttpUrl, isUrlGuardError, urlGuardMessage, fetchPublic } from "./safeDownload.js";

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

  test("a refusal from a declared Content-Length carries the declared size", async () => {
    await assert.rejects(
      downloadPublicUrl(url("/big-declared"), dest(), reachable({ maxBytes: 5000 })),
      (err) => err.code === "URL_TOO_LARGE" && err.declaredBytes === 16384,
    );
  });

  test("a body that only turns out too large has no declared size to report", async () => {
    await assert.rejects(
      downloadPublicUrl(url("/big-chunked"), dest(), reachable({ maxBytes: 10_000 })),
      (err) => err.code === "URL_TOO_LARGE" && err.declaredBytes === undefined,
    );
  });

  test("a good download reports the Content-Length the host declared", async () => {
    const result = await downloadPublicUrl(url("/big-declared"), dest(), reachable());
    assert.equal(result.declaredBytes, 16384);
    assert.equal(result.bytes, 16384);
  });

  test("a good download reports bytes and content type, via the pinned address", async () => {
    lookupCalls = [];
    const file = dest();
    // "public.test" does not resolve in real DNS: the request only succeeds
    // because the socket is pinned to the address our lookup returned.
    const result = await downloadPublicUrl(url("/ok"), file, reachable());
    assert.deepEqual(result, { bytes: BODY.length, contentType: "audio/mpeg", finalUrl: url("/ok"), declaredBytes: 0 });
    assert.deepEqual(fs.readFileSync(file), BODY);
    assert.deepEqual(lookupCalls, [FAKE_HOST]);
  });

  test("an HTTP error status is a plain failure, not a guard code", async () => {
    await assert.rejects(downloadPublicUrl(url("/missing"), dest(), reachable()), { message: "HTTP 404" });
  });
});

describe("assertPublicHttpUrl", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  test("a public host is accepted and the parsed URL returned", async () => {
    const parsed = await assertPublicHttpUrl("https://hook.example.com/a?b=1", { lookup: publicLookup });
    assert.ok(parsed instanceof URL);
    assert.equal(parsed.href, "https://hook.example.com/a?b=1");
  });

  test("a public IP literal is accepted without a lookup", async () => {
    const lookup = async () => { throw new Error("should not resolve an IP literal"); };
    assert.equal((await assertPublicHttpUrl("http://8.8.8.8/x", { lookup })).hostname, "8.8.8.8");
  });

  test("private, loopback and metadata IP literals are refused", async () => {
    for (const bad of [
      "http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "http://10.1.2.3/",
      "http://[::1]/", "http://[::ffff:169.254.169.254]/", "http://2130706433/", "http://0x7f.1/",
    ]) {
      await assert.rejects(assertPublicHttpUrl(bad), { code: "URL_PRIVATE", message: "URL_PRIVATE" }, bad);
    }
  });

  test("a name that resolves to a private address is refused", async () => {
    const lookup = async () => [{ address: "10.0.0.7", family: 4 }];
    await assert.rejects(assertPublicHttpUrl("https://internal.example/x", { lookup }), { code: "URL_PRIVATE" });
  });

  test("a name is refused when ANY of its addresses is private", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
    await assert.rejects(assertPublicHttpUrl("https://mixed.example/x", { lookup }), { code: "URL_PRIVATE" });
  });

  test("every address is asked for, not just the first", async () => {
    let options;
    const lookup = async (_host, opts) => { options = opts; return [{ address: "93.184.216.34", family: 4 }]; };
    await assertPublicHttpUrl("https://hook.example.com/", { lookup });
    assert.equal(options?.all, true);
  });

  test("a lookup that answers with a single address object still works", async () => {
    const lookup = async () => ({ address: "192.168.0.2", family: 4 });
    await assert.rejects(assertPublicHttpUrl("https://single.example/", { lookup }), { code: "URL_PRIVATE" });
  });

  test("a name with no addresses is refused", async () => {
    const lookup = async () => [];
    await assert.rejects(assertPublicHttpUrl("https://empty.example/", { lookup }), { code: "URL_PRIVATE" });
  });

  test("non-http schemes and junk are refused", async () => {
    for (const bad of ["ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)", "not a url", "", null, undefined]) {
      await assert.rejects(assertPublicHttpUrl(bad, { lookup: publicLookup }), { code: "URL_SCHEME" }, String(bad));
    }
  });
});

describe("guard error helpers", () => {
  test("isUrlGuardError is true only for the refusal codes", () => {
    for (const code of ["URL_SCHEME", "URL_PRIVATE", "URL_REDIRECTS", "URL_TOO_LARGE"]) {
      assert.equal(isUrlGuardError(Object.assign(new Error(code), { code })), true, code);
    }
    assert.equal(isUrlGuardError(Object.assign(new Error("URL_TIMEOUT"), { code: "URL_TIMEOUT" })), false);
    assert.equal(isUrlGuardError(new Error("HTTP 404")), false);
    assert.equal(isUrlGuardError(null), false);
  });

  test("urlGuardMessage starts with the code and adds a plain sentence", () => {
    const msg = urlGuardMessage(Object.assign(new Error("URL_PRIVATE"), { code: "URL_PRIVATE" }));
    assert.match(msg, /^URL_PRIVATE: [A-Z].+\.$/);
    assert.equal(urlGuardMessage(new Error("HTTP 500")), null);
  });
});

describe("fetchPublic (pinned request for a URL that is only POSTed to)", () => {
  test("the socket goes to the address that was vetted, whatever DNS says later", async () => {
    let seen = null;
    const fetchImpl = async (href, init) => { seen = { href, init }; return { status: 200, ok: true }; };
    const res = await fetchPublic("https://hook.example.com/x", { method: "POST", body: "{}" }, {
      lookup: async () => ({ address: "93.184.216.34", family: 4 }),
      fetchImpl,
    });
    assert.equal(res.status, 200);
    assert.equal(seen.href, "https://hook.example.com/x");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.redirect, "manual");
    // The agent's own lookup answers with the vetted address for ANY name, so a
    // second (rebinding) DNS answer is never consulted for the connection.
    const agent = typeof seen.init.agent === "function" ? seen.init.agent(new URL(seen.href)) : seen.init.agent;
    const answer = await new Promise((resolve) => agent.options.lookup("hook.example.com", {}, (_e, address, family) => resolve({ address, family })));
    assert.deepEqual(answer, { address: "93.184.216.34", family: 4 });
    const all = await new Promise((resolve) => agent.options.lookup("hook.example.com", { all: true }, (_e, list) => resolve(list)));
    assert.deepEqual(all, [{ address: "93.184.216.34", family: 4 }]);
  });

  test("a real request is pinned: an unresolvable name still reaches the vetted address", async () => {
    const res = await fetchPublic(url("/ok"), { method: "POST", body: "{}" }, reachable());
    assert.equal(res.status, 200);
  });

  test("a redirect is returned, not followed", async () => {
    lookupCalls = [];
    const res = await fetchPublic(url("/chain"), { method: "POST" }, reachable());
    assert.equal(res.status, 302);
    assert.deepEqual(lookupCalls, [FAKE_HOST]);
  });

  test("private hosts and other schemes are refused before connecting", async () => {
    let fetched = false;
    const fetchImpl = async () => { fetched = true; return { status: 200 }; };
    await assert.rejects(fetchPublic(`http://127.0.0.1:${port}/ok`, {}, { fetchImpl }), { code: "URL_PRIVATE" });
    await assert.rejects(fetchPublic("http://hook.internal/x", {}, { fetchImpl, lookup: async () => ({ address: "10.0.0.9", family: 4 }) }), { code: "URL_PRIVATE" });
    await assert.rejects(fetchPublic("ftp://hook.example.com/x", {}, { fetchImpl }), { code: "URL_SCHEME" });
    assert.equal(fetched, false);
  });

  test("a hook that never answers is aborted after timeoutMs", async () => {
    await assert.rejects(fetchPublic(url("/stall"), { method: "POST" }, reachable({ timeoutMs: 80 })).then((r) => r.text()), (err) => err?.name === "AbortError" || /abort/i.test(String(err?.message)));
  });
});
