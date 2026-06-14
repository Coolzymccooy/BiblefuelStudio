import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { MUSIC_LIBRARY, listTracks, resolveLibraryTrack, defaultTrackRef } from "./musicLibrary.js";

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
