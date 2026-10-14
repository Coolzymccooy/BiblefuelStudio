// server/src/lib/lyricVideo/alignJob.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createProject, readProject, writeProject, updateProject, deleteProject, applySheet } from "./projectStore.js";
import { runAlignJob, isAligning, explainFailure } from "./alignJob.js";
import { decodeMono } from "./beats.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-job-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const SHEET = "[INTRO]\nMy time no late\n[CHORUS]\nWho talk say?\n(WHO TALK SAY?!)";
function setup() {
  let p = createProject(dir, { title: "T", artist: "A" });
  p = applySheet(p, SHEET);
  p.song = { file: path.join(dir, "song.m4a"), durationSec: 20 };
  return writeProject(dir, p);
}
const heardSong = [
  { word: "My", start: 1, end: 1.3 }, { word: "time", start: 1.3, end: 1.6 }, { word: "no", start: 1.6, end: 1.9 }, { word: "late", start: 1.9, end: 2.4 },
  { word: "Who", start: 5, end: 5.3 }, { word: "talk", start: 5.3, end: 5.6 }, { word: "say", start: 5.6, end: 6 },
];
const PREPARED = () => path.join(dir, "prepared.m4a");
/** Hears the song only in the full prepared file; a cut window returns times relative to its cut, so a fake must not hand back song-time words for it. */
const hearsFullSong = (onCall) => async (file, prompt) => {
  await onCall?.(file, prompt);
  return { words: file === PREPARED() ? heardSong : [] };
};
const deps = (over = {}) => ({
  prepareAudio: async () => PREPARED(),
  cutAudio: async (from, to) => `cut:${from}:${to}`,
  transcribe: hearsFullSong(),
  detectBeats: async () => ({ bpm: 120, times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] }),
  measureAudibleEnd: async (_file, durationSec) => durationSec,
  log: () => {},
  ...over,
});
const run = (p, over) => runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId, deps: deps(over) });

test("places lines, sets section starts on the beat, stores beats", async () => {
  const p = setup();
  const done = await run(p);
  assert.equal(done.timing.status, "done");
  assert.equal(done.timing.progress, null);
  assert.equal(done.lines[0].start, 1);
  assert.equal(done.lines[1].start, 5);
  assert.equal(done.lines[2].kind, "response");
  assert.equal(done.lines[2].flag, "check");
  assert.equal(done.sections[1].start, 4.5); // 5 minus half a beat (0.25) snapped to the grid
  assert.equal(done.timing.beats.bpm, 120);
  assert.ok(Array.isArray(done.timing.passes) && done.timing.passes.length >= 1);
  assert.equal(readProject(dir, p.projectId).timing.status, "done");
  assert.equal(isAligning(p.projectId), false);
});

test("saves progress into the project while it runs", async () => {
  const p = setup();
  const seen = [];
  await run(p, { transcribe: hearsFullSong(() => seen.push(readProject(dir, p.projectId).timing)) });
  assert.equal(seen[0].status, "running");
  assert.equal(seen[0].progress.step, "listening");
  const windowed = seen.find((t) => t.progress?.window);
  assert.ok(windowed, "a window's progress was saved");
  assert.ok(windowed.progress.total >= windowed.progress.window);
});

test("with no beat found, section starts are the first line's start, unsnapped", async () => {
  const p = setup();
  const done = await run(p, { detectBeats: async () => ({ bpm: 0, times: [] }) });
  assert.equal(done.timing.status, "done");
  assert.equal(done.sections[1].start, 5);
  assert.equal(done.sections[0].start, 1);
  assert.deepEqual(done.timing.beats, { bpm: 0, times: [] });
});

test("a beat failure does not lose the placements", async () => {
  const p = setup();
  const logged = [];
  const done = await run(p, { detectBeats: async () => { throw new Error("ffmpeg decode exited 1: boom"); }, log: (...a) => logged.push(a.join(" ")) });
  assert.equal(done.timing.status, "done");
  assert.equal(done.timing.error, null);
  assert.equal(done.lines[1].start, 5);
  assert.equal(done.sections[1].start, 5, "unsnapped, as when no beat is found");
  assert.deepEqual(done.timing.beats, { bpm: 0, times: [] });
  assert.ok(logged.some((l) => l.includes(p.projectId) && l.includes("boom")));
});

