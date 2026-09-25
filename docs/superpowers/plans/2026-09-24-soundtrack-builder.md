# Soundtrack Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Ambient session be a music-only video with the operator's own track order, a timestamped tracklist + credits in the YouTube description, optional AMD GPU encoding, and laptop-only vocal removal that saves an instrumental into the music library.

**Architecture:** Extend the existing Ambient project type (server `lib/ambient/*`, `routes/ambient.js`; client `components/ambient/*`, `lib/ambientShare.ts`). Vocal removal is a new `server/src/lib/stems/` module that spawns the `audio-separator` CLI from an isolated Python venv (`STEMS_CLI`), run through a process-wide single-slot gate shared with Ambient renders, exposed through `routes/music.js`.

**Tech Stack:** Node 18+ ESM, Express, `node:test` + supertest (server); React 19 + Vite + Vitest + Testing Library (client); FFmpeg 8 (local) / 5.1 (prod); Python 3.12 venv with `audio-separator[cpu]`.

**Spec:** `docs/superpowers/specs/2026-09-24-soundtrack-builder-design.md`

## Global Constraints

- Existing projects must behave exactly as today: defaults `words: "verses"`, `bed.order: "shuffle"`, render `encoder: "cpu"`; a stored project missing these fields reads as the default.
- Derived instrumentals inherit the source track's `licence` and `credit`; the licence gate is unchanged. Nothing in this feature marks a track cleared.
- Vocal removal is hidden unless `STEMS_CLI` is set **and** the separator answers `--version`; nothing is added to the Docker image.
- One heavy job at a time: an Ambient render and a vocal separation never run concurrently (`lib/heavyJobGate.js`).
- Every child process is spawned with an argv array and `shell: false`; no request field is ever used as a path — files are resolved through `resolveTrackFile` / the tenant's `outputDir`.
- Server tests: `cd server && npm test`. Client tests: `cd client && npm test`. Both must stay green after every task.
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Spec deviations decided while planning (apply them, they supersede the spec text):
  1. The spec's `STEMS_PYTHON` becomes **`STEMS_CLI`**, the path to the venv's `audio-separator.exe`, with **no default**; unset means the feature is hidden. The venv lives at `C:\Users\segun\.biblefuel\stems-venv`.
  2. Track order uses **up/down buttons** in the chosen-tracks list (no drag-and-drop).
  3. Preview is two plain `<audio controls>` players (original / instrumental), not a 30-second loudest-section clip.
  4. Unkept instrumentals are swept (older than 7 days, not in the library) when a new separation starts, not by cron.
  5. AMF fallback: **any** failed AMF encode is retried once with CPU args.
  6. `builtOrder` entries carry `credit` resolved at build time (server), so the client needs no library lookup.

---

## File map

**Server — create**
- `server/src/lib/ambient/trackInfo.js` — `trackInfo(dataDir, ref)` → `{ label, credit }` for `library:`/`mylib:`/bare refs.
- `server/src/lib/ambient/encoders.js` — `amfAvailable()`, `videoCodecArgs(encoder)`.
- `server/src/lib/heavyJobGate.js` — `runExclusive(task, { onQueued, signal })`.
- `server/src/lib/stems/separator.js` — `MODELS`, `buildSeparatorArgs`, `parseProgress`, `separatorAvailable`, `removeVocals`.
- `server/src/lib/stems/stemJobs.js` — in-memory separation job registry.
- `server/src/lib/stems/sweep.js` — `sweepStaleInstrumentals(ctx, now)`.
- Tests beside each: `*.test.js`.
- `docs/vocal-removal.md` — setup + spike results.

**Server — modify**
- `server/src/lib/ambient/bedAssembly.js` — `fixedOrder`, `trackStarts`, `bedHash({ order })`, `BED_BUILD_VERSION = 3`.
- `server/src/lib/ambient/projectStore.js` — `words` default, `isMusicOnly()`.
- `server/src/lib/ambient/stages.js` — `writeWithMovements` music-only, `assembleBed` order + `builtOrder`, `renderStage` music-only / encoder / cancel-at-start.
- `server/src/lib/ambient/ambientRender.js` — `encoder` option.
- `server/src/lib/musicLibraryStore.js` — `credit`, `derivedFrom`.
- `server/src/routes/ambient.js` — `PATCH /:id/words`, bed `order`, render `encoder`, voice refusal, gate.
- `server/src/routes/music.js` — `credit`, capabilities, instrumental routes.

**Client — modify**
- `client/src/lib/ambientTypes.ts`, `client/src/lib/ambientApi.ts`, `client/src/lib/ambientShare.ts`, `client/src/lib/musicLibraryApi.ts`
- `client/src/components/ambient/AmbientWordStep.tsx`, `AmbientSoundStep.tsx`, `AmbientRenderStep.tsx`
- `client/src/components/MusicPicker.tsx`
- **Create** `client/src/components/InstrumentalDialog.tsx`
- Tests under the matching `__tests__/` folders.

---

### Task 1: Spike — install the separator and measure it on this laptop

Throwaway investigation. Output is facts recorded in `docs/vocal-removal.md`; no server code.

**Already done while planning (2026-09-24):** venv at `C:\Users\segun\.biblefuel\stems-venv` (Python 3.12.10), `audio-separator 0.47.0`, `torch 2.14.0`, `onnxruntime 1.30.0`.
Findings: (a) `python -m audio_separator.utils.cli` exits 0 and does nothing, so invoke `Scripts\audio-separator.exe` (hence `STEMS_CLI`); (b) the CLI crashes with `ModuleNotFoundError: audioread` until `pip install audioread` (librosa 1.0 no longer pulls it in); (c) models: best = `model_bs_roformer_ep_317_sdr_12.9755.ckpt` (instrumental SDR 16.5), fast = `htdemucs.yaml`; (d) `ffmpeg -encoders` lists `h264_amf`. Steps 1, 2 and the encoder check in Step 4 are done; Step 3, the timed encode in Step 4, Step 5 and Step 7 remain and need one song from the operator. In the commands below use `/c/Users/segun/.biblefuel/stems-venv/Scripts/audio-separator.exe` in place of `$S -m audio_separator.utils.cli`.

**Files:**
- Create: `docs/vocal-removal.md`

