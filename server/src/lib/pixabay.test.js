/**
 * pixabayDownloadVideoById names its output file after the id
 * (pixabay-<id>.mp4) and puts it in the API query, so a request id like
 * "123/../.." could write outside the outputs folder (#112). Only a numeric
 * Pixabay id is accepted, checked before any request is made.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pixabayDownloadVideoById, pixabayHitToVideo } from "./pixabay.js";
import pixabayRouter from "../routes/pixabay.js";

const BAD_IDS = ["123/../..", "../x", "..\\..\\x", "12a", "", " 1", "1.5", "-1", "1e3"];
let savedKey;
before(() => { savedKey = process.env.PIXABAY_API_KEY; process.env.PIXABAY_API_KEY = "test-key-not-real"; });
after(() => { if (savedKey === undefined) delete process.env.PIXABAY_API_KEY; else process.env.PIXABAY_API_KEY = savedKey; });

describe("pixabayDownloadVideoById", () => {
  // The refusal comes before the request: the error names the id, not the
  // (fake) key the Pixabay API would reject.
  test("a non-numeric id is refused before any request", async () => {
    for (const id of BAD_IDS) {
      await assert.rejects(pixabayDownloadVideoById(id), /Pixabay video id must be a number/, JSON.stringify(id));
    }
  });
});

describe("POST /api/pixabay/download", () => {
  test("a traversal id is a 400 with the id message", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: process.cwd(), outputDir: process.cwd() }; next(); });
    app.use("/api/pixabay", pixabayRouter);
    const res = await request(app).post("/api/pixabay/download").send({ id: "123/../.." });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Pixabay video id must be a number/);
  });
});

describe("pixabayHitToVideo", () => {
  test("a Pixabay hit with video files maps to an item (it used to throw a ReferenceError)", () => {
    const video = pixabayHitToVideo({
      id: 7, duration: 15, pageURL: "https://pixabay.com/videos/7/", picture_id: "abc",
      videos: { medium: { url: "https://v/m.mp4", width: 1280, height: 720 }, tiny: { url: "https://v/t.mp4", width: 640, height: 360 } },
    });
    assert.equal(video.id, 7);
    assert.equal(video.previewUrl, "https://v/m.mp4");
    assert.deepEqual(video.files.map((f) => [f.quality, f.width, f.link]), [["medium", 1280, "https://v/m.mp4"], ["tiny", 640, "https://v/t.mp4"]]);
  });

  test("a Pixabay hit with no video files has no preview and no files", () => {
    const video = pixabayHitToVideo({ id: 8, duration: 3, pageURL: "u" });
    assert.equal(video.previewUrl, undefined);
    assert.deepEqual(video.files, []);
  });
});

test("a hit with a user image but no picture_id has no image (no broken vimeo URL)", () => {
  const video = pixabayHitToVideo({ id: 9, duration: 2, pageURL: "u", userImageURL: "https://u/x.jpg" });
  assert.equal(video.image, undefined);
});

test("a hit with a picture_id gets its vimeo still", () => {
  const video = pixabayHitToVideo({ id: 10, duration: 2, pageURL: "u", picture_id: "abc" });
  assert.equal(video.image, "https://i.vimeocdn.com/video/abc_640x360.jpg");
});
