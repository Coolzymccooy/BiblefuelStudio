import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { Readable } from "node:stream";
import socialRouter, { _setFetchImpl, _resetFetchImpl, _setLookupImpl, _resetLookupImpl, _holdPreviewSlot, _releasePreviewSlot } from "./social.js";
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
  const calls = { insert: [], set: [], items: [] };
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
        playlists: {
          list: async () => ({ data: { items: [{ id: "PLa", snippet: { title: "Oba Gba" }, contentDetails: { itemCount: 2 }, status: { privacyStatus: "public" } }] } }),
        },
        playlistItems: {
          insert: async (args) => { calls.items.push(args); return { data: {} }; },
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
  afterEach(() => { _resetGoogleImpl(); _resetFetchImpl(); _resetLookupImpl(); });

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

  test("a junction inside the caller's outputs cannot lead the video or thumbnail out (#112)", async (t) => {
    const { a, outputDir, dataDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const other = path.join(dataDir, "not-outputs");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "private.mp4"), "vid");
    fs.writeFileSync(path.join(other, "pic.png"), "img");
    const door = path.join(outputDir, "door");
    fs.symlinkSync(other, door, "junction");
    t.after(() => { try { fs.unlinkSync(door); } catch {} });
    const video = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl: "/outputs/door/private.mp4", title: "T" });
    assert.equal(video.status, 400, JSON.stringify(video.body));
    assert.match(video.body.error, /videoUrl must point inside your outputs folder/);
    const thumb = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "T", thumbnailPath: "/outputs/door/pic.png" });
    assert.equal(thumb.status, 400, JSON.stringify(thumb.body));
    assert.match(thumb.body.error, /thumbnailPath/);
    assert.equal(fake.calls.insert.length, 0);
    assert.equal(fake.calls.set.length, 0);
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

  test("a non-admin tenant can use their own generated picture from the global genImg dir as the thumbnail", async (t) => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const genImgDir = path.join(OUTPUT_DIR, "genImg", `genvis-u1-yt${process.pid}`);
    fs.mkdirSync(genImgDir, { recursive: true });
    fs.writeFileSync(path.join(genImgDir, "part-1.png"), "img");
    t.after(() => { try { fs.rmSync(genImgDir, { recursive: true, force: true }); } catch {} });
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "T",
      thumbnailPath: `/outputs/genImg/${path.basename(genImgDir)}/part-1.png`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(fake.calls.set.length, 1);
  });

  test("a non-admin tenant cannot use another account's picture from the global genImg dir (#112)", async (t) => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const genImgDir = path.join(OUTPUT_DIR, "genImg", `yt-test-${process.pid}`);
    fs.mkdirSync(genImgDir, { recursive: true });
    fs.writeFileSync(path.join(genImgDir, "part-1.png"), "img");
    t.after(() => { try { fs.rmSync(genImgDir, { recursive: true, force: true }); } catch {} });
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "T",
      thumbnailPath: `/outputs/genImg/${path.basename(genImgDir)}/part-1.png`,
    });
    // The value names the caller's own genImg folder, where no such picture is:
    // the video goes up and the thumbnail is reported, never read from theirs.
    assert.equal(fake.calls.set.length, 0);
    assert.match(String(res.body.thumbnailError), /not found/);
    assert.ok(!String(res.body.thumbnailError).includes(path.resolve(OUTPUT_DIR, "genImg")), res.body.thumbnailError);
  });

  test("streams a remote videoUrl to disk instead of buffering it", async () => {
    const { a } = app();
    const { Readable } = await import("node:stream");
    let streamed = false;
    // The download is SSRF-vetted: resolve the CDN name to a public address.
    _setLookupImpl(async () => ({ address: "93.184.216.34", family: 4 }));
    _setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: Readable.from([Buffer.from("part1"), Buffer.from("part2")]).once("end", () => { streamed = true; }),
    }));
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "https://cdn.example.com/v.mp4", title: "Remote",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(streamed, true);
    assert.equal(fake.calls.insert.length, 1);
  });

  test("a remote videoUrl on a private or metadata address is refused and never fetched", async () => {
    const { a } = app();
    let fetched = 0;
    _setFetchImpl(async () => { fetched += 1; throw new Error("must not connect"); });
    for (const videoUrl of ["http://169.254.169.254/latest/meta-data/v.mp4", "http://10.0.0.8/v.mp4", "http://[::1]/v.mp4"]) {
      const res = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl, title: "T" });
      assert.equal(res.status, 400, videoUrl);
      assert.match(res.body.error, /^URL_PRIVATE: /, videoUrl);
    }
    assert.equal(fetched, 0);
    assert.equal(fake.calls.insert.length, 0);
  });

  test("a name that resolves to a private address is refused", async () => {
    const { a } = app();
    let fetched = 0;
    _setLookupImpl(async () => ({ address: "192.168.1.20", family: 4 }));
    _setFetchImpl(async () => { fetched += 1; throw new Error("must not connect"); });
    const res = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl: "https://nas.example/v.mp4", title: "T" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^URL_PRIVATE: /);
    assert.equal(fetched, 0);
  });

  test("a relative videoUrl that is not a local output is refused, not fetched from this server", async () => {
    // toAbsolutePublicUrl turns it into this server's own (here loopback) URL.
    const { a } = app();
    let fetched = 0;
    _setFetchImpl(async () => { fetched += 1; throw new Error("must not connect"); });
    const res = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl: "/outputs/missing.mp4", title: "T" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^URL_PRIVATE: /);
    assert.equal(fetched, 0);
  });

  test("a remote video over the size limit is refused from its declared length", async () => {
    const { a, outputDir } = app();
    _setLookupImpl(async () => ({ address: "93.184.216.34", family: 4 }));
    let destroyed = false;
    _setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === "content-length" ? String(10 * 1024 * 1024 * 1024) : null) },
      body: Readable.from([Buffer.from("x")]).once("close", () => { destroyed = true; }),
    }));
    const res = await request(a).post("/api/social/post").send({ destination: "youtube", videoUrl: "https://cdn.example.com/huge.mp4", title: "T" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^URL_TOO_LARGE: /);
    assert.equal(destroyed, true);
    assert.deepEqual(fs.readdirSync(outputDir).filter((f) => f.startsWith("youtube-upload-")), []);
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
    _holdPreviewSlot("u1");
    try {
      const busy = await request(a).post("/api/social/youtube/thumbnail-preview").send(body);
      assert.equal(busy.status, 429);
      assert.equal(busy.body.busy, true);
    } finally {
      _releasePreviewSlot("u1");
    }
    const free = await request(a).post("/api/social/youtube/thumbnail-preview").send(body);
    assert.equal(free.status, 200, "the slot is released afterwards");
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

describe("YouTube playlists and the AI disclosure", () => {
  let fake;
  beforeEach(() => { fake = fakeGoogle(); _setGoogleImpl(fake.google); });
  afterEach(() => { _resetGoogleImpl(); });

  test("a publish carries the AI disclosure and lands in the chosen playlist", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "song.mp4"), "vid");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/song.mp4", title: "Oba Gba",
      syntheticMedia: true, playlistId: "PLa",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(fake.calls.insert[0].requestBody.status.containsSyntheticMedia, true);
    assert.equal(fake.calls.items[0].requestBody.snippet.playlistId, "PLa");
    assert.equal(res.body.playlistId, "PLa");
  });

  test("a bad playlist choice is refused before anything is uploaded", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "song.mp4"), "vid");
    const res = await request(a).post("/api/social/youtube/publish").send({
      videoUrl: "/outputs/song.mp4", title: "Oba Gba", playlistId: "PLa", newPlaylistTitle: "Also this",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not both/i);
    assert.equal(fake.calls.insert.length, 0);
  });

  test("GET /youtube/playlists lists the channel's playlists", async () => {
    const { a } = app();
    const res = await request(a).get("/api/social/youtube/playlists");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.playlists, [{ id: "PLa", title: "Oba Gba", itemCount: 2, privacyStatus: "public" }]);
  });

  test("GET /youtube/playlists says so when YouTube isn't connected", async () => {
    const { a, dataDir } = app();
    writeSocialStore(dataDir, { direct: { youtube: {} } });
    const res = await request(a).get("/api/social/youtube/playlists");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not connected/i);
  });

  test("status says whether this connection may add to playlists", async () => {
    const { a, dataDir } = app();
    const before = await request(a).get("/api/social/youtube/status");
    assert.equal(before.body.canUsePlaylists, false, "connections made before playlists lack the permission");
    writeSocialStore(dataDir, { direct: { youtube: { refreshToken: "ref", scopes: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl" } } });
    const after = await request(a).get("/api/social/youtube/status");
    assert.equal(after.body.canUsePlaylists, true);
  });
});
