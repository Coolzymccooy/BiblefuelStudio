import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEED_MAX, normaliseSeed, timedLinePhrases, prepareStudioCaptions } from "./renderCaptions.js";
import { hasLibass, _setLibassForTest } from "./capability.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "studio-caps-"));

test("normaliseSeed keeps a valid integer seed", () => {
  assert.equal(normaliseSeed(42), 42);
  assert.equal(normaliseSeed("42"), 42);
  assert.equal(normaliseSeed(0), 0);
  assert.equal(normaliseSeed(SEED_MAX), SEED_MAX);
});

test("normaliseSeed replaces anything else with a random integer in range", () => {
  for (const bad of [-1, 1.5, "abc", "", null, undefined, true, SEED_MAX + 1, " 7 x"]) {
    const n = normaliseSeed(bad);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= SEED_MAX, `${String(bad)} -> ${n}`);
  }
});

test("timedLinePhrases cuts a line into phrases of at most 5 words and shares time by length", () => {
  assert.deepEqual(timedLinePhrases(["Be still and know that I am God"], 10), [
    { text: "Be still and know that", start: 0, end: 7.333 },
    { text: "I am God", start: 7.333, end: 10 },
  ]);
});

test("timedLinePhrases keeps a phrase within 28 characters", () => {
  assert.deepEqual(
    timedLinePhrases(["Unsearchable riches of Christ forever"], 6).map((p) => p.text),
    ["Unsearchable riches of", "Christ forever"],
  );
});

test("timedLinePhrases never joins two lines into one phrase", () => {
  assert.deepEqual(timedLinePhrases(["Peace", "be still"], 4), [
    { text: "Peace", start: 0, end: 1.538 },
    { text: "be still", start: 1.538, end: 4 },
  ]);
});

test("timedLinePhrases accepts {text} lines, collapses spaces and skips blanks", () => {
  assert.deepEqual(
    timedLinePhrases([{ text: "  Grace   upon grace " }, "", "   ", null], 3).map((p) => p.text),
    ["Grace upon grace"],
  );
});

test("timedLinePhrases gives a word longer than 28 characters its own phrase", () => {
  const long = "Pneumonoultramicroscopicsilicovolcano";
  assert.deepEqual(timedLinePhrases([`${long} dust`], 2).map((p) => p.text), [long, "dust"]);
});

test("timedLinePhrases returns nothing without lines or a positive duration", () => {
  assert.deepEqual(timedLinePhrases([], 5), []);
  assert.deepEqual(timedLinePhrases(["Peace"], 0), []);
  assert.deepEqual(timedLinePhrases(["Peace"], Number.NaN), []);
  assert.deepEqual(timedLinePhrases(undefined, 5), []);
});

