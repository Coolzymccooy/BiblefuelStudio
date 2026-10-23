import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { projectFromMarkdown } from "./model.js";
import { withTimeline } from "./voiceStage.js";
import { buildRenderData, musicSections } from "./renderData.js";
import { duckAt, dropGate, musicVolume, baseLevel, DUCK } from "./mixCurve.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function voicedFixture() {
  const p = projectFromMarkdown(fs.readFileSync(path.join(here, "__fixtures__", "grace-made-me.md"), "utf8"));
  const lines = p.lines.map((l) => ({ ...l, audio: { durationSec: 2, words: [{ text: "w", start: 0, end: 0.4 }] } }));
  const shots = p.shots.map((s) => ({ ...s, clip: { status: "done", durationSec: 8 } }));
  return withTimeline({ ...p, lines, shots });
}

const assets = (p) => ({
  url: (n) => `http://127.0.0.1:9/${n}`,
  names: {
    voice: Object.fromEntries(p.lines.map((l) => [l.id, `v-${l.id}.wav`])),
    music: Object.fromEntries(p.music.cues.map((c) => [c.id, `m-${c.id}.wav`])),
    clips: Object.fromEntries(p.shots.map((s) => [s.id, `c-${s.id}.mp4`])),
    fonts: { sans: "sans.ttf" },
    heartbeat: "heartbeat.wav",
    impact: "impact.wav",
  },
});

describe("mixCurve", () => {
  const lines = [{ start: 10, dur: 2, kind: "narration" }, { start: 20, dur: 2, kind: "chant" }];
  test("ducks under a line, less under a chant, and is full between", () => {
    assert.equal(duckAt(5, lines), 1);
    assert.ok(Math.abs(duckAt(11, lines) - DUCK) < 1e-9);
    assert.ok(duckAt(21, lines) > DUCK);
  });
  test("is silent inside the drop and lifts after the hit", () => {
    const drop = { from: 30, to: 31.3 };
    assert.equal(dropGate(29, drop), 1);
    assert.equal(dropGate(31, drop), 0);
    assert.ok(dropGate(31.5, drop) > 1);
  });
  test("fades a section in and out and never exceeds 1", () => {
    const s = { base: 0.72, from: 0, to: 40, first: true };
    assert.equal(musicVolume(s, 0, [], null), 0);
    assert.ok(musicVolume(s, 5, [], null) <= 1);
    assert.equal(musicVolume(s, 40, [], null), 0);
  });
  test("sets bed levels by mood", () => {
    assert.equal(baseLevel("Victorious declaration"), 0.72);
    assert.equal(baseLevel("Emotional reflection"), 0.5);
    assert.equal(baseLevel("Grace revealed"), 0.55);
  });
});

describe("buildRenderData on the fixture", () => {
  const project = voicedFixture();
  const data = buildRenderData(project, assets(project));

  test("is a 1080x1920 30 fps video of the timeline's length", () => {
    assert.deepEqual([data.width, data.height, data.fps, data.total], [1080, 1920, 30, project.timeline.total]);
  });

  test("labels the scripture with who declared it", () => {
    assert.equal(data.lines.find((l) => l.kind === "scripture").label, "THE APOSTLE PAUL");
    assert.equal(data.lines.find((l) => l.kind === "reference").reference, "1 Corinthians 15:10");
  });

  test("covers the video with shots and music, gating only the cue with the drop", () => {
    assert.equal(data.shots[0].from, 0);
    assert.equal(data.shots.at(-1).to, data.total);
    assert.equal(data.music[0].from, 0);
    assert.equal(data.music.at(-1).to, data.total);
    assert.deepEqual(data.music.map((m) => m.gated), [false, false, true, false]);
    assert.ok(data.music[0].heartbeat);
    assert.ok(data.heartbeat && data.impact);
  });

  test("overlaps neighbouring music sections for a crossfade", () => {
    const sections = musicSections(project, project.timeline);
    for (let i = 1; i < sections.length; i += 1) assert.ok(sections[i].from < sections[i - 1].to);
  });

  test("shows the end card from the final chant", () => {
    assert.equal(data.endCard.at, data.lines.at(-1).start);
    assert.equal(data.endCard.reference, "1 CORINTHIANS 15:10");
  });

  test("points every voice line at its staged file", () => {
    assert.equal(data.voice.length, project.lines.length);
    assert.equal(data.voice[0].src, "http://127.0.0.1:9/v-l1.wav");
  });
});
