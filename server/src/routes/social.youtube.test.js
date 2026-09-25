import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
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
        thumbnails: {
          set: async (args) => {
            calls.set.push(args);
            // Like the real client, read the whole stream before returning.
            const body = args?.media?.body;
            if (body && typeof body[Symbol.asyncIterator] === "function") {
              for await (const _chunk of body) { /* drain */ }
            }
            return { data: {} };
          },
        },
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

  test("the thumbnail is sent as a 1280x720 JPEG made for it, and the made file is cleaned up", async () => {
    // YouTube refuses thumbnails over 2 MB; a phone photo or generated PNG
    // often is. The picture is converted first, with the title drawn on it
    // when asked.
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const png = path.join(outputDir, "photo.png");
    const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=skyblue:s=2400x1600", "-frames:v", "1", png]);
    assert.equal(made.status, 0, String(made.stderr));
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/long.mp4", title: "Still waters",
      thumbnailPath: "/outputs/photo.png", thumbnailTitle: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const sent = fake.calls.set[0].media;
    assert.equal(sent.mimeType, "image/jpeg");
    assert.match(path.basename(sent.body.path), /^yt-thumb-.*\.jpg$/);
    assert.equal(fs.existsSync(sent.body.path), false, "the made thumbnail is removed after the upload");
    assert.ok(fs.existsSync(png), "your own picture is untouched");
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

/** What image generation writes: JPEG bytes under a .png name. */
function generatedPicture(outputDir, name = "part-1.png") {
  const file = path.join(outputDir, name);
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406080:s=1344x768", "-frames:v", "1", "-f", "mjpeg", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe("YouTube thumbnails with a title on generated pictures", () => {
  let fake;
  beforeEach(() => { fake = fakeGoogle(); _setGoogleImpl(fake.google); });
  afterEach(() => { _resetGoogleImpl(); });

  test("publishing sends a made 1280x720 JPEG, not the bare picture", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    generatedPicture(outputDir);
    const sent = [];
    const set = fake.google.youtube().thumbnails.set;
    fake.google.youtube = ((orig) => () => ({ ...orig(), thumbnails: { set: async (args) => { sent.push(await readAll(args.media.body)); return set({ ...args, media: { ...args.media, body: null } }); } } }))(fake.google.youtube);
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/long.mp4", title: "Be Still, My Soul",
      thumbnailPath: "/outputs/part-1.png", thumbnailTitle: true, thumbnailTagline: "2 hours · scripture",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.thumbnailWarning, undefined);
    assert.equal(sent.length, 1);
    const tmp = path.join(os.tmpdir(), `sent-${Date.now()}.jpg`);
    fs.writeFileSync(tmp, sent[0]);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", tmp], { encoding: "utf8" });
    fs.rmSync(tmp, { force: true });
    assert.equal(probe.stdout.trim(), "1280,720", "the made thumbnail, not the 1344x768 original");
  });

  test("when the title can't be drawn, the picture still goes up and the operator is told", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    fs.writeFileSync(path.join(outputDir, "thumb.png"), "img");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/long.mp4", title: "T", thumbnailPath: "/outputs/thumb.png", thumbnailTitle: true,
    });
    assert.equal(res.status, 200);
    assert.match(res.body.thumbnailWarning, /without it/);
    assert.equal(fake.calls.set.length, 1);
  });

  test("no warning when no title was asked for", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    fs.writeFileSync(path.join(outputDir, "thumb.png"), "img");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/long.mp4", title: "T", thumbnailPath: "/outputs/thumb.png",
    });
    assert.equal(res.body.thumbnailWarning, undefined);
  });
});