**Interfaces:**
- Produces: confirmed values for `MODELS.best`, `MODELS.fast`, the instrumental output filename pattern, and a real progress-output sample (used by Task 8's `parseProgress` test fixture). Also confirms whether `h264_amf` is in `ffmpeg -encoders`.

- [ ] **Step 1: Confirm the venv and package**

```bash
/c/Users/segun/.biblefuel/stems-venv/Scripts/python.exe -m pip show audio-separator torch onnxruntime
/c/Users/segun/.biblefuel/stems-venv/Scripts/python.exe -m audio_separator.utils.cli --version
```
Expected: versions print; `--version` exits 0. If `audio_separator.utils.cli` is not runnable as a module, find the console-script entry point (`Scripts/audio-separator.exe`) and record which invocation works.

- [ ] **Step 2: List models and pick the two**

```bash
/c/Users/segun/.biblefuel/stems-venv/Scripts/python.exe -m audio_separator.utils.cli --list_models | grep -i -E "roformer|htdemucs" | head -20
```
Record the exact filename of the best BS-Roformer vocals/instrumental model and of `htdemucs` (fast).

- [ ] **Step 3: Separate one real song with each model, timed**

Use a 3–5 minute song the operator owns or has licensed (ask the operator for the file path). Run:
```bash
S=/c/Users/segun/.biblefuel/stems-venv/Scripts/python.exe
mkdir -p /c/Users/segun/.biblefuel/spike
time $S -m audio_separator.utils.cli "<song path>" --model_filename <best model> --output_dir /c/Users/segun/.biblefuel/spike --output_format WAV --single_stem Instrumental --model_file_dir /c/Users/segun/.biblefuel/models 2> /c/Users/segun/.biblefuel/spike/best-stderr.txt
time $S -m audio_separator.utils.cli "<song path>" --model_filename <fast model> --output_dir /c/Users/segun/.biblefuel/spike --output_format WAV --single_stem Instrumental --model_file_dir /c/Users/segun/.biblefuel/models 2> /c/Users/segun/.biblefuel/spike/fast-stderr.txt
ls -la /c/Users/segun/.biblefuel/spike
```
Watch peak memory in Task Manager during each run. Record: wall time, peak RAM, output filenames (they must contain `Instrumental`), and copy ~5 lines of progress output from each stderr file.

- [ ] **Step 4: Check the AMD encoder**

```bash
ffmpeg -hide_banner -encoders | grep -i amf
```
If `h264_amf` is listed, time a 5-minute test encode of a still image at 1080p/24 fps with `-c:v h264_amf -quality quality -rc cqp -qp_i 22 -qp_p 24` vs `-c:v libx264 -preset veryfast -crf 23`, and record both times and file sizes.

- [ ] **Step 5: Write `docs/vocal-removal.md`**

Sections: *What it does* (one paragraph), *One-time setup* (`py -3.12 -m venv C:\Users\segun\.biblefuel\stems-venv`, `...\python.exe -m pip install "audio-separator[cpu]" audioread`, set in `server/.env`: `STEMS_CLI=C:\Users\segun\.biblefuel\stems-venv\Scripts\audio-separator.exe` and `STEMS_MODEL_DIR=C:\Users\segun\.biblefuel\models`, restart the server), *Measured on this laptop* (the table from Steps 3–4), *What quality to expect* (studio lead vocal: very good; backing vocals: good, faint bleed; choir-heavy: fair; live: poor; low-bitrate sources worse), *Licence rule* (an instrumental keeps the original's licence; separating a song does not clear it).

- [ ] **Step 6: Apply spike findings**

If model filenames, module name or output naming differ from Task 8's constants, edit Task 8 in this plan before it starts. If `audio-separator` cannot be installed on 3.12, switch Task 8 to plain `demucs` (`-m demucs --two-stems=vocals -n htdemucs -o <outDir> <input>`, output `<outDir>/htdemucs/<name>/no_vocals.wav`) and drop the `best` option.

- [ ] **Step 7: Commit**

```bash
git add docs/vocal-removal.md docs/superpowers/plans/2026-09-24-soundtrack-builder.md
git commit -m "docs: vocal removal setup and measured spike results"
```

---

### Task 2: Bed order and track start times (pure)

**Files:**
- Modify: `server/src/lib/ambient/bedAssembly.js`
- Test: `server/src/lib/ambient/bedAssembly.test.js`

**Interfaces:**
- Consumes: existing `chainDurationSec(chosen, crossfadeSec)`.
- Produces:
  - `fixedOrder(tracks: Array<{ref,file,durationSec}>, targetSec: number, { crossfadeSec = 6, maxTracks = 400 }?) → same-shaped array`
  - `trackStarts(order: Array<{ref, durationSec, ...rest}>, crossfadeSec: number, targetSec: number) → Array<{...rest, ref, startSec, durationSec}>`
  - `bedHash({ trackRefs, crossfadeSec, targetSec, order = "shuffle" }) → string` (order now part of the key; `BED_BUILD_VERSION = 3`)

- [ ] **Step 1: Write the failing tests** — append to `bedAssembly.test.js` (keep its existing imports; add `fixedOrder, trackStarts, bedHash` to the import from `./bedAssembly.js` if not already imported):

```js
describe("fixedOrder — the operator's order", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });

  test("plays tracks exactly in the given order", () => {
    const out = fixedOrder([t("a", 100), t("b", 100), t("c", 100)], 250, { crossfadeSec: 0 });
    assert.deepEqual(out.map((x) => x.ref), ["a", "b", "c"]);
  });

  test("repeats the list from the top when one pass is short", () => {
    const out = fixedOrder([t("a", 100), t("b", 100)], 350, { crossfadeSec: 0 });
    assert.deepEqual(out.map((x) => x.ref), ["a", "b", "a", "b"]);
  });

  test("never puts a track next to itself across the seam", () => {
    // a b a: the seam would place a after a.
    const out = fixedOrder([t("a", 100), t("b", 100), t("a", 100)], 500, { crossfadeSec: 0 });
    for (let i = 1; i < out.length; i += 1) assert.notEqual(out[i].ref, out[i - 1].ref);
  });

  test("a single track still fills the length", () => {
    const out = fixedOrder([t("a", 100)], 250, { crossfadeSec: 0 });
    assert.deepEqual(out.map((x) => x.ref), ["a", "a", "a"]);
  });

  test("a list of one track twice does not loop forever", () => {
    const out = fixedOrder([t("a", 100), t("a", 100)], 250, { crossfadeSec: 0 });
    assert.equal(out.length, 3);
  });

  test("stops at maxTracks", () => {
    assert.equal(fixedOrder([t("a", 1), t("b", 1)], 10_000, { crossfadeSec: 0, maxTracks: 5 }).length, 5);
  });

  test("ignores tracks with no duration", () => {
    assert.deepEqual(fixedOrder([t("a", 0), t("b", 100)], 50, { crossfadeSec: 0 }).map((x) => x.ref), ["b"]);
  });
});

describe("trackStarts — where each track begins in the bed", () => {
  test("each join overlaps by the crossfade", () => {
    const out = trackStarts([{ ref: "a", durationSec: 100 }, { ref: "b", durationSec: 100 }, { ref: "c", durationSec: 100 }], 6, 10_000);
    assert.deepEqual(out.map((x) => x.startSec), [0, 94, 188]);
  });

  test("a track starting at or after the target is left out and the last is cut short", () => {
    const out = trackStarts([{ ref: "a", durationSec: 100 }, { ref: "b", durationSec: 100 }, { ref: "c", durationSec: 100 }], 0, 150);
    assert.deepEqual(out.map((x) => [x.ref, x.startSec, x.durationSec]), [["a", 0, 100], ["b", 100, 50]]);
  });

  test("keeps the other fields of each entry", () => {
    const [first] = trackStarts([{ ref: "a", durationSec: 10, label: "A", credit: "X" }], 0, 60);
    assert.equal(first.label, "A");
    assert.equal(first.credit, "X");
  });
});

describe("bedHash — order is part of the cache key", () => {
  test("shuffle and fixed hash differently", () => {
    const base = { trackRefs: ["library:a"], crossfadeSec: 6, targetSec: 60 };
    assert.notEqual(bedHash({ ...base, order: "shuffle" }), bedHash({ ...base, order: "fixed" }));
  });

  test("order defaults to shuffle", () => {
    const base = { trackRefs: ["library:a"], crossfadeSec: 6, targetSec: 60 };
    assert.equal(bedHash(base), bedHash({ ...base, order: "shuffle" }));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/ambient/bedAssembly.test.js`
Expected: FAIL — `fixedOrder is not a function` / `trackStarts is not a function`.

- [ ] **Step 3: Implement** — in `bedAssembly.js`, after `orderTracks`:

```js
/**
 * The operator's own order. One pass in the order given, then again from the
 * top until the bed is long enough. A track is never placed straight after
 * itself (the seam of a list that starts and ends with the same track, or the
 * same track listed twice in a row) unless nothing else is left to play.
 *
 * @param {Array<{ ref: string, file: string, durationSec: number }>} tracks
 * @param {number} targetSec
 * @param {{ crossfadeSec?: number, maxTracks?: number }} [opts]
 */
export function fixedOrder(tracks, targetSec, { crossfadeSec = 6, maxTracks = 400 } = {}) {
  const pool = (tracks || []).filter((t) => Number(t?.durationSec) > 0);
  if (pool.length === 0) return [];

  const chosen = [];
  let i = 0;
  let skips = 0;
  while (chainDurationSec(chosen, crossfadeSec) < targetSec && chosen.length < maxTracks) {
    const t = pool[i % pool.length];
    i += 1;
    const last = chosen[chosen.length - 1];
    // After a full pass of skips there is nothing else to play: repeat.
    if (last && skips < pool.length && t.ref === last.ref) {
      skips += 1;
      continue;
    }
    skips = 0;
    chosen.push(t);
  }
  return chosen;
}

/**
 * When each track starts in the assembled bed. A crossfaded chain starts the
 * next track `crossfadeSec` before the previous one ends, so track i begins at
 * sum(durations before it) - i * crossfadeSec. Entries past the target are
 * dropped and the last one is cut to what actually plays.
 *
 * @param {Array<{ ref: string, durationSec: number }>} order
 * @param {number} crossfadeSec
 * @param {number} targetSec
 */
export function trackStarts(order, crossfadeSec, targetSec) {
  const d = Number(crossfadeSec) || 0;
  const out = [];
  let chainEnd = 0;
  for (let i = 0; i < (order || []).length; i += 1) {
    const dur = Number(order[i].durationSec) || 0;
    const startSec = i === 0 ? 0 : chainEnd - d;
    if (startSec >= targetSec) break;
    out.push({ ...order[i], startSec, durationSec: Math.min(dur, targetSec - startSec) });
    chainEnd = startSec + dur;
  }
  return out;
}
```

Replace `BED_BUILD_VERSION` and `bedHash`:

```js
// Bumped when the way a bed is built changes, so cached beds built the old
// way are rebuilt rather than reused. v2: tracks levelled to one loudness.
// v3: the operator's own order is part of the key.
const BED_BUILD_VERSION = 3;

export function bedHash({ trackRefs = [], crossfadeSec = 6, targetSec = 0, order = "shuffle" } = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ trackRefs, crossfadeSec, targetSec, order, build: BED_BUILD_VERSION }))
    .digest("hex");
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/ambient/bedAssembly.test.js` → PASS. Then `npm test` → all green (existing cache tests still pass: they compare hashes computed by the same function).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ambient/bedAssembly.js server/src/lib/ambient/bedAssembly.test.js
git commit -m "feat(ambient): keep-my-order track sequencing and per-track start times"
```

---

### Task 3: Track credits in the music library

**Files:**
- Modify: `server/src/lib/musicLibraryStore.js` (`registerTrack`, `updateTrack`)
- Modify: `server/src/routes/music.js` (`toListed`, bundled listing, `PATCH /:id`)
- Create: `server/src/lib/ambient/trackInfo.js`
- Test: `server/src/routes/music.test.js`, create `server/src/lib/ambient/trackInfo.test.js`

**Interfaces:**
- Produces:
  - `registerTrack(dataDir, { file, label, mood, licence, durationSec, credit?, derivedFrom? })` — stores `credit` (trimmed, ≤200 chars, default `""`) and `derivedFrom` (string or `null`).
  - `updateTrack(dataDir, id, { label?, mood?, licence?, credit? })`.
  - Listed tracks carry `credit: string`; bundled tracks `credit: "Music from Pixabay"`.
  - `BUNDLED_CREDIT = "Music from Pixabay"` exported from `trackInfo.js`.
  - `trackInfo(dataDir, ref) → { label: string, credit: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/routes/music.test.js` inside `describe("music route", ...)`:

```js
  test("a track's credit is saved, trimmed and capped at 200 characters", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Bed" });
    const r = res();
    await handlerFor("patch", "/:id")({ ctx, params: { id: t.id }, body: { credit: `  ${"x".repeat(250)}  ` } }, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.track.credit.length, 200);
  });

  test("bundled tracks are credited to Pixabay", async () => {
    const r = res();
    await handlerFor("get", "/library")({ ctx: tenant().ctx }, r);
    const bundled = r.payload.tracks.find((t) => t.source === "bundled");
    assert.equal(bundled.credit, "Music from Pixabay");
  });

  test("an upload with no credit lists an empty credit", async () => {
    const { ctx, file } = tenant();
    registerTrack(ctx.dataDir, { file, label: "Bed" });
    const r = res();
    await handlerFor("get", "/library")({ ctx }, r);
    assert.equal(r.payload.tracks.find((t) => t.source === "upload").credit, "");
  });
```

Create `server/src/lib/ambient/trackInfo.test.js`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { trackInfo, BUNDLED_CREDIT } from "./trackInfo.js";
import { registerTrack } from "../musicLibraryStore.js";
import { listTracks } from "../musicLibrary.js";

describe("trackInfo", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-trackinfo-"));

  test("a bundled track reads its label and the Pixabay credit", () => {
    const first = listTracks()[0];
    assert.deepEqual(trackInfo(dataDir, `library:${first.id}`), { label: first.label, credit: BUNDLED_CREDIT });
  });

  test("an upload reads its own label and credit", () => {
    const file = path.join(dataDir, "song.mp3");
    fs.writeFileSync(file, "x");
    const t = registerTrack(dataDir, { file, label: "Morning", credit: "Music by Ada · Pixabay" });
    assert.deepEqual(trackInfo(dataDir, `mylib:${t.id}`), { label: "Morning", credit: "Music by Ada · Pixabay" });
  });

  test("an unknown ref falls back to its own text and no credit", () => {
    assert.deepEqual(trackInfo(dataDir, "mylib:nope"), { label: "mylib:nope", credit: "" });
  });

  test("a bare path reads as its file name", () => {
    assert.deepEqual(trackInfo(dataDir, "C:\\out\\bed-1.m4a"), { label: "bed-1.m4a", credit: "" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/routes/music.test.js src/lib/ambient/trackInfo.test.js`
Expected: FAIL (`credit` undefined; `trackInfo.js` not found).

- [ ] **Step 3: Implement**

In `musicLibraryStore.js`, add near the top (after imports):

```js
const CREDIT_MAX = 200;
const cleanCredit = (v) => String(v ?? "").trim().slice(0, CREDIT_MAX);
```

Change `registerTrack`'s signature and the `track` literal:

```js
export function registerTrack(dataDir, { file, label, mood, licence, durationSec, credit, derivedFrom }) {
```
```js
    licence: String(licence || "unknown").trim() || "unknown",
    credit: cleanCredit(credit),
    derivedFrom: derivedFrom ? String(derivedFrom) : null,
    addedAt: Date.now(),
```

In `updateTrack`, after the existing `for` loop:

```js
  if (patch.credit !== undefined) patched.credit = cleanCredit(patch.credit);
```

In `routes/music.js`: import `BUNDLED_CREDIT` from `../lib/ambient/trackInfo.js`; in `toListed` add `credit: track.credit || "",` and `derivedFrom: track.derivedFrom || null,`; in the bundled map add `credit: BUNDLED_CREDIT,`; in `PATCH /:id` pass `credit: req.body?.credit,`.

Create `server/src/lib/ambient/trackInfo.js`:

```js
import path from "path";
import { listTracks } from "../musicLibrary.js";
import { readMusicLibrary } from "../musicLibraryStore.js";

/** Bundled tracks ship with the app from Pixabay's free library. */
export const BUNDLED_CREDIT = "Music from Pixabay";

/**
 * What a bed track is called and who to credit, for the tracklist and the
 * description. Never throws: a forgotten track still needs a line.
 *
 * @param {string} dataDir
 * @param {string} ref  `library:<id>`, `mylib:<id>`, or a bare path
 * @returns {{ label: string, credit: string }}
 */
export function trackInfo(dataDir, ref) {
  const raw = String(ref || "");
  if (raw.startsWith("library:")) {
    const t = listTracks().find((x) => x.id === raw.slice("library:".length));
    return t ? { label: t.label, credit: BUNDLED_CREDIT } : { label: raw, credit: "" };
  }
  if (raw.startsWith("mylib:")) {
    const t = readMusicLibrary(dataDir).items.find((x) => x.id === raw.slice("mylib:".length));
    return t ? { label: t.label, credit: t.credit || "" } : { label: raw, credit: "" };
  }
  return { label: path.win32.basename(raw), credit: "" };
}
```

(`path.win32.basename` splits on both `\` and `/`, so it works for Windows and POSIX paths.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/routes/music.test.js src/lib/ambient/trackInfo.test.js` → PASS; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/musicLibraryStore.js server/src/routes/music.js server/src/lib/ambient/trackInfo.js server/src/lib/ambient/trackInfo.test.js server/src/routes/music.test.js
git commit -m "feat(music): credit line on library tracks"
```

---

### Task 4: Music-only sessions

**Files:**
- Modify: `server/src/lib/ambient/projectStore.js` (default + `isMusicOnly`)
- Modify: `server/src/lib/ambient/stages.js` (`writeWithMovements`, `renderStage` drops)
- Modify: `server/src/routes/ambient.js` (`PATCH /:id/words`, voice refusal)
- Test: `server/src/routes/ambient.test.js`

**Interfaces:**
- Produces:
  - `WORDS = ["verses", "none"]`, `isMusicOnly(project) → boolean` exported from `projectStore.js`.
  - `PATCH /api/ambient/:id/words { words }` → `{ ok, project }`; 400 on bad value; 409 while encoding.
  - `POST /api/ambient/:id/voice` → 400 `"this session is music only"` when music-only.
  - A music-only project always has exactly one movement spanning `0 → targetSec * 1000`.
  - `renderStage` passes `drops: []` for music-only projects.

- [ ] **Step 1: Write the failing tests** — append to `server/src/routes/ambient.test.js`:

```js
describe("PATCH /api/ambient/:id/words — music only", () => {
  test("new sessions carry verses", async () => {
    const p = await createSession();
    assert.equal(p.words, "verses");
  });

  test("music only gives one picture for the whole length, even with no verses planned", async () => {
    const p = await createSession({ targetSec: 3600 });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.words, "none");
    assert.equal(res.body.project.movements.length, 1);
    assert.equal(res.body.project.movements[0].startMs, 0);
    assert.equal(res.body.project.movements[0].endMs, 3_600_000);
  });

  test("music only keeps the verses on disk so switching back restores them", async () => {
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 3 });
    await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    const back = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "verses" });
    assert.equal(back.body.project.drops.length, 3);
    assert.equal(back.body.project.movements.length, 3);
  });

  test("rejects anything but verses or none", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "sermon" });
    assert.equal(res.status, 400);
  });

  test("refuses while the session is rendering", async () => {
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: AMBIENT_STATUS.RENDERING });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    assert.equal(res.status, 409);
  });

  test("voicing is refused for a music-only session", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    const res = await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /music only/);
  });
});

