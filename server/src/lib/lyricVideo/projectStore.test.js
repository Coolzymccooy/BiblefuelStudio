// server/src/lib/lyricVideo/projectStore.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, readProject, writeProject, updateProject, listProjects, deleteProject, readPrefs, writePrefs, cleanText, applySheet, carryOverTiming, normaliseBranding } from "./projectStore.js";

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
  test("a file of the wrong shape is skipped, not fatal to the list", () => {
    const good = createProject(dir, { title: "Good", artist: "" });
    const folder = path.join(dir, "lyric-projects");
    fs.writeFileSync(path.join(folder, "lv_trunc.json"), '{"projectId":"lv_tru');
    fs.writeFileSync(path.join(folder, "lv_obj.json"), "{}");
    fs.writeFileSync(path.join(folder, "lv_arr.json"), "[]");
    fs.writeFileSync(path.join(folder, "lv_mismatch.json"), JSON.stringify({ ...good, projectId: "lv_other" }));
    assert.deepEqual(listProjects(dir).map((p) => p.projectId), [good.projectId]);
    assert.equal(readProject(dir, "lv_obj"), null);
    assert.equal(readProject(dir, "lv_mismatch"), null);
  });
  test("writeProject rejects a non-string projectId", () => {
    const p = createProject(dir, { title: "A", artist: "" });
    assert.throws(() => writeProject(dir, { ...p, projectId: [p.projectId] }), /invalid projectId/);
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

describe("updateProject", () => {
  test("a deleted project is not recreated", () => {
    const p = createProject(dir, { title: "Gone", artist: "" });
    deleteProject(dir, p.projectId);
    let called = false;
    const result = updateProject(dir, p.projectId, (latest) => { called = true; return { ...latest }; });
    assert.equal(result, null);
    assert.equal(called, false);
    assert.equal(fs.existsSync(path.join(dir, "lyric-projects", `${p.projectId}.json`)), false);
  });
  test("fn receives the latest on-disk version and its result is written", () => {
    const p = createProject(dir, { title: "A", artist: "" });
    writeProject(dir, { ...p, title: "B" });
    let seen = null;
    const out = updateProject(dir, p.projectId, (latest) => { seen = latest.title; return { ...latest, artist: "X" }; });
    assert.equal(seen, "B");
    assert.equal(out.artist, "X");
    assert.equal(readProject(dir, p.projectId).title, "B");
    assert.equal(readProject(dir, p.projectId).artist, "X");
  });
});

describe("carryOverTiming with repeated lines", () => {
  const timed = (text, start, locked = true) => ({ text, words: [{ text, start, end: start + 1 }], start, end: start + 1, locked, effect: "slam" });
  const X = "Who talk say?";
  test("editing the first of three repeats keeps the other two timings", () => {
    const old = [timed(X, 10), timed(X, 70), timed(X, 130)];
    const next = [{ text: "Who talk say now?" }, { text: X }, { text: X }];
    const out = carryOverTiming(old, next);
    assert.equal(out[0].words, undefined);
    assert.equal(out[0].start, undefined);
    assert.equal(out[1].start, 70);
    assert.equal(out[2].start, 130);
  });
  test("removing the middle one of three keeps the first and last timings", () => {
    const A = "Eh, eh!";
    const B = "Shake am";
    const old = [timed(X, 10), timed(A, 40), timed(X, 70), timed(B, 100), timed(X, 130)];
    const next = [{ text: X }, { text: A }, { text: B }, { text: X }];
    const out = carryOverTiming(old, next);
    assert.equal(out[0].start, 10);
    assert.equal(out[1].start, 40);
    assert.equal(out[2].start, 100);
    assert.equal(out[3].start, 130);
  });
  test("a new line inserted between repeats gets no timing and the repeats keep theirs", () => {
    const old = [timed(X, 10), timed(X, 70), timed(X, 130)];
    const next = [{ text: X }, { text: "New line" }, { text: X }, { text: X }];
    const out = carryOverTiming(old, next);
    assert.equal(out[0].start, 10);
    assert.equal(out[1].words, undefined);
    assert.equal(out[2].start, 70);
    assert.equal(out[3].start, 130);
  });
});

describe("re-reading the lyrics keeps the timing state when no line lost its timing (R40)", () => {
  const SHEET = "[INTRO]\nMy time no late\n[CHORUS]\nWho talk say?\nNa grace";
  /** A project whose lyrics were timed: every line placed, the section starts set, status done. */
  function timedProject() {
    const p = applySheet(createProject(dir, { title: "T", artist: "" }), SHEET);
    const lines = p.lines.map((l, i) => ({ ...l, words: [{ text: "x", start: i * 2, end: i * 2 + 1 }], start: i * 2, end: i * 2 + 1, confidence: 1, flag: null }));
    const sections = p.sections.map((s, i) => ({ ...s, start: i * 2 }));
    return { ...p, lines, sections, timing: { status: "done", beats: { bpm: 120, times: [0] }, finishedAt: "t" } };
  }
  test("the same lyrics read again: still done, section starts kept", () => {
    const next = applySheet(timedProject(), SHEET);
    assert.equal(next.timing.status, "done");
    assert.deepEqual(next.timing.beats, { bpm: 120, times: [0] });
    assert.equal(next.lines[2].start, 4);
    assert.deepEqual(next.sections.map((s) => s.start), [0, 2]);
  });
  test("a line removed: every remaining line kept its timing, so still done", () => {
    const next = applySheet(timedProject(), "[INTRO]\nMy time no late\n[CHORUS]\nWho talk say?");
    assert.equal(next.timing.status, "done");
  });
  test("a changed or added line has no timing, so the lyrics need timing again", () => {
    assert.equal(applySheet(timedProject(), "[INTRO]\nMy time no late\n[CHORUS]\nWho talk say now?\nNa grace").timing.status, "idle");
    assert.equal(applySheet(timedProject(), `${SHEET}\nA new line`).timing.status, "idle");
  });
});

test("applySheet parses the sheet and records it", () => {
  const p = createProject(dir, { title: "T", artist: "" });
  const next = applySheet(p, "[CHORUS]\nWho talk say?\n(WHO TALK SAY?!)");
  assert.equal(next.sheet.raw.includes("CHORUS"), true);
  assert.deepEqual(next.lines.map((l) => [l.kind, l.text, l.effect]), [["lead", "Who talk say?", "auto"], ["response", "(WHO TALK SAY?!)", "auto"]]);
  assert.equal(next.timing.status, "idle");
});

describe("branding options", () => {
  const DEFAULTS = { logo: null, intro: true, endCard: true };
  test("a new project follows Settings for the logo and has the intro and end card on", () => {
    assert.deepEqual(createProject(dir, { title: "A", artist: "" }).branding, DEFAULTS);
  });
  test("an older project without the field reads as the defaults", () => {
    const p = createProject(dir, { title: "A", artist: "" });
    const { branding, ...old } = p;
    fs.writeFileSync(path.join(dir, "lyric-projects", `${p.projectId}.json`), JSON.stringify(old));
    assert.deepEqual(readProject(dir, p.projectId).branding, DEFAULTS);
  });
  test("normaliseBranding keeps booleans (and null for the logo), drops unknown keys and bad values", () => {
    assert.deepEqual(normaliseBranding({ logo: false, intro: false, endCard: false, extra: 1 }), { logo: false, intro: false, endCard: false });
    assert.deepEqual(normaliseBranding({ logo: true }), { logo: true, intro: true, endCard: true });
    assert.deepEqual(normaliseBranding({ logo: "yes", intro: 0, endCard: null }), DEFAULTS);
    for (const junk of [undefined, null, "x", 3, []]) assert.deepEqual(normaliseBranding(junk), DEFAULTS);
  });
});
