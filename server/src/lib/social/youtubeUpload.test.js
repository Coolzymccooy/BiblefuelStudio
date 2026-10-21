import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { uploadToYoutube, listYoutubePlaylists, _setGoogleImpl, _resetGoogleImpl } from "./youtubeUpload.js";

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
  test("a channel that can't set thumbnails is told how to fix it, not shown Google's wording", async () => {
    const { google } = fakeGoogle({ thumbError: "The authenticated user doesn't have permissions to upload and set custom video thumbnails." });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: tmpFile("t.jpg") });
    assert.equal(out.videoId, "abc123");
    assert.match(out.thumbnailError, /youtube\.com\/verify/);
    assert.doesNotMatch(out.thumbnailError, /authenticated user/);
  });
  test("a missing thumbnail file is reported, not thrown", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: "/nope/missing.png" });
    assert.equal(calls.set.length, 0);
    assert.match(out.thumbnailError, /not found/i);
  });
  test("sends the AI disclosure when it was answered, and leaves it out when not", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, containsSyntheticMedia: true } });
    assert.equal(calls.insert[0].requestBody.status.containsSyntheticMedia, true);
    await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, containsSyntheticMedia: false } });
    assert.equal(calls.insert[1].requestBody.status.containsSyntheticMedia, false);
    await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata });
    assert.equal("containsSyntheticMedia" in calls.insert[2].requestBody.status, false);
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

function playlistGoogle({ pages = [[]], itemError = null, createdId = "PLnew" } = {}) {
  const calls = { insert: [], items: [], lists: [], created: [] };
  class OAuth2 { setCredentials() {} }
  const google = {
    auth: { OAuth2 },
    youtube: () => ({
      videos: { insert: async (args) => { calls.insert.push(args); return { data: { id: "abc123" } }; } },
      thumbnails: { set: async () => ({ data: {} }) },
      playlists: {
        list: async (args) => {
          calls.lists.push(args);
          const i = args.pageToken ? Number(args.pageToken) : 0;
          return { data: { items: pages[i] || [], nextPageToken: i + 1 < pages.length ? String(i + 1) : undefined } };
        },
        insert: async (args) => { calls.created.push(args); return { data: { id: createdId } }; },
      },
      playlistItems: {
        insert: async (args) => { calls.items.push(args); if (itemError) throw new Error(itemError); return { data: {} }; },
      },
    }),
  };
  return { google, calls };
}

const pl = (id, title, itemCount = 0) => ({ id, snippet: { title }, contentDetails: { itemCount }, status: { privacyStatus: "public" } });

describe("uploadToYoutube with a playlist", () => {
  test("adds the new video to the chosen playlist", async () => {
    const { google, calls } = playlistGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, playlist: { id: "PLone" } } });
    assert.equal(out.playlistId, "PLone");
    assert.deepEqual(calls.items[0].requestBody.snippet, { playlistId: "PLone", resourceId: { kind: "youtube#video", videoId: "abc123" } });
    assert.equal(calls.created.length, 0);
  });
  test("a named playlist that already exists is reused, matched without regard to case", async () => {
    const { google, calls } = playlistGoogle({ pages: [[pl("PLa", "Other")], [pl("PLb", "I Still Dey")]] });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, playlist: { title: "i still dey" } } });
    assert.equal(out.playlistId, "PLb");
    assert.equal(calls.created.length, 0);
    assert.equal(calls.items[0].requestBody.snippet.playlistId, "PLb");
  });
  test("a named playlist that doesn't exist is created as public, then used", async () => {
    const { google, calls } = playlistGoogle({ pages: [[pl("PLa", "Other")]] });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, playlist: { title: "Oba Gba" } } });
    assert.equal(out.playlistId, "PLnew");
    assert.deepEqual(calls.created[0].requestBody, { snippet: { title: "Oba Gba" }, status: { privacyStatus: "public" } });
    assert.equal(calls.items[0].requestBody.snippet.playlistId, "PLnew");
  });
  test("a channel with too many playlists to search gets no duplicate made", async () => {
    const pages = Array.from({ length: 11 }, (_, i) => [pl(`PL${i}`, `List ${i}`)]);
    const { google, calls } = playlistGoogle({ pages });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, playlist: { title: "List 10" } } });
    assert.equal(out.videoId, "abc123");
    assert.equal(calls.created.length, 0);
    assert.match(out.playlistError, /too many playlists/i);
  });
  test("a playlist failure doesn't fail the upload", async () => {
    const { google } = playlistGoogle({ itemError: "Playlist not found" });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, playlist: { id: "PLgone" } } });
    assert.equal(out.videoId, "abc123");
    assert.match(out.playlistError, /Playlist not found/);
    assert.equal(out.playlistId, undefined);
  });
  test("a connection made before playlists existed is told to reconnect, not shown Google's wording", async () => {
    const { google } = playlistGoogle({ itemError: "Request had insufficient authentication scopes." });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, playlist: { id: "PLone" } } });
    assert.match(out.playlistError, /reconnect YouTube/i);
    assert.doesNotMatch(out.playlistError, /insufficient/);
  });
});

describe("listYoutubePlaylists", () => {
  test("lists the channel's own playlists across pages", async () => {
    const { google, calls } = playlistGoogle({ pages: [[pl("PLa", "A", 3)], [pl("PLb", "B", 0)]] });
    _setGoogleImpl(google);
    const out = await listYoutubePlaylists({ credentials: creds });
    assert.deepEqual(out, [
      { id: "PLa", title: "A", itemCount: 3, privacyStatus: "public" },
      { id: "PLb", title: "B", itemCount: 0, privacyStatus: "public" },
    ]);
    assert.equal(calls.lists[0].mine, true);
  });
});
