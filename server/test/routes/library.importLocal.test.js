/**
 * POST /api/library/import-local copies every video in a server folder into
 * the caller's library (#112, security review). Only the owner may use it,
 * and even the owner only from a folder inside their own outputs folder. A
 * missing folder and an outside one get the same answer, so the route cannot
 * be used to learn what exists on the server.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-local-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: libraryRouter } = await import("../../src/routes/library.js");

const DATA = path.resolve(process.env.DATA_DIR);
const OUT = path.resolve(process.env.OUTPUT_DIR);
const ownerCtx = { userId: "owner", dataDir: DATA, outputDir: OUT, isSuperAdmin: true, isOwner: true };
const userDir = path.join(DATA, "users", "u1");
const userCtx = { userId: "u1", dataDir: userDir, outputDir: path.join(userDir, "outputs"), isSuperAdmin: false, isOwner: false };
const adminDir = path.join(DATA, "users", "admin2");
const otherAdminCtx = { userId: "admin2", dataDir: adminDir, outputDir: path.join(adminDir, "outputs"), isSuperAdmin: true, isOwner: false };

const pack = path.join(OUT, "imports", "pack");
const outsideDir = path.join(root, "elsewhere");
const junction = path.join(OUT, "imports", "door");

function app(ctx) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = ctx; next(); });
  a.use("/api/library", libraryRouter);
  return a;
}

const libraryIds = (ctx) => {
  const file = path.join(ctx.dataDir, "library.json");
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")).items || []).map((x) => x.id);
};

before(() => {
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(pack, "clip.mp4"), "x");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "secret.mp4"), "x");
  fs.mkdirSync(userCtx.outputDir, { recursive: true });
  fs.mkdirSync(path.join(userCtx.outputDir, "mine"), { recursive: true });
  fs.writeFileSync(path.join(userCtx.outputDir, "mine", "a.mp4"), "x");
  fs.symlinkSync(outsideDir, junction, "junction");
});

after(() => {
  try { fs.unlinkSync(junction); } catch { /* already gone */ }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

describe("import-local is the owner's alone", () => {
  for (const [name, ctx] of [["a signed-in user", userCtx], ["another super-admin", otherAdminCtx]]) {
    test(`${name} gets 403, even for a folder of their own`, async () => {
      const res = await request(app(ctx)).post("/api/library/import-local")
        .send({ folderPath: path.join(userCtx.outputDir, "mine") });
      assert.equal(res.status, 403);
      assert.equal(res.body.error, "OWNER_ONLY");
      assert.deepEqual(libraryIds(ctx), []);
    });
  }

  test("GET /import-local tells the client whether the control should show", async () => {
    assert.equal((await request(app(ownerCtx)).get("/api/library/import-local")).body.allowed, true);
    assert.equal((await request(app(userCtx)).get("/api/library/import-local")).body.allowed, false);
    assert.equal((await request(app(otherAdminCtx)).get("/api/library/import-local")).body.allowed, false);
  });
});

describe("the owner imports only from inside their outputs folder", () => {
  test("a folder inside outputs imports its videos", async () => {
    const res = await request(app(ownerCtx)).post("/api/library/import-local").send({ folderPath: pack });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.imported.length, 1);
  });

  test("the /outputs/ alias names the same folder", async () => {
    const res = await request(app(ownerCtx)).post("/api/library/import-local").send({ folderPath: "/outputs/imports/pack" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.imported.length, 1);
  });

  test("an outside folder and a missing one get the same answer, and nothing is copied", async () => {
    const before = libraryIds(ownerCtx).length;
    const answers = [];
    for (const folderPath of [
      outsideDir,
      path.join(root, "no-such-folder"),
      path.join(OUT, "imports", "no-such-folder"),
      `${pack}${path.sep}..${path.sep}..${path.sep}..${path.sep}elsewhere`,
      junction,
      path.join(pack, "clip.mp4"),
      "\\\\server\\share\\pack",
      "file:///etc",
    ]) {
      const res = await request(app(ownerCtx)).post("/api/library/import-local").send({ folderPath });
      answers.push([res.status, res.body.error, res.body.message]);
    }
    for (const answer of answers) assert.deepEqual(answer, answers[0]);
    assert.equal(answers[0][0], 400);
    assert.equal(answers[0][1], "FOLDER_NOT_AVAILABLE");
    assert.equal(libraryIds(ownerCtx).length, before);
    assert.equal(fs.readdirSync(OUT).some((f) => f.startsWith("local-local_") && fs.readFileSync(path.join(OUT, f), "utf8") !== "x"), false);
  });

  test("a symlink to a file outside, inside an allowed folder, is skipped", async (t) => {
    const door = path.join(pack, "door.mp4");
    try {
      fs.symlinkSync(path.join(outsideDir, "secret.mp4"), door, "file");
    } catch (err) {
      if (err?.code === "EPERM") return t.skip("file symlinks need extra rights on this machine");
      throw err;
    }
    try {
      const res = await request(app(ownerCtx)).post("/api/library/import-local").send({ folderPath: pack });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.imported.length, 1, "only clip.mp4");
    } finally {
      fs.rmSync(door, { force: true });
    }
  });
});
