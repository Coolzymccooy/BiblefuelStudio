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

  test("a song Whisper never hears still ends within the budget, each window tried twice", async () => {
    const { lines } = parseSheet(sheet);
    const transcribe = async () => ({ words: [{ word: "♪", start: 0, end: 1 }, { word: "Thanks", start: 1, end: 2 }, { word: "for", start: 2, end: 3 }, { word: "watching", start: 3, end: 4 }] });
    const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: async (a, b) => `cut:${a}:${b}` });
    assert.deepEqual(heard, []);
    assert.ok(passes.every((p) => p.status === "rejected" && /nothing/.test(p.reason)));
    const windows = passes.slice(1);
    assert.ok(windows.length >= 4, "tried several windows");
    for (let k = 0; k + 1 < windows.length; k += 2) {
      assert.equal(windows[k + 1].from, windows[k].from);
      assert.ok(windows[k + 1].to - windows[k + 1].from <= 15);
    }
    const audio = DURATION + windows.reduce((sum, p) => sum + (p.to - p.from), 0);
    assert.ok(audio <= 3 * DURATION, `sent ${audio.toFixed(0)} s`);
  });

  test("when a 30 s window no longer fits the audio budget, its 15 s retry still runs", async () => {
    const { lines } = parseSheet(HEAVY);
    const durationSec = 100; // budget 200 s after pass 0: four 30+15 s pairs, then 20 s left
    const sent = [];
    const transcribe = async (file) => {
      if (file !== "song.m4a") { const [, a, b] = file.split(":").map(Number); sent.push(b - a); }
      return { words: [] };
    };
    await transcribeSong({ audioPath: "song.m4a", durationSec, lines, transcribe, cutAudio: async (a, b) => `cut:${a}:${b}` });
    assert.deepEqual(sent, [30, 15, 30, 15, 30, 15, 30, 15, 15]);
  });

  test("everyday English junk in the windows is rejected and places no line", async () => {
    const { lines } = parseSheet(sheet);
    for (const junk of ["I don't know what to say I don't know what to do", "Thank you so much for watching and I will see you in the next video"]) {
      const words = junk.split(" ").map((w, i) => ({ word: w, start: 3 + i * 0.4, end: 3 + i * 0.4 + 0.3 }));
      const transcribe = async (file) => ({ words: file === "song.m4a" ? [] : words });
      const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: async (a, b) => `cut:${a}:${b}` });
      const windows = passes.slice(1);
      assert.ok(windows.length > 0 && windows.every((p) => p.status === "rejected"), `${junk}: ${windows.filter((p) => p.status === "used").length} windows used`);
      const placed = placeLines(lines, heard, { durationSec: DURATION });
      const sure = placed.filter((l) => l.confidence >= 0.6);
      assert.equal(sure.length, 0, `${junk}: placed ${sure.map((l) => `${l.start} ${l.text}`).join(", ")}`);
    }
  });

  test("never sends Whisper more than three times the song's audio", async () => {
    const { lines } = parseSheet(sheet);
    let sent = 0;
    const cutAudio = async (a, b) => `cut:${a}:${b}`;
    const transcribe = async (file) => {
      if (file === "song.m4a") sent += DURATION;
      else { const [, a, b] = file.split(":").map(Number); sent += b - a; }
      return { words: [] };
    };
    const { passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio });
    assert.ok(sent <= 3 * DURATION, `sent ${sent.toFixed(0)} s for a ${DURATION} s song`);
    assert.ok(passes.length >= 3, "still tried some windows");
  });

  test("after an empty first pass the prompts catch up with the song", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes({ first: [] });
    await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, ...f });
    const last = f.calls[f.calls.length - 1];
    // The outro: "Who talk say?" ×2, "Nobody fit stop wetin God don start!", "Eh-yeah!"
    const outro = lines.slice(-4).map((l) => l.text);
    assert.ok(outro.some((t) => last.prompt.startsWith(t)), `last prompt was: ${last.prompt}`);
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

// A worship song made almost entirely of everyday words: what a plain-English gospel sheet looks like.
const HEAVY = `[VERSE]
You are who you are
I am yours and you are mine
Here I am, here I am
All of me is all for you
[CHORUS]
Oh, oh, oh
You are, you are
Now I know that you are here
And I will go where you go
[VERSE]
You are who you are
I am yours and you are mine
Here I am, here I am
All of me is all for you
[CHORUS]
Oh, oh, oh
You are, you are
Now I know that you are here
And I will go where you go`;