describe("renderStage — music only", () => {
  afterEach(() => { _resetLoudnessImpl(); _resetFfmpegSpawnImpl(); });

  test("a music-only render has no voice input and no burned captions", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    const calls = [];
    _setFfmpegSpawnImpl((args) => {
      calls.push(args);
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    });
    const p = await createSession({ targetSec: 60 });
    const img = path.join(outputDir, "pic.jpg");
    const voice = path.join(outputDir, "voice.mp3");
    fs.writeFileSync(img, "jpg");
    fs.writeFileSync(voice, "mp3");
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      words: "none",
      // A verse voiced before the switch must not reach the render.
      drops: [{ id: "d1", atMs: 1000, reference: "John 14:27", status: "done", audioPath: voice, durationMs: 4000 }],
      movements: [{ id: "m1", startMs: 0, endMs: 60_000, imageStatus: "done", imagePath: img }],
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano"], crossfadeSec: 2 },
    });
    const job = createJob("u1", { durationSec: 60 });
    await renderStage({ dataDir, outputDir }, p.projectId, job.jobId);
    const render = calls[calls.length - 1];
    assert.ok(!render.includes(voice), "the voice file is not an input");
    const script = fs.readFileSync(render[render.indexOf("-filter_complex_script") + 1], "utf8");
    assert.doesNotMatch(script, /drawtext/);
    assert.doesNotMatch(script, /sidechaincompress/);
  });
});
```

Add to the test file's imports: `renderStage` from `../lib/ambient/stages.js`, `createJob` from `../lib/renderJobs.js` (extend the existing `getJob as getRenderJob` import line), and `markCancelled` if not already imported.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/routes/ambient.test.js`
Expected: FAIL — `words` undefined, 404 on `/words`, voice returns 200/202, voice file present in args.

- [ ] **Step 3: Implement**

`projectStore.js` — in `createProject`'s literal, after `status: "draft",` add `words: "verses",`; and export:

```js
/** What a session says over its music: spoken verses, or nothing at all. */
export const WORDS = Object.freeze(["verses", "none"]);

/** A session saved before the choice existed has verses. */
export function isMusicOnly(project) {
  return project?.words === "none";
}
```

`stages.js` — import `isMusicOnly` from `./projectStore.js` and replace `writeWithMovements`:

```js
export function writeWithMovements(dataDir, project) {
  // Music only: one picture for the whole length. The drops stay stored so
  // switching back to verses restores them, but they never place pictures.
  const source = isMusicOnly(project) ? { ...project, drops: [] } : project;
  return writeProject(dataDir, { ...project, movements: deriveMovements(source) });
}
```

In `renderStage`, change the `buildAmbientFfmpegArgs` call's drops argument to:

```js
    bedPath, images, drops: isMusicOnly(project) ? [] : (project.drops || []), outPath, workDir: dir,
```

`routes/ambient.js` — import `WORDS, isMusicOnly` from `../lib/ambient/projectStore.js`. At the top of the `POST /:id/voice` handler, right after `loadOr404`:

```js
  if (isMusicOnly(project)) {
    return res.status(400).json({ ok: false, error: "this session is music only — switch verses back on to voice them" });
  }
```

Add the route after `PATCH /:id/motion`:

```js
// PATCH /:id/words — spoken verses over the music, or music only.
router.patch("/:id/words", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  const words = req.body?.words;
  if (!WORDS.includes(words)) {
    return res.status(400).json({ ok: false, error: "words must be verses or none" });
  }
  if (ENCODING_STATUSES.has(project.status)) {
    return res.status(409).json({ ok: false, error: "this session is rendering; change it when it finishes" });
  }
  try {
    return res.json({ ok: true, project: writeWithMovements(req.ctx.dataDir, { ...project, words }) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/routes/ambient.test.js` → PASS; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ambient/projectStore.js server/src/lib/ambient/stages.js server/src/routes/ambient.js server/src/routes/ambient.test.js
git commit -m "feat(ambient): music-only sessions with one picture and no voice"
```

---

### Task 5: Bed build honours the order and records the tracklist

**Files:**
- Modify: `server/src/lib/ambient/stages.js` (`assembleBed`)
- Modify: `server/src/routes/ambient.js` (`PATCH /:id/bed` accepts `order`, hash includes it)
- Modify: `server/src/lib/ambient/projectStore.js` (bed default `order: "shuffle"`, `builtOrder: null`)
- Test: `server/src/routes/ambient.test.js`

**Interfaces:**
- Consumes: `fixedOrder`, `trackStarts`, `bedHash({ order })` (Task 2); `trackInfo` (Task 3).
- Produces: `project.bed.order: "shuffle" | "fixed"`; `project.bed.builtOrder: Array<{ ref, label, credit, startSec, durationSec }> | null` written whenever a bed is assembled (and kept when the cache hits); in `fixed` mode `bed.trackRefs` is left as the operator's list.

- [ ] **Step 1: Write the failing tests** — append inside `describe("the music bed is levelled", ...)` (it already has `fakeFfmpeg`):

```js
  test("keep-my-order plays the list as given and leaves the operator's list alone", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    const calls = [];
    _setFfmpegSpawnImpl(fakeFfmpeg(calls));
    const p = await createSession({ targetSec: 20 });
    const refs = ["library:prayer-piano", "library:peaceful-worship"];
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", order: "fixed", trackRefs: refs, crossfadeSec: 2 },
    });
    const { project } = await assembleBed({ dataDir, outputDir }, stored);
    // probe says 8 s per track: 8 + 6 + 6 >= 20 → three tracks, a b a.
    assert.deepEqual(project.bed.builtOrder.map((t) => t.ref), [refs[0], refs[1], refs[0]]);
    assert.deepEqual(project.bed.trackRefs, refs);
  });

  test("the tracklist records start times, labels and credits", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    _setFfmpegSpawnImpl(fakeFfmpeg([]));
    const p = await createSession({ targetSec: 20 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", order: "fixed", trackRefs: ["library:prayer-piano", "library:peaceful-worship"], crossfadeSec: 2 },
    });
    const { project } = await assembleBed({ dataDir, outputDir }, stored);
    assert.deepEqual(project.bed.builtOrder.map((t) => t.startSec), [0, 6, 12]);
    assert.equal(project.bed.builtOrder[0].credit, "Music from Pixabay");
    assert.ok(project.bed.builtOrder[0].label.length > 0);
  });
```

And inside `describe("PATCH /api/ambient/:id/bed", ...)`:

```js
  test("accepts shuffle or fixed order, ignores anything else", async () => {
    const p = await createSession();
    const ok = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "fixed" });
    assert.equal(ok.body.project.bed.order, "fixed");
    const bad = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "random" });
    assert.equal(bad.body.project.bed.order, "fixed");
  });

  test("changing the order drops the cached bed", async () => {
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), bed: { ...p.bed, builtPath: "x", builtHash: "old" } });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "fixed" });
    assert.equal(res.body.project.bed.builtHash, null);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/routes/ambient.test.js` → FAIL (`builtOrder` undefined, `order` not stored).

- [ ] **Step 3: Implement**

`projectStore.js` — in the default `bed` literal add `order: "shuffle",` and `builtOrder: null,`.

`routes/ambient.js` `PATCH /:id/bed` — after the `crossfadeSec` line add:

```js
    if (body.order === "shuffle" || body.order === "fixed") bed.order = body.order;
```
and change the `nextHash` line to:
```js
    const nextHash = bedHash({ trackRefs: bed.trackRefs, crossfadeSec: bed.crossfadeSec, targetSec: project.targetSec, order: bed.order || "shuffle" });
```

`stages.js` — import `fixedOrder, trackStarts` from `./bedAssembly.js` and `trackInfo` from `./trackInfo.js`. In `assembleBed`:

1. After `const refs = ...` add `const order = bed.order === "fixed" ? "fixed" : "shuffle";` and pass `order` into the first `bedHash({...})` call.
2. Replace `const order = orderTracks(tracks, project.targetSec, { crossfadeSec });` with:
```js
  const playOrder = order === "fixed"
    ? fixedOrder(tracks, project.targetSec, { crossfadeSec })
    : orderTracks(tracks, project.targetSec, { crossfadeSec });
```
   and rename every later use of `order` in the function (the loudness loop, `buildBedArgs`, `savedRefs`) to `playOrder`.
3. Replace the save block with:
```js
  const fresh = stillThere(ctx, project.projectId);
  // Shuffle stores the expanded play order (what the next render reads back);
  // fixed keeps the operator's list, so their arrangement is never rewritten.
  const savedRefs = order === "fixed" ? refs : playOrder.map((t) => t.ref);
  const builtHash = allMeasured
    ? bedHash({ trackRefs: savedRefs, crossfadeSec: bed.crossfadeSec, targetSec: project.targetSec, order })
    : null;
  const builtOrder = trackStarts(
    playOrder.map((t) => ({ ref: t.ref, durationSec: t.durationSec, ...trackInfo(ctx.dataDir, t.ref) })),
    crossfadeSec,
    project.targetSec,
  );
  const saved = writeProject(ctx.dataDir, {
    ...fresh,
    bed: { ...fresh.bed, trackRefs: savedRefs, builtPath: bedPath, builtHash, builtOrder },
  });
  return { bedPath, project: saved };
```
   (Keep the existing explanatory comment above `builtHash`.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/routes/ambient.test.js` → PASS; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ambient/stages.js server/src/lib/ambient/projectStore.js server/src/routes/ambient.js server/src/routes/ambient.test.js
