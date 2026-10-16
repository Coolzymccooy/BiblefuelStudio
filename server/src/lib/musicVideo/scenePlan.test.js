import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planMusicScenes } from "./scenePlan.js";

let n = 0;
const line = (sectionId, start, end, text = `line ${++n}`) => ({
  id: `l${n}`, sectionId, text, start, end,
  words: [{ text, start, end }],
});
const section = (id, kind, label, start) => ({ id, kind, label, ...(start === undefined ? {} : { start }) });

/** Every plan must run from 0 to the end with no gap, and every scene must fit one Seedance clip. */
function assertContiguous(scenes, endMs, { minSec = 4, maxSec = 12 } = {}) {
  assert.ok(scenes.length > 0, "at least one scene");
  assert.equal(scenes[0].startMs, 0);
  assert.equal(scenes[scenes.length - 1].endMs, endMs);
  for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i].startMs, scenes[i - 1].endMs, `gap before scene ${i}`);
  for (const s of scenes) {
    const sec = (s.endMs - s.startMs) / 1000;
    assert.ok(sec <= maxSec + 1e-6, `scene ${s.startMs}-${s.endMs} is over ${maxSec} s`);
    if (scenes.length > 1) assert.ok(sec >= minSec - 1e-6, `scene ${s.startMs}-${s.endMs} is under ${minSec} s`);
  }
}

