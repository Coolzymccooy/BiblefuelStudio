import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildAss, phrasesFrom } from "./ass.js";
import { studioCaptionFilter } from "./filter.js";
import { EFFECT_IDS } from "./director.js";

const W = (text, start, step = 0.3) => text.split(" ").map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + step }));
const words = [...W("After the rain", 0), ...W("Who still dey", 2), ...W("I still dey", 3.5), ...W("By his grace", 5), ...W("I still dey", 6.5)];

test("nothing to draw gives an empty document and an empty filter", () => {
  assert.equal(buildAss({ words: [], w: 1280, h: 720, look: "studio-lagos-night" }), "");
  assert.deepEqual(studioCaptionFilter({ assPath: "/tmp/x.ass", words: [], w: 1280, h: 720 }), { filter: "", sideFiles: [] });
});

test("the document declares the frame and one Kinetic style, and has events for every phrase", () => {
  const ass = buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 3 });
  assert.match(ass, /PlayResX: 1280\nPlayResY: 720/);
  assert.match(ass, /^Style: Kinetic,/m);
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(events.length >= phrasesFrom({ words }).length);
  // Curve draws one event per letter, so compare the visible text, not raw lines.
  const shown = events.map((l) => l.split(",").slice(9).join(",").replace(/\{[^}]*\}/g, "")).join("").replace(/\s+/g, "");
  for (const t of ["AFTER", "GRACE", "DEY"]) assert.ok(shown.includes(t), t);
});

test("a word carrying a carriage return cannot inject a Dialogue line", () => {
  const evil = "world.\rDialogue: 0,0:00:00.00,0:00:09.00,Kinetic,,0,0,0,,INJECTED\u0000";
  const make = (second) => [...W("hello", 0), { text: second, start: 0.3, end: 0.6 }, ...W("again now", 1)];
  // Same words with the control characters already turned into spaces: the phrase planner sees the same lengths.
  const clean = buildAss({ words: make(evil.replace(/[\x00-\x1f]/g, " ")), w: 1280, h: 720, look: "studio-lagos-night", energy: "lively", seed: 3 });
  const dirty = buildAss({ words: make(evil), w: 1280, h: 720, look: "studio-lagos-night", energy: "lively", seed: 3 });
  const count = (s) => (s.match(/^Dialogue:/gm) || []).length;
  assert.equal(count(dirty), count(clean));
  assert.ok(!dirty.includes("\r") && !dirty.includes("\u0000"));
  const lines = dirty.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(lines.every((l) => !/^Dialogue: 0,0:00:00\.00,0:00:09\.00,Kinetic,,0,0,0,,INJECTED/.test(l)), "the injected event is not a line of its own");
});

test("lines without word timings still animate, words spread across the line", () => {
  const ph = phrasesFrom({ lines: [{ text: "The Lord is my shepherd", start: 1, end: 4 }] });
  assert.equal(ph.length, 1);
  assert.equal(ph[0].words.length, 5);
  assert.equal(ph[0].words[0].start, 1);
  assert.ok(ph[0].words[4].start < 4);
});

test("the same seed is reproducible; overrides reach the director", () => {
  const a = buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 9 });
  assert.equal(buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 9 }), a);
  const forced = buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 9, overrides: { 0: "slam" } });
  assert.ok(forced.includes("\\p1"), "a slam's sparks appear although calm never slams by itself");
});

