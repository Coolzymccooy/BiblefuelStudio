import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import express from "express";
import request from "supertest";
import { createVisualLibraryRouter } from "./visualLibrary.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { readLibrary } from "../lib/visualLibrary/store.js";

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FP = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const needsFfmpeg = { skip: !hasFfmpeg && "ffmpeg not installed" };

const uuid = (n) => `0f8c2a4e-1b3d-4c5e-8f9a-${String(n).padStart(12, "0")}`;

describe("POST /api/visual-library/import", () => {
  let root;
  let outputDir;
  let dataDir;
  let app;
  let admin = true;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-import-"));
    outputDir = path.join(root, "out");
    dataDir = path.join(root, "data");
    fs.mkdirSync(outputDir, { recursive: true });
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ctx = { dataDir, outputDir, isSuperAdmin: admin };
      next();
    });
    app.use("/api/visual-library", requireSuperAdmin, createVisualLibraryRouter());
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  /** A short clip, as POST /api/media/upload-background leaves a video on disk. */
  function upload(n, { size = "360x640", ext = "mp4", codec = ["-c:v", "libx264", "-pix_fmt", "yuv420p"] } = {}) {
    const name = `bg-video-${uuid(n)}.${ext}`;
    const file = path.join(outputDir, name);
    const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=s=${size}:r=30:d=1`, ...codec, file]);
    assert.equal(r.status, 0, String(r.stderr));
    return { name, file };
  }

  const codecOf = (file) => spawnSync(FP, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name",
    "-of", "csv=p=0", file]).stdout.toString().trim();

  test("adds an uploaded clip to the library with its prompt, tags and cost", needsFfmpeg, async () => {
    const { name, file } = upload(1);
    const r = await request(app).post("/api/visual-library/import").send({
      uploadPath: name, prompt: "A still lake at dawn.", tags: ["Lake", "dawn"], costUsd: 0.53,
      model: "dreamina-seedance-2-0-mini-260615", taskId: "cgt-123",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const clip = r.body.clip;
    assert.equal(clip.prompt, "A still lake at dawn.");
    assert.equal(clip.promptKnown, true);
    assert.deepEqual(clip.tags, ["lake", "dawn"]);
    assert.equal(clip.costUsd, 0.53);
    assert.equal(clip.aspect, "portrait");
    assert.equal(clip.source.kind, "import");
    assert.equal(clip.taskId, "cgt-123");
    assert.ok(clip.durationSec > 0.5 && clip.durationSec < 2, String(clip.durationSec));
    assert.equal(clip.url, `/outputs/visual-library/${clip.id}/clip.mp4`);
    assert.equal(clip.posterUrl, `/outputs/visual-library/${clip.id}/poster.jpg`);
    assert.ok(fs.existsSync(path.join(outputDir, "visual-library", clip.id, "clip.mp4")));
    assert.ok(fs.existsSync(path.join(outputDir, "visual-library", clip.id, "poster.jpg")));
    assert.equal(fs.existsSync(file), false, "the upload is moved, not copied");
    assert.equal(readLibrary(dataDir)[0].id, clip.id);
  });

  test("a clip with no prompt is kept but marked prompt unknown", needsFfmpeg, async () => {
    const { name } = upload(2, { size: "640x360" });
    const r = await request(app).post("/api/visual-library/import").send({ uploadPath: name });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.clip.promptKnown, false);
    assert.equal(r.body.clip.aspect, "landscape");
    assert.equal(r.body.clip.costUsd, 0);
  });

  test("a clip that is not H.264 is converted, and the original upload removed", needsFfmpeg, async () => {
    const { name, file } = upload(3, { ext: "mov", codec: ["-c:v", "mpeg4"] });
    const r = await request(app).post("/api/visual-library/import").send({ uploadPath: name, prompt: "Hills." });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(codecOf(path.join(outputDir, "visual-library", r.body.clip.id, "clip.mp4")), "h264");
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(fs.readdirSync(outputDir).filter((f) => f.startsWith("bg-video-")), []);
  });

  test("refuses a path that is not one of your uploads", async () => {
    const before = readLibrary(dataDir).length;
    for (const uploadPath of ["../data/visual-library.json", "/etc/passwd", `bg-video-${uuid(99)}.mp4`, "", 42]) {
      const r = await request(app).post("/api/visual-library/import").send({ uploadPath });
      assert.equal(r.status, 400, `${uploadPath}: ${JSON.stringify(r.body)}`);
    }
    assert.equal(readLibrary(dataDir).length, before);
  });

  test("refuses a file that is not a video", async () => {
    const name = `bg-video-${uuid(4)}.mp4`;
    fs.writeFileSync(path.join(outputDir, name), "not a video");
    const r = await request(app).post("/api/visual-library/import").send({ uploadPath: name });
    assert.equal(r.status, 400);
  });

  test("checks the fields", async () => {
    const name = `bg-video-${uuid(5)}.mp4`;
    for (const body of [
      { uploadPath: name, prompt: "x".repeat(1501) },
      { uploadPath: name, costUsd: -1 },
      { uploadPath: name, costUsd: 1000 },
      { uploadPath: name, tags: "lake" },
      { uploadPath: name, model: "m".repeat(81) },
    ]) {
      const r = await request(app).post("/api/visual-library/import").send(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });

  test("is for super admins only", async () => {
    admin = false;
    try {
      const r = await request(app).post("/api/visual-library/import").send({ uploadPath: `bg-video-${uuid(6)}.mp4` });
      assert.equal(r.status, 403);
    } finally {
      admin = true;
    }
  });
});
