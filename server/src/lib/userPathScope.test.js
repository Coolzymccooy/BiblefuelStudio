/**
 * confineUserPath: the one rule for a file path a signed-in user sends. It
 * must name a file inside the caller's own media folder (or a shared file the
 * route opts into), checked lexically before any file system access and again
 * after realpath, with one answer for "outside" whether or not it exists.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// paths.js reads OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "user-path-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { confineUserPath, isSharedTtsFile, UserPathError, sendUserPathError } = await import("./userPathScope.js");

const mine = path.join(root, "data", "users", "me", "outputs");
const theirs = path.join(root, "data", "users", "them", "outputs");
const ctx = { userId: "me", dataDir: path.join(root, "data", "users", "me"), outputDir: mine };
const ownerCtx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true };
let ownFile;
let theirFile;
let sharedTts;
let ownerFile;

before(() => {
  fs.mkdirSync(path.join(mine, "sub"), { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  ownFile = path.join(mine, "sub", "voice.mp3");
  theirFile = path.join(theirs, "secret.mp3");
  sharedTts = path.join(process.env.OUTPUT_DIR, "tts-edge-1234.mp3");
  ownerFile = path.join(process.env.OUTPUT_DIR, "owner-only.mp3");
  for (const f of [ownFile, theirFile, sharedTts, ownerFile]) fs.writeFileSync(f, "x");
});

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

function refusedWith(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof UserPathError, String(err));
    assert.equal(err.code, code);
    return true;
  });
}

describe("confineUserPath", () => {
  test("accepts the caller's own file and answers its real path", () => {
    assert.equal(confineUserPath(ownFile, ctx), fs.realpathSync(ownFile));
  });

  test("maps the /outputs/ alias onto the caller's own folder", () => {
    assert.equal(confineUserPath("/outputs/sub/voice.mp3", ctx), fs.realpathSync(ownFile));
    assert.equal(confineUserPath("outputs/sub/voice.mp3", ctx), fs.realpathSync(ownFile));
    assert.equal(confineUserPath("./outputs\\sub\\voice.mp3", ctx), fs.realpathSync(ownFile));
  });

  test("refuses another tenant's file", () => {
    refusedWith(() => confineUserPath(theirFile, ctx), "PATH_OUTSIDE_MEDIA");
  });

  test("refuses ../ traversal, also through the alias", () => {
    refusedWith(() => confineUserPath(path.join(mine, "..", "..", "them", "outputs", "secret.mp3"), ctx), "PATH_OUTSIDE_MEDIA");
    refusedWith(() => confineUserPath("/outputs/../../them/outputs/secret.mp3", ctx), "PATH_OUTSIDE_MEDIA");
  });

  test("refuses an absolute system path, existing or not, with the same code", () => {
    const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    refusedWith(() => confineUserPath(system, ctx), "PATH_OUTSIDE_MEDIA");
    refusedWith(() => confineUserPath(path.join(root, "nothing-here.mp3"), ctx), "PATH_OUTSIDE_MEDIA");
  });

  test("refuses UNC and device paths without touching the file system", () => {
    for (const bad of ["\\\\evil-host\\share\\a.wav", "//evil-host/share/a.wav", "\\\\?\\C:\\Windows\\win.ini", "\\\\.\\pipe\\x", "/\\evil\\x"]) {
      refusedWith(() => confineUserPath(bad, ctx), "PATH_OUTSIDE_MEDIA");
    }
  });

  test("refuses URLs and every scheme-prefixed value", () => {
    for (const bad of ["http://127.0.0.1/a.mp3", "https://example.com/a.mp3", "http:/host/a", "file:///etc/passwd", "concat:a|b", "subfile,,start,0,end,0,,:/etc/passwd"]) {
      refusedWith(() => confineUserPath(bad, ctx), "PATH_OUTSIDE_MEDIA");
    }
  });

  test("refuses a NUL byte", () => {
    refusedWith(() => confineUserPath(`${ownFile}\0.png`, ctx), "PATH_OUTSIDE_MEDIA");
  });

  test("refuses a junction or symlink inside the folder that leads out", (t) => {
    const link = path.join(mine, "escape");
    try {
      fs.symlinkSync(theirs, link, "junction");
    } catch (err) {
      t.skip(`cannot create a junction here: ${err.code}`);
      return;
    }
    // rmdir removes the junction itself; a recursive rm would follow it.
    t.after(() => fs.unlinkSync(link));
    refusedWith(() => confineUserPath(path.join(link, "secret.mp3"), ctx), "PATH_OUTSIDE_MEDIA");
    refusedWith(() => confineUserPath("/outputs/escape/secret.mp3", ctx), "PATH_OUTSIDE_MEDIA");
  });

  test("a missing file inside the folder is not found, not outside", () => {
    refusedWith(() => confineUserPath(path.join(mine, "missing.mp3"), ctx), "FILE_NOT_FOUND");
  });

  test("an empty value is a bad request", () => {
    refusedWith(() => confineUserPath("  ", ctx), "PATH_REQUIRED");
    refusedWith(() => confineUserPath(undefined, ctx), "PATH_REQUIRED");
  });

  test("no scope on the request is refused, not resolved against the cwd", () => {
    refusedWith(() => confineUserPath(ownFile, {}), "SCOPE_UNAVAILABLE");
  });

  test("the folder itself is not a file in it", () => {
    refusedWith(() => confineUserPath(mine, ctx), "PATH_OUTSIDE_MEDIA");
  });

  test("shared TTS files are refused unless the route opts in", () => {
    refusedWith(() => confineUserPath(sharedTts, ctx), "PATH_OUTSIDE_MEDIA");
    assert.equal(confineUserPath(sharedTts, ctx, { allowShared: isSharedTtsFile }), fs.realpathSync(sharedTts));
    assert.equal(confineUserPath("/outputs/tts-edge-1234.mp3", ctx, { allowShared: isSharedTtsFile }), fs.realpathSync(sharedTts));
  });

  test("opting in to shared TTS files does not open the rest of the global folder", () => {
    refusedWith(() => confineUserPath(ownerFile, ctx, { allowShared: isSharedTtsFile }), "PATH_OUTSIDE_MEDIA");
    // The alias only looks in the caller's own folder for a non-voice name.
    refusedWith(() => confineUserPath("/outputs/owner-only.mp3", ctx, { allowShared: isSharedTtsFile }), "FILE_NOT_FOUND");
  });

  test("the owner still reads the global output folder", () => {
    assert.equal(confineUserPath(ownerFile, ownerCtx), fs.realpathSync(ownerFile));
    assert.equal(confineUserPath("/outputs/owner-only.mp3", ownerCtx), fs.realpathSync(ownerFile));
    refusedWith(() => confineUserPath(theirFile, ownerCtx), "PATH_OUTSIDE_MEDIA");
  });
});

describe("isSharedTtsFile", () => {
  test("only flat tts-* files in the global output folder", () => {
    assert.equal(isSharedTtsFile(sharedTts), true);
    assert.equal(isSharedTtsFile(ownerFile), false);
    assert.equal(isSharedTtsFile(path.join(process.env.OUTPUT_DIR, "sub", "tts-x.mp3")), false);
    assert.equal(isSharedTtsFile(path.join(mine, "tts-x.mp3")), false);
  });
});

describe("sendUserPathError", () => {
  function fakeRes() {
    return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  }

  test("answers 403 with the code and a message for an outside path", () => {
    const res = fakeRes();
    let err;
    try { confineUserPath(theirFile, ctx); } catch (e) { err = e; }
    assert.equal(sendUserPathError(res, err), true);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA");
    assert.equal(typeof res.body.message, "string");
    assert.ok(!res.body.message.includes(theirs), "the message must not echo the resolved path");
  });

  test("leaves any other error to the caller", () => {
    assert.equal(sendUserPathError(fakeRes(), new Error("boom")), false);
  });
});
