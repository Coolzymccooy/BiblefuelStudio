/**
 * Security tests for the resumable-upload path jailing. These are the control
 * that stops a user finalizing (and downloading) another user's — or an
 * arbitrary — GCS object. Pure functions, no Firebase needed.
 * Run with: node --test server/src/lib/firebaseAdmin.upload.test.js
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildUserUploadPath, isOwnUploadPath } from "./firebaseAdmin.js";

describe("buildUserUploadPath", () => {
  test("namespaces under uploads/<userId>/ and keeps a sanitized filename", () => {
    const p = buildUserUploadPath("u_123", "My Sermon (final).mp3");
    assert.match(p, /^uploads\/u_123\/[0-9a-f-]{36}-My_Sermon__final_\.mp3$/);
  });

  test("strips path + traversal from the filename", () => {
    const p = buildUserUploadPath("u_123", "../../etc/passwd");
    assert.ok(p.startsWith("uploads/u_123/"));
    assert.ok(!p.includes(".."));
    assert.ok(!p.includes("/etc/"));
  });

  test("a slashed/dotted userId can never inject traversal, and round-trips through the guard", () => {
    const weird = "u/../x";
    const p = buildUserUploadPath(weird, "a.mp3");
    assert.ok(p.startsWith("uploads/"));
    assert.ok(!p.includes(".."));
    // The build + guard sanitize identically, so a user always owns what they built.
    assert.equal(isOwnUploadPath(p, weird), true);
  });

  test("throws without a user id", () => {
    assert.throws(() => buildUserUploadPath("", "a.mp3"));
  });
});

describe("isOwnUploadPath", () => {
  const uid = "u_123";

  test("accepts the user's own object", () => {
    const own = buildUserUploadPath(uid, "s.mp3");
    assert.equal(isOwnUploadPath(own, uid), true);
  });

  test("rejects another user's prefix", () => {
    assert.equal(isOwnUploadPath("uploads/u_999/abc-s.mp3", uid), false);
  });

  test("rejects traversal, null bytes, and non-uploads prefixes", () => {
    assert.equal(isOwnUploadPath("uploads/u_123/../u_999/x.mp3", uid), false);
    assert.equal(isOwnUploadPath("uploads/u_123/x\0.mp3", uid), false);
    assert.equal(isOwnUploadPath("outputs/u_123/x.mp3", uid), false);
    assert.equal(isOwnUploadPath("../uploads/u_123/x.mp3", uid), false);
  });

  test("rejects empty / missing inputs and absurd lengths", () => {
    assert.equal(isOwnUploadPath("", uid), false);
    assert.equal(isOwnUploadPath("uploads/u_123/x.mp3", ""), false);
    assert.equal(isOwnUploadPath(`uploads/u_123/${"a".repeat(600)}.mp3`, uid), false);
  });
});
