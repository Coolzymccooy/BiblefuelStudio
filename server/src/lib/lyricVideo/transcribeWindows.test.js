// server/src/lib/lyricVideo/transcribeWindows.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheet } from "./sheetParser.js";
import { placeLines, normWord } from "./align.js";
import { transcribeSong } from "./transcribeWindows.js";

const DURATION = 181.27;
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const sheet = fs.readFileSync(path.join(FIX, "sheet.txt"), "utf8");
const pass0 = read("passes/pass0-mix.json").words;
// Every window the hand-made video used, merged: the "song" a fake Whisper hears in any window.
// The saved windows only cover 70.5 s to the end; pass 0 is the only record of the first 70 s.
const pool = (() => {
  const all = fs.readdirSync(path.join(FIX, "passes")).filter((f) => f.startsWith("window-"))
    .flatMap((f) => read(`passes/${f}`).words).sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of all) {
    const dup = out.find((o) => normWord(o.word) === normWord(w.word) && Math.abs(o.start - w.start) < 0.25);
    if (!dup) out.push(w);
  }
  return out;
})();

function fakes({ first = pass0 } = {}) {
  const calls = [];
  const cutAudio = async (from, to) => `cut:${from}:${to}`;
  const transcribe = async (file, prompt) => {
    calls.push({ file, prompt });
    if (file === "song.m4a") return { words: first };
    const [, from, to] = file.split(":").map(Number);
    return { words: pool.filter((w) => w.start >= from && w.start < to).map((w) => ({ ...w, start: w.start - from, end: w.end - from })) };
  };
  return { calls, cutAudio, transcribe };
}

/** Hand-checked words, each knowing its line's start and kind. */
function expectedWords() {
  return read("expected-lines.json").flatMap((l) => l.words.map((w, i) => ({ ...w, lineStart: i === 0, lineStartSec: l.start, kind: l.kind })));
}

/** Placed words, each knowing whether its line is a response. */
function placedWordsOf(placed) {
  return placed.flatMap((l) => l.words.map((w) => ({ ...w, kind: l.kind })));
}

/**
 * Pairs placed words with expected words by longest common subsequence on the
 * normalised text (the hand-checked file splits a few lines differently and
 * leaves out one response). A pair whose lines agree on being a response
 * weighs more, so "Who talk say" in a lead is never paired with the same words
 * in a response. Returns, per expected word, the placed word index or -1.
 */
function matchWords(placed, expected) {
  const a = placed.map((w) => normWord(w.text));
  const b = expected.map((w) => normWord(w.text));
  const weight = (i, j) => (a[i] !== b[j] ? -1 : (placed[i].kind === "response") === (expected[j].kind === "response") ? 3 : 2);
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const w = weight(i, j);
      L[i][j] = Math.max(L[i + 1][j], L[i][j + 1], w > 0 ? L[i + 1][j + 1] + w : 0);
    }
  }
  const map = new Array(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const w = weight(i, j);
    if (w > 0 && L[i][j] === L[i + 1][j + 1] + w) { map[j] = i; i += 1; j += 1; }
    else if (L[i + 1][j] >= L[i][j + 1]) i += 1;
    else j += 1;
  }
  return map;
}

