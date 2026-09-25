import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  readMusicLibrary, registerTrack, updateTrack, removeTrack,
  resolveTenantTrack, musicIndexPath,
} from "./musicLibraryStore.js";

function tmpTenant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-music-"));
  const file = path.join(dir, "track.mp3");
  fs.writeFileSync(file, "not really audio, but a real file on disk");
  return { dir, file };
}

test("an empty tenant has an empty library rather than an error", () => {
  const { dir } = tmpTenant();
  assert.deepEqual(readMusicLibrary(dir), { items: [] });
});

test("a registered track comes back with an id and the metadata given", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Secret Place", mood: "calm", licence: "cleared", durationSec: 182.5 });
  assert.ok(t.id, "got an id");
  assert.equal(t.label, "Secret Place");
  assert.equal(t.mood, "calm");
  assert.equal(t.licence, "cleared");
  assert.equal(t.durationSec, 182.5);
  assert.equal(t.source, "upload");
  assert.equal(readMusicLibrary(dir).items.length, 1);
});

test("licence defaults to unknown, because assuming cleared is the dangerous default", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Untagged" });
  assert.equal(t.licence, "unknown");
});

test("registering the same file twice returns the same entry instead of duplicating it", () => {
  const { dir, file } = tmpTenant();
  const a = registerTrack(dir, { file, label: "One" });
  const b = registerTrack(dir, { file, label: "One again" });
  assert.equal(a.id, b.id);
  assert.equal(readMusicLibrary(dir).items.length, 1);
});

test("a mylib ref resolves to the file on disk, and to null once the file is gone", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Bed" });
  assert.equal(resolveTenantTrack(dir, `mylib:${t.id}`), file);
  fs.unlinkSync(file);
  assert.equal(resolveTenantTrack(dir, `mylib:${t.id}`), null);
});

test("resolveTenantTrack ignores refs that are not ours", () => {
  const { dir } = tmpTenant();
  assert.equal(resolveTenantTrack(dir, "library:peaceful-worship"), null);
  assert.equal(resolveTenantTrack(dir, "/some/upload.mp3"), null);
  assert.equal(resolveTenantTrack(dir, null), null);
});

test("one tenant cannot see, resolve or delete another tenant's track", () => {
  const a = tmpTenant();
  const b = tmpTenant();
  const t = registerTrack(a.dir, { file: a.file, label: "Mine" });
  assert.deepEqual(readMusicLibrary(b.dir), { items: [] });
  assert.equal(resolveTenantTrack(b.dir, `mylib:${t.id}`), null);
  assert.equal(removeTrack(b.dir, t.id), false);
  assert.equal(readMusicLibrary(a.dir).items.length, 1, "the owner still has it");
});

test("updateTrack changes only what it is given, and reports an unknown id", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Before", mood: "calm", licence: "unknown" });
  const after = updateTrack(dir, t.id, { licence: "cleared" });
  assert.equal(after.licence, "cleared");
  assert.equal(after.label, "Before", "label was left alone");
  assert.equal(after.mood, "calm", "mood was left alone");
  assert.equal(updateTrack(dir, "nope", { label: "x" }), null);
});

test("removeTrack drops the entry but never the operator's file", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Bed" });
  assert.equal(removeTrack(dir, t.id), true);
  assert.deepEqual(readMusicLibrary(dir), { items: [] });
  assert.equal(fs.existsSync(file), true, "the audio file is the operator's, not ours to delete");
  assert.equal(removeTrack(dir, t.id), false, "removing twice is not an error, just false");
});

test("a corrupt index reads as empty rather than throwing mid-request", () => {
  const { dir } = tmpTenant();
  fs.writeFileSync(musicIndexPath(dir), "{ this is not json");
  assert.deepEqual(readMusicLibrary(dir), { items: [] });
});