/** A transcriber that hears every word exactly: line i starts at leadIn + pace·i s, words 0.45 s apart; ad-libs add "oh yeah" after each line. */
function perfectSinger(lines, { adlib = false, firstPass = true, leadIn = 10, unheard = [], pace = 5 } = {}) {
  const truth = lines.flatMap((l, i) => {
    if (unheard.includes(l.sectionId)) return []; // sung, but Whisper hears none of it
    const t0 = leadIn + i * pace;
    const sung = String(l.text).split(/[\s-]+/).map((w, k) =>({ word: w, start: t0 + k * 0.45, end: t0 + k * 0.45 + 0.4 }));
    return adlib ? [...sung, { word: "oh", start: t0 + 4, end: t0 + 4.3 }, { word: "yeah", start: t0 + 4.4, end: t0 + 4.8 }] : sung;
  });
  const transcribe = async (file) => {
    if (file === "song.m4a") return { words: firstPass ? truth : [] };
    const [, a, b] = file.split(":").map(Number);
    return { words: truth.filter((w) => w.start >= a && w.start < b).map((w) => ({ ...w, start: w.start - a, end: w.end - a })) };
  };
  return { transcribe, cutAudio: async (a, b) => `cut:${a}:${b}` };
}

describe("plain-English lyrics", () => {
  for (const adlib of [false, true]) {
    for (const firstPass of [true, false]) {
      test(`a common-word worship song is timed${adlib ? " through ad-libs" : ""}${firstPass ? "" : " from windows alone"}`, async () => {
        const { lines } = parseSheet(HEAVY);
        const durationSec = 20 + lines.length * 5;
        const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec, lines, ...perfectSinger(lines, { adlib, firstPass }) });
        const placed = placeLines(lines, heard, { durationSec });
        const timed = placed.filter((l, i) => l.confidence >= 0.6 && Math.abs(l.start - (10 + i * 5)) <= 0.3).length;
        const trail = passes.map((p) => `${p.from.toFixed(0)}${p.status[0]}`).join(" ");
        assert.ok(timed >= lines.length - 2, `only ${timed}/${lines.length} lines timed; passes ${trail}`);
      });
    }
  }

  test("a long instrumental intro: the first words heard are the first lines", async () => {
    const { lines } = parseSheet(sheet);
    const leadIn = 50;
    const durationSec = leadIn + lines.length * 5 + 10;
    const { heard } = await transcribeSong({ audioPath: "song.m4a", durationSec, lines, ...perfectSinger(lines, { firstPass: false, leadIn }) });
    const placed = placeLines(lines, heard, { durationSec });
    const timed = placed.filter((l, i) => l.confidence >= 0.6 && Math.abs(l.start - (leadIn + i * 5)) <= 0.3).length;
    assert.ok(timed / lines.length >= 0.85, `only ${timed}/${lines.length} lines timed`);
    assert.ok(Math.abs(placed[0].start - leadIn) <= 0.3, `first line at ${placed[0].start}`);
  });
});

// Verse, chorus, verse, chorus, chorus: the chorus words repeat three times.
const REPEATS = `[VERSE 1]
Morning breaks across the valley floor
Silver rivers running to the shore
Lanterns burning in the window pane
Calling travellers home again
[CHORUS]
Lift me higher carry me through
Every mountain leads to you
Lift me higher carry me through
Every river leads to you
[VERSE 2]
Thunder rolling over distant hills
Broken engines standing still
Paper letters scattered on the floor
Strangers knocking at the door
[CHORUS]
Lift me higher carry me through
Every mountain leads to you
Lift me higher carry me through
Every river leads to you
[CHORUS]
Lift me higher carry me through
Every mountain leads to you
Lift me higher carry me through
Every river leads to you`;

describe("sections Whisper never hears", () => {
  const cases = [
    { name: "verse 2", unheard: ["s3"] },
    { name: "verse 1 and verse 2", unheard: ["s1", "s3"] },
  ];
  // Lead-ins and paces that put a window's first words on the chorus after the unheard verse (seen to fail).
  const timings = [{ leadIn: 0, pace: 6 }, { leadIn: 10, pace: 5 }, { leadIn: 10, pace: 6 }, { leadIn: 23, pace: 6 }];
  for (const { name, unheard } of cases) {
    for (const firstPass of [false, true]) {
      test(`with ${name} unheard${firstPass ? " (first pass hears the rest)" : ""}, no window is taken for a later chorus repeat`, async () => {
        const { lines } = parseSheet(REPEATS);
        for (const { leadIn, pace } of timings) {
          const sungAt = (i) => leadIn + i * pace;
          const durationSec = leadIn + lines.length * pace + 8;
          const singer = perfectSinger(lines, { firstPass, unheard, leadIn, pace });
          const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec, lines, ...singer });
          const placed = placeLines(lines, heard, { durationSec });
          const sung = placed.map((l, i) => ({ l, i })).filter(({ l }) => !unheard.includes(l.sectionId));
          const ok = ({ l, i }) => l.confidence >= 0.6 && Math.abs(l.start - sungAt(i)) <= 0.3;
          const finalChorus = sung.filter(({ l }) => l.sectionId === "s5");
          const where = `lead-in ${leadIn} s, ${pace} s a line; passes ${passes.map((p) => `${p.from.toFixed(0)}${p.status[0]}`).join(" ")}`;
          assert.equal(finalChorus.length, 4);
          assert.ok(finalChorus.every(ok), `final chorus ${finalChorus.map(({ l, i }) => `${l.confidence}@${l.start} (sung ${sungAt(i)})`).join(", ")}; ${where}`);
          assert.equal(sung.filter(ok).length, sung.length, `only ${sung.filter(ok).length}/${sung.length} sung lines timed; ${where}`);
        }
      });
    }
  }
});

