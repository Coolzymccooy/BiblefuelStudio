/**
 * The path rule for render inputs (#112): a non-owner's local inputs must be
 * their own files, a shared tts-* voice file, or a generated image made for
 * them (or for a series); library refs, saved library ids and URLs keep
 * their own handling. The owner (and a job with no ctx, which only the owner
 * ever enqueued) keeps today's behaviour.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-input-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const {
  scopeMediaInput, assertPayloadPathsInScope, resolveOutputAliasForCtx, isSharedGeneratedImage,
} = await import("./mediaInputScope.js");
const { UserPathError } = await import("./userPathScope.js");

const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const OUT = process.env.OUTPUT_DIR;
const ctx = { userId: "me", dataDir: userDir, outputDir: mine, isOwner: false };
const ownerCtx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: OUT, isOwner: true };
const f = {};
let junction = null;

before(() => {
  for (const d of [mine, theirs, path.join(OUT, "genImg", "genvis-me-1234abcd"), path.join(OUT, "genImg", "genvis-them-1234abcd"),
    path.join(OUT, "genImg", "auto-me"), path.join(OUT, "genImg", "series_abc_def123")]) fs.mkdirSync(d, { recursive: true });
  f.own = path.join(mine, "bg.mp4");
  f.theirs = path.join(theirs, "private.mp4");
  f.global = path.join(OUT, "owner.mp4");
  f.tts = path.join(OUT, "tts-edge-abc.mp3");
  f.genvis = path.join(OUT, "genImg", "genvis-me-1234abcd", "part-1.png");
  f.genvisTheirs = path.join(OUT, "genImg", "genvis-them-1234abcd", "part-1.png");
  f.auto = path.join(OUT, "genImg", "auto-me", "part-1.png");
  f.series = path.join(OUT, "genImg", "series_abc_def123", "part-2.png");
  for (const file of Object.values(f)) fs.writeFileSync(file, "x");
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "601", url: "https://videos.example.com/s.mp4", files: [{ link: "https://videos.example.com/s-hd.mp4", quality: "hd" }] },
    { id: "602", url: f.theirs, previewUrl: f.theirs },
    { id: "603", url: "/outputs/bg.mp4", previewUrl: "/outputs/bg.mp4" },
  ] }));
});

after(() => {
  if (junction) fs.unlinkSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function refused(fn, code = "PATH_OUTSIDE_MEDIA") {
  assert.throws(fn, (err) => err instanceof UserPathError && err.code === code);
}

const outsideValues = () => {
  const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
  const list = [f.theirs, f.global, f.genvisTheirs, "/outputs/../../them/outputs/private.mp4",
    path.join(mine, "..", "..", "them", "outputs", "private.mp4"), "data/users/them/outputs/private.mp4",
    system, "\\\\evil-host\\share\\a.mp4", "//evil-host/share/a.mp4", "602"];
  if (junction) list.push(path.join(junction, "private.mp4"));
  return list;
};

describe("scopeMediaInput", () => {
  test("refuses a non-owner's outside values", () => {
    for (const v of outsideValues()) refused(() => scopeMediaInput(v, ctx));
  });

  test("an unknown library id or a bare server file name is not found", () => {
    refused(() => scopeMediaInput("999999", ctx), "FILE_NOT_FOUND");
    refused(() => scopeMediaInput("package.json", ctx), "FILE_NOT_FOUND");
  });

  test("keeps own files, aliases, library refs, saved ids, URLs, shared voice files and own generated images", () => {
    assert.equal(scopeMediaInput(f.own, ctx), fs.realpathSync(f.own));
    assert.equal(scopeMediaInput("/outputs/bg.mp4", ctx), fs.realpathSync(f.own));
    for (const v of ["library:peaceful-worship", "mylib:abc", "601", "603", "https://videos.example.com/x.mp4", "tcp://127.0.0.1:9"]) {
      assert.equal(scopeMediaInput(v, ctx), v, v);
    }
    for (const v of [f.tts, f.genvis, f.auto, f.series, "/outputs/genImg/series_abc_def123/part-2.png", "/outputs/tts-edge-abc.mp3"]) {
      assert.ok(scopeMediaInput(v, ctx), v);
    }
  });

  test("the owner and a ctx-less job keep today's behaviour", () => {
    for (const v of [f.theirs, f.global, "package.json"]) {
      assert.equal(scopeMediaInput(v, ownerCtx), v);
      assert.equal(scopeMediaInput(v, null), v);
    }
  });
});

describe("assertPayloadPathsInScope", () => {
  test("checks every path field, scenes included", () => {
    for (const field of ["audioPath", "musicPath", "backgroundPath", "videoPath", "generatedImage"]) {
      refused(() => assertPayloadPathsInScope({ [field]: f.theirs }, ctx));
    }
    refused(() => assertPayloadPathsInScope({ scenes: [{ backgroundPath: f.own }, { backgroundPath: f.global }] }, ctx));
  });

  test("ignoreMissing skips a missing input but still checks the rest", () => {
    refused(() => assertPayloadPathsInScope({ scenes: [{ backgroundPath: "999999" }] }, ctx), "FILE_NOT_FOUND");
    assertPayloadPathsInScope({ scenes: [{ backgroundPath: "999999" }] }, ctx, { ignoreMissing: true });
    refused(() => assertPayloadPathsInScope({ scenes: [{ backgroundPath: path.join(mine, "nope.mp4") }, { backgroundPath: f.theirs }] }, ctx, { ignoreMissing: true }));
  });

  test("passes a payload of own and shared media, and anything for the owner", () => {
    assertPayloadPathsInScope({
      audioPath: f.tts, musicPath: "library:peaceful-worship", backgroundPath: "601",
      scenes: [{ backgroundPath: f.own }, { backgroundPath: "https://videos.example.com/x.mp4" }], generatedImage: f.series,
    }, ctx);
    assertPayloadPathsInScope({ audioPath: f.theirs, scenes: [{ backgroundPath: f.global }] }, ownerCtx);
    assertPayloadPathsInScope({}, ctx);
    assertPayloadPathsInScope(null, ctx);
  });
});

describe("resolveOutputAliasForCtx", () => {
  test("a non-owner's /outputs/ alias follows their own folder, or a shared file in the global one", () => {
    assert.equal(resolveOutputAliasForCtx("/outputs/bg.mp4", ctx), fs.realpathSync(f.own));
    assert.equal(resolveOutputAliasForCtx("/outputs/tts-edge-abc.mp3", ctx), fs.realpathSync(f.tts));
    assert.equal(path.resolve(resolveOutputAliasForCtx("/outputs/owner.mp4", ctx)), path.resolve(mine, "owner.mp4"));
    assert.equal(resolveOutputAliasForCtx("/outputs/../../them/outputs/private.mp4", ctx), "");
  });

  test("the owner and no ctx map the alias to the global folder", () => {
    assert.equal(path.resolve(resolveOutputAliasForCtx("/outputs/owner.mp4", ownerCtx)), path.resolve(f.global));
    assert.equal(path.resolve(resolveOutputAliasForCtx("/outputs/owner.mp4", null)), path.resolve(f.global));
  });

  test("leaves anything that is not an alias alone", () => {
    assert.equal(resolveOutputAliasForCtx(f.own, ctx), f.own);
    assert.equal(resolveOutputAliasForCtx("https://x.example/a.mp4", ctx), "https://x.example/a.mp4");
  });
});

describe("isSharedGeneratedImage", () => {
  test("own genvis/auto images and series images only, flat image files", () => {
    assert.equal(isSharedGeneratedImage(f.genvis, "me"), true);
    assert.equal(isSharedGeneratedImage(f.auto, "me"), true);
    assert.equal(isSharedGeneratedImage(f.series, "me"), true);
    assert.equal(isSharedGeneratedImage(f.genvisTheirs, "me"), false);
    assert.equal(isSharedGeneratedImage(path.join(OUT, "genImg", "auto-them", "part-1.png"), "me"), false);
    assert.equal(isSharedGeneratedImage(path.join(OUT, "genImg", "series_abc_def123", "secret.mp4"), "me"), false);
    assert.equal(isSharedGeneratedImage(path.join(mine, "genImg", "auto-me", "part-1.png"), "me"), false);
  });
});
