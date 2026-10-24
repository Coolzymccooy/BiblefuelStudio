import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveMediaInput, _setScopeForTests } from "./mediaPath.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-path-"));
const mine = path.join(root, "mine");
const shared = path.join(root, "shared");
const elsewhere = path.join(root, "elsewhere");
const ctx = { user: { sub: "u1", email: "u1@example.com", role: "user" } };

before(() => {
  for (const dir of [mine, path.join(mine, "sub"), shared, elsewhere]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(mine, "voice.mp3"), "x");
  fs.writeFileSync(path.join(mine, "sub", "deep.mp3"), "x");
  fs.writeFileSync(path.join(shared, "tts-abc.mp3"), "x");
  fs.writeFileSync(path.join(shared, "other.mp3"), "x");
  fs.writeFileSync(path.join(elsewhere, "secret.mp3"), "x");
  _setScopeForTests(async () => ({ outputDir: mine, sharedDir: shared }));
});

after(() => {
  _setScopeForTests(null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a file in the user's media folder resolves to its real path", async () => {
  const out = await resolveMediaInput(ctx, path.join(mine, "voice.mp3"));
  assert.equal(out.path, fs.realpathSync(path.join(mine, "voice.mp3")));
});

test("a file in a sub-folder of the media folder is allowed", async () => {
  const out = await resolveMediaInput(ctx, path.join(mine, "sub", "deep.mp3"));
  assert.ok(out.path.endsWith("deep.mp3"));
});

test("/outputs/<name> maps onto the user's media folder", async () => {
  const out = await resolveMediaInput(ctx, "/outputs/voice.mp3");
  assert.equal(out.path, fs.realpathSync(path.join(mine, "voice.mp3")));
});

test("a file outside the media folder is refused with PATH_OUTSIDE_MEDIA", async () => {
  const out = await resolveMediaInput(ctx, path.join(elsewhere, "secret.mp3"));
  assert.equal(out.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("a .. escape is refused", async () => {
  const out = await resolveMediaInput(ctx, path.join(mine, "..", "elsewhere", "secret.mp3"));
  assert.equal(out.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("a missing file is FILE_NOT_FOUND", async () => {
  const out = await resolveMediaInput(ctx, path.join(mine, "nope.mp3"));
  assert.equal(out.refusal.structuredContent.error, "FILE_NOT_FOUND");
});

test("a voice file the TTS providers wrote to the shared folder is allowed; other shared files are not", async () => {
  const tts = await resolveMediaInput(ctx, path.join(shared, "tts-abc.mp3"));
  assert.ok(tts.path.endsWith("tts-abc.mp3"));
  const other = await resolveMediaInput(ctx, path.join(shared, "other.mp3"));
  assert.equal(other.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("URLs are refused with a pointer to media_import_url", async () => {
  const out = await resolveMediaInput(ctx, "https://example.com/a.mp3");
  assert.equal(out.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.match(out.refusal.structuredContent.message, /media_import_url/);
});

test("library and mylib references pass through only when refs are allowed", async () => {
  assert.deepEqual(await resolveMediaInput(ctx, "library:calm-1", { allowRefs: true }), { path: "library:calm-1" });
  assert.deepEqual(await resolveMediaInput(ctx, "mylib:abc_9", { allowRefs: true }), { path: "mylib:abc_9" });
  const refused = await resolveMediaInput(ctx, "library:calm-1");
  assert.equal(refused.refusal.isError, true);
  assert.equal(refused.path, undefined);
});

test("an empty value is BAD_INPUT", async () => {
  const out = await resolveMediaInput(ctx, "  ");
  assert.equal(out.refusal.structuredContent.error, "BAD_INPUT");
});

test("a symlink inside the folder pointing out is refused", async (t) => {
  const link = path.join(mine, "link.mp3");
  try {
    fs.symlinkSync(path.join(elsewhere, "secret.mp3"), link);
  } catch {
    t.skip("symlinks not permitted on this machine");
    return;
  }
  const out = await resolveMediaInput(ctx, link);
  assert.equal(out.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});
