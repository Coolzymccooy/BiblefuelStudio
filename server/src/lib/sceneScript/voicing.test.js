import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseSceneScript } from "./parse.js";
import { defaultCast, normaliseCast, deliveryForLine, DEFAULT_ENSEMBLE, isVoiceName } from "./cast.js";
import { speakableText, ssmlFor, numberToWords, audioKey } from "./speech.js";
import { computeTimeline, gapAfter, GAP } from "./timeline.js";
import { alignWords, spreadWords } from "./align.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { script } = parseSceneScript(fs.readFileSync(path.join(here, "__fixtures__", "grace-made-me.md"), "utf8"));

describe("defaultCast", () => {
  test("casts the fixture as the prototype did", () => {
    const cast = defaultCast(script);
    assert.equal(cast.Narrator.voice, "en-US-Davis:DragonHDLatestNeural");
    assert.equal(cast.Scripture.voice, "en-US-Ava:DragonHDLatestNeural");
    assert.equal(cast.Ensemble.ensemble.length, DEFAULT_ENSEMBLE.length);
  });

  test("gives a new speaker a voice from its name", () => {
    const cast = defaultCast({ speakers: [{ name: "Child" }, { name: "Mother" }, { name: "Pastor" }], voiceHints: {} });
    assert.equal(cast.Child.voice, "en-US-AnaNeural");
    assert.equal(cast.Mother.voice, "en-US-Ava:DragonHDLatestNeural");
    assert.equal(cast.Pastor.voice, "en-US-Andrew:DragonHDLatestNeural");
  });

  test("drops child voices when the ensemble is adults only", () => {
    const cast = defaultCast({ speakers: [], voiceHints: { Ensemble: { adults: true, children: false } } });
    assert.ok(cast.Ensemble.ensemble.every((l) => !/Ana|Maisie/.test(l.voice)));
  });
});

describe("normaliseCast", () => {
  const current = defaultCast(script);

  test("applies a valid edit and keeps the rest", () => {
    const next = normaliseCast({ Narrator: { voice: "en-NG-AbeoNeural", rate: "-10%" } }, current);
    assert.equal(next.Narrator.voice, "en-NG-AbeoNeural");
    assert.equal(next.Narrator.rate, "-10%");
    assert.equal(next.Scripture.voice, current.Scripture.voice);
  });

  test("rejects bad voices, out-of-range rates and unknown speakers", () => {
    const next = normaliseCast({ Narrator: { voice: "<script>", rate: "-90%" }, Stranger: { voice: "en-US-AnaNeural" } }, current);
    assert.equal(next.Narrator.voice, current.Narrator.voice);
    assert.equal(next.Narrator.rate, "-50%");
    assert.equal(next.Stranger, undefined);
  });

  test("clamps ensemble offsets and caps the layer count", () => {
    const layers = Array.from({ length: 20 }, () => ({ voice: "en-US-AnaNeural", offsetMs: 9999 }));
    const next = normaliseCast({ Ensemble: { ensemble: layers, room: "stadium" } }, current);
    assert.equal(next.Ensemble.ensemble.length, 12);
    assert.equal(next.Ensemble.ensemble[0].offsetMs, 400);
    assert.equal(next.Ensemble.room, "hall");
  });

  test("never mutates the cast it was given", () => {
    const before = JSON.stringify(current);
    normaliseCast({ Narrator: { voice: "en-NG-AbeoNeural" } }, current);
    assert.equal(JSON.stringify(current), before);
  });
});

describe("deliveryForLine", () => {
  const cast = defaultCast(script);
  test("uses the line's own voice over its speaker's", () => {
    const d = deliveryForLine({ speaker: "Narrator", voice: "en-NG-AbeoNeural", rate: "+5%" }, cast);
    assert.deepEqual(d, { voice: "en-NG-AbeoNeural", rate: "+5%", pitch: "0%" });
  });
  test("falls back to the narrator for an unknown speaker", () => {
    assert.equal(deliveryForLine({ speaker: "Ghost" }, cast).voice, cast.Narrator.voice);
  });
  test("returns the ensemble for a chant", () => {
    assert.ok(Array.isArray(deliveryForLine({ speaker: "Ensemble", kind: "chant" }, cast).ensemble));
  });
  test("accepts HD and standard neural names only", () => {
    assert.ok(isVoiceName("en-US-Davis:DragonHDLatestNeural"));
    assert.ok(isVoiceName("en-NG-AbeoNeural"));
    assert.ok(!isVoiceName("en-US-Davis\" onload=\""));
  });
});

