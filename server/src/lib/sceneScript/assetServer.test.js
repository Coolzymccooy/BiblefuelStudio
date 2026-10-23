import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { startAssetServer } from "./assetServer.js";

/** A raw request, so the Host header can be set as a rebinding page would. */
function get(port, name, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: `/${name}`, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("asset server", () => {
  let root;
  let server;
  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-assets-"));
    fs.writeFileSync(path.join(root, "clip.mp4"), "0123456789");
    fs.writeFileSync(path.join(root, "secret.txt"), "no");
    server = await startAssetServer({ "clip-sh1.mp4": path.join(root, "clip.mp4") });
  });
  after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("serves a listed file whole and by byte range", async () => {
    const whole = await get(server.port, "clip-sh1.mp4");
    assert.equal(whole.status, 200);
    assert.equal(whole.body, "0123456789");
    assert.equal(whole.headers["content-type"], "video/mp4");
    const part = await get(server.port, "clip-sh1.mp4", { Range: "bytes=2-4" });
    assert.equal(part.status, 206);
    assert.equal(part.body, "234");
    assert.equal(part.headers["content-range"], "bytes 2-4/10");
    const bad = await get(server.port, "clip-sh1.mp4", { Range: "bytes=20-30" });
    assert.equal(bad.status, 416);
  });

  test("serves nothing that was not listed, by name or by path", async () => {
    assert.equal((await get(server.port, "secret.txt")).status, 404);
    assert.equal((await get(server.port, "..%2Fsecret.txt")).status, 404);
  });

  test("refuses a request addressed to any other host name", async () => {
    const rebound = await get(server.port, "clip-sh1.mp4", { Host: `attacker.example:${server.port}` });
    assert.equal(rebound.status, 403);
    assert.equal(server.url("a b.wav"), `http://127.0.0.1:${server.port}/a%20b.wav`);
  });
});
