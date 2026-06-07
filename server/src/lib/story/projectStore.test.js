import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createProject,
  readProject,
  writeProject,
  listProjects,
  STORY_STATUS,
} from "./projectStore.js";

let baseDir;
beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-store-"));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("projectStore", () => {
  test("createProject persists a draft with a generated id", () => {
    const p = createProject(baseDir, { title: "Trusting God", style: "cinematic-bible" });
    assert.ok(p.projectId);
    assert.equal(p.title, "Trusting God");
    assert.equal(p.style, "cinematic-bible");
    assert.equal(p.status, STORY_STATUS.DRAFT);
    assert.deepEqual(p.scenes, []);
    const onDisk = readProject(baseDir, p.projectId);
    assert.equal(onDisk.projectId, p.projectId);
  });

  test("writeProject is atomic — no .tmp left behind", () => {
    const p = createProject(baseDir, { title: "A", style: "cinematic-bible" });
    writeProject(baseDir, { ...p, title: "B" });
    assert.equal(readProject(baseDir, p.projectId).title, "B");
    const dir = path.join(baseDir, "story-projects");
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  test("readProject returns null for a missing id", () => {
    assert.equal(readProject(baseDir, "nope"), null);
  });

  test("readProject returns null for a corrupt file instead of throwing", () => {
    const dir = path.join(baseDir, "story-projects");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.json"), "{ not json");
    assert.equal(readProject(baseDir, "bad"), null);
  });

  test("listProjects returns summaries newest-first", () => {
    const a = createProject(baseDir, { title: "A", style: "cinematic-bible" });
    const b = createProject(baseDir, { title: "B", style: "cinematic-bible" });
    writeProject(baseDir, { ...b, updatedAt: 2000 });
    writeProject(baseDir, { ...a, updatedAt: 1000 });
    const list = listProjects(baseDir);
    assert.equal(list[0].projectId, b.projectId);
    assert.equal(list.length, 2);
  });

  test("readProject returns null for an empty projectId (invalid guard)", () => {
    assert.equal(readProject(baseDir, ""), null);
  });
});
