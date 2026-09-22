import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { registerTrack } from "../lib/musicLibraryStore.js";
import { resolveAssetPath, _setJobCtxForTest, _resetJobCtxForTest } from "./jobs.js";

// A track saved to the library is only useful if every build can play it.
// jobs.js is the shared resolver for the render queue; render.js and
// audio_advanced.js carry their own copies of the same helper.
//
// Every production caller of resolveAssetPath (executeJob, renderVideoCore,
// renderAdvancedVideo, validatePayloadForEnqueue, ...) invokes it with ONE
// argument and relies on currentJobCtx for dataDir — currentJobCtx is set
// synchronously around validation and job execution (see jobs.js). These
// tests set currentJobCtx the same way production does instead of passing
// dataDir as a second argument, which no production caller ever does.

test("a mylib ref resolves to the saved file for the tenant that owns it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-"));
  const file = path.join(dir, "bed.mp3");
  fs.writeFileSync(file, "audio");
  const t = registerTrack(dir, { file, label: "Bed" });
  _setJobCtxForTest({ dataDir: dir });
  try {
    assert.equal(resolveAssetPath(`mylib:${t.id}`), file);
  } finally {
    _resetJobCtxForTest();
  }
});

test("a mylib ref from another tenant does not resolve", () => {
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-a-"));
  const theirs = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-b-"));
  const file = path.join(mine, "bed.mp3");
  fs.writeFileSync(file, "audio");
  const t = registerTrack(mine, { file, label: "Bed" });
  _setJobCtxForTest({ dataDir: theirs });
  try {
    const resolved = resolveAssetPath(`mylib:${t.id}`);
    // The real contract: a ref that doesn't resolve for THIS tenant must
    // never come back as another tenant's filesystem path. Asserting
    // notEqual(resolved, file) alone passes even when resolveAssetPath
    // returns the raw ref string unresolved — which is exactly what
    // happens here, so pin that down explicitly too.
    assert.notEqual(resolved, file, "must never return another tenant's file");
    assert.equal(
      resolved,
      `mylib:${t.id}`,
      "an unresolved ref falls through as the raw ref string, not a foreign tenant's path",
    );
    assert.equal(fs.existsSync(resolved), false, "the raw ref must not happen to exist as a real file either");
  } finally {
    _resetJobCtxForTest();
  }
});

test("bundled library refs still resolve exactly as they did", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-c-"));
  const resolved = resolveAssetPath("library:peaceful-worship", dir);
  assert.ok(resolved && resolved.endsWith("01-peaceful-worship.mp3"));
});
