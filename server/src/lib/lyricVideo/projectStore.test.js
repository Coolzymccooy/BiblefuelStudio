// server/src/lib/lyricVideo/projectStore.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, readProject, writeProject, listProjects, deleteProject, readPrefs, writePrefs, cleanText, applySheet, carryOverTiming } from "./projectStore.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-store-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("projects", () => {
  test("create, read, list, delete", () => {
    const p = createProject(dir, { title: " My Time No Late ", artist: "Sthill Waters" });
    assert.match(p.projectId, /^lv_[a-z0-9]+$/);
    assert.equal(p.title, "My Time No Late");
    assert.deepEqual(p.look, { id: "studio-lagos-night", energy: "wild", seed: 1 });
    assert.equal(readProject(dir, p.projectId).title, "My Time No Late");
    assert.equal(listProjects(dir)[0].projectId, p.projectId);
    assert.equal(deleteProject(dir, p.projectId), true);
    assert.equal(readProject(dir, p.projectId), null);
  });
  test("a malicious id never escapes the folder", () => {
    assert.equal(readProject(dir, "../../etc/passwd"), null);
  });
  test("writes are atomic and bump updatedAt", async () => {
    const p = createProject(dir, { title: "A", artist: "" });
    await new Promise((r) => setTimeout(r, 5));
    const next = writeProject(dir, { ...p, title: "B" });
    assert.ok(next.updatedAt > p.updatedAt);
    assert.deepEqual(fs.readdirSync(path.join(dir, "lyric-projects")).filter((f) => f.endsWith(".tmp")), []);
  });
});

test("artist is remembered per user", () => {
  assert.deepEqual(readPrefs(dir), { artist: "" });
  writePrefs(dir, { artist: "Sthill Waters" });
  assert.deepEqual(readPrefs(dir), { artist: "Sthill Waters" });
});

test("cleanText strips control characters and caps length", () => {
  assert.equal(cleanText("a\u0000b\u0007c"), "abc");
  assert.equal(cleanText("x".repeat(150)).length, 100);
});

describe("carryOverTiming", () => {
  const timed = (text, start, locked = false) => ({ text, words: [{ text, start, end: start + 1 }], start, end: start + 1, locked, effect: "slam" });
  test("same text at the same occurrence keeps its timing, lock and effect", () => {
    const old = [timed("Who talk say?", 10, true), timed("Who talk say?", 20, true), timed("Eh!", 30)];
    const next = [{ text: "Who talk say?" }, { text: "New line" }, { text: "Who talk say?" }, { text: "Eh!" }];
    const out = carryOverTiming(old, next);
    assert.equal(out[0].start, 10);
    assert.equal(out[0].locked, true);
    assert.equal(out[1].words, undefined);
    assert.equal(out[2].start, 20);
    assert.equal(out[3].effect, "slam");
  });
});

test("applySheet parses the sheet and records it", () => {
  const p = createProject(dir, { title: "T", artist: "" });
  const next = applySheet(p, "[CHORUS]\nWho talk say?\n(WHO TALK SAY?!)");
  assert.equal(next.sheet.raw.includes("CHORUS"), true);
  assert.deepEqual(next.lines.map((l) => [l.kind, l.text, l.effect]), [["lead", "Who talk say?", "auto"], ["response", "(WHO TALK SAY?!)", "auto"]]);
  assert.equal(next.timing.status, "idle");
});
