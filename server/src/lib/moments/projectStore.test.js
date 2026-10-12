import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, applyUpdate, withHistory, isRendering, HISTORY_KEEP,
} from "./projectStore.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-store-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a new Moment takes its occasion's defaults", () => {
  const p = createProject(dir, { occasion: "memorial" });
  assert.equal(p.occasion, "memorial");
  assert.equal(p.style, "glow");
  assert.equal(p.energy, 0.15);
  assert.equal(p.lengthSec, 15);
  assert.deepEqual(p.sound.song, { ref: "library:prayer-piano", windowStartSec: null });
  assert.equal(p.sound.voiceover, null);
  assert.ok(Number.isInteger(p.seed));
  assert.deepEqual(readProject(dir, p.projectId), p);
});

test("ids that could escape the folder are refused", () => {
  assert.equal(readProject(dir, "../../etc/passwd"), null);
  assert.equal(deleteProject(dir, "..%2F..%2Fx"), false);
});

test("list is newest first with a thumbnail and the last render", () => {
  const a = createProject(dir, { occasion: "birthday" });
  const b = createProject(dir, { occasion: "fun" });
  // updatedAt: b's, so the rewrite is strictly newer even within one millisecond.
  writeProject(dir, { ...a, updatedAt: b.updatedAt, title: "A", photos: [{ ref: { kind: "upload", path: "x" }, url: "/outputs/x.jpg", width: 1, height: 1 }], history: [{ jobId: "j", file: "/outputs/moment-1.mp4", createdAt: 1, seed: 1 }] });
  const list = listProjects(dir);
  assert.equal(list[0].projectId, a.projectId, "the most recently written comes first");
  assert.equal(list[0].thumb, "/outputs/x.jpg");
  assert.equal(list[0].lastFile, "/outputs/moment-1.mp4");
  assert.equal(list[1].projectId, b.projectId);
});

test("applyUpdate accepts good fields and clamps Energy", () => {
  const p = createProject(dir, { occasion: "birthday" });
  const r = applyUpdate(p, {
    details: { name: " Tolu ", milestone: "40" }, title: "Happy 40th!", statements: ["One", "Two"],
    style: "hype", energy: 7, lengthSec: 30, heroIndex: 0, seed: 42,
    sound: { song: { ref: "library:hopeful", windowStartSec: 12.5 } },
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.project.details.name, "Tolu");
  assert.equal(r.project.energy, 1);
  assert.equal(r.project.lengthSec, 30);
  assert.equal(r.project.seed, 42);
  assert.deepEqual(r.project.sound.song, { ref: "library:hopeful", windowStartSec: 12.5 });
});

const bad = [
  ["an unknown occasion", { occasion: "party" }, /occasion/],
  ["an unknown style", { style: "disco" }, /style/],
  ["a length of 20", { lengthSec: 20 }, /length/],
  ["a 41-character title", { title: "x".repeat(41) }, /title/],
  ["nine statements", { statements: Array(9).fill("x") }, /statements/],
  ["a 61-character statement", { statements: ["x".repeat(61)] }, /statement/],
  ["an empty statement", { statements: ["ok", "  "] }, /statement/],
  ["an unknown detail", { details: { password: "x" } }, /detail/],
  ["an 81-character detail", { details: { name: "x".repeat(81) } }, /name/],
  ["21 photos", { photos: Array(21).fill({ ref: { kind: "upload", path: "p" }, url: "u", width: 1, height: 1 }) }, /20 photos/],
  ["a hero outside the photos", { heroIndex: 3 }, /hero/],
  ["a negative window", { sound: { song: { ref: "library:hopeful", windowStartSec: -1 } } }, /window/],
];
for (const [name, body, re] of bad) {
  test(`applyUpdate refuses ${name}`, () => {
    const r = applyUpdate(createProject(dir, { occasion: "birthday" }), body);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  });
}

test("the song can be removed, and the voiceover only cleared, through applyUpdate", () => {
  const p = { ...createProject(dir, { occasion: "fun" }), sound: { song: { ref: "library:hopeful", windowStartSec: null }, voiceover: { script: "s", voiceId: "v", file: "moment-vo-1.mp3" } } };
  const r = applyUpdate(p, { sound: { song: null, voiceover: null } });
  assert.equal(r.ok, true);
  assert.equal(r.project.sound.song, null);
  assert.equal(r.project.sound.voiceover, null);
  const keep = applyUpdate(p, { sound: { voiceover: { script: "injected", voiceId: "x", file: "../../x.mp3" } } });
  assert.equal(keep.ok, false);
  assert.match(keep.error, /voiceover/);
});

test("history keeps the last 20", () => {
  let p = createProject(dir, { occasion: "fun" });
  for (let i = 0; i < 25; i += 1) p = withHistory(p, { jobId: `j${i}`, file: `/outputs/m${i}.mp4`, createdAt: i, seed: i });
  assert.equal(p.history.length, HISTORY_KEEP);
  assert.equal(p.history[0].jobId, "j5");
});

test("isRendering is true only while a render runs", () => {
  const p = createProject(dir, { occasion: "fun" });
  assert.equal(isRendering(p), false);
  assert.equal(isRendering({ ...p, render: { status: "running" } }), true);
  assert.equal(isRendering({ ...p, render: { status: "done" } }), false);
});