test("a section never starts after its first line", async () => {
  const p = setup();
  const done = await run(p, { detectBeats: async () => ({ bpm: 120, times: [0, 6] }) });
  assert.equal(done.lines[1].start, 5);
  assert.equal(done.sections[1].start, 5); // the nearest beat to 4.75 is 6, which is after the line
  assert.ok(done.sections.every((s, i) => s.start <= done.lines.find((l) => l.sectionId === s.id).start));
});

describe("vocals from the laptop", () => {
  const SONG = () => path.join(dir, "song.m4a");
  const VOCALS = () => path.join(dir, "lyric-vocals-x.m4a");
  const MIX_PREPARED = () => path.join(dir, "prepared-mix.m4a");
  /** Prepares the vocals file to PREPARED() and the song to a different file, and records every input. */
  let currentProject = null;
  const projectIdOf = () => currentProject.projectId;
  const spy = () => {
    const calls = { prepared: [], measured: [], beats: [], steps: [], stepAtPrepare: [], logged: [] };
    return {
      calls,
      over: (extra = {}) => ({
        prepareAudio: async (input) => {
          calls.prepared.push(input);
          calls.stepAtPrepare.push(readProject(dir, projectIdOf())?.timing?.progress?.step);
          return input === VOCALS() ? PREPARED() : MIX_PREPARED();
        },
        measureAudibleEnd: async (file, durationSec) => { calls.measured.push(file); return durationSec; },
        detectBeats: async (file) => { calls.beats.push(file); return { bpm: 0, times: [] }; },
        // The mix is also heard in full when no vocals came, so either prepared file answers with the song's words.
        transcribe: async (file) => ({ words: file === PREPARED() || file === MIX_PREPARED() ? heardSong : [] }),
        log: (...a) => calls.logged.push(a.join(" ")),
        ...extra,
      }),
    };
  };
  const makeSongFiles = () => { fs.writeFileSync(SONG(), "the user's own song"); };

  test("timing listens to the vocals when the laptop returns them", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({
      vocalStem: async (song, { onQueued }) => {
        assert.equal(song, SONG(), "the laptop is asked to separate the user's song");
        onQueued(); // a job is really waiting on the laptop now
        s.calls.steps.push(readProject(dir, p.projectId).timing.progress.step);
        fs.writeFileSync(VOCALS(), "voice only");
        return VOCALS();
      },
    }));
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.usedVocalStem, true);
    assert.deepEqual(s.calls.steps, ["vocals"], "the user sees the separating step while the laptop works");
    assert.equal(s.calls.stepAtPrepare[0], "preparing", "and the normal step again once the wait is over");
    assert.ok(s.calls.prepared.includes(VOCALS()), "the vocals were prepared for transcription");
    assert.equal(done.lines[0].start, 1, "the words were heard in the file made from the vocals");
    assert.equal(done.lines[1].start, 5);
    assert.deepEqual(s.calls.measured, [MIX_PREPARED()], "where the music ends is measured on the mix, not the vocals");
    assert.deepEqual(s.calls.beats, [SONG()], "beats come from the original song");
    assert.equal(fs.existsSync(VOCALS()), false, "the vocals file is deleted after the job");
    assert.equal(fs.readFileSync(SONG(), "utf8"), "the user's own song", "the user's song is never touched");
  });

  test("no capable laptop → no wait, timing runs on the mix", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({ vocalStem: async () => null }));
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.usedVocalStem, false);
    assert.deepEqual(s.calls.prepared, [SONG()], "only the song was prepared");
    assert.deepEqual(s.calls.measured, [MIX_PREPARED()]);
    assert.equal(done.lines[1].start, 5);
    assert.equal(fs.readFileSync(SONG(), "utf8"), "the user's own song");
  });

  test("the user is never told about the laptop when none was asked", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const seen = [];
    const done = await run(p, s.over({
      vocalStem: async () => { seen.push(readProject(dir, p.projectId).timing.progress.step); return null; }, // onQueued is never called
      transcribe: async (file) => { seen.push(readProject(dir, p.projectId).timing.progress.step); return { words: file === PREPARED() || file === MIX_PREPARED() ? heardSong : [] }; },
      measureAudibleEnd: async (_f, durationSec) => { seen.push(readProject(dir, p.projectId).timing.progress.step); return durationSec; },
    }));
    assert.equal(done.timing.status, "done");
    assert.deepEqual([...s.calls.stepAtPrepare, ...seen].filter((x) => x === "vocals"), [], "no step ever said vocals");
    assert.deepEqual(s.calls.stepAtPrepare, ["preparing"]);
    assert.deepEqual(seen.slice(0, 2), ["preparing", "preparing"], "the vocal-stem step and the end measurement ran under the normal step");
  });

  test("the vocals step is shown when the queue job is made, even if the laptop then fails", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const seen = [];
    const done = await run(p, s.over({
      vocalStem: async (_song, { onQueued }) => { onQueued(); seen.push(readProject(dir, p.projectId).timing.progress.step); throw new Error("laptop gone"); },
    }));
    assert.equal(done.timing.status, "done");
    assert.deepEqual(seen, ["vocals"]);
    assert.equal(s.calls.stepAtPrepare[0], "preparing", "a failed wait does not leave the vocals message up");
  });

  test("a vocal-stem error never fails timing, and is logged once", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({ vocalStem: async () => { throw new Error("laptop gone"); } }));
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.error, null);
    assert.equal(done.timing.usedVocalStem, false);
    assert.deepEqual(s.calls.prepared, [SONG()]);
    assert.equal(s.calls.logged.filter((l) => l.includes("laptop gone")).length, 1);
  });

  test("the default step, with no signed-in user to ask on behalf of, skips the laptop", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    // No vocalStem override: the real default runs with no userId, so it must answer "no vocals" without touching the queue.
    const done = await run(p, s.over());
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.usedVocalStem, false);
  });

  test("the vocals file is deleted when timing fails after using it", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({
      vocalStem: async () => { fs.writeFileSync(VOCALS(), "voice only"); return VOCALS(); },
      transcribe: async (file) => { if (file === PREPARED()) return { words: heardSong }; throw new Error("Whisper 503: down"); },
    }));
    assert.equal(done.timing.status, "error");
    assert.equal(fs.existsSync(VOCALS()), false);
    assert.equal(fs.existsSync(SONG()), true);
  });

  test("vocals that cannot be prepared are skipped, not fatal, and still deleted", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({
      vocalStem: async () => { fs.writeFileSync(VOCALS(), "not audio"); return VOCALS(); },
      prepareAudio: async (input) => {
        s.calls.prepared.push(input);
        if (input === VOCALS()) throw new Error("ffmpeg exited 1: broken vocals");
        return PREPARED();
      },
    }));
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.usedVocalStem, false, "it fell back to the mix");
    assert.equal(done.lines[1].start, 5);
    assert.equal(fs.existsSync(VOCALS()), false);
    assert.equal(s.calls.logged.filter((l) => l.includes("broken vocals")).length, 1);
  });

  test("a vocals path that is the song itself is never deleted", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    await run(p, s.over({ vocalStem: async () => SONG() }));
    assert.equal(fs.readFileSync(SONG(), "utf8"), "the user's own song");
  });

  test("a project deleted during the wait for a queued laptop job stops the job and still removes the vocals", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({
      vocalStem: async (_song, { onQueued }) => {
        onQueued();
        fs.writeFileSync(VOCALS(), "voice only");
        deleteProject(dir, p.projectId); // the user deletes the project while the laptop works
        return VOCALS();
      },
    }));
    assert.equal(done, null, "the job ends as project-gone");
    assert.equal(fs.existsSync(VOCALS()), false, "the vocals file is not orphaned");
    assert.equal(fs.readFileSync(SONG(), "utf8"), "the user's own song");
    assert.deepEqual(s.calls.prepared, [], "nothing more was prepared for a deleted project");
  });

  test("a project deleted while the laptop works stops the job and still removes the vocals", async () => {
    const p = setup();
    currentProject = p;
    makeSongFiles();
    const s = spy();
    const done = await run(p, s.over({
      vocalStem: async () => { fs.writeFileSync(VOCALS(), "voice only"); deleteProject(dir, p.projectId); return VOCALS(); },
    }));
    assert.equal(done, null);
    assert.equal(fs.existsSync(VOCALS()), false);
  });
});

