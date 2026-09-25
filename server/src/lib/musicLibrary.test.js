import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { MUSIC_LIBRARY, listTracks, resolveLibraryTrack, defaultTrackRef, bundledDurations, _resetBundledDurations } from "./musicLibrary.js";

describe("musicLibrary", () => {
  test("has 23 tracks with exactly one default, all with unique ids", () => {
    assert.equal(MUSIC_LIBRARY.length, 23);
    assert.equal(MUSIC_LIBRARY.filter((t) => t.default).length, 1);
    for (const t of MUSIC_LIBRARY) { assert.ok(t.id && t.label && t.file); }
    assert.equal(new Set(MUSIC_LIBRARY.map((t) => t.id)).size, 23);
    assert.equal(new Set(MUSIC_LIBRARY.map((t) => t.file)).size, 23);
  });
  test("the auto-applied default is instrumental (not a vocal song)", () => {
    // Series / Auto-Publish auto-select the default as a bed UNDER narration,
    // so it must not be one of the labelled "(vocal)" gospel songs.
    const def = MUSIC_LIBRARY.find((t) => t.default);
    assert.doesNotMatch(def.label, /vocal/i);
  });
  test("listTracks exposes id/label/mood/previewUrl/default", () => {
    const list = listTracks();
    assert.equal(list.length, 23);
    assert.match(list[0].previewUrl, /^\/music\//);
    assert.equal(list.filter((t) => t.default).length, 1);
  });
  test("resolveLibraryTrack maps a library: ref to an existing absolute file", () => {
    const id = MUSIC_LIBRARY[0].id;
    const p = resolveLibraryTrack(`library:${id}`);
    assert.ok(p && fs.existsSync(p));
  });
  test("resolveLibraryTrack returns null for unknown id and non-library input", () => {
    assert.equal(resolveLibraryTrack("library:nope"), null);
    assert.equal(resolveLibraryTrack("/some/upload.mp3"), null);
    assert.equal(resolveLibraryTrack(null), null);
  });
  test("defaultTrackRef points at the default track", () => {
    const def = MUSIC_LIBRARY.find((t) => t.default);
    assert.equal(defaultTrackRef(), `library:${def.id}`);
  });
});

describe("bundledDurations", () => {
  afterEach(() => _resetBundledDurations());

  test("probes each bundled file once and caches the lengths", async () => {
    let calls = 0;
    const probe = async (file) => { calls += 1; return file.endsWith("01-peaceful-worship.mp3") ? 204.5 : 100; };
    const first = await bundledDurations(probe);
    assert.equal(first["peaceful-worship"], 204.5);
    assert.equal(first["prayer-piano"], 100);
    const again = await bundledDurations(probe);
    assert.equal(again, first);
    assert.equal(calls, MUSIC_LIBRARY.length, "second call answered from the cache");
  });

  test("a file that cannot be probed has no length, and the rest still do", async () => {
    const probe = async (file) => { if (file.includes("prayer-piano")) throw new Error("bad file"); return 60; };
    const d = await bundledDurations(probe);
    assert.equal(d["prayer-piano"], null);
    assert.equal(d["gentle-peace"], 60);
  });

  test("a probe that learned nothing (ffprobe missing or timed out) is not cached; the next call tries again", async () => {
    const first = await bundledDurations(async () => null);
    assert.equal(first["peaceful-worship"], null);
    const second = await bundledDurations(async () => 42);
    assert.equal(second["peaceful-worship"], 42);
  });

  test("probes a few files at a time, not all at once", async () => {
    let running = 0;
    let peak = 0;
    await bundledDurations(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running -= 1;
      return 10;
    });
    assert.ok(peak <= 4, `peak concurrency ${peak}`);
  });
});