git commit -m "feat(ambient): bed honours keep-my-order and records a timed tracklist"
```

---

### Task 6: One heavy job at a time

**Files:**
- Create: `server/src/lib/heavyJobGate.js`, `server/src/lib/heavyJobGate.test.js`
- Modify: `server/src/routes/ambient.js` (render runs through the gate)
- Modify: `server/src/lib/ambient/stages.js` (`renderStage` honours a cancel issued while queued)

**Interfaces:**
- Produces: `runExclusive(task: () => Promise<T>, { onQueued?: () => void, signal?: AbortSignal }) → Promise<T>`; `isHeavyBusy() → boolean`; `_resetHeavyGate()` (tests only).

- [ ] **Step 1: Write the failing test** — `server/src/lib/heavyJobGate.test.js`:

```js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runExclusive, isHeavyBusy, _resetHeavyGate } from "./heavyJobGate.js";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe("heavyJobGate", () => {
  beforeEach(() => _resetHeavyGate());

  test("a second job waits for the first", async () => {
    const first = deferred();
    const order = [];
    const a = runExclusive(async () => { order.push("a start"); await first.promise; order.push("a end"); });
    let queued = false;
    const b = runExclusive(async () => { order.push("b start"); }, { onQueued: () => { queued = true; } });
    await new Promise((r) => setImmediate(r));
    assert.equal(queued, true);
    assert.deepEqual(order, ["a start"]);
    first.resolve();
    await Promise.all([a, b]);
    assert.deepEqual(order, ["a start", "a end", "b start"]);
    assert.equal(isHeavyBusy(), false);
  });

  test("a failed job releases the gate", async () => {
    await assert.rejects(runExclusive(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await runExclusive(async () => 7), 7);
  });

  test("a queued job can be cancelled before it starts", async () => {
    const first = deferred();
    const a = runExclusive(() => first.promise);
    const ctrl = new AbortController();
    let ran = false;
    const b = runExclusive(async () => { ran = true; }, { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(b, /Cancelled/);
    first.resolve();
    await a;
    assert.equal(ran, false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && node --test src/lib/heavyJobGate.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** — `server/src/lib/heavyJobGate.js`:

```js
/**
 * One heavy job at a time on this machine.
 *
 * A two-hour Ambient encode and an AI vocal separation each hold every CPU
 * core for many minutes, and the separation needs several GB of RAM. Run
 * together they are both far slower and can exhaust memory, so they queue
 * behind each other here. In-process only: this server is one process.
 */
let active = false;
const queue = [];

export function isHeavyBusy() {
  return active;
}

function start(entry) {
  active = true;
  Promise.resolve()
    .then(entry.task)
    .then(entry.resolve, entry.reject)
    .finally(() => {
      active = false;
      const next = queue.shift();
      if (next) start(next);
    });
}

/**
 * @template T
 * @param {() => Promise<T>} task
 * @param {{ onQueued?: () => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<T>}
 */
export function runExclusive(task, { onQueued, signal } = {}) {
  return new Promise((resolve, reject) => {
    const entry = { task, resolve, reject };
    if (!active) return start(entry);
    queue.push(entry);
    signal?.addEventListener("abort", () => {
      const i = queue.indexOf(entry);
      if (i >= 0) {
        queue.splice(i, 1);
        reject(new Error("Cancelled."));
      }
    }, { once: true });
    try { onQueued?.(); } catch { /* a progress write must not break the queue */ }
    return undefined;
  });
}

/** Tests only. */
export function _resetHeavyGate() {
  active = false;
  queue.length = 0;
}
```

- [ ] **Step 4: Wire renders through the gate**

`routes/ambient.js` — import `runExclusive` from `../lib/heavyJobGate.js`. In `POST /:id/render`, replace `stage(ctx, id, job.jobId).catch(...)` with:

```js
    runExclusive(() => stage(ctx, id, job.jobId), {
      onQueued: () => {
        const live = readProject(ctx.dataDir, id);
        if (live) writeProject(ctx.dataDir, { ...live, render: { jobId: job.jobId, outputPath: null, status: "running", percent: 0, phase: "waiting for another job to finish" } });
      },
    }).catch((err) => {
```
(keep the existing catch body unchanged).

`stages.js` `renderStage` — right after `if (!start) throw new Error("project not found");` add:

```js
  // Cancelled while it waited its turn behind another heavy job.
  if (isCancelled(projectId)) {
    clearCancelled(projectId);
    throw new Error("Cancelled.");
  }
```

- [ ] **Step 5: Run to verify**

Run: `cd server && node --test src/lib/heavyJobGate.test.js` → PASS; `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/heavyJobGate.js server/src/lib/heavyJobGate.test.js server/src/routes/ambient.js server/src/lib/ambient/stages.js
git commit -m "feat: one heavy job at a time; renders queue behind each other"
```

---

### Task 7: Encode with the graphics chip

**Files:**
- Create: `server/src/lib/ambient/encoders.js`, `server/src/lib/ambient/encoders.test.js`
- Modify: `server/src/lib/ambient/ambientRender.js` (`encoder` option)
- Modify: `server/src/lib/ambient/stages.js` (`renderStage(ctx, id, jobId, { encoder })`, AMF→CPU retry, `render.encoderUsed`)
- Modify: `server/src/routes/ambient.js` (`POST /:id/render { encoder }`)
- Test: `server/src/lib/ambient/ambientRender.test.js`, `server/src/routes/ambient.test.js`

**Interfaces:**
- Produces:
  - `ENCODERS = ["cpu", "amf"]`; `videoCodecArgs(encoder) → string[]`; `amfAvailable() → boolean` (cached); `_setEncodersProbe(fn)` / `_resetEncodersProbe()` for tests.
  - `buildAmbientFfmpegArgs(project, { ..., encoder = "cpu" })`.
  - `renderStage(ctx, projectId, jobId, { encoder = "cpu" } = {})`; stored `render.encoderUsed: "cpu" | "amf"`.
  - `POST /api/ambient/:id/render` accepts `{ encoder }`; unknown values become `"cpu"`.

- [ ] **Step 1: Write the failing tests**

`encoders.test.js`:

```js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { videoCodecArgs, amfAvailable, _setEncodersProbe, _resetEncodersProbe } from "./encoders.js";

describe("encoders", () => {
  afterEach(() => _resetEncodersProbe());

  test("cpu is today's x264 settings", () => {
    assert.deepEqual(videoCodecArgs("cpu"), ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]);
  });

  test("amf uses the AMD encoder at constant quality", () => {
    assert.deepEqual(videoCodecArgs("amf"), ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24"]);
  });

  test("anything else is cpu", () => {
    assert.deepEqual(videoCodecArgs("nvenc"), videoCodecArgs("cpu"));
  });

  test("amf is available only when ffmpeg lists h264_amf", () => {
    _setEncodersProbe(() => " V....D h264_amf  AMD AMF H.264 Encoder");
    assert.equal(amfAvailable(), true);
    _setEncodersProbe(() => " V....D libx264  H.264");
    assert.equal(amfAvailable(), false);
  });
});
```

Append to `ambientRender.test.js` (reuse its existing fixture project/helper; if it has none, build a minimal project `{ targetSec: 60, aspect: "landscape", motion: "still", captions: "none", movements: [{ startMs: 0, endMs: 60000 }], bed: { volume: 0.85 } }` with `images: ["/tmp/a.jpg"]`, `bedPath: "/tmp/bed.m4a"`, `drops: []`, `outPath: "/tmp/out.mp4"`):

```js
test("the graphics-chip encoder swaps only the video codec", () => {
  const base = { bedPath: "/tmp/bed.m4a", images: ["/tmp/a.jpg"], drops: [], outPath: "/tmp/out.mp4" };
  const project = { targetSec: 60, aspect: "landscape", motion: "still", captions: "none", movements: [{ startMs: 0, endMs: 60000 }], bed: { volume: 0.85 } };
  const cpu = buildAmbientFfmpegArgs(project, base).args;
  const amf = buildAmbientFfmpegArgs(project, { ...base, encoder: "amf" }).args;
  assert.ok(cpu.includes("libx264"));
  assert.ok(amf.includes("h264_amf"));
  assert.ok(!amf.includes("libx264"));
  assert.ok(amf.includes("yuv420p"));
});
```

Append to `ambient.test.js` inside `describe("POST /api/ambient/:id/render", ...)` (the render stage is stubbed via `_setRenderStageImpl`; capture its 4th argument). The session needs a bed and imaged movements the same way the existing render tests in that block prepare it — reuse their setup helper:

```js
  test("passes the chosen encoder to the render, and only cpu or amf", async () => {
    const seen = [];
    _setRenderStageImpl(async (_ctx, _id, _job, opts) => { seen.push(opts?.encoder); });
    const p = await readyToRender(); // the helper this describe block already uses; if it has none, inline its setup
    await request(app).post(`/api/ambient/${p.projectId}/render`).send({ encoder: "amf" });
    await waitFor(p.projectId, () => seen.length === 1);
    assert.deepEqual(seen, ["amf"]);
  });
```
If the block has no `readyToRender`, write it at the top of the block: create a session, write a project with `movements: [{ id: "m1", startMs: 0, endMs: 3600000, imageStatus: "done", imagePath: <a file in outputDir> }]` and `bed.trackRefs: ["library:prayer-piano"]`, return it. Also add a second render test posting `{ encoder: "nvenc" }` asserting `"cpu"` (call `_resetHeavyGate()` from `../lib/heavyJobGate.js` in this block's `beforeEach` so a previous test's render cannot hold the gate).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/ambient/encoders.test.js src/lib/ambient/ambientRender.test.js src/routes/ambient.test.js` → FAIL.

- [ ] **Step 3: Implement**

`server/src/lib/ambient/encoders.js`:

```js
import { spawnSync } from "child_process";

/**
 * Video encoders an Ambient render can use. "amf" is the AMD graphics chip's
 * H.264 encoder: several times faster than x264 on a laptop and it leaves the
 * CPU free, at slightly lower quality for the size. Values tuned in the spike
 * (docs/vocal-removal.md, "Measured on this laptop").
 */
export const ENCODERS = Object.freeze(["cpu", "amf"]);

export function videoCodecArgs(encoder) {
  if (encoder === "amf") {
    return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24"];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"];
}

function realProbe() {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const r = spawnSync(ff, ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return String(r.stdout || "");
}
let _probe = realProbe;
let cached = null;
export function _setEncodersProbe(fn) { _probe = fn; cached = null; }
export function _resetEncodersProbe() { _probe = realProbe; cached = null; }

/** Whether this machine's ffmpeg has the AMD encoder. Probed once. */
export function amfAvailable() {
  if (cached === null) {
    try { cached = /\bh264_amf\b/.test(_probe()); } catch { cached = false; }
  }
  return cached;
}
```

`ambientRender.js` — import `videoCodecArgs`; add `encoder = "cpu"` to the destructured options of `buildAmbientFfmpegArgs`; replace `"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS),` with:

```js
    ...videoCodecArgs(encoder), "-pix_fmt", "yuv420p", "-r", String(FPS),
```

`stages.js` — import `amfAvailable` from `./encoders.js`. Change the signature to `export async function renderStage(ctx, projectId, jobId, { encoder = "cpu" } = {})`. Move the existing `new Promise(... spawnFfmpeg(built.args) ...)` block into a local function and call it with an AMF→CPU fallback:

```js
  const encodeWith = (args) => new Promise((resolve) => {
    // ... the existing body unchanged, using `args` instead of `built.args` ...
  });

  const wanted = encoder === "amf" && amfAvailable() ? "amf" : "cpu";
  const argsFor = (enc) => buildAmbientFfmpegArgs(project, {
    bedPath, images, drops: isMusicOnly(project) ? [] : (project.drops || []), outPath, workDir: dir, encoder: enc,
  }).args;
  let encoderUsed = wanted;
  let result = await encodeWith(argsFor(wanted));
  if (!result.ok && wanted === "amf" && !isCancelled(projectId)) {
    // The graphics encoder failed (driver, unsupported size): the CPU encode
    // is slower but always there.
    encoderUsed = "cpu";
    result = await encodeWith(argsFor("cpu"));
  }
```
Delete the old `const built = buildAmbientFfmpegArgs(...)` line. In both final `writeProject` calls add `encoderUsed` to the `render` object.

`routes/ambient.js` — import `ENCODERS` from `../lib/ambient/encoders.js`; in `POST /:id/render`:

```js
    const encoder = ENCODERS.includes(req.body?.encoder) ? req.body.encoder : "cpu";
```
and call `stage(ctx, id, job.jobId, { encoder })` inside `runExclusive`.

- [ ] **Step 4: Run to verify they pass**

Run the three files, then `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ambient/encoders.js server/src/lib/ambient/encoders.test.js server/src/lib/ambient/ambientRender.js server/src/lib/ambient/ambientRender.test.js server/src/lib/ambient/stages.js server/src/routes/ambient.js server/src/routes/ambient.test.js
git commit -m "feat(ambient): optional AMD graphics-chip encode with CPU fallback"
```

---

### Task 8: Separator wrapper (pure parts + process runner)

**Files:**
- Create: `server/src/lib/stems/separator.js`, `server/src/lib/stems/separator.test.js`

**Interfaces:**
- Produces:
  - `MODELS = { best: "model_bs_roformer_ep_317_sdr_12.9755.ckpt", fast: "htdemucs.yaml" }` (confirmed in the spike).
  - `stemsCli(env = process.env) → string | null`
  - `buildSeparatorArgs({ input, outDir, quality, modelDir }) → string[]` (throws if `input`/`outDir` not absolute)
  - `parseProgress(text) → number | null` (0–100)
  - `separatorAvailable({ timeoutMs = 20000 }?) → Promise<{ ok: boolean, version?: string, reason?: string }>` (cached)
  - `removeVocals({ input, outPath, workDir, quality, onProgress, signal }) → Promise<string>` (resolves to `outPath`)
  - Test seams: `_setSpawnImpl(fn)`, `_resetSpawnImpl()`, `_resetAvailability()`.

- [ ] **Step 1: Write the failing tests** — `separator.test.js` (replace the progress fixture strings with two real lines captured in Task 1 Step 3):

```js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MODELS, stemsCli, buildSeparatorArgs, parseProgress,
  separatorAvailable, removeVocals, _setSpawnImpl, _resetSpawnImpl, _resetAvailability,
} from "./separator.js";

function fakeProc({ code = 0, stdout = "", stderr = "", onSpawn } = {}) {
  return (cmd, args, opts) => {
    onSpawn?.(cmd, args, opts);
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => { p.killed = true; setImmediate(() => p.emit("close", null)); };
    setImmediate(() => {
      if (stdout) p.stdout.emit("data", Buffer.from(stdout));
      if (stderr) p.stderr.emit("data", Buffer.from(stderr));
      p.emit("close", code);
    });
    return p;
  };
}

describe("stemsCli", () => {
  test("unset means the feature is off", () => assert.equal(stemsCli({}), null));
  test("reads STEMS_CLI", () => assert.equal(stemsCli({ STEMS_CLI: " C:\\v\\python.exe " }), "C:\\v\\python.exe"));
});

describe("buildSeparatorArgs", () => {
  const input = path.resolve("/music/My Song's \"Best\".mp3");
  const outDir = path.resolve("/work/job 1");

  test("best quality uses the Roformer model and asks only for the instrumental", () => {
    const args = buildSeparatorArgs({ input, outDir, quality: "best" });
    assert.equal(args[0], input);
    assert.equal(args[args.indexOf("--model_filename") + 1], MODELS.best);
    assert.equal(args[args.indexOf("--single_stem") + 1], "Instrumental");
    assert.equal(args[args.indexOf("--output_dir") + 1], outDir);
  });

  test("fast uses the Demucs model; unknown quality is best", () => {
    assert.equal(buildSeparatorArgs({ input, outDir, quality: "fast" }).includes(MODELS.fast), true);
    assert.equal(buildSeparatorArgs({ input, outDir, quality: "ultra" }).includes(MODELS.best), true);
  });

  test("a path with spaces and quotes stays one argument", () => {
    assert.ok(buildSeparatorArgs({ input, outDir, quality: "best" }).includes(input));
  });

  test("the model folder is passed when set", () => {
    const args = buildSeparatorArgs({ input, outDir, quality: "best", modelDir: path.resolve("/models") });
    assert.equal(args[args.indexOf("--model_file_dir") + 1], path.resolve("/models"));
  });

  test("refuses a relative input (it could be read as a flag)", () => {
    assert.throws(() => buildSeparatorArgs({ input: "-rf", outDir, quality: "best" }), /absolute/);
  });
});

describe("parseProgress", () => {
  test("reads the last percentage in a chunk", () => {
    assert.equal(parseProgress(" 12%|█▏        | 3/25 [00:05<00:40]\r 48%|████▊     | 12/25"), 48);
  });
  test("null when there is none", () => assert.equal(parseProgress("Loading model..."), null));
});

describe("separatorAvailable", () => {
  afterEach(() => { _resetSpawnImpl(); _resetAvailability(); delete process.env.STEMS_CLI; });

  test("off when STEMS_CLI is unset", async () => {
    delete process.env.STEMS_CLI;
    assert.equal((await separatorAvailable()).ok, false);
  });

  test("on when --version exits 0, spawned without a shell", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    let seen;
    _setSpawnImpl(fakeProc({ stdout: "audio-separator 0.30.1", onSpawn: (cmd, args, opts) => { seen = { cmd, args, opts }; } }));
    const r = await separatorAvailable();
    assert.equal(r.ok, true);
    assert.equal(seen.cmd, "C:\\v\\python.exe");
    assert.deepEqual(seen.args, ["--version"]);
    assert.equal(seen.opts.shell, false);
  });

  test("off when --version fails", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    _setSpawnImpl(fakeProc({ code: 1 }));
    assert.equal((await separatorAvailable()).ok, false);
  });

  test("off, not hung, when --version never answers", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    _setSpawnImpl(() => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; return p; });
    const r = await separatorAvailable({ timeoutMs: 20 });
    assert.equal(r.ok, false);
  });
});

describe("removeVocals", () => {
  afterEach(() => { _resetSpawnImpl(); delete process.env.STEMS_CLI; });

  test("separates, converts the instrumental to m4a, reports progress and cleans up", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    const workDir = path.join(root, "work");
    const outPath = path.join(root, "instrumental-1.m4a");
    const calls = [];
    const progress = [];
    _setSpawnImpl((cmd, args, opts) => {
      calls.push({ cmd, args });
      if (cmd !== "C:\\v\\python.exe") fs.writeFileSync(args[args.length - 1], "m4a"); // ffmpeg writes outPath
      else fs.writeFileSync(path.join(workDir, "song_(Instrumental)_model.wav"), "wav");
      return fakeProc({ stderr: cmd === "C:\\v\\python.exe" ? " 50%|█████ | 5/10" : "" })(cmd, args, opts);
    });
    const result = await removeVocals({ input: path.join(root, "song.mp3"), outPath, workDir, quality: "fast", onProgress: (p) => progress.push(p) });
    assert.equal(result, outPath);
    assert.equal(fs.existsSync(outPath), true);
    assert.equal(fs.existsSync(workDir), false, "work files removed");
    assert.deepEqual(progress, [50]);
    const ff = calls[1];
    assert.ok(ff.args.includes(path.join(workDir, "song_(Instrumental)_model.wav")));
    assert.ok(ff.args.includes("aac"));
  });

  test("fails clearly when the separator writes no instrumental", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setSpawnImpl(fakeProc());
    await assert.rejects(
      removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best" }),
      /no instrumental/,
    );
  });

  test("a non-zero exit is an error carrying the tail of stderr", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setSpawnImpl(fakeProc({ code: 2, stderr: "CUDA? no. out of memory" }));
    await assert.rejects(
      removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best" }),
      /out of memory/,
    );
  });

  test("an abort kills the process", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    let proc;
    _setSpawnImpl(() => { proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit("close", null)); }; return proc; });
    const ctrl = new AbortController();
    const run = removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best", signal: ctrl.signal });
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    await assert.rejects(run, /Cancelled/);
    assert.equal(proc.killed, true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/stems/separator.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** — `server/src/lib/stems/separator.js`:

```js
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

/**
 * Vocal removal through the `audio-separator` CLI installed in its own
 * Python venv; STEMS_CLI is the path to that venv's audio-separator.exe
 * (`python -m audio_separator.utils.cli` exits 0 without doing anything). Laptop-only: with STEMS_CLI unset the feature is
 * hidden, which is how the deployed server runs. Model names and the module
 * path were confirmed on the operator's laptop (docs/vocal-removal.md).
 */
export const MODELS = Object.freeze({
  best: "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
  fast: "htdemucs.yaml",
});

let _spawn = spawn;
export function _setSpawnImpl(fn) { _spawn = fn; }
export function _resetSpawnImpl() { _spawn = spawn; }

export function stemsCli(env = process.env) {
  const p = String(env.STEMS_CLI || "").trim();
  return p || null;
}

export function buildSeparatorArgs({ input, outDir, quality, modelDir }) {
  // The input sits where the CLI expects a positional argument; a relative
  // value such as "-rf" would be read as a flag.
  if (!path.isAbsolute(String(input || "")) || !path.isAbsolute(String(outDir || ""))) {
    throw new Error("separator paths must be absolute");
  }
  const model = MODELS[quality] || MODELS.best;
  const args = [
    input,
    "--model_filename", model,
    "--output_dir", outDir,
    "--output_format", "WAV",
    "--single_stem", "Instrumental",
  ];
  if (modelDir) args.push("--model_file_dir", modelDir);
  return args;
}

/** The last "NN%|" progress-bar percentage in a chunk of output. */
export function parseProgress(text) {
  const all = [...String(text || "").matchAll(/(\d{1,3})%\|/g)];
  if (all.length === 0) return null;
  const n = Number(all[all.length - 1][1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Spawn without a shell; resolve on exit 0, reject with the stderr tail otherwise. */
function run(cmd, args, { onOutput, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled."));
    let proc;
    try {
      proc = _spawn(cmd, args, { shell: false, windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    let tail = "";
    let aborted = false;
    const onAbort = () => { aborted = true; try { proc.kill(); } catch { /* already gone */ } };
    signal?.addEventListener("abort", onAbort, { once: true });
    const take = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      onOutput?.(s);
    };
    proc.stdout?.on("data", take);
    proc.stderr?.on("data", take);
    proc.on("error", (e) => { signal?.removeEventListener("abort", onAbort); reject(e); });
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (aborted) return reject(new Error("Cancelled."));
      if (code === 0) return resolve();
      return reject(new Error(`${path.basename(cmd)} exited ${code}: ${tail.slice(-400)}`));
    });
    return undefined;
  });
}

let cached = null;
export function _resetAvailability() { cached = null; }

/** Whether this machine can remove vocals. Probed once per process. */
export async function separatorAvailable({ timeoutMs = 20_000 } = {}) {
  if (cached) return cached;
  const py = stemsCli();
  if (!py) {
    cached = { ok: false, reason: "STEMS_CLI is not set" };
    return cached;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let out = "";
  try {
    await run(py, ["--version"], { onOutput: (s) => { out += s; }, signal: ctrl.signal });
    cached = { ok: true, version: out.trim().split(/\s+/).pop() || "" };
  } catch (e) {
    cached = { ok: false, reason: ctrl.signal.aborted ? "timed out" : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
  return cached;
}

/**
 * Separate `input`, keep only the instrumental, and store it as AAC at
 * `outPath`. The WAV working files are removed whatever happens.
 */
export async function removeVocals({ input, outPath, workDir, quality, onProgress, signal }) {
  const py = stemsCli();
  if (!py) throw new Error("vocal removal is not set up on this machine");
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const args = buildSeparatorArgs({ input, outDir: workDir, quality, modelDir: process.env.STEMS_MODEL_DIR?.trim() || undefined });
    await run(py, args, {
      signal,
      onOutput: (s) => { const p = parseProgress(s); if (p !== null) onProgress?.(p); },
    });
    const wav = fs.readdirSync(workDir).find((f) => /instrumental/i.test(f) && /\.wav$/i.test(f));
    if (!wav) throw new Error("the separator finished but wrote no instrumental");
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    await run(ff, ["-y", "-i", path.join(workDir, wav), "-c:a", "aac", "-b:a", "192k", outPath], { signal });
    return outPath;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
```


- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/stems/separator.test.js` → PASS; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/stems/separator.js server/src/lib/stems/separator.test.js
git commit -m "feat(stems): audio-separator wrapper for vocal removal"
```

---

### Task 9: Separation jobs, sweep, and music routes

**Files:**
- Create: `server/src/lib/stems/stemJobs.js`, `server/src/lib/stems/sweep.js`, `server/src/lib/stems/sweep.test.js`
- Modify: `server/src/routes/music.js`
- Test: `server/src/routes/music.test.js`

**Interfaces:**
- Consumes: `separatorAvailable`, `removeVocals` (Task 8); `runExclusive` (Task 6); `amfAvailable` (Task 7); `registerTrack` with `credit`, `derivedFrom` (Task 3); `resolveTrackFile` from `../lib/ambient/stages.js`; `listTracks`; `probeAudioDurationSec`.
- Produces (HTTP, all under `/api/music`):
  - `GET /capabilities` → `{ ok, vocalRemoval: boolean, amfEncoder: boolean }`
  - `POST /:id/instrumental { quality }` → `{ ok, jobId }` | 404 unknown track | 409 not set up
  - `GET /instrumental/:jobId` → `{ ok, job: { jobId, status: "queued"|"running"|"done"|"error", percent, error, sourceRef, sourcePreview, resultFile } }` | 404
  - `POST /instrumental/:jobId/cancel` → `{ ok }`
  - `POST /instrumental/:jobId/keep` → `{ ok, track }` (409 unless `done`)
  - `POST /instrumental/:jobId/discard` → `{ ok }`
  - Module: `createStemJob`, `getStemJob(jobId, userId)`, `updateStemJob`, `removeStemJob`, `_resetStemJobs`; `sweepStaleInstrumentals({ dataDir, outputDir }, now = Date.now())`; test seams `_setSeparatorImpl({ available, remove })`, `_resetSeparatorImpl()` exported from `routes/music.js`.

- [ ] **Step 1: Write the failing tests**

`sweep.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { sweepStaleInstrumentals } from "./sweep.js";
import { registerTrack } from "../musicLibraryStore.js";

test("removes unkept instrumentals older than a week, keeps kept and recent ones", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sweep-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  const old = path.join(outputDir, "instrumental-old.m4a");
  const kept = path.join(outputDir, "instrumental-kept.m4a");
  const fresh = path.join(outputDir, "instrumental-new.m4a");
  const other = path.join(outputDir, "video.mp4");
  for (const f of [old, kept, fresh, other]) fs.writeFileSync(f, "x");
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  for (const f of [old, kept, other]) fs.utimesSync(f, eightDaysAgo, eightDaysAgo);
  registerTrack(dataDir, { file: kept, label: "Kept" });
  sweepStaleInstrumentals({ dataDir, outputDir });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(kept), true);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(other), true);
});
```

Append to `music.test.js` (add imports: `_setSeparatorImpl, _resetSeparatorImpl` from `./music.js`; `_resetStemJobs` from `../lib/stems/stemJobs.js`; `_resetHeavyGate` from `../lib/heavyJobGate.js`; `afterEach` from `node:test`):

```js
describe("vocal removal routes", () => {
  afterEach(() => { _resetSeparatorImpl(); _resetStemJobs(); _resetHeavyGate(); });

  const call = async (method, route, req) => { const r = res(); await handlerFor(method, route)(req, r); return r; };
  const until = async (pred) => { for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5)); };

  test("capabilities say no when the separator is not set up", async () => {
    _setSeparatorImpl({ available: async () => ({ ok: false }) });
    const r = await call("get", "/capabilities", { ctx: tenant().ctx });
    assert.equal(r.payload.vocalRemoval, false);
  });

  test("starting a separation is refused when not set up", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: false }) });
    const r = await call("post", "/:id/instrumental", { ctx: { ...ctx, userId: "u1" }, params: { id: t.id }, body: {} });
    assert.equal(r.statusCode, 409);
  });

  test("an unknown track is 404, never a path from the request", async () => {
    _setSeparatorImpl({ available: async () => ({ ok: true }) });
    const r = await call("post", "/:id/instrumental", { ctx: { ...tenant().ctx, userId: "u1" }, params: { id: "../../etc/passwd" }, body: {} });
    assert.equal(r.statusCode, 404);
  });

  test("keep saves a new track that inherits licence and credit, and leaves the original alone", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song", licence: "unknown", credit: "Choir X", mood: "worship" });
    let seenInput;
    _setSeparatorImpl({
      available: async () => ({ ok: true }),
      remove: async ({ input, outPath, onProgress }) => { seenInput = input; onProgress(40); fs.writeFileSync(outPath, "m4a"); return outPath; },
    });
    const c = { ...ctx, userId: "u1" };
    const started = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: { quality: "fast" } });
    assert.equal(started.payload.ok, true);
    const { jobId } = started.payload;
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId } })).payload.job.status === "done");
    assert.equal(fs.realpathSync(seenInput), fs.realpathSync(file));
    const kept = await call("post", "/instrumental/:jobId/keep", { ctx: c, params: { jobId } });
    assert.equal(kept.payload.ok, true);
    assert.equal(kept.payload.track.label, "Song (instrumental)");
    assert.equal(kept.payload.track.licence, "unknown");
    assert.equal(kept.payload.track.credit, "Choir X");
    assert.equal(kept.payload.track.derivedFrom, `mylib:${src.id}`);
    const lib = readMusicLibrary(ctx.dataDir).items;
    assert.equal(lib.find((t) => t.id === src.id).label, "Song");
    assert.equal(lib.length, 2);
  });

  test("another user's job is 404", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { fs.writeFileSync(outPath, "x"); return outPath; } });
    const started = await call("post", "/:id/instrumental", { ctx: { ...ctx, userId: "u1" }, params: { id: src.id }, body: {} });
    const r = await call("get", "/instrumental/:jobId", { ctx: { ...ctx, userId: "u2" }, params: { jobId: started.payload.jobId } });
    assert.equal(r.statusCode, 404);
  });

  test("discard deletes the result and forgets the job", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    let out;
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { out = outPath; fs.writeFileSync(outPath, "x"); return outPath; } });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(() => out && fs.existsSync(out));
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "done");
    await call("post", "/instrumental/:jobId/discard", { ctx: c, params: { jobId: payload.jobId } });
    assert.equal(fs.existsSync(out), false);
    assert.equal((await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).statusCode, 404);
  });

  test("a failed separation reports its error and leaves no file", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async () => { throw new Error("out of memory"); } });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "error");
    const job = (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job;
    assert.match(job.error, /out of memory/);
  });
});
```


- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/stems/sweep.test.js src/routes/music.test.js` → FAIL.