describe("a Whisper failure part-way keeps what was heard", () => {
  const failOnWindows = () => ({ transcribe: async (file) => { if (file === PREPARED()) return { words: heardSong }; throw new Error("Whisper 429: busy"); } });
  test("429 on the first window: pass 0's lines keep their times and the status is error", async () => {
    const p = setup();
    const done = await run(p, failOnWindows());
    assert.equal(done.timing.status, "error");
    assert.match(done.timing.error, /busy/);
    assert.equal(done.lines[0].start, 1);
    assert.equal(done.lines[1].start, 5);
    assert.ok(Array.isArray(done.timing.passes) && done.timing.passes.length >= 1);
    assert.deepEqual(readProject(dir, p.projectId).lines, done.lines);
  });
  test("a line locked mid-job still wins", async () => {
    const p = setup();
    const done = await run(p, {
      transcribe: async (file) => {
        if (file !== PREPARED()) {
          updateProject(dir, p.projectId, (l) => ({ ...l, lines: l.lines.map((x, i) => (i === 0 ? { ...x, locked: true, start: 0.2, end: 0.9, words: [{ text: "My", start: 0.2, end: 0.9 }] } : x)) }));
          throw new Error("Whisper 429: busy");
        }
        return { words: heardSong };
      },
    });
    assert.equal(done.timing.status, "error");
    assert.equal(done.lines[0].start, 0.2);
    assert.equal(done.lines[1].start, 5);
  });
  test("lyrics changed before the failure: the lyrics-changed error, no placements", async () => {
    const p = setup();
    let mid = null;
    const done = await run(p, {
      transcribe: async (file) => {
        if (file !== PREPARED()) {
          updateProject(dir, p.projectId, (l) => applySheet(l, "[INTRO]\nSomething else entirely"));
          mid = readProject(dir, p.projectId);
          throw new Error("Whisper 429: busy");
        }
        return { words: heardSong };
      },
    });
    assert.equal(done.timing.error, "The lyrics changed while timing ran — run timing again.");
    assert.deepEqual(done.lines, mid.lines);
  });
  test("a deleted project ends silently", async () => {
    const p = setup();
    const done = await run(p, { transcribe: async (file) => { if (file !== PREPARED()) { deleteProject(dir, p.projectId); throw new Error("Whisper 429: busy"); } return { words: heardSong }; } });
    assert.equal(done, null);
    assert.equal(readProject(dir, p.projectId), null);
  });
});