test("the filter points ffmpeg at the file and the repo fonts, with Windows colons escaped", () => {
  const out = studioCaptionFilter({ assPath: "C:\\work\\job\\captions-x.ass", words, w: 1280, h: 720, look: "studio-clean-white" });
  assert.match(out.filter, /^ass=filename='C\\:\/work\/job\/captions-x\.ass':fontsdir='/);
  assert.equal(out.sideFiles.length, 1);
  assert.equal(out.sideFiles[0].path, "C:\\work\\job\\captions-x.ass");
  assert.match(out.sideFiles[0].text, /^\[Script Info\]/);
});

const lyric = [
  { text: "Fear thou not", start: 0, end: 1.5 }, { text: "I still dey", start: 2, end: 3.5 },
  { text: "By his grace", start: 4, end: 5.5 }, { text: "Hold my hand", start: 6, end: 7.5 },
];

/** Phrase 1's events: it starts at 2 s and phrase 2 at 4 s, so its events start in 2.00..3.99. */
const phraseOne = (ass) => ass.split("\n").filter((l) => /^Dialogue: \d+,0:00:0[23]\.\d\d,/.test(l));
const shownText = (l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
const HIT_FAMILY = "Knewave"; // Lagos Night's hit font

/** What each effect leaves in its events, and nothing else does. */
const FINGERPRINTS = {
  quote: (ev) => ev.some((l) => l.includes("\\t(0,350,\\clip(")),
  slam: (ev) => ev.some((l) => l.includes("\\p1") && !l.includes("\\clip")) && ev.some((l) => l.includes(`\\fn${HIT_FAMILY}`)),
  frame: (ev) => ev.filter((l) => l.includes("\\clip(")).length === 4,
  echo: (ev) => ev.some((l) => /\\frz6\\/.test(l) && l.includes("\\fscx175")),
  title: (ev) => ev.some((l) => l.startsWith("Dialogue: 2,")) && !ev.some((l) => l.includes("\\clip(")),
  curve: (ev) => ev.length >= 6 && ev.every((l) => l.includes("\\pos(") && l.includes("\\frz") && [...shownText(l)].length === 1),
  stack: (ev) => ev.some((l) => l.includes("\\move(") && /\\frz-?[1-9]/.test(l)),
  pop: (ev) => ev.some((l) => l.includes("\\move(")) && ev.filter((l) => l.includes("\\move(")).every((l) => l.includes("\\frz0\\")),
};

test("every effect id renders through buildAss, each with its own fingerprint", () => {
  const make = (overrides) => buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 1, overrides });
  for (const effect of EFFECT_IDS) {
    const ass = make({ 1: effect });
    const events = phraseOne(ass);
    assert.ok(events.length, `${effect} draws phrase 1`);
    assert.ok(FINGERPRINTS[effect](events), `${effect} fingerprint:\n${events.join("\n")}`);
    assert.ok(!/NaN|undefined|Infinity/.test(ass), `${effect} writes only real numbers`);
  }
  // Calm only pops or stacks on its own, so phrase 1 shows none of the other effects.
  const plain = phraseOne(make({}));
  for (const effect of ["quote", "curve", "frame", "title", "echo"]) {
    assert.ok(!FINGERPRINTS[effect](plain), `calm phrase 1 looks like ${effect}:\n${plain.join("\n")}`);
  }
});

const stampSeconds = (stamp) => stamp.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
const dialogue = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

test("a title card opens the video and is gone before the first lyric", () => {
  // The first lyric starts at 4 s here, so there is room for the card.
  const late = lyric.map((l) => ({ ...l, start: l.start + 4, end: l.end + 4 }));
  const ass = buildAss({ lines: late, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "Hold My Hand" });
  const events = dialogue(ass);
  const first = events[0];
  assert.match(first, /^Dialogue: 2,0:00:00\.00,/);
  assert.ok(first.includes("HOLD"));
  const cardEnd = stampSeconds(first.split(",")[2]);
  // The card is two lines (events 0 and 1); everything after is lyric.
  const lyricStarts = events.slice(2).map((l) => stampSeconds(l.split(",")[1]));
  assert.ok(lyricStarts.length > 0);
  assert.ok(cardEnd < Math.min(...lyricStarts), `card ends ${cardEnd} before the first lyric ${Math.min(...lyricStarts)}`);
  const none = buildAss({ lines: late, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "   " });
  assert.equal(none, buildAss({ lines: late, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1 }));
});

