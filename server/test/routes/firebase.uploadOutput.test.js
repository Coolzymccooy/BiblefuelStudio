/**
 * POST /api/firebase/upload-output publishes a local file to storage and
 * answers a signed URL (#112). It may only publish a file in the caller's own
 * output folder; anything else is 403 PATH_OUTSIDE_MEDIA and nothing is
 * uploaded.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "firebase-upload-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const firebaseModule = await import("../../src/routes/firebase.js");
const firebaseRouter = firebaseModule.default;
const { _setFirebaseForTests } = firebaseModule;

const mine = path.join(process.env.DATA_DIR, "users", "me", "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", dataDir: path.dirname(mine), outputDir: mine };
const ownerCtx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true };
const f = {};
let junction = null;
let uploads = [];

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  f.own = path.join(mine, "video.mp4");
  f.theirs = path.join(theirs, "private.mp4");
  f.tts = path.join(process.env.OUTPUT_DIR, "tts-edge-abc.mp3");
  f.owner = path.join(process.env.OUTPUT_DIR, "owner.mp4");
  for (const file of Object.values(f)) fs.writeFileSync(file, "x");
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  _setFirebaseForTests({
    enabled: () => true,
    upload: async (localPath, options) => {
      uploads.push({ localPath, options });
      return { bucket: "b", objectPath: `outputs/${path.basename(localPath)}`, signedUrl: "https://signed.example/x" };
    },
  });
});

after(() => {
  _setFirebaseForTests(null);
  if (junction) fs.rmdirSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => { uploads = []; });

function appFor(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/firebase", firebaseRouter);
  return a;
}

const upload = (scope, body) => request(appFor(scope)).post("/api/firebase/upload-output").send(body);

describe("/api/firebase/upload-output path scope", () => {
  test("refuses another tenant's file, shared and owner files, traversal, system paths, UNC, URLs and a junction", async () => {
    const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const bad = [
      f.theirs,
      f.tts,
      f.owner,
      path.join(mine, "..", "..", "them", "outputs", "private.mp4"),
      "/outputs/../../them/outputs/private.mp4",
      system,
      path.join(process.env.DATA_DIR, "users.json"),
      "\\\\evil-host\\share\\a.mp4",
      "//evil-host/share/a.mp4",
      "http://127.0.0.1:9/a.mp4",
    ];
    if (junction) bad.push(path.join(junction, "private.mp4"));
    for (const p of bad) {
      for (const body of [{ path: p }, { filePath: p }]) {
        const res = await upload(ctx, body);
        assert.equal(res.status, 403, `${p}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", p);
      }
    }
    assert.deepEqual(uploads, []);
  });

  test("uploads the caller's own file, by path and by /outputs/ alias", async () => {
    for (const p of [f.own, "/outputs/video.mp4"]) {
      const res = await upload(ctx, { path: p });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    assert.deepEqual(uploads.map((u) => u.localPath), [fs.realpathSync(f.own), fs.realpathSync(f.own)]);
  });

  test("a missing own file is a 400 and nothing is uploaded", async () => {
    const res = await upload(ctx, { path: path.join(mine, "nope.mp4") });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.deepEqual(uploads, []);
  });

  test("the owner still uploads from the global output folder", async () => {
    const res = await upload(ownerCtx, { path: "/outputs/owner.mp4" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(uploads.map((u) => u.localPath), [fs.realpathSync(f.owner)]);
  });
});
