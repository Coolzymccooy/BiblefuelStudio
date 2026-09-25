import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { uploadToYoutube, _setGoogleImpl, _resetGoogleImpl } from "./youtubeUpload.js";

afterEach(() => _resetGoogleImpl());

function tmpFile(name, bytes = "vid") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-up-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

function fakeGoogle({ insertResult = { data: { id: "abc123" } }, thumbError = null } = {}) {
  const calls = { insert: [], set: [], creds: [] };
  class OAuth2 { setCredentials(c) { calls.creds.push(c); } }
  const google = {
    auth: { OAuth2 },
    youtube: () => ({
      videos: { insert: async (args) => { calls.insert.push(args); return insertResult; } },
      thumbnails: { set: async (args) => { calls.set.push(args); if (thumbError) throw new Error(thumbError); return { data: {} }; } },
    }),
  };
  return { google, calls };
}

const creds = { clientId: "id", clientSecret: "sec", refreshToken: "ref" };
const metadata = { title: "T", description: "D", tags: ["a"], categoryId: "22", privacyStatus: "private", publishAt: "2026-09-22T10:00:00.000Z", forcedPrivate: false };

describe("uploadToYoutube", () => {
  test("inserts with snippet+status and returns the watch URL", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata });
    assert.equal(out.videoId, "abc123");
    assert.equal(out.videoUrl, "https://www.youtube.com/watch?v=abc123");
    assert.deepEqual(calls.creds[0], { refresh_token: "ref" });
    const body = calls.insert[0].requestBody;
    assert.deepEqual(body.snippet, { title: "T", description: "D", tags: ["a"], categoryId: "22" });
    assert.deepEqual(body.status, { privacyStatus: "private", publishAt: "2026-09-22T10:00:00.000Z", selfDeclaredMadeForKids: false });
    assert.deepEqual(calls.insert[0].part, ["snippet", "status"]);
    assert.equal(calls.set.length, 0);
  });
  test("omits publishAt from status when not scheduled", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, publishAt: undefined } });
    assert.equal("publishAt" in calls.insert[0].requestBody.status, false);
  });
  test("sets the thumbnail after insert when given", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: tmpFile("t.png") });
    assert.equal(calls.set[0].videoId, "abc123");
    assert.equal(calls.set[0].media.mimeType, "image/png");
    assert.equal(out.thumbnailError, undefined);
  });
  test("a thumbnail failure does not fail the upload", async () => {
    const { google } = fakeGoogle({ thumbError: "channel not verified" });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: tmpFile("t.jpg") });
    assert.equal(out.videoId, "abc123");
    assert.match(out.thumbnailError, /channel not verified/);
  });
  test("a missing thumbnail file is reported, not thrown", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: "/nope/missing.png" });
    assert.equal(calls.set.length, 0);
    assert.match(out.thumbnailError, /not found/i);
  });
  test("throws a named error when insert returns no id", async () => {
    const { google } = fakeGoogle({ insertResult: { data: {} } });
    _setGoogleImpl(google);
    await assert.rejects(
      () => uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata }),
      /YouTube did not return a video id/,
    );
  });
});
