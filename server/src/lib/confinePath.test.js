import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { confineToDir } from "./confinePath.js";

const root = path.resolve(process.platform === "win32" ? "C:\srv\out" : "/srv/out");

describe("confineToDir", () => {
  test("accepts a child path and returns it resolved", () => {
    assert.equal(confineToDir(root, path.join(root, "a", "b.mp4")), path.join(root, "a", "b.mp4"));
  });
  test("accepts the root itself", () => {
    assert.equal(confineToDir(root, root), root);
    assert.equal(confineToDir(root, root + path.sep), root);
  });
  test("rejects `..` traversal that escapes the root", () => {
    assert.equal(confineToDir(root, path.join(root, "..", "etc", "passwd")), null);
    assert.equal(confineToDir(root, path.join(root, "a", "..", "..", "x")), null);
  });
  test("allows `..` that stays inside the root", () => {
    assert.equal(confineToDir(root, path.join(root, "a", "..", "b")), path.join(root, "b"));
  });
  test("rejects an absolute path outside the root", () => {
    const outside = path.resolve(process.platform === "win32" ? "C:\etc\passwd" : "/etc/passwd");
    assert.equal(confineToDir(root, outside), null);
  });
  test("rejects a sibling whose name merely starts with the root's name", () => {
    assert.equal(confineToDir(root, root + "-evil" + path.sep + "x"), null);
  });
  test("handles Windows-style separators in the candidate", () => {
    const candidate = path.join(root, "a", "b").replace(/\//g, "\\");
    if (process.platform === "win32") {
      assert.equal(confineToDir(root, candidate), path.join(root, "a", "b"));
      assert.equal(confineToDir(root, root + "\..\..\Windows\win.ini"), null);
    } else {
      // POSIX treats backslashes as ordinary filename characters: still confined.
      assert.equal(confineToDir(root, root + "/a\..\b"), root + "/a\..\b");
    }
  });
  test("rejects empty, null, or non-string input, and a missing root", () => {
    assert.equal(confineToDir(root, ""), null);
    assert.equal(confineToDir(root, null), null);
    assert.equal(confineToDir(root, undefined), null);
    assert.equal(confineToDir("", "x"), null);
    assert.equal(confineToDir(undefined, root), null);
  });
});