describe("failures are stored in plain English, with the detail in the log", () => {
  const cases = [
    ["Whisper 429: rate limited", /busy/],
    ["Whisper 503: upstream", /problem/],
    ["Whisper 401: bad key", /key/],
    ["OPENAI_API_KEY is not set on the server", /not set up/],
    ["ffmpeg exited 1: Invalid data found when processing input", /audio/],
    ["fetch failed", /reach/],
  ];
  for (const [raw, expected] of cases) {
    test(raw, async () => {
      const p = setup();
      const logged = [];
      const done = await run(p, { transcribe: async () => { throw new Error(raw); }, log: (...a) => logged.push(a.join(" ")) });
      assert.equal(done.timing.status, "error");
      assert.match(done.timing.error, expected);
      assert.doesNotMatch(done.timing.error, /Whisper|ffmpeg|OPENAI|\d{3}/);
      assert.ok(logged.some((l) => l.includes(p.projectId) && l.includes(raw)), "the log names the project and keeps the detail");
      assert.equal(isAligning(p.projectId), false);
    });
  }
  test("a Whisper timeout", async () => {
    assert.match(explainFailure(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })), /too long/);
  });
  test("an unknown failure still gets a plain message", async () => {
    assert.match(explainFailure(new Error("x is not a function")), /run it again/);
  });
  test("a failure keeps the lines as they were", async () => {
    const p = setup();
    const before = readProject(dir, p.projectId).lines;
    const done = await run(p, { transcribe: async () => { throw new Error("Whisper 429: busy"); } });
    assert.deepEqual(done.lines, before);
  });
  test("no song and no lyrics say what to do", async () => {
    let p = setup();
    p = writeProject(dir, { ...p, song: null });
    assert.match((await run(p)).timing.error, /Add the song/);
    p = writeProject(dir, { ...p, song: { file: "x", durationSec: 20 }, lines: [] });
    assert.match((await run(p)).timing.error, /Paste the lyrics/);
  });
});

