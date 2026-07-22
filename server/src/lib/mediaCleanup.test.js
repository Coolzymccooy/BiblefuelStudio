import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";

import { cleanupMediaFiles } from "./mediaCleanup.js";

test("cleanupMediaFiles removes old media files but keeps recent files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-cleanup-"));
  const oldFile = path.join(root, "old.mp4");
  const recentFile = path.join(root, "recent.mp4");
  fs.writeFileSync(oldFile, Buffer.alloc(10));
  fs.writeFileSync(recentFile, Buffer.alloc(10));
  const now = Date.now();
  fs.utimesSync(oldFile, new Date(now - 10 * 86400_000), new Date(now - 10 * 86400_000));
  fs.utimesSync(recentFile, new Date(now), new Date(now));

  const result = cleanupMediaFiles(root, { maxAgeDays: 7, now });

  assert.equal(result.removed.length, 1);
  assert.equal(path.basename(result.removed[0].path), "old.mp4");
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(recentFile), true);
});

test("cleanupMediaFiles never follows traversal outside the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-cleanup-safe-"));
  const result = cleanupMediaFiles(path.join(root, "missing", "..", "missing"), { maxAgeDays: 1, now: Date.now() });
  assert.deepEqual(result.removed, []);
});
