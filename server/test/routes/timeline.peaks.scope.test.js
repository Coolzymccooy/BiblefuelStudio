/**
 * GET /api/timeline/peaks reads the file named in the query string (#112).
 * A non-owner may read only their own output folder (plus shared tts-* voice
 * files and bundled library audio); another tenant's file and the owner's
 * files in the global OUTPUT_DIR are refused with 403 PATH_OUTSIDE_MEDIA.
 * The owner keeps the global folder.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "peaks-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: timelineRouter } = await import("../../src/routes/timeline.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", dataDir: userDir, outputDir: mine, isOwner: false };
const ownerCtx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true };
const f = {};
let junction = null;

function tone(file) {
  if (noFfmpeg) { fs.writeFileSync(file, "x"); return file; }
  const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=1", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  f.own = tone(path.join(mine, "upload.mp3"));
  f.theirs = tone(path.join(theirs, "private.mp3"));
  f.global = tone(path.join(process.env.OUTPUT_DIR, "owner-sermon.mp3"));
  f.tts = tone(path.join(process.env.OUTPUT_DIR, "tts-edge-abc.mp3"));
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
});

after(() => {
  if (junction) fs.rmdirSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function appFor(scope) {
  const a = express();
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/timeline", timelineRouter);
  return a;
}

const peaks = (scope, p) => request(appFor(scope)).get(`/api/timeline/peaks?path=${encodeURIComponent(p)}`);
const cacheFiles = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".peaks.json"));

describe("/api/timeline/peaks path scope", () => {
  test("a non-owner cannot read another tenant's file or the global output folder", async () => {
    const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const bad = [
      f.theirs,
      f.global,
      "/outputs/../../them/outputs/private.mp3",
      path.join(mine, "..", "..", "them", "outputs", "private.mp3"),
      system,
      "\\\\evil-host\\share\\a.mp3",
      "tcp://127.0.0.1:9",
    ];
    if (junction) bad.push(path.join(junction, "private.mp3"));
    for (const p of bad) {
      const res = await peaks(ctx, p);
      assert.equal(res.status, 403, `${p}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", p);
    }
    assert.deepEqual(cacheFiles(mine), []);
  });

  test("the /outputs/ alias of a global file names the caller's own folder, not the global one", async () => {
    const res = await peaks(ctx, "/outputs/owner-sermon.mp3");
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  test("a missing own file is 404", async () => {
    const res = await peaks(ctx, path.join(mine, "nope.mp3"));
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  test("a non-owner reads their own upload, by path and by alias", { skip: noFfmpeg }, async () => {
    for (const p of [f.own, "/outputs/upload.mp3"]) {
      const res = await peaks(ctx, p);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(res.body.peaks.length > 0);
    }
  });

  test("shared tts-* voice files and bundled library audio still draw", { skip: noFfmpeg }, async () => {
    for (const p of [f.tts, "library:peaceful-worship"]) {
      const res = await peaks(ctx, p);
      assert.equal(res.status, 200, `${p}: ${JSON.stringify(res.body)}`);
    }
  });

  test("the owner still reads the global output folder", { skip: noFfmpeg }, async () => {
    for (const p of [f.global, "/outputs/owner-sermon.mp3"]) {
      const res = await peaks(ownerCtx, p);
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  });
});