describe("a failed re-run keeps the earlier good timing (R44)", () => {
  /** A project timed once already: run it, then hand it back for a second run. */
  async function timedOnce() {
    const p = setup();
    const done = await run(p);
    assert.equal(done.timing.status, "done");
    return done;
  }
  test("a re-run that fails outright: still done, the earlier lines kept, the failure noted", async () => {
    const before = await timedOnce();
    const after = await run(before, { transcribe: async () => { throw new Error("Whisper 503: upstream"); } });
    assert.equal(after.timing.status, "done");
    assert.equal(after.timing.error, null);
    assert.match(after.timing.lastError, /speech service had a problem/);
    assert.doesNotMatch(after.timing.lastError, /Whisper|503/);
    assert.deepEqual(after.lines, before.lines);
    assert.deepEqual(after.sections, before.sections);
    assert.deepEqual(after.timing.beats, before.timing.beats);
    assert.equal(readProject(dir, before.projectId).timing.status, "done", "saved so");
  });
  test("a re-run that fails part-way keeps the earlier placements, not the partial ones", async () => {
    const before = await timedOnce();
    const moved = heardSong.map((w) => ({ ...w, start: w.start + 3, end: w.end + 3 }));
    const after = await run(before, { transcribe: async (file) => { if (file === PREPARED()) return { words: moved }; throw new Error("Whisper 429: busy"); } });
    assert.equal(after.timing.status, "done");
    assert.match(after.timing.lastError, /busy/);
    assert.deepEqual(after.lines, before.lines);
  });
  test("a re-run that works clears the earlier failure note", async () => {
    const before = await timedOnce();
    const failed = await run(before, { transcribe: async () => { throw new Error("Whisper 429: busy"); } });
    assert.ok(failed.timing.lastError);
    const again = await run(failed);
    assert.equal(again.timing.status, "done");
    assert.equal(again.timing.lastError ?? null, null);
  });
  test("a first run that fails is still an error", async () => {
    const p = setup();
    const done = await run(p, { transcribe: async () => { throw new Error("Whisper 429: busy"); } });
    assert.equal(done.timing.status, "error");
    assert.match(done.timing.error, /busy/);
    assert.equal(done.timing.lastError ?? null, null);
  });
});

test("locked lines keep their timing on a re-run", async () => {
  let p = setup();
  p.lines[0] = { ...p.lines[0], locked: true, words: [{ text: "My", start: 0.5, end: 0.8 }, { text: "time", start: 0.8, end: 1 }, { text: "no", start: 1, end: 1.2 }, { text: "late", start: 1.2, end: 1.5 }], start: 0.5, end: 1.5 };
  p = writeProject(dir, p);
  const done = await run(p);
  assert.equal(done.lines[0].start, 0.5);
  assert.equal(done.lines[0].locked, true);
});

describe("edits made while the job runs", () => {
  test("a line the user locked mid-job keeps the user's timing", async () => {
    const p = setup();
    let edited = false;
    const done = await run(p, {
      detectBeats: async () => ({ bpm: 0, times: [] }),
      transcribe: hearsFullSong(() => {
        if (edited) return;
        edited = true;
        updateProject(dir, p.projectId, (latest) => ({
          ...latest,
          lines: latest.lines.map((l, i) => (i === 1 ? { ...l, locked: true, start: 9, end: 10, words: [{ text: "Who", start: 9, end: 9.3 }, { text: "talk", start: 9.3, end: 9.6 }, { text: "say", start: 9.6, end: 10 }] } : l)),
        }));
      }),
    });
    assert.equal(done.timing.status, "done");
    assert.equal(done.lines[1].locked, true);
    assert.equal(done.lines[1].start, 9);
    assert.equal(done.lines[1].words[0].start, 9);
    assert.equal(done.lines[0].start, 1); // the rest uses the job's placement
    assert.equal(done.sections[1].start, 9); // the section follows the locked line
  });

  test("an effect picked mid-job is kept", async () => {
    const p = setup();
    const done = await run(p, {
      transcribe: hearsFullSong(() => updateProject(dir, p.projectId, (l) => ({ ...l, lines: l.lines.map((x, i) => (i === 0 ? { ...x, effect: "slam" } : x)) }))),
    });
    assert.equal(done.lines[0].effect, "slam");
    assert.equal(done.lines[0].start, 1);
  });

  test("lyrics changed mid-job: an error, and no placements are written", async () => {
    const p = setup();
    let mid = null;
    const done = await run(p, {
      transcribe: hearsFullSong(() => {
        if (mid) return;
        updateProject(dir, p.projectId, (latest) => applySheet(latest, "[INTRO]\nSomething else entirely"));
        mid = readProject(dir, p.projectId);
      }),
    });
    assert.equal(done.timing.status, "error");
    assert.equal(done.timing.error, "The lyrics changed while timing ran — run timing again.");
    assert.deepEqual(done.lines, mid.lines);
    assert.deepEqual(done.sections, mid.sections);
    assert.equal(readProject(dir, p.projectId).timing.error, done.timing.error);
  });

  test("project deleted mid-job: ends silently and nothing is recreated", async () => {
    const p = setup();
    let calls = 0;
    const done = await run(p, { transcribe: hearsFullSong(() => { calls += 1; deleteProject(dir, p.projectId); }) });
    assert.equal(done, null);
    assert.equal(readProject(dir, p.projectId), null);
    const left = fs.existsSync(path.join(dir, "lyric-projects")) ? fs.readdirSync(path.join(dir, "lyric-projects")) : [];
    assert.deepEqual(left, []);
    assert.equal(calls, 1, "no more Whisper calls once the project is gone");
    assert.equal(isAligning(p.projectId), false);
  });

  test("a project that is already gone returns null without throwing", async () => {
    const p = setup();
    deleteProject(dir, p.projectId);
    assert.equal(await run(p), null);
  });
});

