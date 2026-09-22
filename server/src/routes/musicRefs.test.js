import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { registerTrack } from "../lib/musicLibraryStore.js";
import { resolveAssetPath } from "./jobs.js";

// A track saved to the library is only useful if every build can play it.
// jobs.js is the shared resolver for the render queue; render.js and
// audio_advanced.js carry their own copies of the same helper.

test("a mylib ref resolves to the saved file for the tenant that owns it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-"));
  const file = path.join(dir, "bed.mp3");
  fs.writeFileSync(file, "audio");
  const t = registerTrack(dir, { file, label: "Bed" });
  assert.equal(resolveAssetPath(`mylib:${t.id}`, dir), file);
});

test("a mylib ref from another tenant does not resolve", () => {
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-a-"));
  const theirs = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-b-"));
  const file = path.join(mine, "bed.mp3");
  fs.writeFileSync(file, "audio");
  const t = registerTrack(mine, { file, label: "Bed" });
  assert.notEqual(resolveAssetPath(`mylib:${t.id}`, theirs), file);
});

test("bundled library refs still resolve exactly as they did", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-c-"));
  const resolved = resolveAssetPath("library:peaceful-worship", dir);
  assert.ok(resolved && resolved.endsWith("01-peaceful-worship.mp3"));
});
