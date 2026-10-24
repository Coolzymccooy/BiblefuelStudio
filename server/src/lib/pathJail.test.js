import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isInsideDir } from "./pathJail.js";

test("isInsideDir accepts children and refuses the folder itself, parents and siblings", () => {
  const root = path.resolve("/srv/media/u1");
  assert.equal(isInsideDir(path.join(root, "a.mp3"), root), true);
  assert.equal(isInsideDir(path.join(root, "sub", "a.mp3"), root), true);
  assert.equal(isInsideDir(root, root), false);
  assert.equal(isInsideDir(path.join(root, "..", "u2", "a.mp3"), root), false);
  assert.equal(isInsideDir(path.resolve("/srv/media/u10/a.mp3"), root), false);
  assert.equal(isInsideDir(path.resolve("/etc/passwd"), root), false);
});