- [ ] **Step 3: Implement**

`server/src/lib/stems/stemJobs.js`:

```js
/**
 * Vocal-removal jobs, in memory. A separation is minutes long and its only
 * durable output is a file in the tenant's outputs; a server restart forgets
 * the job and the sweep removes an unkept result later.
 */
const jobs = new Map();

export function createStemJob({ jobId, userId, sourceRef, sourcePreview, resultPath }) {
  const job = {
    jobId, userId, sourceRef, sourcePreview, resultPath,
    status: "queued", percent: 0, error: null, controller: new AbortController(), createdAt: Date.now(),
  };
  jobs.set(jobId, job);
  return job;
}

/** The job, only for the user who started it. */
export function getStemJob(jobId, userId) {
  const job = jobs.get(String(jobId));
  return job && job.userId === userId ? job : null;
}

export function updateStemJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, patch);
  return job;
}

export function removeStemJob(jobId) {
  jobs.delete(jobId);
}

export function _resetStemJobs() {
  jobs.clear();
}
```
*(The registry mutates its own entries in place — it is the single owner of this state, matching `lib/renderJobs.js`.)*

`server/src/lib/stems/sweep.js`:

```js
import fs from "fs";
import path from "path";
import { readMusicLibrary } from "../musicLibraryStore.js";

const WEEK_MS = 7 * 86_400_000;

/** Delete instrumentals nobody kept, a week after they were made. */
export function sweepStaleInstrumentals({ dataDir, outputDir }, now = Date.now()) {
  let names;
  try { names = fs.readdirSync(outputDir); } catch { return; }
  const kept = new Set(readMusicLibrary(dataDir).items.map((t) => path.resolve(t.file)));
  for (const name of names) {
    if (!/^instrumental-[\w-]+\.m4a$/.test(name)) continue;
    const file = path.resolve(outputDir, name);
    if (kept.has(file)) continue;
    try {
      if (now - fs.statSync(file).mtimeMs > WEEK_MS) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}
```
Note: `registerTrack` stores the path as passed; the keep route passes `fs.realpathSync(resultPath)` — so also compare against `fs.realpathSync` when building `kept` if paths differ on the machine (wrap in try/catch). Use `path.resolve` as above and pass the same resolved path in the keep route.

