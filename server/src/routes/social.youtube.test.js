import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import socialRouter, { _setFetchImpl, _resetFetchImpl } from "./social.js";
import { _setGoogleImpl, _resetGoogleImpl } from "../lib/social/youtubeUpload.js";
import { writeSocialStore } from "../lib/socialStore.js";
import { OUTPUT_DIR } from "../lib/paths.js";

function app() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-yt-"));
  const outputDir = path.join(dataDir, "outputs");
  fs.mkdirSync(outputDir);
  writeSocialStore(dataDir, { direct: { youtube: { clientId: "id", clientSecret: "sec", refreshToken: "ref" } } });
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir, isSuperAdmin: false }; next(); });
  a.use("/api/social", socialRouter);
  return { a, dataDir, outputDir };
}

function fakeGoogle() {
  const calls = { insert: [], set: [] };
  class OAuth2 { setCredentials() {} }
  return {
    calls,
    google: {
      auth: { OAuth2 },
      youtube: () => ({
        videos: {
          insert: async (args) => {
            calls.insert.push(args);
            // The real Google API client fully reads the upload stream over
            // HTTP before this promise resolves. Drain it here too, so this
            // fake doesn't leave an unconsumed fs.createReadStream dangling
            // when postToYoutube's finally-block cleanup deletes the file.
            const body = args?.media?.body;
            if (body && typeof body[Symbol.asyncIterator] === "function") {
              for await (const _chunk of body) { /* drain */ }
            }
            return { data: { id: "vid1" } };
          },
        },
        thumbnails: { set: async (args) => { calls.set.push(args); return { data: {} }; } },
      }),
    },
  };
}

describe("POST /api/social/post destination=youtube", () => {
  let fake;
  beforeEach(() => { fake = fakeGoogle(); _setGoogleImpl(fake.google); });
  afterEach(() => { _resetGoogleImpl(); _resetFetchImpl(); });

  test("uploads a local output with full metadata and a thumbnail", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    fs.writeFileSync(path.join(outputDir, "thumb.png"), "img");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube",
      videoUrl: "/outputs/long.mp4",
      title: "Psalms for Sleep",
      description: "One hour of Psalms.",
      tags: ["psalms", "sleep"],
      chapters: [{ startMs: 0, title: "Welcome" }, { startMs: 60000, title: "Psalm 23" }, { startMs: 120000, title: "Psalm 91" }],
      publishAt: new Date(Date.now() + 86_400_000).toISOString(),
      privacyStatus: "public",
      thumbnailPath: "/outputs/thumb.png",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.videoId, "vid1");
    assert.equal(res.body.forcedPrivate, true);
    const body = fake.calls.insert[0].requestBody;
    assert.equal(body.snippet.title, "Psalms for Sleep");
    assert.match(body.snippet.description, /00:00 Welcome\n01:00 Psalm 23\n02:00 Psalm 91/);
    assert.deepEqual(body.snippet.tags, ["psalms", "sleep"]);
    assert.equal(body.status.privacyStatus, "private");
    assert.equal(fake.calls.set[0].videoId, "vid1");
  });

  test("falls back to caption as description and title when only caption is sent (Timeline share)", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", caption: "Be still\nPsalm 46:10", privacyStatus: "unlisted",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = fake.calls.insert[0].requestBody;
    assert.equal(body.snippet.title, "Be still");
    assert.equal(body.snippet.description, "Be still\nPsalm 46:10");
    assert.equal(body.status.privacyStatus, "unlisted");

    // A caption-derived title (no explicit `title` sent) with a first line
    // over 100 chars must be truncated, not rejected — unlike an explicitly
    // provided over-length `title`, which validateYoutubeMetadata rejects by
    // name (see "names the validation failure" below). Existing Timeline/
    // Shorts shares regularly have a first caption line longer than 100
    // chars and must keep working exactly as before this change.
    fs.writeFileSync(path.join(outputDir, "clip2.mp4"), "vid");
    const longFirstLine = "y".repeat(150);
    const res2 = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip2.mp4", caption: `${longFirstLine}\nmore caption text`,
    });
    assert.equal(res2.status, 200, JSON.stringify(res2.body));
    const body2 = fake.calls.insert[1].requestBody;
    assert.equal(body2.snippet.title, "y".repeat(100));
    assert.equal(body2.snippet.title.length, 100);
  });

  test("names the validation failure and never calls YouTube", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "x".repeat(101),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /title must be 100/);
    assert.equal(fake.calls.insert.length, 0);
  });

  test("rejects a traversing thumbnailPath by name and never calls YouTube", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "T", thumbnailPath: "/outputs/../../etc/passwd",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /thumbnailPath/);
    assert.equal(fake.calls.insert.length, 0);
    assert.equal(fake.calls.set.length, 0);
  });

  test("rejects an absolute thumbnailPath outside the caller's outputs by name and never calls YouTube", async () => {
    const { a, outputDir, dataDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const elsewhere = path.join(dataDir, "not-outputs", "thumb.png");
    fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
    fs.writeFileSync(elsewhere, "img");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "T", thumbnailPath: elsewhere,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /thumbnailPath/);
    assert.equal(fake.calls.insert.length, 0);
  });

  test("rejects a videoUrl that resolves outside the caller's outputs by name", async () => {
    const { a, dataDir } = app();
    const elsewhere = path.join(dataDir, "not-outputs", "clip.mp4");
    fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
    fs.writeFileSync(elsewhere, "vid");
    for (const videoUrl of [elsewhere, "/outputs/../not-outputs/clip.mp4"]) {
      const res = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl, title: "T" });
      assert.equal(res.status, 400, videoUrl);
      assert.match(res.body.error, /videoUrl must point inside your outputs folder/);
    }
    assert.equal(fake.calls.insert.length, 0);
  });

  test("a non-admin tenant can use a genImg scene image from the global outputs dir as the thumbnail", async (t) => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const genImgDir = path.join(OUTPUT_DIR, "genImg", `yt-test-${process.pid}`);
    fs.mkdirSync(genImgDir, { recursive: true });
    const scene = path.join(genImgDir, "part-1.png");
    fs.writeFileSync(scene, "img");
    t.after(() => { try { fs.rmSync(genImgDir, { recursive: true, force: true }); } catch {} });
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "T",
      thumbnailPath: `/outputs/genImg/${path.basename(genImgDir)}/part-1.png`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(fake.calls.set.length, 1);
  });

  test("streams a remote videoUrl to disk instead of buffering it", async () => {
    const { a } = app();
    const { Readable } = await import("node:stream");
    let streamed = false;
    _setFetchImpl(async () => ({
      ok: true,
      status: 200,
      body: Readable.from([Buffer.from("part1"), Buffer.from("part2")]).once("end", () => { streamed = true; }),
    }));
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "https://cdn.example.com/v.mp4", title: "Remote",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(streamed, true);
    assert.equal(fake.calls.insert.length, 1);
  });
});
