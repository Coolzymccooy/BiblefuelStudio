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
        videos: { insert: async (args) => { calls.insert.push(args); return { data: { id: "vid1" } }; } },
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