describe("a failure part-way carries what was heard", () => {
  test("a failing window keeps pass 0's heard words and passes on the error", async () => {
    const f = fakes();
    const lines = parseSheet(sheet).lines;
    const boom = new Error("Whisper 429: busy");
    let calls = 0;
    const transcribe = async (file, prompt) => { calls += 1; if (calls > 1) throw boom; return f.transcribe(file, prompt); };
    await assert.rejects(
      transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: f.cutAudio }),
      (err) => {
        assert.equal(err, boom);
        assert.ok(err.partial.heard.length > 0, "pass 0's reliable prefix is kept");
        assert.equal(err.partial.passes[0].from, 0);
        assert.ok(err.partial.heard.every((w) => Number.isFinite(w.start)));
        return true;
      },
    );
  });
  test("a failing first pass carries nothing heard", async () => {
    const lines = parseSheet(sheet).lines;
    await assert.rejects(
      transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe: async () => { throw new Error("Whisper 500"); }, cutAudio: async () => "cut" }),
      (err) => { assert.deepEqual(err.partial, { heard: [], passes: [] }); return true; },
    );
  });
});

describe("a window that hears only a repeated hook", () => {
  test("does not carry the frontier to a later section that shares the hook", async () => {
    const { lines } = parseSheet(sheet);
    const singer = perfectSinger(lines, { pace: 4 });
    const stopsAt = 10 + 4 * 30; // pass 0 hears lines 0-29, then the singer goes quiet
    const hook = ["Who", "talk", "say", "Who", "talk", "say", "Who", "talk", "say"].map((word, k) => ({ word, start: 0.5 + k * 0.4, end: 0.8 + k * 0.4 }));
    const prompts = [];
    const transcribe = async (file, prompt) => {
      if (file === "song.m4a") {
        let max = -Infinity; // pass 0 is strictly in order: it is never trimmed at a backwards step
        return { words: (await singer.transcribe(file)).words.filter((w) => w.start < stopsAt && w.start >= max && ((max = w.start), true)) };
      }
      prompts.push(prompt);
      return { words: hook }; // every window hears just the hook, at its start
    };
    await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: singer.cutAudio });
    // Line 56 "WHO TALK SAY?!" and the outro also sing the hook: hearing it ~30 s on proves nothing about line 56.
    const frontierOf = (prompt) => lines.findIndex((l) => prompt.startsWith(l.text));
    assert.ok(prompts.length >= 2, "windows ran after the hook was heard");
    for (const prompt of prompts) {
      assert.ok(frontierOf(prompt) >= 0, `a window prompt starts with no sheet line: ${prompt.slice(0, 40)}`);
      assert.ok(frontierOf(prompt) <= 38, `a window was prompted from line ${frontierOf(prompt)}: ${prompt.slice(0, 40)}`);
    }
  });
});

describe("a backwards step in time", () => {
  const { lines } = parseSheet(sheet);
  const stray = { word: "oh", start: 0.1, end: 0.3 }; // a late word stamped earlier than the words before it
  test("rejects the first full pass whole (it is never trimmed)", async () => {
    const singer = perfectSinger(lines, { pace: 4 });
    const transcribe = async (file) => (file === "song.m4a" ? { words: [...(await singer.transcribe(file)).words, stray] } : { words: [] });
    const { passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: singer.cutAudio });
    assert.equal(passes[0].status, "rejected");
    assert.equal(passes[0].reason, "times out of order");
  });
  test("keeps the words before it in a window", async () => {
    const singer = perfectSinger(lines, { pace: 4, firstPass: false });
    const transcribe = async (file, prompt) => {
      const res = await singer.transcribe(file, prompt);
      return file === "song.m4a" ? res : { words: res.words.length ? [...res.words, stray] : res.words };
    };
    const { passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: DURATION, lines, transcribe, cutAudio: singer.cutAudio });
    assert.ok(passes.slice(1).some((p) => p.status === "used"), "a window with the step is used, not rejected");
  });
});
