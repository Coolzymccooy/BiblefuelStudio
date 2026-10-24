import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveMediaInput, resolveMediaOutput, _setScopeForTests } from "./mediaPath.js";

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

test("a link inside the folder pointing out is refused (file symlink, else a directory junction)", async (t) => {
  let link = path.join(mine, "link.mp3");
  try {
    fs.symlinkSync(path.join(elsewhere, "secret.mp3"), link);
  } catch {
    // Windows without symlink rights: a directory junction needs none.
    const dirLink = path.join(mine, "linkdir");
    try {
      fs.symlinkSync(elsewhere, dirLink, "junction");
    } catch {
      t.skip("neither symlinks nor junctions can be made on this machine");
      return;
    }
    link = path.join(dirLink, "secret.mp3");
  }
  const out = await resolveMediaInput(ctx, link);
  assert.equal(out.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("outside the media folder, an existing file and a missing file get the same answer", async () => {
  const existing = await resolveMediaInput(ctx, path.join(elsewhere, "secret.mp3"));
  const missing = await resolveMediaInput(ctx, path.join(elsewhere, "no-such-file.mp3"));
  assert.equal(existing.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  assert.deepEqual(missing.refusal.structuredContent, existing.refusal.structuredContent);
  const gone = await resolveMediaInput(ctx, path.join(root, "no-such-dir", "x.mp3"));
  assert.deepEqual(gone.refusal.structuredContent, existing.refusal.structuredContent);
});

test("UNC, device and double-slash paths are refused before any file is touched", async () => {
  const same = (await resolveMediaInput(ctx, path.join(elsewhere, "secret.mp3"))).refusal.structuredContent;
  for (const bad of ["\\\\server\\share\\a.mp3", "\\\\.\\C:\\a.mp3", "\\\\?\\C:\\a.mp3", "//server/share/a.mp3", "/\\server\\share\\a.mp3"]) {
    const out = await resolveMediaInput(ctx, bad);
    assert.deepEqual(out.refusal.structuredContent, same, bad);
  }
});

test("a path that only looks like it is inside the folder (sibling prefix) is refused", async () => {
  const sibling = `${mine}-evil`;
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, "a.mp3"), "x");
  const out = await resolveMediaInput(ctx, path.join(sibling, "a.mp3"));
  assert.equal(out.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("the shared folder is recognised however its case is spelled on Windows", { skip: process.platform !== "win32" && "Windows paths only" }, async () => {
  _setScopeForTests(async () => ({ outputDir: mine, sharedDir: shared.toUpperCase() }));
  const out = await resolveMediaInput(ctx, path.join(shared, "tts-abc.mp3"));
  _setScopeForTests(async () => ({ outputDir: mine, sharedDir: shared }));
  assert.ok(out.path.endsWith("tts-abc.mp3"));
});

test("an /outputs/tts-*.mp3 url form also finds the voice file in the shared folder", async () => {
  const out = await resolveMediaInput(ctx, "/outputs/tts-abc.mp3");
  assert.equal(out.path, fs.realpathSync(path.join(shared, "tts-abc.mp3")));
  const notVoice = await resolveMediaInput(ctx, "/outputs/other.mp3");
  assert.equal(notVoice.refusal.structuredContent.error, "FILE_NOT_FOUND");
});

test("a media-folder file wins over a shared file of the same /outputs/ name", async () => {
  fs.writeFileSync(path.join(mine, "tts-own.mp3"), "x");
  fs.writeFileSync(path.join(shared, "tts-own.mp3"), "x");
  const out = await resolveMediaInput(ctx, "/outputs/tts-own.mp3");
  assert.equal(out.path, fs.realpathSync(path.join(mine, "tts-own.mp3")));
});

// ---- resolveMediaOutput: the same check, answered as the file's /outputs/ link ----

test("resolveMediaOutput gives a media-folder file as its /outputs/ path, sub-folders kept", async () => {
  const flat = await resolveMediaOutput(ctx, path.join(mine, "voice.mp3"));
  assert.equal(flat.outputsPath, "/outputs/voice.mp3");
  assert.equal(flat.path, fs.realpathSync(path.join(mine, "voice.mp3")));
  const deep = await resolveMediaOutput(ctx, "/outputs/sub/deep.mp3");
  assert.equal(deep.outputsPath, "/outputs/sub/deep.mp3");
});

test("resolveMediaOutput gives a shared voice file its flat /outputs/ name", async () => {
  const out = await resolveMediaOutput(ctx, path.join(shared, "tts-abc.mp3"));
  assert.equal(out.outputsPath, "/outputs/tts-abc.mp3");
});

test("resolveMediaOutput refuses what resolveMediaInput refuses, and library refs", async () => {
  const outside = await resolveMediaOutput(ctx, path.join(elsewhere, "secret.mp3"));
  assert.equal(outside.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const url = await resolveMediaOutput(ctx, "https://example.com/a.mp4");
  assert.equal(url.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const ref = await resolveMediaOutput(ctx, "library:peaceful");
  assert.equal(ref.refusal.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});