describe("transcribeSong on the reference song", () => {
  test("windows recover what the first pass lost, within the acceptance bar", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes();
    const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...f });
    assert.ok(passes.length >= 3, "used several windows");
    assert.ok(f.calls.every((c) => c.prompt.length <= 900));
    const placed = placeLines(lines, heard, { durationSec: DURATION });
    // Compare lead line starts by their first sheet word, against the hand-checked timings.
    const expected = expectedWords();
    const placedWords = placedWordsOf(placed);
    const map = matchWords(placedWords, expected);
    const matched = map.filter((p) => p >= 0).length;
    assert.ok(matched >= expected.length - 5, `only ${matched}/${expected.length} sheet words line up with the hand-checked file`);
    const leadStarts = expected.map((w, k) => ({ w, p: map[k] >= 0 ? placedWords[map[k]] : null }))
      .filter(({ w }) => w.lineStart && w.kind !== "response");
    const misses = leadStarts.filter(({ w, p }) => !p || Math.abs(w.start - p.start) > 0.3);
    const close = leadStarts.length - misses.length;
    const detail = misses.map(({ w, p }) => `  ${w.start.toFixed(2)} → ${p ? p.start.toFixed(2) : "unmatched"}  ${w.text}`).join("\n");
    assert.ok(close / leadStarts.length >= 0.85, `only ${close}/${leadStarts.length} lead lines within 0.3 s\n${detail}`);
  });

  test("an empty first pass still reaches the end and times the lines the windows can hear", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes({ first: [] });
    const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...f });
    assert.equal(passes[0].status, "rejected", "an empty first pass is recorded as rejected");
    const last = passes[passes.length - 1];
    assert.ok(passes.length >= 2 && last.from > 0, "windows ran after the first pass");
    assert.ok(last.to >= DURATION - 1, `windows stopped at ${last.to}`);
    const placed = placeLines(lines, heard, { durationSec: DURATION });
    // The saved windows hold no audio before 70.5 s, so judge only the lines sung after 71 s.
    const expected = expectedWords();
    const placedWords = placedWordsOf(placed);
    const map = matchWords(placedWords, expected);
    const startOf = new Map(map.map((p, k) => [p, expected[k].lineStartSec]).filter(([p]) => p >= 0));
    let wordAt = 0;
    const late = [];
    for (const line of placed) {
      const sec = startOf.get(wordAt);
      if (sec !== undefined && sec >= 71) late.push(line);
      wordAt += line.words.length;
    }
    const heardLines = late.filter((l) => l.confidence >= 0.6).length;
    assert.ok(late.length >= 30, `only ${late.length} lines after 71 s were found`);
    assert.ok(heardLines / late.length >= 0.7, `only ${heardLines}/${late.length} lines after 71 s heard`);
  });

  test("keeps the first pass up to its loop and starts the windows there", async () => {
    const { lines } = parseSheet(sheet);
    const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...fakes() });
    assert.equal(passes[0].status, "used");
    // pass0-mix starts looping "Who talk say" at 75.7 s; everything before the chorus is its own.
    assert.ok(passes[1].from > 65 && passes[1].from < 76, `first window at ${passes[1].from}`);
    assert.equal(heard.filter((w) => w.start < 70).length, pass0.filter((w) => w.start < 70).length);
  });

  test("a song Whisper never hears still ends, each window tried twice", async () => {
    const { lines } = parseSheet(sheet);
    const transcribe = async () => ({ words: [{ word: "♪", start: 0, end: 1 }, { word: "Thanks", start: 1, end: 2 }, { word: "for", start: 2, end: 3 }, { word: "watching", start: 3, end: 4 }] });
    const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: async (a, b) => `cut:${a}:${b}` });
    assert.deepEqual(heard, []);
    assert.ok(passes.every((p) => p.status === "rejected" && /nothing/.test(p.reason)));
    const windows = passes.slice(1);
    for (let k = 0; k + 1 < windows.length; k += 2) {
      assert.equal(windows[k + 1].from, windows[k].from);
      assert.ok(windows[k + 1].to - windows[k + 1].from <= 15);
    }
    assert.ok(windows[windows.length - 1].to >= DURATION - 1);
  });

  test("after an empty first pass the prompts catch up with the song", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes({ first: [] });
    await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...f });
    const last = f.calls[f.calls.length - 1];
    assert.match(last.prompt, /Nobody fit stop wetin God don start!/, `last prompt was: ${last.prompt}`);
  });

  test("windows move on instead of crawling after a looping first pass", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes({ first: read("passes/pass0-vocals.json").words });
    const { passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...f });
    const windows = passes.slice(1);
    const audio = windows.reduce((sum, p) => sum + (p.to - p.from), 0);
    assert.ok(audio <= 2 * DURATION, `windows heard ${audio.toFixed(0)} s of a ${DURATION} s song`);
    for (let k = 1; k < windows.length; k += 1) {
      if (windows[k].from === windows[k - 1].from) continue; // the narrower retry of the same window
      assert.ok(windows[k].from - windows[k - 1].from >= 5, `window at ${windows[k].from} only ${(windows[k].from - windows[k - 1].from).toFixed(1)} s after the last`);
    }
  });

  test("reports progress for each window", async () => {
    const { lines } = parseSheet(sheet);
    const seen = [];
    await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...fakes(), onProgress: (p) => seen.push(p) });
    assert.ok(seen.length >= 2 && seen.every((p) => typeof p.window === "number"));
  });
});