test("a title card is skipped when the first lyric starts too soon, and the first phrase is then a plain phrase", () => {
  // The first lyric at 0.3 s leaves under 0.6 s, so no card is drawn. `titleFirst` is off whenever a
  // title was given, so the first phrase is not promoted to the wild title effect either: the video
  // simply opens on the lyric. That is accepted — captions stay in sync with the audio.
  const soon = lyric.map((l) => ({ ...l, start: l.start + 0.3, end: l.end + 0.3 }));
  const ass = buildAss({ lines: soon, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "Morning Glory" });
  const events = dialogue(ass);
  assert.ok(events.length > 0);
  assert.ok(!events.some((l) => /^Dialogue: 2,0:00:00\.00,/.test(l)), "no layer-2 event at 0:00:00.00");
  assert.ok(!events.some((l) => l.includes("MORNING")), "the title text is not drawn");
});

const sha = (text) => createHash("sha256").update(text).digest("hex");
const GOLDEN_LINES = [
  { text: "Be still, and know that I am God:", start: 2, end: 6.5 },
  { text: "I will be exalted among the heathen, I will be exalted in the earth.", start: 6.5, end: 12 },
  { text: "The LORD of hosts is with us", start: 14, end: 17 },
];

test("lines without reveal or holdUntil give byte-identical ASS to before those options existed", () => {
  // Hashes taken from the engine before `reveal`/`holdUntil` were added.
  const make = (energy, lines) => buildAss({ lines, w: 1080, h: 1920, look: "studio-gospel-gold", energy, seed: 3 });
  assert.equal(sha(make("calm", GOLDEN_LINES)), "46274ddb5da76a1fa02f52304b6a7350c1ab6c3866d1b8cae605469aac41ba16");
  assert.equal(sha(make("wild", GOLDEN_LINES)), "254267f654ef7788d3d0ecf6beb0a9551869b8589dd6743dfbb30f4bbcea4540");
  const explicitlyUnset = GOLDEN_LINES.map((l) => ({ ...l, reveal: undefined, holdUntil: undefined }));
  assert.equal(make("calm", explicitlyUnset), make("calm", GOLDEN_LINES));
});

test("reveal spreads a line's words over min(reveal, line length) from its start", () => {
  const text = "one two three four five six seven eight nine ten";
  const [p] = phrasesFrom({ lines: [{ text, start: 10, end: 70, reveal: 4 }] });
  assert.equal(p.start, 10);
  assert.equal(p.end, 70, "the phrase keeps the line's own window");
  assert.equal(p.words[0].start, 10);
  assert.ok(p.words[9].start < 14 && p.words[9].start > 13, `last word lands inside the reveal, at ${p.words[9].start}`);
  assert.ok(p.words.every((w) => w.end <= 14.001));
  const [short] = phrasesFrom({ lines: [{ text, start: 0, end: 2, reveal: 30 }] });
  assert.ok(short.words[9].start < 2, "a reveal longer than the line is capped at the line");
  for (const reveal of [0, -1, NaN, Infinity, "3", null]) {
    const [plain] = phrasesFrom({ lines: [{ text, start: 0, end: 10, reveal }] });
    assert.equal(plain.words[5].start, 5, `reveal ${String(reveal)} is ignored`);
  }
});

test("holdUntil pins where every drawn event of a line ends", () => {
  const lines = [
    { text: "Be still, and know that I am God:", start: 0, end: 60, reveal: 3, holdUntil: 60 },
    { text: "I will be exalted among the heathen", start: 60, end: 120, reveal: 3, holdUntil: 120 },
  ];
  for (const energy of ["calm", "lively"]) {
    for (const seed of [1, 2, 3, 4]) {
      const ass = buildAss({ lines, w: 1080, h: 1920, look: "studio-gospel-gold", energy, seed });
      const drawn = dialogue(ass).filter((l) => !l.includes("\\p1"));
      assert.ok(drawn.length >= 2);
      for (const l of drawn) {
        const [, start, end] = l.split(",");
        const pinned = stampSeconds(start) < 60 ? 60 : 120;
        assert.equal(stampSeconds(end), pinned, `${energy}/${seed}: ${l.slice(0, 60)}`);
      }
    }
  }
});
