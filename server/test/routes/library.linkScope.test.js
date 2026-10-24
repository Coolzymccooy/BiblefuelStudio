/**
 * A saved library item's links are read later: by the thumbnail ffmpeg run in
 * GET /api/library and by renders (#112, security review). POST /add refuses
 * a local url/image/files[].link outside the caller's own folder (stock https
 * links stay allowed) and an id that is not a plain name; GET writes
 * thumbnails into the caller's own outputs folder, only for confined videos,
 * under a name built from a sanitised id.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import request from "supertest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "library-links-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const { default: libraryRouter } = await import("../../src/routes/library.js");
const { captureFfmpegReports } = await import("../helpers/ffreport.js");

const dataDir = path.join(root, "data", "users", "u1");
const mine = path.join(dataDir, "outputs");
const theirs = path.join(root, "data", "users", "u2", "outputs");
const ctx = { userId: "u1", dataDir, outputDir: mine, isSuperAdmin: false, isOwner: false };
const ownVideo = path.join(mine, "clip.mp4");
const secret = path.join(theirs, "private.mp4");
const ownerVideo = path.join(process.env.OUTPUT_DIR, "owner.mp4");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = ctx; next(); });
  a.use("/api/library", libraryRouter);
  return a;
}

const stored = () => {
  const file = path.join(dataDir, "library.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).items : [];
};
const plant = (items) => fs.writeFileSync(path.join(dataDir, "library.json"), JSON.stringify({ items }));

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  if (!noFfmpeg) {
    for (const file of [ownVideo, secret, ownerVideo]) {
      spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-pix_fmt", "yuv420p", file]);
    }
  } else {
    for (const file of [ownVideo, secret, ownerVideo]) fs.writeFileSync(file, "x");
  }
});

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

describe("POST /api/library/add", () => {
  test("refuses an id that is not a plain name, x/../../ included", async () => {
    plant([]);
    for (const id of ["x/../../evil", "../evil", "a b", "x".repeat(201), "", { a: 1 }]) {
      const res = await request(app()).post("/api/library/add").send({ id, url: "https://videos.pexels.com/a.mp4" });
      assert.equal(res.status, 400, JSON.stringify(id));
    }
    assert.deepEqual(stored(), []);
  });

  test("refuses a local url, image or file link outside the caller's folder", async () => {
    plant([]);
    for (const [field, value] of [
      ["url", secret], ["url", ownerVideo], ["url", "file:///etc/passwd"], ["url", `${mine}/../../u2/outputs/private.mp4`],
      ["image", secret], ["image", "/outputs/../../u2/outputs/x.jpg"],
      ["files", [{ link: secret, quality: "hd" }]],
    ]) {
      const res = await request(app()).post("/api/library/add").send({ id: "evil_1", [field]: value });
      assert.equal(res.status, 403, `${field}=${JSON.stringify(value)}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA");
    }
    assert.deepEqual(stored(), []);
  });

  test("keeps stock https links and the caller's own files", async () => {
    plant([]);
    const stock = { id: 3571264, url: "https://www.pexels.com/video/3571264/", image: "https://images.pexels.com/x.jpg", files: [{ link: "https://videos.pexels.com/x.mp4", quality: "hd" }] };
    assert.equal((await request(app()).post("/api/library/add").send(stock)).status, 200);
    const own = { id: "local_mine", url: ownVideo, files: [{ link: "/outputs/clip.mp4" }] };
    const res = await request(app()).post("/api/library/add").send(own);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(stored().map((x) => String(x.id)).sort(), ["3571264", "local_mine"]);
  });
});

describe("GET /api/library thumbnails", () => {
  test("never runs ffmpeg on a planted outside link and drops a planted outside image", async () => {
    plant([
      { id: "x/../../../evil", url: secret },
      { id: "owner_pick", url: ownerVideo },
      { id: "img_pick", url: "https://videos.pexels.com/a.mp4", image: secret },
    ]);
    const cap = captureFfmpegReports(path.join(root, "reports-1"));
    let res;
    try {
      res = await request(app()).get("/api/library");
    } finally {
      cap.stop();
    }
    assert.equal(res.status, 200);
    const read = cap.commands().filter((c) => c.tokens.some((t) => [secret, ownerVideo].includes(path.resolve(t))));
    assert.deepEqual(read, []);
    for (const item of res.body.library.items) assert.equal(item.image, undefined, item.id);
    assert.deepEqual(fs.readdirSync(process.env.OUTPUT_DIR).filter((f) => f.endsWith(".jpg")), []);
    assert.equal(fs.existsSync(path.join(root, "data", "evil.jpg")), false);
    assert.equal(fs.existsSync(path.join(root, "evil.jpg")), false);
  });

  test("a thumbnail for the caller's own video lands in their outputs folder under a sanitised name", { skip: noFfmpeg }, async () => {
    plant([{ id: "x/../../mine", url: ownVideo }]);
    const res = await request(app()).get("/api/library");
    assert.equal(res.status, 200);
    const [item] = res.body.library.items;
    assert.ok(item.image, JSON.stringify(item));
    const name = path.posix.basename(item.image);
    assert.match(name, /^thumb-[\w-]+\.jpg$/);
    assert.ok(fs.existsSync(path.join(mine, name)), `${name} in the caller's outputs`);
    assert.deepEqual(fs.readdirSync(process.env.OUTPUT_DIR).filter((f) => f.endsWith(".jpg")), []);
  });
});
