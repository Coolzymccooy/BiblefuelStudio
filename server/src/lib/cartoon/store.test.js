import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import * as cartoon from "./store.js";
import * as human from "../sceneScript/projectStore.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-store-"));
}

test("cartoon projects live in cartoons/ and never show in scene-scripts/", () => {
  const dir = tempDir();
  try {
    const created = cartoon.createProject(dir, { meta: { title: "Pilot" } });
    assert.ok(fs.existsSync(path.join(dir, "cartoons", `${created.id}.json`)));
    assert.equal(fs.existsSync(path.join(dir, "scene-scripts", `${created.id}.json`)), false);
    assert.deepEqual(human.listProjects(dir), []);
    const listed = cartoon.listProjects(dir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);
    assert.equal(listed[0].title, "Pilot");
    assert.equal(listed[0].renderStatus, "idle");
    assert.equal(listed[0].mode, "cartoon");
    assert.equal(
      cartoon.projectOutputUrl(created.id, "a b.mp4"),
      `/outputs/cartoons/${created.id}/a%20b.mp4`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("human projects keep their folder, url and list shape", () => {
  const dir = tempDir();
  try {
    const created = human.createProject(dir, { meta: { title: "Scene" } });
    assert.ok(fs.existsSync(path.join(dir, "scene-scripts", `${created.id}.json`)));
    assert.deepEqual(cartoon.listProjects(dir), []);
    assert.equal(human.projectOutputUrl(created.id, "x.mp4"), `/outputs/scene-scripts/${created.id}/x.mp4`);
    assert.equal(human.listProjects(dir)[0].mode, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cartoon store reads, updates and deletes within its own folder", () => {
  const dir = tempDir();
  const outDir = tempDir();
  try {
    const created = cartoon.createProject(dir, { meta: { title: "A" } });
    assert.equal(cartoon.readProject(dir, created.id).meta.title, "A");
    const updated = cartoon.updateProject(dir, created.id, (p) => ({ ...p, meta: { title: "B" } }));
    assert.equal(updated.meta.title, "B");
    assert.equal(cartoon.updateProject(dir, created.id, () => null), null);
    // a human lookup of a cartoon id finds nothing
    assert.equal(human.readProject(dir, created.id), null);
    fs.mkdirSync(cartoon.projectOutputDir(outDir, created.id), { recursive: true });
    assert.ok(cartoon.projectOutputDir(outDir, created.id).includes(path.join("cartoons", created.id)));
    assert.equal(cartoon.deleteProject(dir, outDir, created.id), true);
    assert.equal(cartoon.readProject(dir, created.id), null);
    assert.equal(fs.existsSync(cartoon.projectOutputDir(outDir, created.id)), false);
    assert.equal(cartoon.deleteProject(dir, outDir, created.id), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("cartoon store rejects ids that are not UUIDs", () => {
  assert.equal(cartoon.isProjectId("../x"), false);
  assert.throws(() => cartoon.projectOutputDir("/tmp", "../x"), /invalid cartoon id/);
  assert.throws(() => cartoon.writeProject("/tmp", { id: "nope" }), /invalid cartoon id/);
});