describe("POST /api/social/youtube/thumbnail-preview", () => {
  test("returns the thumbnail as it would be published", async () => {
    const { a, outputDir } = app();
    generatedPicture(outputDir);
    const res = await request(a).post("/api/social/youtube/thumbnail-preview")
      .send({ thumbnailPath: "/outputs/part-1.png", title: "Be Still, My Soul", thumbnailTitle: true, thumbnailTagline: "2 hours" })
      .buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /image\/jpeg/);
    assert.deepEqual([...res.body.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  });

  test("refuses a missing path, a path outside the caller's outputs, a missing file and a non-picture", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "junk.png"), "not an image");
    const post = (body) => request(a).post("/api/social/youtube/thumbnail-preview").send(body);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ thumbnailPath: "/outputs/../../secret.png" })).status, 400);
    assert.equal((await post({ thumbnailPath: "/outputs/gone.png" })).status, 404);
    assert.equal((await post({ thumbnailPath: "/outputs/junk.png" })).status, 422);
  });
});

describe("preview load", () => {
  test("one preview at a time per user: a second while the first runs is told it's busy", async () => {
    const { a, outputDir } = app();
    generatedPicture(outputDir);
    const body = { thumbnailPath: "/outputs/part-1.png", title: "T", thumbnailTitle: true };
    const [first, second] = await Promise.all([
      request(a).post("/api/social/youtube/thumbnail-preview").send(body),
      request(a).post("/api/social/youtube/thumbnail-preview").send(body),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 429]);
    const again = await request(a).post("/api/social/youtube/thumbnail-preview").send(body);
    assert.equal(again.status, 200, "the slot is released afterwards");
  });

  test("a failed preview releases its slot too", async () => {
    const { a } = app();
    assert.equal((await request(a).post("/api/social/youtube/thumbnail-preview").send({})).status, 400);
    assert.equal((await request(a).post("/api/social/youtube/thumbnail-preview").send({})).status, 400);
  });
});

describe("POST /api/social/youtube/thumbnail", () => {
  let fake;
  beforeEach(() => { fake = fakeGoogle(); _setGoogleImpl(fake.google); });
  afterEach(() => { _resetGoogleImpl(); });

  test("puts a titled thumbnail on a video that is already up", async () => {
    const { a, outputDir } = app();
    generatedPicture(outputDir);
    const res = await request(a).post("/api/social/youtube/thumbnail")
      .send({ videoId: "Awlj9uLvOCQ", thumbnailPath: "/outputs/part-1.png", title: "Be Still, My Soul", thumbnailTitle: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(fake.calls.set.length, 1);
    assert.equal(fake.calls.set[0].videoId, "Awlj9uLvOCQ");
    assert.equal(fake.calls.set[0].media.mimeType, "image/jpeg");
  });

  test("refuses a malformed video id before touching YouTube", async () => {
    const { a, outputDir } = app();
    generatedPicture(outputDir);
    for (const videoId of ["", "short", "Awlj9uLvOCQ&x=1", "../../etc/pass"]) {
      const res = await request(a).post("/api/social/youtube/thumbnail").send({ videoId, thumbnailPath: "/outputs/part-1.png" });
      assert.equal(res.status, 400, videoId);
    }
    assert.equal(fake.calls.set.length, 0);
  });

  test("reports YouTube's refusal instead of claiming success", async () => {
    const { a, outputDir } = app();
    generatedPicture(outputDir);
    const orig = fake.google.youtube;
    fake.google.youtube = () => ({ ...orig(), thumbnails: { set: async () => { throw new Error("Forbidden: video not owned"); } } });
    const res = await request(a).post("/api/social/youtube/thumbnail").send({ videoId: "Awlj9uLvOCQ", thumbnailPath: "/outputs/part-1.png" });
    assert.equal(res.status, 502);
    assert.match(res.body.error, /not owned/);
  });

  test("says YouTube isn't connected when it isn't", async () => {
    const { a, dataDir, outputDir } = app();
    writeSocialStore(dataDir, {});
    generatedPicture(outputDir);
    const res = await request(a).post("/api/social/youtube/thumbnail").send({ videoId: "Awlj9uLvOCQ", thumbnailPath: "/outputs/part-1.png" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not connected/);
    assert.equal(fake.calls.set.length, 0);
  });
});