`routes/music.js` — add imports:

```js
import crypto from "crypto";
import { resolveTrackFile } from "../lib/ambient/stages.js";
import { amfAvailable } from "../lib/ambient/encoders.js";
import { runExclusive } from "../lib/heavyJobGate.js";
import { separatorAvailable, removeVocals } from "../lib/stems/separator.js";
import { createStemJob, getStemJob, updateStemJob, removeStemJob } from "../lib/stems/stemJobs.js";
import { sweepStaleInstrumentals } from "../lib/stems/sweep.js";
import { quota } from "../middleware/quota.js";
```

Then add, before `export default router;`:

```js
let _separator = { available: separatorAvailable, remove: removeVocals };
export function _setSeparatorImpl(impl) { _separator = { ..._separator, ...impl }; }
export function _resetSeparatorImpl() { _separator = { available: separatorAvailable, remove: removeVocals }; }

/** The source track as `{ ref, label, mood, licence, credit, previewUrl }`, or null. */
function sourceTrack(dataDir, id) {
  const bundled = listTracks().find((t) => t.id === id);
  if (bundled) {
    return { ref: `library:${id}`, label: bundled.label, mood: bundled.mood, licence: "pixabay-cleared", credit: BUNDLED_CREDIT, previewUrl: bundled.previewUrl };
  }
  const mine = readMusicLibrary(dataDir).items.find((t) => t.id === id);
  if (!mine) return null;
  return { ref: `mylib:${id}`, label: mine.label, mood: mine.mood, licence: mine.licence, credit: mine.credit || "", previewUrl: path.basename(mine.file) };
}

function jobView(job) {
  return {
    jobId: job.jobId, status: job.status, percent: job.percent, error: job.error,
    sourceRef: job.sourceRef, sourcePreview: job.sourcePreview,
    resultFile: job.status === "done" ? path.basename(job.resultPath) : null,
  };
}

router.get("/capabilities", async (req, res) => {
  const sep = await _separator.available();
  res.json({ ok: true, vocalRemoval: Boolean(sep?.ok), amfEncoder: amfAvailable() });
});

router.post("/:id/instrumental", quota("render"), async (req, res) => {
  try {
    const src = sourceTrack(req.ctx.dataDir, String(req.params.id));
    if (!src) return res.status(404).json({ ok: false, error: "track not found" });
    if (!(await _separator.available())?.ok) {
      return res.status(409).json({ ok: false, error: "vocal removal is not set up on this machine — see docs/vocal-removal.md" });
    }
    const input = resolveTrackFile({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, src.ref);
    if (!input) return res.status(404).json({ ok: false, error: "that track's audio file is missing" });

    sweepStaleInstrumentals(req.ctx);
    const jobId = crypto.randomUUID();
    const resultPath = path.resolve(req.ctx.outputDir, `instrumental-${jobId}.m4a`);
    const workDir = path.resolve(req.ctx.outputDir, "stems-work", jobId);
    const quality = req.body?.quality === "fast" ? "fast" : "best";
    const job = createStemJob({ jobId, userId: req.ctx.userId, sourceRef: src.ref, sourcePreview: src.previewUrl, resultPath });

    runExclusive(async () => {
      updateStemJob(jobId, { status: "running" });
      await _separator.remove({
        input, outPath: resultPath, workDir, quality, signal: job.controller.signal,
        onProgress: (p) => updateStemJob(jobId, { percent: Math.min(99, p) }),
      });
      updateStemJob(jobId, { status: "done", percent: 100 });
    }, { signal: job.controller.signal }).catch((e) => {
      fs.rmSync(resultPath, { force: true });
      updateStemJob(jobId, { status: "error", error: String(e?.message || e) });
    });

    return res.json({ ok: true, jobId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/instrumental/:jobId", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  return res.json({ ok: true, job: jobView(job) });
});

router.post("/instrumental/:jobId/cancel", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  job.controller.abort();
  return res.json({ ok: true });
});

router.post("/instrumental/:jobId/keep", async (req, res) => {
  try {
    const job = getStemJob(req.params.jobId, req.ctx.userId);
    if (!job) return res.status(404).json({ ok: false, error: "job not found" });
    if (job.status !== "done") return res.status(409).json({ ok: false, error: "the instrumental is not ready yet" });
    const src = sourceTrack(req.ctx.dataDir, job.sourceRef.replace(/^(library|mylib):/, ""));
    let durationSec = null;
    try { durationSec = await probeAudioDurationSec(job.resultPath); } catch { /* recorded without it */ }
    const track = registerTrack(req.ctx.dataDir, {
      file: job.resultPath,
      label: `${src?.label || "Track"} (instrumental)`,
      mood: src?.mood,
      // Separating a song does not clear it: the instrumental carries the
      // original's licence and credit, and the bed's licence gate still applies.
      licence: src?.licence || "unknown",
      credit: src?.credit || "",
      derivedFrom: job.sourceRef,
      durationSec,
    });
    removeStemJob(job.jobId);
    return res.json({ ok: true, track: toListed(track) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/instrumental/:jobId/discard", (req, res) => {
  const job = getStemJob(req.params.jobId, req.ctx.userId);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  job.controller.abort();
  fs.rmSync(job.resultPath, { force: true });
  removeStemJob(job.jobId);
  return res.json({ ok: true });
});
```

Check the import of `BUNDLED_CREDIT` from Task 3 is present, and confirm `listTracks()` entries carry `mood` and `previewUrl` (they do in the current `/library` output). Route order: the literal `/capabilities` and `/instrumental/...` paths are all distinct from `/:id` routes by method or segment count, so no reordering is needed.

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/stems/sweep.test.js src/routes/music.test.js` → PASS; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/stems/stemJobs.js server/src/lib/stems/sweep.js server/src/lib/stems/sweep.test.js server/src/routes/music.js server/src/routes/music.test.js
git commit -m "feat(music): make-instrumental jobs with preview, keep and discard"
```

---

### Task 10: Client — types, API calls, tracklist chapters and credits

**Files:**
- Modify: `client/src/lib/ambientTypes.ts`, `client/src/lib/ambientApi.ts`, `client/src/lib/ambientShare.ts`, `client/src/lib/musicLibraryApi.ts`
- Test: `client/src/lib/__tests__/ambientShare.test.ts`, create `client/src/lib/__tests__/musicLibraryApi.instrumental.test.ts`

**Interfaces:**
- Produces:
  - Types: `AmbientWords = 'verses' | 'none'`; `AmbientProject.words?: AmbientWords`; `AmbientBed.order?: 'shuffle' | 'fixed'`; `AmbientBed.builtOrder?: AmbientTrackEntry[] | null` where `AmbientTrackEntry = { ref: string; label: string; credit: string; startSec: number; durationSec: number }`; `AmbientRenderState.encoderUsed?: 'cpu' | 'amf'`; `MusicTrack.credit?: string`, `MusicTrack.derivedFrom?: string | null`.
  - `ambientApi.setWords(id, words)`, `ambientApi.render(id, encoder?: 'cpu' | 'amf')`; `AmbientBedPatch.order?`.
  - `musicLibraryApi`: `fetchCapabilities()`, `startInstrumental(id, quality)`, `getInstrumental(jobId)`, `cancelInstrumental(jobId)`, `keepInstrumental(jobId)`, `discardInstrumental(jobId)`; `updateTrack` patch accepts `credit`.
  - `ambientChapters(project)` uses the tracklist when music-only or no spoken verses; `ambientDescription(project)` appends `Music credits:`.

- [ ] **Step 1: Write the failing tests** — append to `ambientShare.test.ts` (keep existing imports; add `ambientChapters, ambientDescription` if missing):

```ts
describe('tracklist chapters and music credits', () => {
  const entry = (label: string, startSec: number, durationSec: number, credit = '') =>
    ({ ref: `mylib:${label}`, label, credit, startSec, durationSec });
  const musicOnly = (builtOrder: ReturnType<typeof entry>[]) => ({
    words: 'none', theme: 'Soaking worship', drops: [], movements: [],
    bed: { builtOrder },
  }) as unknown as AmbientProject;

  it('a music-only session gets one chapter per track', () => {
    const p = musicOnly([entry('Grace', 0, 300), entry('Peace', 294, 300), entry('Rest', 588, 300)]);
    expect(ambientChapters(p)).toEqual([
      { startMs: 0, title: 'Grace' },
      { startMs: 294_000, title: 'Peace' },
      { startMs: 588_000, title: 'Rest' },
    ]);
  });

  it('drops tracks that play for under ten seconds (a YouTube rule)', () => {
    const p = musicOnly([entry('Grace', 0, 300), entry('Tail', 300, 5)]);
    expect(ambientChapters(p).map((c) => c.title)).toEqual(['Grace']);
  });

  it('verse chapters still win when verses were spoken', () => {
    const p = {
      ...musicOnly([entry('Grace', 0, 300)]),
      words: 'verses',
      drops: [{ id: 'd', atMs: 0, reference: 'John 14:27', status: 'done' }],
      movements: [{ id: 'm', startMs: 0, endMs: 600000 }],
    } as unknown as AmbientProject;
    expect(ambientChapters(p)).toEqual([{ startMs: 0, title: 'John 14:27' }]);
  });

  it('the description credits each source once, falling back to the track name', () => {
    const p = musicOnly([entry('Grace', 0, 300, 'Music from Pixabay'), entry('Peace', 294, 300, 'Music from Pixabay'), entry('Mine', 588, 300)]);
    expect(ambientDescription(p)).toBe('Soaking worship\n\nMusic credits:\nMusic from Pixabay\nMine');
  });

  it('no tracklist yet means no credits block', () => {
    expect(ambientDescription(musicOnly([]))).toBe('Soaking worship');
  });
});
```

