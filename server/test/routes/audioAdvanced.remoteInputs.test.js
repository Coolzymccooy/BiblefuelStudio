/**
 * /api/audio-adv routes hand their inputs to ffmpeg, which fetches URL inputs
 * itself with no SSRF check (including URLs written into a concat list).
 *
 * A URL in the request is refused outright like any path outside the
 * caller's folder (#112). The only URLs left are the links of the caller's
 * saved library items (stock footage), and those must be localised through
 * the guard first, so a private address is refused and the loopback fixture
 * below is never reached.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import audioAdvRouter from "../../src/routes/audio_advanced.js";

let server;
let port;
let hits = 0;

before(async () => {
  server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "audio/mpeg" }).end(Buffer.alloc(4096));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function sandbox(t, libraryItems = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-adv-remote-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = path.join(dir, "a.mp3");
  fs.writeFileSync(a, Buffer.alloc(200, 0));
  fs.writeFileSync(path.join(dir, "library.json"), JSON.stringify({ items: libraryItems }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: dir, outputDir: dir }; next(); });
  app.use("/api/audio-adv", audioAdvRouter);
  return { app, dir, a };
}

const loopback = (p) => `http://127.0.0.1:${port}${p}`;
/** A saved library item whose link is `url`. */
const item = (id, url) => ({ id, url, previewUrl: url });

function assertRefused(res) {
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.ok(String(res.body.error).startsWith("URL_PRIVATE: "), res.body.error);
}

function assertOutside(res) {
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA");
}

const concatLists = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith("concat-"));

describe("audio-adv refuses a URL in the request", () => {
  const urls = () => [
    loopback("/b.mp3"),
    "http://169.254.169.254/x.mp3",
    `http:/127.0.0.1:${port}/latest/meta-data/`,
    `http:127.0.0.1:${port}/latest/meta-data/`,
    `tcp://127.0.0.1:${port}`,
    `gopher://127.0.0.1:${port}/x`,
  ];

  test("/merge", async (t) => {
    const { app, dir, a } = sandbox(t);
    hits = 0;
    for (const url of [...urls(), `concat:${a}|${a}`]) {
      assertOutside(await request(app).post("/api/audio-adv/merge").send({ inputs: [a, url] }));
    }
    assert.equal(hits, 0);
    assert.deepEqual(concatLists(dir), []);
  });

  test("/timeline", async (t) => {
    const { app } = sandbox(t);
    hits = 0;
    for (const url of urls()) assertOutside(await request(app).post("/api/audio-adv/timeline").send({ clips: [{ path: url }] }));
    assert.equal(hits, 0);
  });

  test("/timeline-preview background and clip", async (t) => {
    const { app, dir, a } = sandbox(t);
    const bg = path.join(dir, "bg.mp4");
    fs.writeFileSync(bg, Buffer.alloc(200, 0));
    hits = 0;
    for (const url of urls()) {
      assertOutside(await request(app).post("/api/audio-adv/timeline-preview").send({ backgroundPath: url, clips: [{ path: a }] }));
      assertOutside(await request(app).post("/api/audio-adv/timeline-preview").send({ backgroundPath: bg, clips: [{ path: url }] }));
    }
    assert.equal(hits, 0);
  });
});

describe("audio-adv localises a saved library item's URL through the guard", () => {
  test("/merge refuses a private item and writes no concat list", async (t) => {
    const { app, dir, a } = sandbox(t, [item("101", loopback("/b.mp3"))]);
    hits = 0;
    const res = await request(app).post("/api/audio-adv/merge").send({ inputs: [a, "101"] });
    assertRefused(res);
    assert.equal(hits, 0);
    assert.deepEqual(concatLists(dir), []);
  });

  test("/merge never writes an item's URL into the concat list", async (t) => {
    const { app, a } = sandbox(t, [item("102", "http://169.254.169.254/x.mp3")]);
    assertRefused(await request(app).post("/api/audio-adv/merge").send({ inputs: [a, "102"] }));
  });

  test("/timeline refuses a private item, also in single-slash form", async (t) => {
    const { app } = sandbox(t, [item("103", loopback("/c.mp3")), item("104", `http:/127.0.0.1:${port}/latest/meta-data/`)]);
    hits = 0;
    assertRefused(await request(app).post("/api/audio-adv/timeline").send({ clips: [{ path: "103" }] }));
    assertRefused(await request(app).post("/api/audio-adv/timeline").send({ clips: [{ path: "104" }] }));
    assert.equal(hits, 0);
  });

  test("/timeline-preview refuses a private background item, also in no-slash form", async (t) => {
    const { app, a } = sandbox(t, [item("105", loopback("/bg.mp4")), item("106", `http:127.0.0.1:${port}/latest/meta-data/`)]);
    hits = 0;
    assertRefused(await request(app).post("/api/audio-adv/timeline-preview").send({ backgroundPath: "105", clips: [{ path: a }] }));
    assertRefused(await request(app).post("/api/audio-adv/timeline-preview").send({ backgroundPath: "106", clips: [{ path: a }] }));
    assert.equal(hits, 0);
  });

  test("/timeline-preview refuses a private clip item", async (t) => {
    const { app, dir } = sandbox(t, [item("107", loopback("/c.mp3"))]);
    const bg = path.join(dir, "bg.mp4");
    fs.writeFileSync(bg, Buffer.alloc(200, 0));
    hits = 0;
    assertRefused(await request(app).post("/api/audio-adv/timeline-preview").send({ backgroundPath: bg, clips: [{ path: "107" }] }));
    assert.equal(hits, 0);
  });

  test("other schemes in an item (tcp:, gopher:, concat:) are refused with URL_SCHEME", async (t) => {
    const dirItems = [item("108", `tcp://127.0.0.1:${port}`), item("109", `gopher://127.0.0.1:${port}/x`), item("110", "concat:a|b")];
    const { app, a } = sandbox(t, dirItems);
    for (const id of ["108", "109", "110"]) {
      const res = await request(app).post("/api/audio-adv/merge").send({ inputs: [a, id] });
      assert.equal(res.status, 400, id);
      assert.ok(String(res.body.error).startsWith("URL_SCHEME: "), `${id}: ${res.body.error}`);
    }
  });
});
