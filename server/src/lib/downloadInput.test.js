import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { isRemoteUrl, downloadToFile } from "./downloadInput.js";

const tmp = (name) => path.join(os.tmpdir(), `bf-dl-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
const okResp = (bytes = 2048) => ({ ok: true, status: 200, body: Readable.from([Buffer.alloc(bytes, 7)]) });

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
    const out = await downloadToFile("https://x/a.mp4", dest, { fetchImpl });
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
    await downloadToFile("https://x/a.mp4", dest, { fetchImpl, retries: 2 });
    assert.equal(calls, 2);
    assert.ok(fs.existsSync(dest));
  });

  test("throws after exhausting retries and leaves no partial file", async (t) => {
    const dest = tmp("fail.mp4");
    const fetchImpl = async () => { throw new Error("ECONNRESET"); };
    await assert.rejects(
      () => downloadToFile("https://x/a.mp4", dest, { fetchImpl, retries: 1 }),
      /download failed/,
    );
    assert.equal(fs.existsSync(dest), false);
  });

  test("rejects a too-small (truncated) download", async (t) => {
    const dest = tmp("tiny.mp4");
    const fetchImpl = async () => okResp(10); // under MIN_VALID_BYTES
    await assert.rejects(
      () => downloadToFile("https://x/a.mp4", dest, { fetchImpl, retries: 0 }),
      /download failed/,
    );
    assert.equal(fs.existsSync(dest), false);
  });
});