describe("planMusicScenes", () => {
  test("one scene per section, each running to the next section's start", () => {
    const sections = [section("s1", "verse", "Verse 1", 0), section("s2", "chorus", "Chorus", 10)];
    const lines = [line("s1", 0.5, 3, "We walk"), line("s1", 4, 7, "by faith"), line("s2", 10.2, 13, "Grace"), line("s2", 14, 18, "beyond the race")];
    const scenes = planMusicScenes({ sections, lines, durationSec: 20 });
    assert.deepEqual(scenes, [
      { startMs: 0, endMs: 10000, kind: "verse", label: "Verse 1", text: "We walk / by faith" },
      { startMs: 10000, endMs: 20000, kind: "chorus", label: "Chorus", text: "Grace / beyond the race" },
    ]);
  });

  test("the last section runs to the song file's full length, quiet tail included, so the video covers the whole song", () => {
    const sections = [section("s1", "verse", "Verse", 0), section("s2", "chorus", "Chorus", 9)];
    const lines = [line("s1", 1, 5), line("s2", 9.5, 14)];
    const scenes = planMusicScenes({ sections, lines, durationSec: 20, audibleEnd: 15 });
    assert.equal(scenes[scenes.length - 1].endMs, 20000);
    assertContiguous(scenes, 20000);
  });

  test("a long section is split at line starts into pieces of at most 12 s", () => {
    const sections = [section("s1", "verse", "Verse 1", 0)];
    const lines = [0, 5, 10, 15, 20, 25].map((t) => line("s1", t, t + 4));
    const scenes = planMusicScenes({ sections, lines, durationSec: 30 });
    assertContiguous(scenes, 30000);
    assert.equal(scenes.length, 3);
    const starts = new Set(lines.map((l) => Math.round(l.start * 1000)));
    for (const s of scenes.slice(1)) assert.ok(starts.has(s.startMs), `cut at ${s.startMs} is not a line start`);
    for (const s of scenes) assert.equal(s.kind, "verse");
  });

  test("a line longer than 12 s is split evenly, and every piece keeps its words", () => {
    const sections = [section("s1", "bridge", "Bridge", 0)];
    const lines = [line("s1", 0, 30, "a very long held note")];
    const scenes = planMusicScenes({ sections, lines, durationSec: 30 });
    assertContiguous(scenes, 30000);
    assert.equal(scenes.length, 3);
    for (const s of scenes) {
      assert.equal(s.endMs - s.startMs, 10000);
      assert.equal(s.kind, "bridge");
      assert.equal(s.text, "a very long held note");
    }
  });

  test("a piece shorter than 4 s is merged into a neighbour", () => {
    const sections = [section("s1", "verse", "Verse", 0), section("s2", "chorus", "Tag", 10), section("s3", "verse", "Verse 2", 12)];
    const lines = [line("s1", 1, 8), line("s2", 10.1, 11.9), line("s3", 12.5, 20)];
    const scenes = planMusicScenes({ sections, lines, durationSec: 22 });
    assertContiguous(scenes, 22000);
    assert.equal(scenes.length, 2);
  });

  test("a short piece whose neighbours are both nearly full is shared out, never over 12 s", () => {
    const sections = [section("s1", "verse", "V1", 0), section("s2", "chorus", "C", 11), section("s3", "verse", "V2", 13)];
    const lines = [line("s1", 0.5, 10), line("s2", 11.2, 12.8), line("s3", 13.2, 24)];
    const scenes = planMusicScenes({ sections, lines, durationSec: 24.5 });
    assertContiguous(scenes, 24500);
    // The same answer the client copy gives (client/src/lib/__tests__/musicVideoPlan.test.ts).
    assert.deepEqual(scenes.map((s) => [s.startMs, s.endMs]), [[0, 6500], [6500, 13000], [13000, 24500]]);
  });

  test("with no section starts the song is cut at line starts into pieces of about 8 s", () => {
    const sections = [section("s1", "verse", "Verse", undefined)];
    const lines = Array.from({ length: 20 }, (_, i) => line("s1", i * 2, i * 2 + 1.5));
    const scenes = planMusicScenes({ sections, lines, durationSec: 40 });
    assertContiguous(scenes, 40000);
    assert.equal(scenes.length, 5);
    const starts = new Set(lines.map((l) => Math.round(l.start * 1000)));
    for (const s of scenes.slice(1)) assert.ok(starts.has(s.startMs));
    for (const s of scenes) assert.ok(s.text.length > 0);
  });

  test("an intro before the first line and a gap with no lines get scenes of their own, marked instrumental", () => {
    const sections = [section("s1", "verse", "Verse 1", 6), section("s2", "chorus", "Chorus", 30)];
    const lines = [line("s1", 6, 8), line("s1", 9, 11), line("s1", 12, 14), line("s2", 30.5, 36)];
    const scenes = planMusicScenes({ sections, lines, durationSec: 40 });
    assertContiguous(scenes, 40000);
    assert.deepEqual(scenes[0], { startMs: 0, endMs: 6000, kind: "instrumental", label: "Intro", text: "" });
    const gap = scenes.find((s) => s.startMs >= 14000 && s.endMs <= 30000 && s.text === "");
    assert.ok(gap, "the instrumental break has a scene");
    assert.equal(gap.kind, "instrumental");
    assert.equal(gap.label, "Verse 1");
  });

  test("a section with no start folds its lines into the section before it", () => {
    const sections = [section("s1", "verse", "Verse", 0), section("s2", "pre", "Pre", undefined), section("s3", "chorus", "Chorus", 10)];
    const lines = [line("s1", 0.5, 3, "one"), line("s2", 5, 8, "two"), line("s3", 10.5, 15, "three")];
    const scenes = planMusicScenes({ sections, lines, durationSec: 18 });
    assert.equal(scenes[0].text, "one / two");
    assert.equal(scenes[0].kind, "verse");
  });

  test("untimed lines are ignored and a song with no length gives no scenes", () => {
    assert.deepEqual(planMusicScenes({ sections: [], lines: [], durationSec: 0 }), []);
    const scenes = planMusicScenes({ sections: [], lines: [{ id: "x", sectionId: "s", text: "never timed" }], durationSec: 6 });
    assert.deepEqual(scenes, [{ startMs: 0, endMs: 6000, kind: "instrumental", label: "", text: "" }]);
  });

  test("a 15-minute song plans at most 60 scenes (the daily picture budget), contiguous", () => {
    const sections = Array.from({ length: 45 }, (_, i) => section(`s${i}`, i % 2 ? "chorus" : "verse", `S${i}`, i * 20));
    const lines = Array.from({ length: 300 }, (_, i) => line(`s${Math.floor((i * 3) / 20)}`, i * 3, i * 3 + 2.5));
    const scenes = planMusicScenes({ sections, lines, durationSec: 900 });
    assert.ok(scenes.length <= 60, `${scenes.length} scenes`);
    // The same count the client copy gives (client/src/lib/__tests__/musicVideoPlan.test.ts).
    assert.equal(scenes.length, 60, "the cap makes longer scenes, not a handful");
    assertContiguous(scenes, 900000, { maxSec: Infinity });
  });

  test("the cap holds with no sections, and with very many short sections", () => {
    const fallback = planMusicScenes({ sections: [], lines: Array.from({ length: 400 }, (_, i) => line("s", i * 2.25, i * 2.25 + 2)), durationSec: 900 });
    assert.ok(fallback.length <= 60, `${fallback.length} scenes`);
    assertContiguous(fallback, 900000, { maxSec: Infinity });
    const tiny = Array.from({ length: 150 }, (_, i) => section(`s${i}`, "verse", `S${i}`, i * 6));
    const many = planMusicScenes({ sections: tiny, lines: tiny.map((s) => line(s.id, s.start + 0.5, s.start + 5)), durationSec: 900 });
    assert.ok(many.length <= 60, `${many.length} scenes`);
    assertContiguous(many, 900000, { maxSec: Infinity });
  });

  test("plans are contiguous from 0 to the end across many shapes", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let t = (seed % 5) * 1.3;
      const sections = [];
      const lines = [];
      for (let s = 0; s < 1 + (seed % 6); s++) {
        sections.push(section(`s${s}`, s % 2 ? "chorus" : "verse", `S${s}`, t));
        for (let k = 0; k < 1 + ((seed * (s + 3)) % 7); k++) {
          const len = 0.8 + ((seed + k * 7) % 13) * 0.9;
          lines.push(line(`s${s}`, t + 0.2, t + 0.2 + len));
          t += len + ((seed + k) % 3) * 2.1;
        }
      }
      const durationSec = Math.round((t + 3) * 100) / 100;
      const scenes = planMusicScenes({ sections, lines, durationSec });
      assertContiguous(scenes, Math.round(durationSec * 1000));
    }
  });
});