`musicLibraryApi.instrumental.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';
import { fetchCapabilities, startInstrumental, keepInstrumental } from '../musicLibraryApi';

beforeEach(() => vi.restoreAllMocks());

describe('instrumental API', () => {
  it('reads capabilities', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, vocalRemoval: true, amfEncoder: false } } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: true, amfEncoder: false });
  });

  it('capabilities default to off when the call fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'x' } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: false, amfEncoder: false });
  });

  it('starts a job with the chosen quality', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true, jobId: 'j1' } } as never);
    expect(await startInstrumental('t1', 'fast')).toBe('j1');
    expect(post).toHaveBeenCalledWith('/api/music/t1/instrumental', { quality: 'fast' });
  });

  it('keep returns the new track', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true, track: { id: 'n', label: 'Song (instrumental)' } } } as never);
    expect((await keepInstrumental('j1')).label).toBe('Song (instrumental)');
  });
});
```
(Match the shape `api.get/post` actually return — check one existing call in `musicLibraryApi.ts`: they read `res.ok`, `res.error`, `res.data`. The mocks above follow that.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run src/lib/__tests__/ambientShare.test.ts src/lib/__tests__/musicLibraryApi.instrumental.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`ambientTypes.ts` — add:

```ts
export type AmbientWords = 'verses' | 'none';
export type AmbientBedOrder = 'shuffle' | 'fixed';

/** One track as it plays in the assembled bed; written by the server at build. */
export interface AmbientTrackEntry {
  ref: string;
  label: string;
  credit: string;
  startSec: number;
  durationSec: number;
}
```
In `AmbientBed` add `order?: AmbientBedOrder;` and `builtOrder?: AmbientTrackEntry[] | null;`. In `AmbientProject` add `/** Spoken verses over the music, or music only. Absent on older sessions: verses. */ words?: AmbientWords;`. In `AmbientRenderState` add `encoderUsed?: 'cpu' | 'amf';`.

`ambientApi.ts` — add `order?: AmbientBedOrder` to `AmbientBedPatch`; add to `ambientApi`:

```ts
  async setWords(id: string, words: AmbientWords): Promise<AmbientProject> {
    return unwrapProject(await api.patch(`/api/ambient/${id}/words`, { words }));
  },
```
and change `render`:

```ts
  async render(id: string, encoder: 'cpu' | 'amf' = 'cpu'): Promise<{ ok: boolean; jobId?: string }> {
    const res = await api.post(`/api/ambient/${id}/render`, { encoder });
```

`ambientShare.ts` — replace `ambientChapters` and `ambientDescription`:

```ts
/** YouTube ignores a chapter shorter than ten seconds. */
const MIN_CHAPTER_SEC = 10;

const tracklist = (project: AmbientProject): AmbientTrackEntry[] =>
  (project.bed?.builtOrder || []).filter((t) => t.durationSec >= MIN_CHAPTER_SEC);

/**
 * One chapter per verse, at the start of the picture it belongs to; for a
 * music-only session (or one with no spoken verses), one per track of the
 * assembled bed. The server forces the first to 00:00 and drops them below
 * three (the YouTube minimum).
 */
export function ambientChapters(project: AmbientProject): Chapter[] {
  const verses = project.words === 'none' ? [] : spoken(project.drops);
  if (verses.length === 0) {
    return tracklist(project).map((t) => ({ startMs: Math.round(t.startSec * 1000), title: t.label }));
  }
  const movements = project.movements || [];
  return verses.map((d) => {
    const m = movements.find((mv, i) => d.atMs >= mv.startMs && (d.atMs < mv.endMs || i === movements.length - 1));
    return { startMs: m ? m.startMs : d.atMs, title: d.reference };
  });
}

/** Each source credited once; a track with no credit is named instead. */
function creditsBlock(project: AmbientProject): string {
  const lines = [...new Set((project.bed?.builtOrder || []).map((t) => (t.credit || t.label).trim()).filter(Boolean))];
  return lines.length ? `Music credits:\n${lines.join('\n')}` : '';
}

export function ambientDescription(project: AmbientProject): string {
  const theme = String(project.theme || '').trim();
  const refs = project.words === 'none' ? [] : spoken(project.drops).map((d) => d.reference);
  const translation = String(project.translation || 'kjv').toUpperCase();
  const blocks = [
    theme,
    refs.length ? `Scripture (${translation}): ${refs.join(' · ')}` : '',
    creditsBlock(project),
  ].filter(Boolean);
  return blocks.join('\n\n');
}
```
Import `AmbientTrackEntry` in the type import. Existing tests for verse-only descriptions must still pass (a project with no `bed.builtOrder` gives no credits block).

`musicLibraryApi.ts` — add `credit?: string; derivedFrom?: string | null;` to `MusicTrack`; add `credit?: string` to `updateTrack`'s patch type; append:

```ts
export interface Capabilities { vocalRemoval: boolean; amfEncoder: boolean }

export async function fetchCapabilities(): Promise<Capabilities> {
  const res = await api.get('/api/music/capabilities');
  if (!res.ok) return { vocalRemoval: false, amfEncoder: false };
  return { vocalRemoval: Boolean(res.data?.vocalRemoval), amfEncoder: Boolean(res.data?.amfEncoder) };
}

export type InstrumentalQuality = 'best' | 'fast';
export interface InstrumentalJob {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  percent: number;
  error: string | null;
  sourceRef: string;
  sourcePreview: string | null;
  resultFile: string | null;
}

export async function startInstrumental(trackId: string, quality: InstrumentalQuality): Promise<string> {
  const res = await api.post(`/api/music/${trackId}/instrumental`, { quality });
  if (!res.ok || !res.data?.jobId) throw new Error(res.error || 'Failed to start vocal removal');
  return res.data.jobId as string;
}

export async function getInstrumental(jobId: string): Promise<InstrumentalJob> {
  const res = await api.get(`/api/music/instrumental/${jobId}`);
  if (!res.ok || !res.data?.job) throw new Error(res.error || 'Vocal removal job not found');
  return res.data.job as InstrumentalJob;
}

export async function cancelInstrumental(jobId: string): Promise<void> {
  await api.post(`/api/music/instrumental/${jobId}/cancel`, {});
}

export async function keepInstrumental(jobId: string): Promise<MusicTrack> {
  const res = await api.post(`/api/music/instrumental/${jobId}/keep`, {});
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to save the instrumental');
  return res.data.track as MusicTrack;
}

export async function discardInstrumental(jobId: string): Promise<void> {
  await api.post(`/api/music/instrumental/${jobId}/discard`, {});
}
```

- [ ] **Step 4: Run to verify they pass**

Run the two test files, then `cd client && npm test && npx tsc --noEmit -p .` → green.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib
git commit -m "feat(client): tracklist chapters, music credits, and instrumental API"
```

---

### Task 11: Client — music-only switch, keep-my-order, credit edit, graphics-chip checkbox

**Files:**
- Modify: `client/src/components/ambient/AmbientWordStep.tsx`, `AmbientSoundStep.tsx`, `AmbientRenderStep.tsx`, `client/src/components/MusicPicker.tsx`
- Test: `client/src/components/ambient/__tests__/AmbientWordStep.test.tsx`, `AmbientSoundStep.test.tsx`, `AmbientRenderStep.test.tsx`, create `client/src/components/__tests__/MusicPicker.order.test.tsx`

**Interfaces:**
- Consumes: Task 10 API/types.
- Produces: `MusicPicker` props `reorderable?: boolean` (multi mode shows ↑/↓ per chosen track and emits the reordered `paths`); per-track **Credit** button in the library list.

- [ ] **Step 1: Write the failing tests**

`AmbientWordStep.test.tsx` — append (reuse the file's existing `project` fixture / render helper):

```tsx
describe('AmbientWordStep — music only', () => {
  it('switching to music only saves it and hides the verse tools', async () => {
    const setWords = vi.spyOn(ambientApi, 'setWords').mockResolvedValue({} as never);
    const refresh = vi.fn();
    const { rerender } = render(<AmbientWordStep project={{ ...project, words: 'verses' }} busy={false} setBusy={() => {}} refresh={refresh} />);
    await userEvent.click(screen.getByRole('switch', { name: /music only/i }));
    expect(setWords).toHaveBeenCalledWith(project.projectId, 'none');
    rerender(<AmbientWordStep project={{ ...project, words: 'none' }} busy={false} setBusy={() => {}} refresh={refresh} />);
    expect(screen.queryByRole('button', { name: /suggest verses/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no verses will be spoken/i)).toBeInTheDocument();
  });
});
```

`AmbientSoundStep.test.tsx` — append:

```tsx
describe('AmbientSoundStep — order', () => {
  it('offers shuffle or keep my order and saves the choice', async () => {
    const setBed = vi.spyOn(ambientApi, 'setBed').mockResolvedValue({ ok: true } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AmbientSoundStep project={project} busy={false} setBusy={() => {}} refresh={() => {}} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /keep my order/i }));
    expect(setBed).toHaveBeenCalledWith('p1', { order: 'fixed' });
  });
});
```

`MusicPicker.order.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPicker } from '../MusicPicker';
import * as libraryApi from '../../lib/musicLibraryApi';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue([]);
  vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
});

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe('MusicPicker — reorder', () => {
  it('moves a chosen track up', async () => {
    const onChange = vi.fn();
    render(wrap(<MusicPicker value={{ path: 'a', paths: ['mylib:a', 'mylib:b'], volume: 1 }} onChange={onChange} multiple reorderable />));
    await userEvent.click(screen.getAllByRole('button', { name: /move up/i })[1]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paths: ['mylib:b', 'mylib:a'] }));
  });

  it('shows no move buttons unless reorderable', () => {
    render(wrap(<MusicPicker value={{ path: 'a', paths: ['mylib:a', 'mylib:b'], volume: 1 }} onChange={() => {}} multiple />));
    expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument();
  });
});
```

`AmbientRenderStep.test.tsx` — append:

```tsx
describe('AmbientRenderStep — graphics chip', () => {
  it('renders with the graphics chip when ticked', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: true });
    const renderCall = vi.spyOn(ambientApi, 'render').mockResolvedValue({ ok: true });
    renderStep(); // the file's existing helper for a ready-to-render project; wrap in QueryClientProvider if it isn't already
    await userEvent.click(await screen.findByRole('checkbox', { name: /graphics chip/i }));
    await userEvent.click(screen.getByRole('button', { name: /render/i }));
    expect(renderCall).toHaveBeenCalledWith(expect.any(String), 'amf');
  });

  it('hides the option when the chip is not available', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
    renderStep();
    await Promise.resolve();
    expect(screen.queryByRole('checkbox', { name: /graphics chip/i })).not.toBeInTheDocument();
  });
});
```
(Add `import * as libraryApi from '../../../lib/musicLibraryApi';` and `userEvent` imports where missing. If `@testing-library/user-event` is not a dependency, use `fireEvent.click` instead throughout.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run src/components` → the new tests FAIL.

- [ ] **Step 3: Implement**

**AmbientWordStep.tsx** — add at the top of the component:

```tsx
  const musicOnly = project.words === 'none';
  const setMusicOnly = async (next: boolean) => {
    setBusy(true);
    try {
      await ambientApi.setWords(project.projectId, next ? 'none' : 'verses');
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to change the words setting');
    } finally {
      setBusy(false);
    }
  };
```
Render, as the first child of the step's root element:

```tsx
      <label className={`${panelCls} flex items-center justify-between gap-3 text-sm text-content-secondary`}>
        <span>
          <span className="font-medium text-white">Music only (no verses)</span>
          <span className="block text-xs text-content-secondary">One picture for the whole video and a tracklist in the description.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={musicOnly}
          aria-label="Music only"
          disabled={busy}
          onClick={() => setMusicOnly(!musicOnly)}
          className={`h-6 w-11 rounded-full transition ${musicOnly ? 'bg-primary-500' : 'bg-white/15'}`}
        >
          <span className={`block h-5 w-5 rounded-full bg-white transition ${musicOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </label>
```
and wrap the rest of the existing content in `{musicOnly ? <p className="text-sm text-content-secondary">No verses will be spoken. Go on to Look to choose the picture.</p> : (<>…existing content…</>)}`.

**MusicPicker.tsx** — add `reorderable?: boolean` to the props interface and destructuring. In the chosen-tracks `<li>` (currently ~line 216, which already has the remove `X` button), before the remove button add:

```tsx
                {reorderable && (
                  <>
                    <button type="button" disabled={busy || idx === 0} onClick={() => emitPaths(move(paths, idx, idx - 1))} aria-label="move up" className="text-gray-400 hover:text-white disabled:opacity-30">↑</button>
                    <button type="button" disabled={busy || idx === paths.length - 1} onClick={() => emitPaths(move(paths, idx, idx + 1))} aria-label="move down" className="text-gray-400 hover:text-white disabled:opacity-30">↓</button>
                  </>
                )}
```
with a module-level helper:

```tsx
/** A copy of `list` with the item at `from` moved to `to`. */
function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
```
In the library list `<li>` (~line 171), for upload tracks add a **Credit** button beside the licence badge:

```tsx
          {t.source === 'upload' && (
            <button
              type="button"
              onClick={() => editCredit(t.id, t.credit || '')}
              title={t.credit ? `Credit: ${t.credit}` : 'Add a credit line for the video description'}
              className="rounded border border-white/15 px-1 text-[10px] text-gray-300 hover:border-primary-400"
            >
              {t.credit ? 'credit ✓' : 'credit'}
            </button>
          )}
```
with the handler next to `clearLicence` (same pattern: toast on error, invalidate the library query the way `clearLicence` does):

```tsx
  const editCredit = async (id: string, current: string) => {
    const next = window.prompt('Credit line for the video description (e.g. "Music by Ada · Pixabay")', current);
    if (next === null) return;
    try {
      await updateTrack(id, { credit: next });
      // …same library refresh call clearLicence uses…
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save the credit");
    }
  };
```

**AmbientSoundStep.tsx** — below the bed-mode segmented control, when `bed.mode === 'assemble'`:

```tsx
      {bed.mode === 'assemble' && (
        <div>
          <div className={fieldLabelCls}>Track order</div>
          <div className={segmentedCls} role="tablist" aria-label="Track order">
            <button type="button" onClick={() => applyBedPatch({ order: 'shuffle' })} className={segmentCls((bed.order ?? 'shuffle') === 'shuffle')} disabled={busy}>Shuffle</button>
            <button type="button" onClick={() => applyBedPatch({ order: 'fixed' })} className={segmentCls(bed.order === 'fixed')} disabled={busy}>Keep my order</button>
          </div>
        </div>
      )}
```
and pass `reorderable={bed.order === 'fixed'}` to the assemble-mode `MusicPicker`.

**AmbientRenderStep.tsx** — add:

```tsx
  const { data: caps } = useQuery({ queryKey: ['music-capabilities'], queryFn: fetchCapabilities, staleTime: 5 * 60_000 });
  const [useChip, setUseChip] = useState(false);
```
(import `useQuery` from `@tanstack/react-query`, `fetchCapabilities` from `../../lib/musicLibraryApi`, `useState` from `react`). Change `ambientApi.render(project.projectId)` to `ambientApi.render(project.projectId, useChip ? 'amf' : 'cpu')`. Above the Render button:

```tsx
      {caps?.amfEncoder && (
        <label className="flex items-center gap-2 text-sm text-content-secondary">
          <input type="checkbox" checked={useChip} onChange={(e) => setUseChip(e.target.checked)} disabled={busy} />
          Encode with graphics chip (faster; falls back to the CPU if it fails)
        </label>
      )}
```
If `AmbientRenderStep` is rendered in tests or pages without a `QueryClientProvider`, wrap its test helper in one (the page already sits inside the app's provider).

- [ ] **Step 4: Run to verify they pass**

Run: `cd client && npm test && npx tsc --noEmit -p .` → green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components
git commit -m "feat(ambient-ui): music-only switch, keep-my-order, credits, graphics-chip encode"
```

---

### Task 12: Client — Make instrumental dialog

**Files:**
- Create: `client/src/components/InstrumentalDialog.tsx`, `client/src/components/__tests__/InstrumentalDialog.test.tsx`
- Modify: `client/src/components/MusicPicker.tsx` (button per library track when `caps.vocalRemoval`)

**Interfaces:**
- Consumes: `fetchCapabilities`, `startInstrumental`, `getInstrumental`, `cancelInstrumental`, `keepInstrumental`, `discardInstrumental`, `InstrumentalJob` (Task 10); `api.mediaUrl`.
- Produces: `<InstrumentalDialog track={MusicTrack} onClose={() => void} onKept={(t: MusicTrack) => void} pollMs?={number} />`.

- [ ] **Step 1: Write the failing test** — `InstrumentalDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { InstrumentalDialog } from '../InstrumentalDialog';
import * as lib from '../../lib/musicLibraryApi';
import type { MusicTrack } from '../../lib/musicLibraryApi';

const track = { id: 't1', label: 'Song', licence: 'unknown', source: 'upload', ref: 'mylib:t1' } as MusicTrack;
const job = (status: lib.InstrumentalJob['status'], extra: Partial<lib.InstrumentalJob> = {}) =>
  ({ jobId: 'j1', status, percent: 0, error: null, sourceRef: 'mylib:t1', sourcePreview: 'song.mp3', resultFile: null, ...extra });

beforeEach(() => vi.restoreAllMocks());

describe('InstrumentalDialog', () => {
  it('runs, shows progress, then previews both versions and keeps', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental')
      .mockResolvedValueOnce(job('running', { percent: 40 }))
      .mockResolvedValue(job('done', { percent: 100, resultFile: 'instrumental-j1.m4a' }));
    const keep = vi.spyOn(lib, 'keepInstrumental').mockResolvedValue({ ...track, id: 'n', label: 'Song (instrumental)' });
    const onKept = vi.fn();
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={onKept} pollMs={1} />);
    fireEvent.click(screen.getByRole('radio', { name: /fast/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    expect(lib.startInstrumental).toHaveBeenCalledWith('t1', 'fast');
    await screen.findByText(/40%/);
    await screen.findByLabelText(/instrumental preview/i);
    expect(screen.getByLabelText(/original preview/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    await waitFor(() => expect(onKept).toHaveBeenCalledWith(expect.objectContaining({ label: 'Song (instrumental)' })));
    expect(keep).toHaveBeenCalledWith('j1');
  });

  it('says the licence carries over', () => {
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} />);
    expect(screen.getByText(/keeps the original's licence/i)).toBeInTheDocument();
  });

  it('shows the error when separation fails', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('error', { error: 'out of memory' }));
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    await screen.findByText(/out of memory/);
  });

  it('discard throws the result away and closes', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('done', { resultFile: 'instrumental-j1.m4a' }));
    const discard = vi.spyOn(lib, 'discardInstrumental').mockResolvedValue();
    const onClose = vi.fn();
    render(<InstrumentalDialog track={track} onClose={onClose} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    fireEvent.click(await screen.findByRole('button', { name: /discard/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(discard).toHaveBeenCalledWith('j1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/InstrumentalDialog.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** — `client/src/components/InstrumentalDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import {
  startInstrumental, getInstrumental, cancelInstrumental, keepInstrumental, discardInstrumental,
  type InstrumentalJob, type InstrumentalQuality, type MusicTrack,
} from '../lib/musicLibraryApi';
import { panelCls, primaryBtnCls, secondaryBtnCls } from './story/formStyles';

export interface InstrumentalDialogProps {
  track: MusicTrack;
  onClose: () => void;
  onKept: (track: MusicTrack) => void;
  /** Poll interval; tests shorten it. */
  pollMs?: number;
}

/**
 * Remove the vocals from one library track: choose a quality, watch it run,
 * listen to both versions, then keep the instrumental as a new track (it
 * carries the original's licence and credit) or throw it away.
 */
export function InstrumentalDialog({ track, onClose, onKept, pollMs = 2000 }: InstrumentalDialogProps) {
  const [quality, setQuality] = useState<InstrumentalQuality>('best');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<InstrumentalJob | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!jobId) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await getInstrumental(jobId);
        if (stopped) return;
        setJob(next);
        if (next.status === 'queued' || next.status === 'running') setTimeout(tick, pollMs);
      } catch (e) {
        if (!stopped) setJob((j) => (j ? { ...j, status: 'error', error: (e as Error).message } : j));
      }
    };
    tick();
    return () => { stopped = true; };
  }, [jobId, pollMs]);

  const start = async () => {
    try {
      setJob(null);
      setJobId(await startInstrumental(track.id, quality));
    } catch (e) {
      toast.error((e as Error).message || 'Failed to start vocal removal');
    }
  };

  const keep = async () => {
    if (!jobId) return;
    setSaving(true);
    try {
      const kept = await keepInstrumental(jobId);
      toast.success(`Saved "${kept.label}" to your library`);
      onKept(kept);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save the instrumental');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (jobId) await discardInstrumental(jobId).catch(() => undefined);
    onClose();
  };

  const cancel = async () => {
    if (jobId) await cancelInstrumental(jobId).catch(() => undefined);
    onClose();
  };

  const running = job?.status === 'queued' || job?.status === 'running' || (jobId !== null && job === null);

  return (
    <div role="dialog" aria-label={`Remove vocals from ${track.label}`} className={`${panelCls} space-y-3`}>
      <div className="font-medium text-white">Remove vocals — {track.label}</div>
      <p className="text-xs text-content-secondary">
        The instrumental is saved as a new track and keeps the original's licence and credit. Removing vocals does not clear a song for YouTube.
      </p>

      {!jobId && (
        <>
          <div role="radiogroup" aria-label="Quality" className="flex gap-4 text-sm text-content-secondary">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="quality" checked={quality === 'best'} onChange={() => setQuality('best')} /> Best quality (slower)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="quality" aria-label="Fast" checked={quality === 'fast'} onChange={() => setQuality('fast')} /> Fast
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={start} className={primaryBtnCls}>Remove vocals</button>
            <button type="button" onClick={onClose} className={secondaryBtnCls}>Close</button>
          </div>
        </>
      )}

      {running && (
        <div className="space-y-2">
          <div className="text-sm text-content-secondary">
            {job?.status === 'queued' ? 'Waiting for another job to finish…' : `Removing vocals… ${job?.percent ?? 0}%`}
          </div>
          <div className="h-1.5 w-full rounded bg-white/10">
            <div className="h-1.5 rounded bg-primary-500" style={{ width: `${job?.percent ?? 0}%` }} />
          </div>
          <button type="button" onClick={cancel} className={secondaryBtnCls}>Cancel</button>
        </div>
      )}

      {job?.status === 'error' && (
        <div className="space-y-2 text-sm text-red-300">
          <div>{job.error}</div>
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Close</button>
        </div>
      )}

      {job?.status === 'done' && job.resultFile && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-content-secondary">
              Original
              <audio controls preload="none" aria-label="original preview" src={api.mediaUrl(job.sourcePreview)} className="w-full" />
            </label>
            <label className="text-xs text-content-secondary">
              Instrumental
              <audio controls preload="none" aria-label="instrumental preview" src={api.mediaUrl(job.resultFile)} className="w-full" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={keep} disabled={saving} className={primaryBtnCls}>Keep</button>
            <button type="button" onClick={discard} disabled={saving} className={secondaryBtnCls}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
```
Note: bundled tracks' `sourcePreview` is their `/music/...` preview URL; `api.mediaUrl` returns a `/outputs/<name>` URL for bare names, so for bundled sources pass the preview URL through unchanged — in the `Original` `<audio>` use `job.sourcePreview?.startsWith('/music/') ? job.sourcePreview : api.mediaUrl(job.sourcePreview)`.

**MusicPicker.tsx** — add `const { data: caps } = useQuery({ queryKey: ['music-capabilities'], queryFn: fetchCapabilities, staleTime: 5 * 60_000 });` and `const [instrumentalFor, setInstrumentalFor] = useState<MusicTrack | null>(null);`. In each library-list `<li>`, when `caps?.vocalRemoval`, add:

```tsx
          {caps?.vocalRemoval && (
            <button type="button" onClick={() => setInstrumentalFor(t)} className="rounded border border-white/15 px-1 text-[10px] text-gray-300 hover:border-primary-400" title="Make an instrumental version (removes the vocals)">
              instrumental
            </button>
          )}
```
and after the list:

```tsx
      {instrumentalFor && (
        <InstrumentalDialog
          track={instrumentalFor}
          onClose={() => setInstrumentalFor(null)}
          onKept={() => { setInstrumentalFor(null); /* …same library refresh call clearLicence uses… */ }}
        />
      )}
```

- [ ] **Step 4: Run to verify**

Run: `cd client && npm test && npx tsc --noEmit -p .` → green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components
git commit -m "feat(music-ui): make-instrumental dialog with before/after preview"
```

---

### Task 13: End-to-end check, docs, review, PR

**Files:**
- Modify: `docs/music-library.md` (credits, instrumentals, order), `docs/vocal-removal.md` (final)
- Modify: `server/.env.example` (add commented `STEMS_CLI=` and `STEMS_MODEL_DIR=` with one-line explanations)

- [ ] **Step 1: Full test suites**

```bash
cd server && npm test
cd ../client && npm test && npx tsc --noEmit -p . && npm run build
```
Expected: all green, build succeeds.

- [ ] **Step 2: Real run on the laptop**

Set `STEMS_CLI` / `STEMS_MODEL_DIR` in `server/.env`, `npm run dev` from the repo root, then in the browser:
1. Music library → a track with vocals → **instrumental** → Fast → wait → listen to both → Keep. Confirm the new track shows with the original's licence badge.
2. New Ambient session, target 10 minutes → Words: **Music only** → Sound: pick 4 tracks, **Keep my order**, reorder with ↑/↓ → Look: generate the one picture → Render (tick graphics chip if shown).
3. When done: play the video; open the publish panel and confirm chapters list the tracks with sensible times and the description ends with **Music credits**.
4. Start a render and a separation together; confirm the second shows "Waiting for another job to finish…".
Record anything that fails as a bug and fix it (TDD) before continuing.

- [ ] **Step 3: Docs**

Update `docs/music-library.md` with short sections: *Credits* (what the field is for, where it appears), *Instrumentals* (derived tracks, `derivedFrom`, inherited licence), *Track order* (shuffle vs keep my order). Finalise `docs/vocal-removal.md`.

- [ ] **Step 4: Review**

Run the code-reviewer and security-reviewer agents on `git diff master...HEAD`; fix CRITICAL/HIGH findings with tests.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/soundtrack-builder
gh pr create --title "feat: Soundtrack Builder — music-only Ambient, own order, tracklist credits, vocal removal" --body "<summary of the four features, test plan checklist from Step 2, 'Closes #10', and the Claude Code footer>"
```
Then follow the Codex review gate from the operator's git workflow: wait for the `chatgpt-codex-connector` review, fetch inline comments, verify and fix each finding, reply on the PR.