describe("the song's audible end", () => {
  // Heard to 6 s; the long unheard outro would spread to 20 s without a bound.
  const OUTRO = "\n[OUTRO]\ngoing home going home today\nthe driver knows the way to go\nno more crying no more pain there\nwe shall rest at last my friend";
  const outroSetup = () => {
    let p = createProject(dir, { title: "T", artist: "A" });
    p = applySheet(p, SHEET + OUTRO);
    p.song = { file: path.join(dir, "song.m4a"), durationSec: 20 };
    return writeProject(dir, p);
  };
  const lastEnd = (lines) => Math.max(...lines.flatMap((l) => l.words.map((w) => w.end)));

  test("is measured on the prepared audio, stored, and no line runs past it", async () => {
    const p = outroSetup();
    const asked = [];
    const done = await run(p, { measureAudibleEnd: async (file, durationSec) => { asked.push([file, durationSec]); return 8; } });
    assert.equal(done.timing.status, "done");
    assert.deepEqual(asked, [[PREPARED(), 20]]);
    assert.equal(done.timing.audibleEnd, 8);
    assert.ok(lastEnd(done.lines) <= 8, `last line ends at ${lastEnd(done.lines)}`);
    assert.equal(done.lines[0].start, 1, "heard lines keep their times");
    for (const l of done.lines.slice(3)) assert.equal(l.flag, "check");
  });
  test("without a bound the same outro runs on past it (the bug)", async () => {
    const p = outroSetup();
    const done = await run(p);
    assert.equal(done.timing.audibleEnd, 20);
    assert.ok(lastEnd(done.lines) > 8);
  });
  test("a measurement failure falls back to the song's length, logged once, and the job still finishes", async () => {
    const p = outroSetup();
    const logged = [];
    const done = await run(p, { measureAudibleEnd: async () => { throw new Error("ffmpeg decode exited 1: silence"); }, log: (...a) => logged.push(a.join(" ")) });
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.audibleEnd, 20);
    assert.equal(logged.filter((l) => l.includes("silence")).length, 1);
    assert.ok(logged.some((l) => l.includes(p.projectId)));
  });
  test("a nonsense measurement is ignored", async () => {
    const p = outroSetup();
    const done = await run(p, { measureAudibleEnd: async () => Number.NaN });
    assert.equal(done.timing.audibleEnd, 20);
  });
  test("never earlier than the last confidently heard line (a click, then near-silence)", async () => {
    const p = outroSetup();
    const done = await run(p, { measureAudibleEnd: async () => 0.5 });
    assert.equal(done.timing.status, "done");
    // "say", the last word heard with confidence, ends at 6.0.
    assert.equal(done.timing.audibleEnd, 6);
    assert.equal(done.lines[0].start, 1);
    assert.equal(done.lines[1].start, 5);
    assert.equal(done.lines[0].flag, null);
    assert.deepEqual(done.lines[1].words.map((w) => w.start), [5, 5.3, 5.6], "the heard words keep their times");
    assert.ok(lastEnd(done.lines) <= done.timing.audibleEnd);
  });
  test("the same floor holds when a failure part-way keeps what was heard", async () => {
    const p = outroSetup();
    const done = await run(p, {
      measureAudibleEnd: async () => 0.5,
      transcribe: async (file) => { if (file === PREPARED()) return { words: heardSong }; throw new Error("Whisper 429: busy"); },
    });
    assert.equal(done.timing.status, "error");
    assert.equal(done.lines[1].start, 5);
    assert.equal(done.timing.audibleEnd, 6);
  });
  test("a failure part-way places the heard lines inside the audible end too", async () => {
    const p = outroSetup();
    const done = await run(p, {
      measureAudibleEnd: async () => 8,
      transcribe: async (file) => { if (file === PREPARED()) return { words: heardSong }; throw new Error("Whisper 429: busy"); },
    });
    assert.equal(done.timing.status, "error");
    assert.equal(done.lines[1].start, 5);
    assert.ok(lastEnd(done.lines) <= 8, `last line ends at ${lastEnd(done.lines)}`);
    assert.equal(done.timing.audibleEnd, 8);
  });
});