test("a non-Studio preset stays on drawtext, unchanged, and writes nothing", () => {
  const dir = tmp();
  const assPath = path.join(dir, "c.ass");
  const out = prepareStudioCaptions({ preset: "hero-bold", assPath, lines: ["Peace"], durationSec: 2, w: 720, h: 1280, libass: true });
  assert.deepEqual(out, { mode: "drawtext", preset: "hero-bold" });
  assert.equal(fs.existsSync(assPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a Studio look without libass draws with its fallback preset", () => {
  const out = prepareStudioCaptions({ preset: "studio-lagos-night", assPath: "unused.ass", lines: ["Peace"], durationSec: 2, w: 720, h: 1280, libass: false });
  assert.deepEqual(out, { mode: "drawtext", preset: "marker" });
});

test("a Studio look with libass writes the .ass file and returns one ass filter", () => {
  const dir = tmp();
  const assPath = path.join(dir, "c.ass");
  // Calm only pops and stacks, which keep each word whole (curve splits letters).
  const out = prepareStudioCaptions({ preset: "studio-lagos-night", assPath, lines: ["Be still and know"], durationSec: 4, w: 720, h: 1280, energy: "calm", seed: 1, libass: true });
  assert.equal(out.mode, "studio");
  assert.match(out.filter, /^ass=filename='/);
  assert.deepEqual(out.files, [assPath]);
  const doc = fs.readFileSync(assPath, "utf8");
  assert.match(doc, /^Dialogue:/m);
  assert.match(doc, /still/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("timed words win over lines", () => {
  const dir = tmp();
  const assPath = path.join(dir, "c.ass");
  prepareStudioCaptions({
    preset: "studio-lagos-night", assPath, w: 720, h: 1280, energy: "calm", seed: 1, libass: true,
    words: [{ text: "grace", start: 0, end: 1 }], lines: ["mercy"], durationSec: 2,
  });
  const doc = fs.readFileSync(assPath, "utf8");
  assert.match(doc, /grace/i);
  assert.doesNotMatch(doc, /mercy/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a failed .ass write falls back to drawtext instead of failing the render", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const assPath = path.join(os.tmpdir(), `no-such-dir-${Date.now()}`, "c.ass");
    const out = prepareStudioCaptions({ preset: "studio-gospel-gold", assPath, lines: ["Peace"], durationSec: 2, w: 720, h: 1280, libass: true });
    assert.deepEqual(out, { mode: "drawtext", preset: "scripture-emphasis" });
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /studio fallback/);
  } finally {
    warn.mock.restore();
  }
});

/** The .ass text prepareStudioCaptions writes for `opts` (seed 1, fixed lines). */
function assFor(opts) {
  const dir = tmp();
  const assPath = path.join(dir, "c.ass");
  try {
    prepareStudioCaptions({
      preset: "studio-lagos-night", assPath, w: 720, h: 1280, seed: 1, libass: true,
      lines: ["Be still and know that I am God", "Peace be still"], durationSec: 6, ...opts,
    });
    return fs.readFileSync(assPath, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("an unknown energy falls back to defaultEnergy", () => {
  assert.equal(assFor({ energy: "loud", defaultEnergy: "calm" }), assFor({ energy: "calm" }));
});

test("without an energy, defaultEnergy is used", () => {
  assert.equal(assFor({ defaultEnergy: "wild" }), assFor({ energy: "wild" }));
});

test("invalid words are dropped, and with none left the lines are used", () => {
  const doc = assFor({
    energy: "calm",
    words: [
      { text: "", start: 0, end: 1 },
      { text: "   ", start: 0, end: 1 },
      { text: "grace", start: Number.NaN, end: 1 },
      { text: "favour", start: 0, end: Number.POSITIVE_INFINITY },
      { start: 0, end: 1 },
      null,
    ],
    lines: ["mercy"],
  });
  assert.match(doc, /mercy/i);
  assert.doesNotMatch(doc, /grace|favour/i);
});

test("a non-Studio preset never probes ffmpeg for libass", (t) => {
  if (!hasLibass()) return t.skip("ffmpeg here has no libass");
  const saved = process.env.FFMPEG_PATH;
  t.after(() => {
    if (saved === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved;
    _setLibassForTest(undefined);
  });
  // Forget the answer and point the probe at a missing binary: a probe now
  // would cache false.
  _setLibassForTest(undefined);
  process.env.FFMPEG_PATH = path.join(os.tmpdir(), "no-such-ffmpeg-binary");
  const out = prepareStudioCaptions({ preset: "hero-bold", assPath: "unused.ass", lines: ["Peace"], durationSec: 2, w: 720, h: 1280 });
  assert.deepEqual(out, { mode: "drawtext", preset: "hero-bold" });
  if (saved === undefined) delete process.env.FFMPEG_PATH;
  else process.env.FFMPEG_PATH = saved;
  assert.equal(hasLibass(), true, "the non-Studio call must not have cached a probe");
});

test("a Studio look with no libass argument asks the probe", (t) => {
  t.after(() => _setLibassForTest(undefined));
  _setLibassForTest(false);
  const out = prepareStudioCaptions({ preset: "studio-lagos-night", assPath: "unused.ass", lines: ["Peace"], durationSec: 2, w: 720, h: 1280 });
  assert.deepEqual(out, { mode: "drawtext", preset: "marker" });
});

test("nothing timed gives an empty studio filter and no file", () => {
  const dir = tmp();
  const assPath = path.join(dir, "c.ass");
  const out = prepareStudioCaptions({ preset: "studio-clean-white", assPath, words: [], lines: [], durationSec: 3, w: 720, h: 1280, libass: true });
  assert.deepEqual(out, { mode: "studio", filter: "", files: [] });
  assert.equal(fs.existsSync(assPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