describe("speakableText", () => {
  test("keeps the author's words and only changes how capitals are sent", () => {
    assert.equal(speakableText({ text: "NOT BY MY STRENGTH." }), "Not by my strength.");
    assert.equal(speakableText({ text: "BUT BY THE GRACE OF GOD!" }), "But by the grace of god!");
    assert.equal(speakableText({ text: "You may see strength." }), "You may see strength.");
    assert.equal(speakableText({ text: "I AM" }), "I AM");
  });

  test("reads a printed reference out only on a reference line", () => {
    assert.equal(speakableText({ kind: "reference", text: "1 Corinthians 15:10" }), "First Corinthians, chapter fifteen, verse ten.");
    assert.equal(speakableText({ kind: "narration", text: "Read 1 Corinthians 15:10 today" }), "Read 1 Corinthians 15:10 today");
  });

  test("spells numbers", () => {
    assert.equal(numberToWords(119), "one hundred and nineteen");
    assert.equal(numberToWords(23), "twenty-three");
  });

  test("escapes text and voice into SSML", () => {
    const x = ssmlFor({ voice: "en-NG-AbeoNeural", rate: "-6%", text: "Grace & <peace>" });
    assert.match(x, /xml:lang="en-NG"/);
    assert.match(x, /Grace &amp; &lt;peace&gt;/);
    assert.match(x, /<prosody rate="-6%" pitch="0%">/);
  });

  test("audioKey changes with any heard part", () => {
    assert.notEqual(audioKey({ v: "a", t: "x" }), audioKey({ v: "a", t: "y" }));
    assert.equal(audioKey({ v: "a", t: "x" }), audioKey({ v: "a", t: "x" }));
  });
});

describe("computeTimeline", () => {
  const durations = Object.fromEntries(script.lines.map((l) => [l.id, 2]));
  const tl = computeTimeline(script, durations);

  test("starts after the intro and runs lines end to end", () => {
    assert.equal(tl.lines[0].start, 1.6);
    for (let i = 1; i < tl.lines.length; i += 1) {
      const prev = tl.lines[i - 1];
      assert.ok(Math.abs(tl.lines[i].start - (prev.start + prev.dur + prev.gap)) < 0.002);
    }
    assert.deepEqual(tl.missing, []);
  });

  test("makes scenes contiguous from zero to the end", () => {
    assert.equal(tl.scenes[0].start, 0);
    for (let i = 1; i < tl.scenes.length; i += 1) assert.equal(tl.scenes[i].start, tl.scenes[i - 1].end);
    assert.equal(tl.scenes.at(-1).end, tl.total);
  });

  test("places the drop between the line before it and the hit", () => {
    const hit = tl.lines.find((l) => l.id === "l28");
    const before = tl.lines.find((l) => l.id === "l27");
    assert.deepEqual(tl.drop, { from: +(before.start + before.dur).toFixed(3), to: hit.start });
    assert.equal(before.gap, GAP.beforeDrop);
  });

  test("uses the prototype's pauses", () => {
    const line = (t) => script.lines.find((l) => l.text === t);
    assert.equal(gapAfter(line("Look at me today…")), 0.65);
    assert.equal(gapAfter(line("The grace of God."), { lastInScene: true }), 1.35);
    assert.equal(gapAfter(script.lines.at(-1), { lastLine: true }), 3);
    assert.equal(gapAfter({ text: "x", gapAfter: 2.5 }), 2.5);
  });

  test("reports lines with no audio yet", () => {
    assert.deepEqual(computeTimeline(script, { ...durations, l3: 0 }).missing, ["l3"]);
  });
});

describe("alignWords", () => {
  test("keeps the script's words and takes the provider's timing", () => {
    const heard = [
      { text: "Look", start: 0.1, end: 0.3 }, { text: "at", start: 0.3, end: 0.4 },
      { text: "me", start: 0.4, end: 0.5 }, { text: "today", start: 0.5, end: 0.9 },
    ];
    assert.deepEqual(alignWords("Look at me today…", heard, 1.2).map((w) => [w.text, w.start, w.end]), [
      ["Look", 0.1, 0.3], ["at", 0.3, 0.4], ["me", 0.4, 0.5], ["today…", 0.5, 0.9],
    ]);
  });

  test("joins a word the provider split", () => {
    const heard = [{ text: "self", start: 0.5, end: 0.7 }, { text: "made", start: 0.7, end: 1.0 }];
    const words = alignWords("self-made", heard, 1.2);
    assert.deepEqual(words, [{ text: "self-made", start: 0.5, end: 1 }]);
  });

  test("spreads by length when the provider's words do not match", () => {
    const words = alignWords("Grace upon grace", [{ text: "something", start: 0, end: 1 }], 2);
    assert.deepEqual(words, spreadWords("Grace upon grace", 2));
    assert.equal(words.length, 3);
  });
});