test("one job per project at a time", async () => {
  const p = setup();
  let release;
  const gate = new Promise((r) => { release = r; });
  let entered;
  const inside = new Promise((r) => { entered = r; });
  const first = run(p, { transcribe: hearsFullSong(async () => { entered(); await gate; }) });
  await inside;
  assert.equal(isAligning(p.projectId), true);
  const second = await run(p);
  assert.equal(second.timing.status, "running");
  release();
  assert.equal((await first).timing.status, "done");
  assert.equal(isAligning(p.projectId), false);
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

describe("with real ffmpeg", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  // 70 s of silence with one second of tone starting at exactly 40.0 s.
  const BURST_AT = 40;
  function makeSong() {
    const file = path.join(dir, "burst.m4a");
    const r = spawnSync(FF, ["-v", "error", "-f", "lavfi", "-i", `aevalsrc=0.5*sin(2*PI*440*t)*between(t\\,${BURST_AT}\\,${BURST_AT + 1}):d=70:s=16000`, "-c:a", "aac", "-b:a", "96k", file]);
    assert.equal(r.status, 0, String(r.stderr));
    return file;
  }
  const onsetOf = async (file) => {
    const x = await decodeMono(file, 16000);
    return x.findIndex((v) => Math.abs(v) > 0.1) / 16000;
  };
  const realSetup = (name) => {
    let p = createProject(dir, { title: name, artist: "A" });
    p = applySheet(p, SHEET);
    p.song = { file: makeSong.file, durationSec: 70 };
    return writeProject(dir, p);
  };
  const leftovers = () => fs.readdirSync(dir).filter((f) => f.startsWith("lyric-lv_"));

  test("windows are cut where they say, temp files are named per project and removed afterwards", async () => {
    makeSong.file = makeSong();
    const a = realSetup("A");
    const b = realSetup("B");
    const seen = [];
    const hear = (id) => async (file) => {
      if (path.extname(file) === ".wav") {
        const m = /-cut-(\d+)-(\d+)\.wav$/.exec(file);
        seen.push({ id, file, from: Number(m[1]) / 1000, to: Number(m[2]) / 1000, onset: await onsetOf(file), size: fs.statSync(file).size });
      } else {
        assert.ok(fs.existsSync(file), "the prepared file exists while it is used");
      }
      return { words: [] };
    };
    const real = { detectBeats: async () => ({ bpm: 0, times: [] }), log: () => {} };
    const [doneA, doneB] = await Promise.all([
      runAlignJob({ dataDir: dir, workDir: dir, projectId: a.projectId, deps: { ...real, transcribe: hear("A") } }),
      runAlignJob({ dataDir: dir, workDir: dir, projectId: b.projectId, deps: { ...real, transcribe: hear("B") } }),
    ]);
    assert.equal(doneA.timing.status, "done");
    assert.equal(doneB.timing.status, "done");
    const hit = seen.filter((s) => s.from < BURST_AT && s.to > BURST_AT + 0.5);
    assert.ok(hit.length >= 4, `windows over the tone: ${hit.length}`);
    for (const s of hit) {
      assert.ok(Math.abs(s.onset - (BURST_AT - s.from)) < 0.02, `window from ${s.from}: tone starts at ${s.onset}, expected ${BURST_AT - s.from}`);
    }
    for (const s of seen) {
      assert.ok(path.basename(s.file).startsWith(`lyric-${s.id === "A" ? a.projectId : b.projectId}-`), "cut files are named for their own project");
      assert.ok(s.size < 1.1e6 + 1000, `a cut is small (${s.size} bytes)`);
    }
    assert.deepEqual(leftovers(), []);
  });

  test("each cut is removed right after it is used, so one exists at a time", async () => {
    makeSong.file = makeSong();
    const p = realSetup("A");
    const counts = [];
    const done = await runAlignJob({
      dataDir: dir, workDir: dir, projectId: p.projectId,
      deps: {
        transcribe: async (file) => {
          if (file.endsWith(".wav")) counts.push(fs.readdirSync(dir).filter((f) => /^lyric-lv_.*-cut-.*\.wav$/.test(f)).length);
          return { words: [] };
        },
        detectBeats: async () => ({ bpm: 0, times: [] }), log: () => {},
      },
    });
    assert.equal(done.timing.status, "done");
    assert.ok(counts.length >= 4, `windows heard: ${counts.length}`);
    assert.ok(counts.every((n) => n === 1), `cuts on disk at each call: ${counts}`);
    assert.deepEqual(leftovers(), []);
  });

  test("temp files are removed when the job fails too", async () => {
    makeSong.file = makeSong();
    const p = realSetup("A");
    const done = await runAlignJob({
      dataDir: dir, workDir: dir, projectId: p.projectId,
      deps: { transcribe: async (file) => { if (file.endsWith(".wav")) throw new Error("Whisper 503: down"); return { words: [] }; }, log: () => {} },
    });
    assert.equal(done.timing.status, "error");
    assert.match(done.timing.error, /problem/);
    assert.deepEqual(leftovers(), []);
  });

  test("with vocals, the windows are cut from the vocals and every prepared file is removed", async () => {
    makeSong.file = makeSong(); // stands in for the vocals: it holds the tone
    const vocals = path.join(dir, "lyric-vocals-x.m4a");
    fs.copyFileSync(makeSong.file, vocals);
    const silent = path.join(dir, "silent-mix.m4a"); // the "mix": the same length, nothing audible
    const made = spawnSync(FF, ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "70", "-c:a", "aac", "-b:a", "96k", silent]);
    assert.equal(made.status, 0, String(made.stderr));
    let p = createProject(dir, { title: "V", artist: "A" });
    p = applySheet(p, SHEET);
    p.song = { file: silent, durationSec: 70 };
    p = writeProject(dir, p);
    const onsets = [];
    const done = await runAlignJob({
      dataDir: dir, workDir: dir, projectId: p.projectId,
      deps: {
        vocalStem: async () => vocals,
        transcribe: async (file) => {
          const m = /-cut-(\d+)-(\d+)\.wav$/.exec(file);
          if (m) onsets.push({ from: Number(m[1]) / 1000, to: Number(m[2]) / 1000, onset: await onsetOf(file) });
          return { words: [] };
        },
        detectBeats: async () => ({ bpm: 0, times: [] }), log: () => {},
      },
    });
    assert.equal(done.timing.status, "done");
    assert.equal(done.timing.usedVocalStem, true);
    const hit = onsets.filter((s) => s.from < BURST_AT && s.to > BURST_AT + 0.5);
    assert.ok(hit.length >= 3, `windows over the tone: ${hit.length}`);
    for (const s of hit) assert.ok(Math.abs(s.onset - (BURST_AT - s.from)) < 0.02, `the tone is heard where the vocals put it (${s.onset})`);
    assert.equal(fs.existsSync(vocals), false, "the vocals file is gone");
    assert.equal(fs.existsSync(silent), true, "the user's song is not");
    assert.deepEqual(leftovers(), [], "the prepared mix and vocals are gone");
  });

  test("a song ffmpeg cannot read is a plain error", async () => {
    const p = setup(); // song.m4a does not exist
    const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId, deps: { transcribe: async () => ({ words: [] }), log: () => {} } });
    assert.equal(done.timing.status, "error");
    assert.match(done.timing.error, /Could not read this song's audio/);
    assert.deepEqual(leftovers(), []);
  });
});
