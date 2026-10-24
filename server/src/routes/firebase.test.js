// POST /api/firebase/upload-output copied any path the caller named to the
// bucket and returned a link to it: server/.env, users.json, anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { createFirebaseRouter } from "./firebase.js";

function rig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fb-route-"));
  const outputDir = path.join(root, "users", "u1", "outputs");
  fs.mkdirSync(path.join(outputDir, "story"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, "story", "video.mp4"), "V");
  fs.writeFileSync(path.join(outputDir, "notes.json"), "{}");
  fs.writeFileSync(path.join(root, ".env"), "JWT_SECRET=topsecret");
  fs.writeFileSync(path.join(root, "users.json"), "{}");
  const uploads = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", outputDir }; next(); });
  app.use("/api/firebase", createFirebaseRouter({
    enabled: () => true,
    upload: async (localPath, opts) => { uploads.push({ localPath, ...opts }); return { objectPath: `${opts.prefix}/x` }; },
  }));
  return { app, root, outputDir, uploads };
}
const send = (app, body) => request(app).post("/api/firebase/upload-output").send(body);

test("server files and other users' files are refused, however they are named", async () => {
  const { app, root, uploads } = rig();
  for (const p of [
    path.join(root, ".env"),
    path.join(root, "users.json"),
    "../../../.env",
    "/outputs/../../../.env",
    "outputs/../../users.json",
    path.join(root, "users", "u2", "outputs", "theirs.mp4"),
  ]) {
    const r = await send(app, { path: p });
    assert.equal(r.status, 400, p);
  }
  assert.deepEqual(uploads, []);
});

test("a symlink out of the outputs folder is refused", async (t) => {
  const { app, root, outputDir, uploads } = rig();
  try {
    fs.symlinkSync(path.join(root, ".env"), path.join(outputDir, "leak.mp4"));
  } catch {
    return t.skip("symlinks need extra rights on this machine");
  }
  assert.equal((await send(app, { path: path.join(outputDir, "leak.mp4") })).status, 400);
  assert.deepEqual(uploads, []);
});

test("the caller's own media is uploaded to their own folder; they cannot choose another", async () => {
  const { app, outputDir, uploads } = rig();
  const r = await send(app, { path: "/outputs/story/video.mp4", prefix: "backups/data" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(uploads, [{ localPath: fs.realpathSync(path.join(outputDir, "story", "video.mp4")), prefix: "outputs/u1" }]);
  assert.equal((await send(app, { path: path.join(outputDir, "notes.json") })).status, 400, "not a media file");
});
