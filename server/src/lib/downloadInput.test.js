import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { isRemoteUrl, downloadToFile } from "./downloadInput.js";

const tmp = (name) => path.join(os.tmpdir(), `bf-dl-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
const headersOf = (map = {}) => ({ get: (k) => map[String(k).toLowerCase()] ?? null });
const okResp = (bytes = 2048, headers = {}) => ({
  ok: true,
  status: 200,
  headers: headersOf(headers),
  body: Readable.from([Buffer.alloc(bytes, 7)]),
});
// downloadToFile now vets the host before connecting; tests resolve every name
// to a public address so the stubbed fetch is reached.
const publicLookup = async () => ({ address: "93.184.216.34", family: 4 });

describe("isRemoteUrl", () => {
  test("distinguishes http(s) from local paths", () => {
    assert.equal(isRemoteUrl("https://videos.pexels.com/a.mp4"), true);
    assert.equal(isRemoteUrl("http://x/y.png"), true);
    assert.equal(isRemoteUrl("C:/Users/x/a.mp4"), false);
    assert.equal(isRemoteUrl("/var/data/a.mp4"), false);
    assert.equal(isRemoteUrl(""), false);
  });
});

describe("downloadToFile", () => {
  test("writes the body to disk on success", async (t) => {
    const dest = tmp("ok.mp4");
    t.after(() => { try { fs.unlinkSync(dest); } catch {} });
    const fetchImpl = async () => okResp(4096);
    const out = await downloadToFile("https://x/a.mp4", dest, { fetchImpl, lookup: publicLookup });
    assert.equal(out, dest);
    assert.equal(fs.statSync(dest).size, 4096);
  });

  test("retries a transient failure then succeeds", async (t) => {
    const dest = tmp("retry.mp4");
    t.after(() => { try { fs.unlinkSync(dest); } catch {} });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return okResp();
    };
    await downloadToFile("https://x/a.mp4", dest, { fetchImpl, lookup: publicLookup, retries: 2 });
    assert.equal(calls, 2);
    assert.ok(fs.existsSync(dest));
  });

  test("throws after exhausting retries and leaves no partial file", async () => {
    const dest = tmp("fail.mp4");
    const fetchImpl = async () => { throw new Error("ECONNRESET"); };
    await assert.rejects(
      () => downloadToFile("https://x/a.mp4", dest, { fetchImpl, lookup: publicLookup, retries: 1 }),
      /download failed/,
    );
    assert.equal(fs.existsSync(dest), false);
  });

  test("rejects a too-small (truncated) download", async () => {
    const dest = tmp("tiny.mp4");
    const fetchImpl = async () => okResp(10); // under MIN_VALID_BYTES
    await assert.rejects(
      () => downloadToFile("https://x/a.mp4", dest, { fetchImpl, lookup: publicLookup, retries: 0 }),
      /download failed/,
    );
    assert.equal(fs.existsSync(dest), false);
  });

  test("a private-address URL is refused with URL_PRIVATE and fetched zero times", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return okResp(); };
    const privateLookup = async () => ({ address: "10.0.0.5", family: 4 });
    for (const [url, lookup] of [
      ["http://169.254.169.254/latest/meta-data/x.mp4", publicLookup],
      ["http://127.0.0.1:5051/outputs/a.mp4", publicLookup],
      ["https://internal.example/a.mp4", privateLookup],
    ]) {
      const dest = tmp("private.mp4");
      await assert.rejects(
        () => downloadToFile(url, dest, { fetchImpl, lookup, retries: 2 }),
        (err) => err.code === "URL_PRIVATE",
        url,
      );
      assert.equal(fs.existsSync(dest), false);
    }
    assert.equal(calls, 0);
  });

  test("a non-http scheme is refused with URL_SCHEME and not retried", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return okResp(); };
    await assert.rejects(
      () => downloadToFile("file:///etc/passwd", tmp("scheme.mp4"), { fetchImpl, lookup: publicLookup, retries: 2 }),
      (err) => err.code === "URL_SCHEME",
    );
    assert.equal(calls, 0);
  });

  test("an oversized declared file is refused once, keeping code and declared size", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return okResp(2048, { "content-length": "5000000" }); };
    await assert.rejects(
      () => downloadToFile("https://x/big.mp4", tmp("big.mp4"), { fetchImpl, lookup: publicLookup, retries: 2, maxBytes: 1_000_000 }),
      (err) => err.code === "URL_TOO_LARGE" && err.declaredBytes === 5_000_000,
    );
    assert.equal(calls, 1);
  });

  test("a body bigger than maxBytes is cut off and not retried", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return okResp(8192); };
    const dest = tmp("cut.mp4");
    await assert.rejects(
      () => downloadToFile("https://x/cut.mp4", dest, { fetchImpl, lookup: publicLookup, retries: 2, maxBytes: 4096 }),
      (err) => err.code === "URL_TOO_LARGE",
    );
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(dest), false);
  });

  test("a redirect to a private address is refused without retrying", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: false, status: 302, headers: headersOf({ location: "http://169.254.169.254/" }), body: null };
    };
    await assert.rejects(
      () => downloadToFile("https://x/hop.mp4", tmp("hop.mp4"), { fetchImpl, lookup: publicLookup, retries: 2 }),
      (err) => err.code === "URL_PRIVATE",
    );
    assert.equal(calls, 1);
  });
});
