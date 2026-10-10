# Kinetic Captions Step 3: Script/Wizard, Series, Social and Sermon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio effects captions (the libass kinetic engine shipped in steps 1–2) render in the Script/Wizard video renders (including Series and social auto-posts) and in Sermon clips, with the Studio look, Energy and Shuffle offered in their pickers.

**Architecture:** One shared server helper, `prepareStudioCaptions`, decides per render: not a Studio look → drawtext unchanged; Studio look with libass → write the `.ass` file and return one `ass=` filter; no libass or a failed write → drawtext with the look's `fallbackPreset`. `renderAdvancedVideo` (jobs.js) and POST `/captioned-video` (render.js) call it; the legacy single-background path routes Studio looks into `renderAdvancedVideo`. On the client, the Story panel's Studio controls are extracted into shared components reused by the Render, Sermon (CaptionStylePanel/AnimationPicker) and Series pickers.

**Tech Stack:** Node 24 ESM, Express, node:test, supertest, ffmpeg + libass; React 18 + TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-kinetic-caption-engine-design.md` (sections "Wiring (piece 2)", "Prod constraints", "Build order" step 3).

## Global Constraints

- Worktree `C:\Users\segun\source\repos\bf-kinetic`, branch `feat/kinetic-captions-step3`. Never push. Never use `--no-verify`.
- Prod runs ffmpeg 5.1.9 (Debian bookworm). Filter graphs go through `-filter_complex_script`, as they do now. The `ass` filter string comes only from `studioCaptionFilter` (already escaped for Windows drive colons).
- "If `hasLibass()` is false, every Studio look renders with its `fallbackPreset` (an existing drawtext preset). The render never fails because of the engine."
- "ASS handles thousands of events cheaply, so the Studio path needs no word caps."
- Default energy: Script/Wizard (also Series and social) `lively`; Sermon clip `calm`. Unknown values are normalised to the defaults.
- Non-Studio presets must render exactly as before (no change to any drawtext output).
- Lyric/caption text reaches ASS only through `buildAss` (which escapes via `assEscape`); never build ASS text anywhere else.
- Kinetic tests: from `server/`, `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js` (a bare directory argument fails on Node 24). Full server suite: `npm test` from `server/`.
- Client tests: from `client/`, `npx vitest run <path>`; types: `npx tsc -b`.
- Commits: run `git add` and `git commit` as separate commands. Message format `<type>: <description>`; the message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If a hook falsely blocks a multi-line `-m`, write the message to a scratch file and use `git commit -F <file>`.
- Use the Write/Edit tools for file changes (no heredocs). Do not dispatch subagents.

## File Structure

| File | Responsibility |
|---|---|
| `server/src/lib/kinetic/renderCaptions.js` (new) | `normaliseSeed`, `timedLinePhrases`, `prepareStudioCaptions`: the per-render Studio/drawtext decision shared by every renderer |
| `server/src/lib/kinetic/looks.js` | add `drawtextPresetFor(id)` (Studio id → its fallback preset) |
| `server/src/lib/kinetic/render.test.js` | ruling R9: sample the 9:16 safe-area test at t ∈ {1.7, 1.95} |
| `server/src/routes/jobs.js` | Script/Wizard: `renderAdvancedVideo` uses the helper; `renderVideoCore` routes Studio looks to it; campaign forwards energy/seed |
| `server/src/routes/series.js` | Series: schema accepts `captionEnergy`, forwards it |
| `server/src/routes/render.js` | Sermon clip: helper in `/captioned-video`, no word cap for Studio |
| `server/src/routes/timeline.js` | Timeline render (step 4 territory): a Studio pick draws with its fallback until step 4 |
| `client/src/lib/studioCaptions.ts` (new) | shared types/helpers: `isStudioLook`, `readableLook`, `nextSeed`, `randomSeed`, `FALLBACK_ENERGIES` |
| `client/src/components/captions/StudioEffects.tsx` (new) | `StudioLookOptions` (optgroup) and `StudioEffectsControls` (sample clip, Energy, Shuffle) |
| `client/src/components/story/StoryCaptionsPanel.tsx` | refactored onto the shared components (behaviour unchanged) |
| `client/src/components/render/RenderCaptionsPanel.tsx`, `client/src/pages/RenderPage.tsx` | Script/Wizard picker + payload |
| `client/src/components/voicelab/AnimationPicker.tsx`, `client/src/components/timeline/CaptionStylePanel.tsx`, `client/src/pages/TimelinePage.tsx` | Sermon clip picker + payload + client word cap |
| `client/src/components/series/SeriesCaptionStyle.tsx` (new), `client/src/pages/SeriesPage.tsx`, `client/src/lib/bibleApi.ts` | Series caption style picker |

---

### Task 1: Shared server helper `prepareStudioCaptions` (+ R9 test fix)

**Files:**
- Create: `server/src/lib/kinetic/renderCaptions.js`
- Create: `server/src/lib/kinetic/renderCaptions.test.js`
- Modify: `server/src/lib/kinetic/looks.js` (append `drawtextPresetFor`)
- Modify: `server/src/lib/kinetic/looks.test.js` (append one test)
- Modify: `server/src/lib/kinetic/render.test.js:78-105` (R9)

**Interfaces:**
- Consumes: `isStudioLook(id)`, `resolveLook(id)`, `resolveEnergy(id, fallback)` from `./looks.js`; `studioCaptionFilter({ assPath, ...buildAssOpts }) -> { filter, sideFiles: [{ path, text }] }` from `./filter.js`; `hasLibass()` from `./capability.js`.
- Produces:
  - `SEED_MAX = 2147483647`
  - `normaliseSeed(seed: unknown): number` — the seed when it is an integer 0..SEED_MAX (number or digit string), else a random integer in that range.
  - `timedLinePhrases(lines: Array<string | {text}>, durationSec: number): Array<{ text, start, end }>`
  - `prepareStudioCaptions({ preset, assPath, words?, lines?, durationSec?, w, h, energy?, seed?, title?, defaultEnergy = "lively", libass = hasLibass() })` returning either `{ mode: "drawtext", preset: string }` or `{ mode: "studio", filter: string, files: string[] }` (`filter` is `""` when nothing is timed).
  - `drawtextPresetFor(id: string): string` in `looks.js`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/kinetic/renderCaptions.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEED_MAX, normaliseSeed, timedLinePhrases, prepareStudioCaptions } from "./renderCaptions.js";

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
  const assPath = path.join(os.tmpdir(), `no-such-dir-${Date.now()}`, "c.ass");
  const out = prepareStudioCaptions({ preset: "studio-gospel-gold", assPath, lines: ["Peace"], durationSec: 2, w: 720, h: 1280, libass: true });
  assert.deepEqual(out, { mode: "drawtext", preset: "scripture-emphasis" });
});

test("nothing timed gives an empty studio filter and no file", () => {
  const dir = tmp();
  const assPath = path.join(dir, "c.ass");
  const out = prepareStudioCaptions({ preset: "studio-clean-white", assPath, words: [], lines: [], durationSec: 3, w: 720, h: 1280, libass: true });
  assert.deepEqual(out, { mode: "studio", filter: "", files: [] });
  assert.equal(fs.existsSync(assPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Append to `server/src/lib/kinetic/looks.test.js` (add `drawtextPresetFor` to that file's existing import from `./looks.js`):

```js
test("drawtextPresetFor maps a Studio look to its fallback and leaves other presets alone", () => {
  assert.equal(drawtextPresetFor("studio-lagos-night"), "marker");
  assert.equal(drawtextPresetFor("studio-gospel-gold"), "scripture-emphasis");
  assert.equal(drawtextPresetFor("hero-bold"), "hero-bold");
  assert.equal(drawtextPresetFor(undefined), undefined);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `server/`): `node --test src/lib/kinetic/renderCaptions.test.js src/lib/kinetic/looks.test.js`
Expected: FAIL — `Cannot find module './renderCaptions.js'` and `drawtextPresetFor` is not exported.

- [ ] **Step 3: Implement**

Create `server/src/lib/kinetic/renderCaptions.js`:

```js
import fs from "node:fs";
import { isStudioLook, resolveLook, resolveEnergy } from "./looks.js";
import { studioCaptionFilter } from "./filter.js";
import { hasLibass } from "./capability.js";

export const SEED_MAX = 2147483647;
const PHRASE_WORDS = 5;
const PHRASE_CHARS = 28;

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The seed when it is an integer 0..SEED_MAX, else a fresh random one. */
export function normaliseSeed(seed) {
  const text = typeof seed === "number" ? String(seed) : typeof seed === "string" ? seed.trim() : "";
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  return Number.isInteger(n) && n <= SEED_MAX ? n : Math.floor(Math.random() * SEED_MAX);
}

/** One line cut into phrases of at most PHRASE_WORDS words and PHRASE_CHARS characters. */
function phrasesOfLine(line) {
  const out = [];
  let current = [];
  for (const word of line.split(" ")) {
    const next = [...current, word];
    if (current.length > 0 && (next.length > PHRASE_WORDS || next.join(" ").length > PHRASE_CHARS)) {
      out.push(current.join(" "));
      current = [word];
    } else {
      current = next;
    }
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

/**
 * Untimed caption lines (a Script render without word timings) as timed
 * phrases for the engine. The video's length is shared out by character
 * count, and each line is cut into short phrases so none is too long for the
 * effects. A phrase never spans two lines.
 */
export function timedLinePhrases(lines, durationSec) {
  const total = Number(durationSec);
  const texts = (Array.isArray(lines) ? lines : [])
    .map((l) => String(typeof l === "string" ? l : (l?.text ?? "")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (texts.length === 0 || !Number.isFinite(total) || total <= 0) return [];
  const phrases = texts.flatMap(phrasesOfLine);
  const weight = phrases.reduce((sum, p) => sum + p.length, 0);
  let t = 0;
  return phrases.map((text) => {
    const start = t;
    t += total * (text.length / weight);
    return { text, start: round3(start), end: round3(t) };
  });
}

/**
 * How a renderer draws captions for `preset`.
 * - Not a Studio look: drawtext with the preset unchanged.
 * - A Studio look: one libass filter, its .ass file already written to
 *   `assPath`. Timed `words` win; otherwise `lines` are spread over
 *   `durationSec`. A `filter` of "" means there was nothing to caption.
 * - Where libass is missing or the write fails: drawtext with the look's
 *   fallback preset, so captions never fail a render.
 */
export function prepareStudioCaptions({
  preset, assPath, words, lines, durationSec, w, h, energy, seed, title,
  defaultEnergy = "lively", libass = hasLibass(),
}) {
  if (!isStudioLook(preset)) return { mode: "drawtext", preset };
  const fallback = { mode: "drawtext", preset: resolveLook(preset).fallbackPreset };
  if (!libass) return fallback;
  const timed = (Array.isArray(words) ? words : []).filter(
    (wd) => wd && String(wd.text || "").trim() && Number.isFinite(wd.start) && Number.isFinite(wd.end),
  );
  try {
    const built = studioCaptionFilter({
      assPath,
      w,
      h,
      look: preset,
      title,
      words: timed.length > 0 ? timed : undefined,
      lines: timed.length > 0 ? undefined : timedLinePhrases(lines, durationSec),
      energy: resolveEnergy(energy, defaultEnergy),
      seed: normaliseSeed(seed),
    });
    for (const f of built.sideFiles) fs.writeFileSync(f.path, f.text, "utf8");
    return { mode: "studio", filter: built.filter, files: built.sideFiles.map((f) => f.path) };
  } catch (err) {
    console.warn(`[CAPTIONS] studio fallback: ${err?.message || err}`);
    return fallback;
  }
}
```

Append to `server/src/lib/kinetic/looks.js`:

```js
/** The drawtext preset to use for `id`: a Studio look's fallback, any other id unchanged. */
export function drawtextPresetFor(id) {
  return isStudioLook(id) ? resolveLook(id).fallbackPreset : id;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run (from `server/`): `node --test src/lib/kinetic/renderCaptions.test.js src/lib/kinetic/looks.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: R9 — sample the 9:16 safe-area test at t ∈ {1.7, 1.95}**

In `server/src/lib/kinetic/render.test.js`, replace the body of the `for (const [look, effect, text] of cases) { ... }` loop in the test "what libass paints stays inside the 9:16 safe area, outline, shadow and slant included" with:

```js
  for (const [look, effect, text] of cases) {
    const out = studioCaptionFilter({ assPath: "unused", lines: [{ text, start: 0, end: 2 }], w, h, look, energy: "calm", seed: 1, overrides: { 0: effect } });
    // Late in the phrase every word is up and the pop/slam overshoot has settled
    // — the widest the phrase gets (ruling R9: 1.5 s alone missed that).
    for (const t of [1.7, 1.95]) {
      const buf = frameAt({ assText: out.sideFiles[0].text, w, h, t, pix: "gray" });
      let minX = w;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        if (buf[y * w + x] > 60) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      }
      const name = `${look} ${effect} "${text}" at ${t}s: lit x ${minX}..${maxX}, lowest row ${maxY}`;
      assert.ok(maxX >= 0, `${name}: nothing drawn`);
      assert.ok(minX >= 0.06 * w - 1 && maxX <= 0.88 * w + 1, name);
      assert.ok(maxY <= 0.82 * h + 1, name);
    }
  }
```

Run (from `server/`): `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: PASS, 0 failures (the render tests skip only where ffmpeg has no libass; this dev box has libass). If a case fails at 1.7 or 1.95, STOP and report the case name and bounds — do not loosen the bounds.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/kinetic/renderCaptions.js server/src/lib/kinetic/renderCaptions.test.js server/src/lib/kinetic/looks.js server/src/lib/kinetic/looks.test.js server/src/lib/kinetic/render.test.js
git commit -m "feat: one Studio-or-drawtext caption decision shared by every renderer"
```
(Message body ends with the Co-Authored-By line from Global Constraints.)

---

### Task 2: Script/Wizard, Series and social renders draw Studio looks

**Files:**
- Modify: `server/src/routes/jobs.js` (imports near line 18; `renderVideoCore` ~line 763; `renderAdvancedVideo` ~lines 1074–1125 and ~1245; `runCampaignAutoPost` destructuring ~line 1314 and the three `renderVideoCore({...})` calls ~lines 1498, 1527, 1543)
- Modify: `server/src/routes/series.js` (schema ~line 14–70, forwarding ~line 198)
- Create: `server/test/routes/studioCaptionRenders.test.js`
- Create: `server/test/routes/seriesSchema.test.js`

**Interfaces:**
- Consumes: `prepareStudioCaptions` from Task 1 (`server/src/lib/kinetic/renderCaptions.js`); `isStudioLook` from `server/src/lib/kinetic/looks.js`; `hasLibass` from `server/src/lib/kinetic/capability.js` (tests only).
- Produces: render payload fields `captionEnergy` (`"calm" | "lively" | "wild"`) and `captionSeed` (integer) accepted by `render_video` and `campaign_auto_post` jobs; `export const GenerateSchema` in `series.js` with `captionEnergy` optional.

- [ ] **Step 1: Write the failing tests**

Create `server/test/routes/studioCaptionRenders.test.js`:

```js
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { _setJobCtxForTest, _resetJobCtxForTest, _renderVideoCoreForTest } from "../../src/routes/jobs.js";
import { hasLibass } from "../../src/lib/kinetic/capability.js";

// Script/Wizard, Series and social renders all run through renderVideoCore.
// These render real (tiny) videos and look at the pixels: white Studio
// captions over a solid green picture. A filter string can look right and
// still draw nothing.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const skip = !hasFfmpeg ? "ffmpeg not installed" : !hasLibass() ? "ffmpeg here has no libass" : false;

let dir;
let media;

function ff(args) {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

/** How many near-white pixels a frame at time t has (scaled to 270 px wide). */
function whitePixelsAt(video, t) {
  const r = spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1",
    "-vf", "scale=270:-2,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  let n = 0;
  for (let i = 0; i + 2 < r.stdout.length; i += 3) {
    if (r.stdout[i] > 200 && r.stdout[i + 1] > 200 && r.stdout[i + 2] > 200) n += 1;
  }
  return n;
}

const leftoverAss = () => fs.readdirSync(dir).filter((f) => f.endsWith(".ass"));

before(() => {
  if (skip) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-render-"));
  media = { bg: path.join(dir, "bg.mp4"), voice: path.join(dir, "voice.m4a") };
  ff(["-f", "lavfi", "-i", "color=c=0x00FF00:s=320x240:d=4:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", media.bg]);
  ff(["-f", "lavfi", "-i", "sine=f=440:d=4", "-c:a", "aac", media.voice]);
});

after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("Script renders draw Studio looks with libass", { skip }, () => {
  before(() => _setJobCtxForTest({ dataDir: dir, outputDir: dir, userId: "studio-user" }));
  after(() => _resetJobCtxForTest());

  test("timed words (series and auto-posts render this way)", async () => {
    const { outFile } = await _renderVideoCoreForTest({
      backgroundPath: media.bg, audioPath: media.voice, durationSec: 4, aspect: "square",
      typographyPreset: "studio-lagos-night", captionEnergy: "calm", captionSeed: 1,
      words: [
        { text: "Peace", start: 0.2, end: 1.2 },
        { text: "be", start: 1.2, end: 1.8 },
        { text: "still", start: 1.8, end: 2.8 },
      ],
    }, "t-studio-words");
    assert.ok(fs.existsSync(outFile));
    assert.ok(whitePixelsAt(outFile, 1.5) > 30, "expected white Studio captions at 1.5 s");
    assert.deepEqual(leftoverAss(), [], "the .ass file is removed after the render");
  });

  test("lines only, on the single-background path, are spread over the video", async () => {
    const { outFile } = await _renderVideoCoreForTest({
      backgroundPath: media.bg, audioPath: media.voice, durationSec: 4, aspect: "square",
      typographyPreset: "studio-clean-white", captionSeed: 1,
      lines: ["Peace be still"],
    }, "t-studio-lines");
    assert.ok(fs.existsSync(outFile));
    assert.ok(whitePixelsAt(outFile, 1.5) > 30, "expected white Studio captions at 1.5 s");
    assert.deepEqual(leftoverAss(), [], "the .ass file is removed after the render");
  });
});
```

Create `server/test/routes/seriesSchema.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerateSchema } from "../../src/routes/series.js";

const base = { reference: "Psalm 23", parts: 2, translation: "KJV" };

test("a series can ask for a Studio look and an energy", () => {
  const input = GenerateSchema.parse({ ...base, typographyPreset: "studio-gospel-gold", captionEnergy: "calm" });
  assert.equal(input.typographyPreset, "studio-gospel-gold");
  assert.equal(input.captionEnergy, "calm");
});

test("an unknown energy is rejected", () => {
  assert.equal(GenerateSchema.safeParse({ ...base, captionEnergy: "loud" }).success, false);
});

test("energy is optional", () => {
  assert.equal(GenerateSchema.parse(base).captionEnergy, undefined);
});
```

Before writing `seriesSchema.test.js`, read `PreviewSchema` in `server/src/routes/series.js` (~line 37) and adjust `base` so it satisfies every required field of the real schema (keep the three tests' intent unchanged).

- [ ] **Step 2: Run the tests to see them fail**

Run (from `server/`): `node --test test/routes/studioCaptionRenders.test.js test/routes/seriesSchema.test.js`
Expected: FAIL — no white caption pixels (Studio ids are not drawn yet), and `GenerateSchema` is not exported.

- [ ] **Step 3: Implement in `server/src/routes/jobs.js`**

(a) Imports — after the `videoFilters.js` import line (line 18) add:

```js
import { isStudioLook } from "../lib/kinetic/looks.js";
import { prepareStudioCaptions } from "../lib/kinetic/renderCaptions.js";
```

(b) `renderVideoCore` — immediately before the line
`const { backgroundPath, audioPath, lines, durationSec, aspect, captionWidthPct, musicPath, musicVolume, autoDuck, typographyPreset } = payload || {};`
insert:

```js
  // Studio looks draw with libass from an .ass file, which the advanced path
  // writes and cleans up; it also takes a single background as one scene.
  if (isStudioLook(payload?.typographyPreset)) {
    return await renderAdvancedVideo(payload, jobId);
  }
```

(c) `renderAdvancedVideo` — replace the line
`  const resolvedPreset = resolveKineticAnimation(typographyPreset)?.presetId || typographyPreset;`
(keep the comment above it) with:

```js
  // Studio looks (libass) replace the drawtext chain with one `ass` filter.
  // Without libass, or if the .ass file can't be written, they draw with
  // their fallback preset like any other style.
  const studioCaptions = prepareStudioCaptions({
    preset: typographyPreset,
    assPath: path.join(currentOutDir(), `captions-${uuid()}.ass`),
    words,
    lines: Array.isArray(lines) ? lines.map((s) => cleanCaptionLine(String(s).slice(0, 280))).filter(Boolean) : [],
    durationSec: totalDuration,
    w,
    h,
    energy: payload?.captionEnergy,
    seed: payload?.captionSeed,
    defaultEnergy: "lively",
  });
  const drawPreset = studioCaptions.mode === "drawtext" ? studioCaptions.preset : typographyPreset;
  const resolvedPreset = resolveKineticAnimation(drawPreset)?.presetId || drawPreset;
```

(d) Same function — change the first line of the `drawtextChain` expression from
`  const drawtextChain = hasWordTimings && !wantsLines`
to:

```js
  const drawtextChain = studioCaptions.mode === "studio"
    ? studioCaptions.filter
    : hasWordTimings && !wantsLines
```

and indent the rest of that existing expression by two more spaces so the nesting reads correctly. The existing `if (drawtextChain) { filterParts.push(...) }` already skips an empty filter.

(e) Same function — replace `cleanupFilterScript` with:

```js
  const cleanupFilterScript = () => {
    for (const f of [filterScriptFile, ...(studioCaptions.files || [])]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  };
```

(f) `runCampaignAutoPost` — in the payload destructuring, after the line `typographyPreset: typographyPresetOverride,` add:

```js
    // Studio looks: how lively the effects are, and which effect each line
    // gets. Unset seed = a fresh one per video, so series parts differ.
    captionEnergy,
    captionSeed,
```

and in each of the three `renderVideoCore({ ... }, jobId)` calls in that function, add after `typographyPreset,`:

```js
      captionEnergy,
      captionSeed,
```

(match each call's existing indentation).

- [ ] **Step 4: Implement in `server/src/routes/series.js`**

Change `const GenerateSchema = PreviewSchema.extend({` to `export const GenerateSchema = PreviewSchema.extend({`, and after the schema line `typographyPreset: z.string().optional(),` add:

```js
  captionEnergy: z.enum(["calm", "lively", "wild"]).optional(),
```

In the campaign payload built per segment, after `typographyPreset: input.typographyPreset || undefined,` add:

```js
        captionEnergy: input.captionEnergy || undefined,
```

- [ ] **Step 5: Run the tests to see them pass**

Run (from `server/`): `node --test test/routes/studioCaptionRenders.test.js test/routes/seriesSchema.test.js test/routes/brandLogoRenders.test.js test/routes/jobsEnqueueValidation.test.js`
Expected: PASS, 0 failures (brand-logo and enqueue tests prove non-Studio renders are unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/jobs.js server/src/routes/series.js server/test/routes/studioCaptionRenders.test.js server/test/routes/seriesSchema.test.js
git commit -m "feat: Script, Series and social renders draw Studio looks"
```

---

### Task 3: Shared client Studio pieces (Story refactored onto them)

**Files:**
- Create: `client/src/lib/studioCaptions.ts`
- Create: `client/src/lib/__tests__/studioCaptions.test.ts`
- Create: `client/src/components/captions/StudioEffects.tsx`
- Create: `client/src/components/captions/__tests__/StudioEffects.test.tsx`
- Modify: `client/src/components/story/StoryCaptionsPanel.tsx`

**Interfaces:**
- Produces (`client/src/lib/studioCaptions.ts`):
  - `interface StudioOption { id: string; label: string; description?: string }`
  - `type CaptionEnergy = 'calm' | 'lively' | 'wild'`
  - `SEED_MAX = 2147483647`, `FALLBACK_ENERGIES: StudioOption[]`
  - `isStudioLook(id?: string | null): boolean`, `readableLook(id: string): string`
  - `nextSeed(current?: number, random?: () => number): number` — never returns `current`
  - `randomSeed(): number`
- Produces (`client/src/components/captions/StudioEffects.tsx`):
  - `StudioLookOptions({ looks, libass, value }: { looks: StudioOption[]; libass: boolean; value?: string })` — an `<optgroup label="Studio effects">` (or `null` when there is nothing to list)
  - `StudioEffectsControls({ look, energy, energies?, onEnergyChange, onShuffle?, disabled? })` — sample `<video>`, an "Energy" select, and a "Shuffle effects" button only when `onShuffle` is given

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/__tests__/studioCaptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SEED_MAX, isStudioLook, readableLook, nextSeed, randomSeed } from '../studioCaptions';

describe('studioCaptions', () => {
  it('recognises Studio look ids', () => {
    expect(isStudioLook('studio-lagos-night')).toBe(true);
    expect(isStudioLook('hero-bold')).toBe(false);
    expect(isStudioLook(undefined)).toBe(false);
    expect(isStudioLook(null)).toBe(false);
  });

  it('turns a look id into a readable name', () => {
    expect(readableLook('studio-lagos-night')).toBe('Lagos Night');
  });

  it('nextSeed never returns the current seed', () => {
    expect(nextSeed(3, () => 3 / SEED_MAX)).toBe(4);
    expect(nextSeed(SEED_MAX - 1, () => (SEED_MAX - 1) / SEED_MAX)).toBe(0);
    expect(nextSeed(undefined, () => 0.5)).toBe(Math.floor(0.5 * SEED_MAX));
  });

  it('randomSeed stays in range', () => {
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s < SEED_MAX).toBe(true);
  });
});
```

Create `client/src/components/captions/__tests__/StudioEffects.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioLookOptions, StudioEffectsControls } from '../StudioEffects';

const LOOKS = [{ id: 'studio-lagos-night', label: 'Lagos Night' }];

const inSelect = (ui: ReactNode, value = '') =>
  render(<select aria-label="Style" value={value} onChange={() => {}}><option value="">None</option>{ui}</select>);

describe('StudioLookOptions', () => {
  it('lists the looks under "Studio effects"', () => {
    const { container } = inSelect(<StudioLookOptions looks={LOOKS} libass />);
    expect(container.querySelector('optgroup[label="Studio effects"]')).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Lagos Night' })).not.toBeDisabled();
  });

  it('disables the looks where the server has no libass', () => {
    inSelect(<StudioLookOptions looks={LOOKS} libass={false} />);
    expect(screen.getByRole('option', { name: /Lagos Night \(unavailable on this server\)/ })).toBeDisabled();
  });

  it('keeps a saved look selectable before the catalogue loads', () => {
    inSelect(<StudioLookOptions looks={[]} libass value="studio-gospel-gold" />, 'studio-gospel-gold');
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('studio-gospel-gold');
    expect(screen.getByRole('option', { name: 'Gospel Gold' })).toBeInTheDocument();
  });

  it('renders nothing with no looks and no saved look', () => {
    const { container } = inSelect(<StudioLookOptions looks={[]} libass value="hero-bold" />);
    expect(container.querySelector('optgroup')).toBeNull();
  });
});

describe('StudioEffectsControls', () => {
  it('plays the look sample and hides it if it fails to load', () => {
    const { container } = render(
      <StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} />,
    );
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/studio-looks/lagos-night.mp4');
    fireEvent.error(video);
    expect(container.querySelector('video')).toBeNull();
  });

  it('reports an energy change and a shuffle', async () => {
    const user = userEvent.setup();
    const onEnergyChange = vi.fn();
    const onShuffle = vi.fn();
    render(<StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={onEnergyChange} onShuffle={onShuffle} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Energy' }), 'wild');
    expect(onEnergyChange).toHaveBeenCalledWith('wild');
    await user.click(screen.getByRole('button', { name: /shuffle effects/i }));
    expect(onShuffle).toHaveBeenCalled();
  });

  it('offers no Shuffle button when there is nothing to shuffle', () => {
    render(<StudioEffectsControls look="studio-lagos-night" energy="calm" onEnergyChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /shuffle effects/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `client/`): `npx vitest run src/lib/__tests__/studioCaptions.test.ts src/components/captions`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `client/src/lib/studioCaptions.ts`:

```ts
/**
 * Studio caption looks (the server's libass engine): shared ids, labels and
 * seed helpers for every caption picker.
 */

export interface StudioOption { id: string; label: string; description?: string }

export type CaptionEnergy = 'calm' | 'lively' | 'wild';

export const STUDIO_PREFIX = 'studio-';
export const SEED_MAX = 2147483647;

/** Used until (or if) the server's energy list loads. */
export const FALLBACK_ENERGIES: StudioOption[] = [
  { id: 'calm', label: 'Calm' },
  { id: 'lively', label: 'Lively' },
  { id: 'wild', label: 'Wild' },
];

export const isStudioLook = (id?: string | null): boolean =>
  typeof id === 'string' && id.startsWith(STUDIO_PREFIX);

/** "studio-lagos-night" -> "Lagos Night". */
export const readableLook = (id: string): string =>
  id
    .replace(/^studio-/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** A new random seed that is never the current one, so Shuffle always changes something. */
export function nextSeed(current?: number, random: () => number = Math.random): number {
  const next = Math.floor(random() * SEED_MAX);
  return next === current ? (next + 1) % SEED_MAX : next;
}

export const randomSeed = (): number => Math.floor(Math.random() * SEED_MAX);
```

Create `client/src/components/captions/StudioEffects.tsx`:

```tsx
import { useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { FALLBACK_ENERGIES, isStudioLook, readableLook, type CaptionEnergy, type StudioOption } from '../../lib/studioCaptions';

/**
 * Studio effects controls shared by every caption picker (Story, Render,
 * Sermon clip, Series), so they cannot drift apart.
 */

export interface StudioLookOptionsProps {
  looks: StudioOption[];
  /** False when the server's ffmpeg has no libass: looks are listed but disabled. */
  libass: boolean;
  /** The current selection; a saved Studio look stays selectable before the catalogue loads. */
  value?: string;
}

/** The "Studio effects" group for a caption-style <select>. */
export function StudioLookOptions({ looks, libass, value }: StudioLookOptionsProps) {
  const savedMissing = isStudioLook(value) && !looks.some((l) => l.id === value);
  if (looks.length === 0 && !savedMissing) return null;
  return (
    <optgroup label="Studio effects">
      {savedMissing && <option value={value}>{readableLook(value!)}</option>}
      {looks.map((l) => (
        <option key={l.id} value={l.id} disabled={!libass}>
          {l.label}{libass ? '' : ' (unavailable on this server)'}
        </option>
      ))}
    </optgroup>
  );
}

export interface StudioEffectsControlsProps {
  /** The chosen Studio look id, e.g. "studio-lagos-night". */
  look: string;
  energy: string;
  /** The server's energy list; falls back to Calm / Lively / Wild. */
  energies?: StudioOption[];
  onEnergyChange: (next: CaptionEnergy) => void;
  /** Re-roll which effect each line gets. Omit where every render is shuffled anyway. */
  onShuffle?: () => void;
  disabled?: boolean;
}

/** Shown once a Studio look is picked: its sample clip, Energy, and Shuffle. */
export function StudioEffectsControls({ look, energy, energies, onEnergyChange, onShuffle, disabled = false }: StudioEffectsControlsProps) {
  // A look whose sample clip failed to load: hide the player rather than show a broken one.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const options = energies && energies.length > 0 ? energies : FALLBACK_ENERGIES;
  return (
    <>
      {failedPreview !== look && (
        <video
          key={look}
          src={`/studio-looks/${look.replace(/^studio-/, '')}.mp4`}
          autoPlay
          muted
          loop
          playsInline
          aria-label="Studio look sample"
          onError={() => setFailedPreview(look)}
          className="w-full max-w-xs rounded-lg border border-white/10"
        />
      )}
      <Field
        label="Energy"
        tooltip="How wild the effects get. Calm pops and stacks words; Lively adds big brush slams on lines that repeat; Wild slams everywhere, made for songs."
      >
        <div className="flex items-center gap-2">
          <Select
            aria-label="Energy"
            value={energy}
            disabled={disabled}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onEnergyChange(e.target.value as CaptionEnergy)}
          >
            {options.map((en) => (
              <option key={en.id} value={en.id}>{en.label}</option>
            ))}
          </Select>
          {onShuffle && (
            <button
              type="button"
              onClick={onShuffle}
              disabled={disabled}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-2.5 text-xs text-content-secondary hover:text-bf-cream disabled:opacity-50"
              title="Re-roll which effect each line gets"
            >
              Shuffle effects
            </button>
          )}
        </div>
      </Field>
    </>
  );
}
```

Refactor `client/src/components/story/StoryCaptionsPanel.tsx` (behaviour must not change; its existing tests are the guard):
- Delete the local `StudioOption` interface, `FALLBACK_ENERGIES`, `readableLook`, the `failedPreview` state, `savedStudioMissing`, `energyOptions` and `shuffle`.
- Import `{ isStudioLook, nextSeed, type StudioOption } from '../../lib/studioCaptions'` and `{ StudioLookOptions, StudioEffectsControls } from '../captions/StudioEffects'`.
- `const studio = isStudioLook(value.captionPreset);`
- Replace the whole `{(studioLooks.length > 0 || savedStudioMissing) && ( <optgroup label="Studio effects"> … </optgroup> )}` block with `<StudioLookOptions looks={studioLooks} libass={libass} value={value.captionPreset} />`.
- Replace the `{studio && failedPreview !== value.captionPreset && (<video … />)}` block and the Energy `<Field>` (with its Shuffle button) inside `{studio && (<> … </>)}` with:

```tsx
          {studio && (
            <>
            <StudioEffectsControls
              look={value.captionPreset!}
              energy={value.captionEnergy || 'lively'}
              energies={energies}
              onEnergyChange={(next) => onChange({ captionEnergy: next })}
              onShuffle={() => onChange({ captionSeed: nextSeed(value.captionSeed) })}
              disabled={busy}
            />
            {/* the existing "Title intro" <Field> stays here unchanged */}
            </>
          )}
```

keeping the existing "Title intro" `<Field>` exactly as it is, inside the same fragment after `StudioEffectsControls`.

- [ ] **Step 4: Run the tests to see them pass**

Run (from `client/`): `npx vitest run src/lib/__tests__/studioCaptions.test.ts src/components/captions src/components/story`
Expected: PASS, 0 failures (every existing StoryCaptionsPanel test unchanged and green).
Run (from `client/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/studioCaptions.ts client/src/lib/__tests__/studioCaptions.test.ts client/src/components/captions client/src/components/story/StoryCaptionsPanel.tsx
git commit -m "refactor: share the Studio effects picker controls across caption panels"
```

---

### Task 4: Script/Wizard picker and payload (RenderCaptionsPanel + RenderPage)

**Files:**
- Modify: `client/src/components/render/RenderCaptionsPanel.tsx`
- Modify: `client/src/components/render/__tests__/RenderCaptionsPanel.test.tsx`
- Modify: `client/src/pages/RenderPage.tsx` (state ~line 147, catalogue fetch ~line 290, payload ~line 509, both `<RenderCaptionsPanel>` usages ~lines 1092 and 1392)
- Modify: `client/src/lib/storage.ts` (`STORAGE_KEYS`)

**Interfaces:**
- Consumes: Task 3's `StudioLookOptions`, `StudioEffectsControls`, `isStudioLook`, `nextSeed`, `randomSeed`, `StudioOption`, `CaptionEnergy`.
- Produces: `RenderCaptionsPanelProps` gains `studioLooks?: StudioOption[]`, `energies?: StudioOption[]`, `libass?: boolean`, `captionEnergy?: string`, `onCaptionEnergyChange?: (next: CaptionEnergy) => void`, `onShuffleEffects?: () => void`. The render payload gains `captionEnergy` and `captionSeed` when the style is a Studio look.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/render/__tests__/RenderCaptionsPanel.test.tsx` (the file's `setup` helper and imports already exist):

```tsx
const STUDIO = [{ id: 'studio-lagos-night', label: 'Lagos Night' }];

describe('RenderCaptionsPanel Studio effects', () => {
  it('lists Studio looks in the caption animation picker', () => {
    setup({ studioLooks: STUDIO, libass: true });
    expect(screen.getByRole('option', { name: 'Lagos Night' })).not.toBeDisabled();
  });

  it('disables Studio looks where the server cannot draw them', () => {
    setup({ studioLooks: STUDIO, libass: false });
    expect(screen.getByRole('option', { name: /unavailable on this server/ })).toBeDisabled();
  });

  it('a Studio look swaps motion, layout and depth for Energy and Shuffle', async () => {
    const user = userEvent.setup();
    const onCaptionEnergyChange = vi.fn();
    const onShuffleEffects = vi.fn();
    setup({
      typographyPreset: 'studio-lagos-night',
      studioLooks: STUDIO,
      libass: true,
      motions: [{ id: 'words', label: 'Word by word' }],
      captionEnergy: 'lively',
      onCaptionEnergyChange,
      onShuffleEffects,
    });
    expect(screen.queryByRole('combobox', { name: 'Caption motion' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Text layout' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /depth/i })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Energy' }), 'wild');
    expect(onCaptionEnergyChange).toHaveBeenCalledWith('wild');
    await user.click(screen.getByRole('button', { name: /shuffle effects/i }));
    expect(onShuffleEffects).toHaveBeenCalled();
  });

  it('other styles keep layout and depth, and show no Energy', () => {
    setup({ typographyPreset: 'cinematic-default', studioLooks: STUDIO, libass: true });
    expect(screen.getByRole('combobox', { name: 'Text layout' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Energy' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `client/`): `npx vitest run src/components/render/__tests__/RenderCaptionsPanel.test.tsx`
Expected: FAIL — no "Lagos Night" option, no Energy control.

- [ ] **Step 3: Implement the panel**

In `client/src/components/render/RenderCaptionsPanel.tsx`:
- Import `{ StudioLookOptions, StudioEffectsControls } from '../captions/StudioEffects'` and `{ isStudioLook, type CaptionEnergy, type StudioOption } from '../../lib/studioCaptions'`.
- Add to `RenderCaptionsPanelProps`:

```ts
  /** Studio looks (libass) from the server; may be empty while loading. */
  studioLooks?: StudioOption[];
  /** Energy levels from the server; falls back to Calm / Lively / Wild. */
  energies?: StudioOption[];
  /** False when the server's ffmpeg has no libass: Studio looks are listed but disabled. */
  libass?: boolean;
  captionEnergy?: string;
  onCaptionEnergyChange?: (next: CaptionEnergy) => void;
  /** Re-roll which effect each line gets (a new seed). */
  onShuffleEffects?: () => void;
```

- Destructure them with defaults `studioLooks = []`, `energies`, `libass = true`, `captionEnergy`, `onCaptionEnergyChange`, `onShuffleEffects`, and add `const studio = isStudioLook(typographyPreset);` at the top of the function body.
- Caption motion block: change `{Array.isArray(motions) && motions.length > 0 && (` to `{!studio && Array.isArray(motions) && motions.length > 0 && (`.
- Inside the "Caption animation" `<Select>`, add as its first child: `<StudioLookOptions looks={studioLooks} libass={libass} value={typographyPreset} />`.
- Directly after the "Caption animation" `</Field>`, add:

```tsx
      {studio && (
        <>
          <StudioEffectsControls
            look={typographyPreset}
            energy={captionEnergy || 'lively'}
            energies={energies}
            onEnergyChange={(next) => onCaptionEnergyChange?.(next)}
            onShuffle={() => onShuffleEffects?.()}
          />
          <p className="text-[11px] text-content-secondary">
            Studio effects follow each spoken word when Kinetic captions are on; otherwise the lines are spread over the video.
          </p>
        </>
      )}
```

- Wrap the "Text layout" `<Field>` and the "Layered depth" `<label>` together in `{!studio && ( <> … </> )}`.

- [ ] **Step 4: Implement the page**

In `client/src/lib/storage.ts`, add to `STORAGE_KEYS` after `renderTypographyPreset`:

```ts
    renderCaptionEnergy: 'BF_RENDER_CAPTION_ENERGY',
    renderCaptionSeed: 'BF_RENDER_CAPTION_SEED',
```

In `client/src/pages/RenderPage.tsx`:
- Import `{ isStudioLook, nextSeed, randomSeed, type CaptionEnergy, type StudioOption } from '../lib/studioCaptions'`.
- After the `typographyPreset` state line add:

```tsx
    // Studio looks: how lively the effects are, and which effect each line gets.
    const [captionEnergy, setCaptionEnergy] = useState<CaptionEnergy>(() => loadJson<CaptionEnergy>(STORAGE_KEYS.renderCaptionEnergy, 'lively'));
    const [captionSeed, setCaptionSeed] = useState<number>(() => loadJson<number>(STORAGE_KEYS.renderCaptionSeed, randomSeed()));
    const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
    const [energies, setEnergies] = useState<StudioOption[]>([]);
    const [libass, setLibass] = useState(true);
```

- After the existing `useEffect` that saves `renderTypographyPreset`, add:

```tsx
    useEffect(() => {
        saveJson(STORAGE_KEYS.renderCaptionEnergy, captionEnergy);
    }, [captionEnergy]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderCaptionSeed, captionSeed);
    }, [captionSeed]);
```

- In the `/api/tts/animations` fetch: add `studioLooks?: StudioOption[]; energies?: StudioOption[]; libass?: boolean;` to the response type, and after `setCaptionMotions(...)` add:

```tsx
            setStudioLooks(res.data?.studioLooks ?? []);
            setEnergies(res.data?.energies ?? []);
            setLibass(res.data?.libass !== false);
```

- In `corePayload`, after `captionHighlight,` add:

```tsx
                ...(isStudioLook(typographyPreset) ? { captionEnergy, captionSeed } : {}),
```

- On BOTH `<RenderCaptionsPanel>` usages, add after `animations={animations}`:

```tsx
                            studioLooks={studioLooks}
                            energies={energies}
                            libass={libass}
                            captionEnergy={captionEnergy}
                            onCaptionEnergyChange={setCaptionEnergy}
                            onShuffleEffects={() => setCaptionSeed((s) => nextSeed(s))}
```

- [ ] **Step 5: Run the tests to see them pass**

Run (from `client/`): `npx vitest run src/components/render src/pages/__tests__/RenderLabEmbedded.test.tsx`
Expected: PASS, 0 failures.
Run (from `client/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/render client/src/pages/RenderPage.tsx client/src/lib/storage.ts
git commit -m "feat: Studio effects in the Script render picker"
```

---

### Task 5: Sermon clip server — Studio captions in `/captioned-video` (+ Timeline guard)

**Files:**
- Modify: `server/src/routes/render.js` (imports ~line 13; word cap ~lines 601–620; caption block ~lines 905–930)
- Modify: `server/src/routes/timeline.js` (~line 379, plus an import)
- Modify: `server/test/routes/render.captionedVideo.test.js` (append tests)

**Interfaces:**
- Consumes: `prepareStudioCaptions` (Task 1), `isStudioLook` and `drawtextPresetFor` (Task 1, `looks.js`), `hasLibass` (`server/src/lib/kinetic/capability.js`).
- Produces: POST `/api/render/captioned-video` accepts `captionEnergy` and `captionSeed`; default energy `calm`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("POST /api/render/captioned-video — validation", ...)` block of `server/test/routes/render.captionedVideo.test.js` (add `import { hasLibass } from "../../src/lib/kinetic/capability.js";` to the imports at the top):

```js
  test("a Studio look draws captions with one ass filter instead of drawtext", async (t) => {
    const { spawnSync } = await import("child_process");
    const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    if (spawnSync(bin, ["-version"], { stdio: "ignore" }).status !== 0) return t.skip("ffmpeg not available");
    if (!hasLibass()) return t.skip("ffmpeg here has no libass");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const aud = path.join(outDir, "voice.wav");
    const bg = path.join(outDir, "bg.mp4");
    spawnSync(bin, ["-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "6", aud], { stdio: "ignore" });
    spawnSync(bin, ["-y", "-f", "lavfi", "-i", "color=size=64x64:rate=10:color=navy", "-t", "6", "-pix_fmt", "yuv420p", bg], { stdio: "ignore" });

    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({
        audioPath: aud,
        backgroundPath: bg,
        typographyPreset: "studio-lagos-night",
        captionEnergy: "calm",
        captionSeed: 1,
        words: [
          { text: "be", startMs: 200, endMs: 500 },
          { text: "strong", startMs: 3200, endMs: 3600 },
        ],
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const filterName = fs.readdirSync(outDir).find((f) => /^filter-.*\.txt$/.test(f));
    assert.ok(filterName, "expected a filter script to be written");
    const graph = fs.readFileSync(path.join(outDir, filterName), "utf-8");
    assert.match(graph, /ass=filename='[^']*captions-[0-9a-f-]+\.ass'/);
    assert.doesNotMatch(graph, /drawtext=/);
  });

  test("a Studio look is not bound by the drawtext word cap", async (t) => {
    if (!hasLibass()) return t.skip("ffmpeg here has no libass");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const aud = path.join(outDir, "a.wav");
    const bg = path.join(outDir, "bg.mp4");
    fs.writeFileSync(aud, Buffer.alloc(200, 0));
    fs.writeFileSync(bg, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const words = Array.from({ length: 1600 }, (_, i) => ({ text: `w${i}`, startMs: i * 100, endMs: i * 100 + 80 }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({ audioPath: aud, backgroundPath: bg, words, typographyPreset: "studio-gospel-gold" });
    // The zeroed sentinel files fail a later probe; what matters is that the
    // word cap did not stop it.
    assert.notEqual(res.status, 413, JSON.stringify(res.body));
    assert.doesNotMatch(res.body?.error || "", /Too many caption words/);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `server/`): `node --test test/routes/render.captionedVideo.test.js`
Expected: the two new tests FAIL (graph has `drawtext=`; 1600 words → 413). All existing tests still PASS.

- [ ] **Step 3: Implement in `server/src/routes/render.js`**

(a) After the `videoFilters.js` import (line 13) add:

```js
import { isStudioLook } from "../lib/kinetic/looks.js";
import { hasLibass } from "../lib/kinetic/capability.js";
import { prepareStudioCaptions } from "../lib/kinetic/renderCaptions.js";
```

(b) After the line `const captions = req.body?.captions !== false;` add:

```js
    // Studio looks draw with libass: thousands of ASS events cost little, so
    // drawtext's word cap below does not apply to them.
    const studioLook = captions && isStudioLook(typographyPreset) && hasLibass();
```

(c) Change the cap condition `if (captions && Array.isArray(words) && words.length > MAX_CAPTION_WORDS) {` to:

```js
    if (captions && !studioLook && Array.isArray(words) && words.length > MAX_CAPTION_WORDS) {
```

Read the 413 response inside that `if` and note its exact error string; step (d) reuses it verbatim.

(d) In the `if (captions) { … }` caption block, keep the `drawWords.length === 0` 400 check first, then replace everything from `const resolvedPreset = resolveKineticAnimation(typographyPreset)?.presetId || typographyPreset;` through the `if (!drawtextChain) { return res.status(400)…; }` check with:

```js
      fs.mkdirSync(req.ctx.outputDir, { recursive: true });
      const studioCaptions = prepareStudioCaptions({
        preset: typographyPreset,
        assPath: path.join(req.ctx.outputDir, `captions-${uuid()}.ass`),
        words: drawWords,
        w: renderWidth,
        h: renderHeight,
        energy: req.body?.captionEnergy,
        seed: req.body?.captionSeed,
        defaultEnergy: "calm",
      });
      if (studioCaptions.mode === "studio") {
        // Removed with the other temp inputs when the render ends.
        tempInputs.push(...studioCaptions.files);
        drawtextChain = studioCaptions.filter || "null";
      } else {
        // A Studio look that fell back to drawtext is bound by drawtext's cap again.
        if (drawWords.length > MAX_CAPTION_WORDS) {
          cleanupTempInputs();
          return res.status(413).json({ ok: false, error: /* the exact string from step (c), with words.length -> drawWords.length */ });
        }
        const resolvedPreset = resolveKineticAnimation(studioCaptions.preset)?.presetId || studioCaptions.preset;
        // (the existing comment block, `const tieredWords = annotatePhrasedTiers(drawWords);`,
        //  the existing `drawtextChain = buildWordDrawtext({ ... preset: resolvedPreset, ... });`
        //  and the existing `if (!drawtextChain) { return res.status(400)... }` — unchanged)
      }
```

The two comment placeholders above mean: paste the existing code there unchanged (moved inside `else`), and use the exact 413 template string from step (c) with `${words.length}` replaced by `${drawWords.length}`. Nothing else in the handler changes. Confirm `tempInputs` and `cleanupTempInputs` are declared before this block (they are, ~line 700); if not, STOP and report.

- [ ] **Step 4: Timeline guard in `server/src/routes/timeline.js`**

Import `{ drawtextPresetFor } from "../lib/kinetic/looks.js"` (match the file's import quote style), and wrap the `typographyPreset:` value at ~line 379:

```js
      // The Timeline renderer gets its Studio (libass) path in step 4 of the
      // kinetic caption plan; until then a Studio pick draws with its fallback.
      typographyPreset: drawtextPresetFor(typeof req.body?.typographyPreset === 'string' ? req.body.typographyPreset : (project?.renderSettings?.typographyPreset || null)),
```

(`drawtextPresetFor(null)` returns `null`, so the existing default is unchanged.)

- [ ] **Step 5: Run the tests to see them pass**

Run (from `server/`): `node --test test/routes/render.captionedVideo.test.js test/routes/sermonClipStudio.smoke.test.js test/routes/brandLogoRenders.test.js`
Expected: PASS, 0 failures.
Run (from `server/`): `npm test`
Expected: 0 failures (record the pass/skip counts in the report).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/render.js server/src/routes/timeline.js server/test/routes/render.captionedVideo.test.js
git commit -m "feat: Sermon clips draw Studio looks, with no word cap"
```

---

### Task 6: Sermon clip picker and payload (AnimationPicker, CaptionStylePanel, TimelinePage)

**Files:**
- Modify: `client/src/components/voicelab/AnimationPicker.tsx`
- Create: `client/src/components/voicelab/__tests__/AnimationPicker.studio.test.tsx`
- Modify: `client/src/components/timeline/CaptionStylePanel.tsx`
- Modify: `client/src/components/timeline/__tests__/CaptionStylePanel.test.tsx`
- Modify: `client/src/pages/TimelinePage.tsx` (state ~line 343; payload ~line 861; word cap ~lines 774 and 2035; both `<CaptionStylePanel>` usages ~lines 2558 and 3173)
- Modify: `client/src/lib/storage.ts` (`STORAGE_KEYS`)

**Interfaces:**
- Consumes: Task 3's `StudioEffectsControls`, `isStudioLook`, `nextSeed`, `randomSeed`, `CaptionEnergy`, `StudioOption`.
- Produces: `AnimationPicker` prop `showStudio?: boolean`; its `onChange` becomes `(id: string, animation?: KineticAnimation) => void`. `CaptionStylePanelProps` gains `captionEnergy?: string`, `onCaptionEnergyChange?: (next: CaptionEnergy) => void`, `onShuffleEffects?: () => void`. The `/captioned-video` request gains `captionEnergy` and `captionSeed` for Studio looks.

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/voicelab/__tests__/AnimationPicker.studio.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnimationPicker } from '../AnimationPicker';
import { api } from '../../../lib/api';

const catalogue = (libass: boolean) => ({
  ok: true,
  data: {
    ok: true,
    animations: [{ id: 'karaoke-pop', label: 'Karaoke Pop', description: 'Pop', presetId: 'karaoke-pop', renderable: true, unsupported: [] }],
    studioLooks: [{ id: 'studio-lagos-night', label: 'Lagos Night', description: 'Yellow brush hits' }],
    libass,
  },
});

afterEach(() => vi.restoreAllMocks());

describe('AnimationPicker Studio looks', () => {
  it('lists Studio looks only when asked to', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(catalogue(true) as any);
    const { unmount } = render(<AnimationPicker defaultOpen />);
    await screen.findByText('Karaoke Pop');
    expect(screen.queryByText('Lagos Night')).toBeNull();
    unmount();
    render(<AnimationPicker defaultOpen showStudio />);
    expect(await screen.findByText('Lagos Night')).toBeInTheDocument();
  });

  it('picking a Studio look reports its id', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue(catalogue(true) as any);
    const onChange = vi.fn();
    render(<AnimationPicker defaultOpen showStudio onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: /Lagos Night/ }));
    expect(onChange).toHaveBeenCalledWith('studio-lagos-night');
  });

  it('disables Studio looks where the server has no libass', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(catalogue(false) as any);
    render(<AnimationPicker defaultOpen showStudio />);
    expect(await screen.findByRole('button', { name: /Lagos Night/ })).toBeDisabled();
  });
});
```

Append to `client/src/components/timeline/__tests__/CaptionStylePanel.test.tsx` (its `setup` helper and the `AnimationPicker` mock already exist):

```tsx
describe('CaptionStylePanel Studio effects', () => {
  it('a Studio look swaps layout and depth for Energy and Shuffle', async () => {
    const user = userEvent.setup();
    const onCaptionEnergyChange = vi.fn();
    const onShuffleEffects = vi.fn();
    setup({ typographyPreset: 'studio-lagos-night', captionEnergy: 'calm', onCaptionEnergyChange, onShuffleEffects });
    expect(screen.queryByRole('combobox', { name: 'Text layout' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const energy = screen.getByRole('combobox', { name: 'Energy' });
    expect(energy).toHaveValue('calm');
    await user.selectOptions(energy, 'wild');
    expect(onCaptionEnergyChange).toHaveBeenCalledWith('wild');
    await user.click(screen.getByRole('button', { name: /shuffle effects/i }));
    expect(onShuffleEffects).toHaveBeenCalled();
  });

  it('defaults a Studio look to Calm energy for sermons', () => {
    setup({ typographyPreset: 'studio-gospel-gold' });
    expect(screen.getByRole('combobox', { name: 'Energy' })).toHaveValue('calm');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `client/`): `npx vitest run src/components/voicelab src/components/timeline/__tests__/CaptionStylePanel.test.tsx`
Expected: the new tests FAIL; existing tests PASS.

- [ ] **Step 3: Implement `AnimationPicker`**

In `client/src/components/voicelab/AnimationPicker.tsx`:
- Import `type { StudioOption } from '../../lib/studioCaptions'`.
- Props: change `onChange?: (id: string, animation: KineticAnimation) => void;` to `onChange?: (id: string, animation?: KineticAnimation) => void;` and add:

```ts
  /** List the Studio effects looks (libass) above the animations. Only for renderers that draw them. */
  showStudio?: boolean;
```

- State: add `const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);` and `const [libass, setLibass] = useState(true);`. Extend the fetch's response type with `studioLooks?: StudioOption[]; libass?: boolean;` and, inside `if (res.ok && res.data?.animations) {`, add `setStudioLooks(res.data.studioLooks ?? []); setLibass(res.data.libass !== false);`.
- Add a picker for Studio ids next to `pick`:

```tsx
  const pickId = (id: string) => {
    setSelected(id);
    saveJson(STORAGE_KEYS.renderTypographyPreset, id);
    onChange?.(id);
  };
```

- In the loaded branch, render the Studio group before the existing grid, wrapping both in a fragment:

```tsx
        <>
          {showStudio && studioLooks.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-content-secondary">Studio effects</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {studioLooks.map((l) => {
                  const active = l.id === selected;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => pickId(l.id)}
                      disabled={!libass}
                      aria-pressed={active}
                      title={libass ? l.description : 'Studio effects unavailable on this server'}
                      className={`text-left rounded-lg px-3 py-2 border transition focus:outline-none focus:ring-2 focus:ring-editor-accent/40 disabled:opacity-50 ${
                        active
                          ? 'border-editor-accent/60 bg-editor-accent/10 ring-1 ring-editor-accent/40'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-gray-100">{l.label}</span>
                        <Badge variant="default" className="shrink-0 !px-1.5 !py-0.5 !text-[10px]">Studio</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-content-secondary truncate">{l.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* existing <div className="grid … max-h-80 …"> animations grid, unchanged */}
        </>
```

- [ ] **Step 4: Implement `CaptionStylePanel`**

In `client/src/components/timeline/CaptionStylePanel.tsx`:
- Import `{ StudioEffectsControls } from '../captions/StudioEffects'` and `{ isStudioLook, type CaptionEnergy } from '../../lib/studioCaptions'`.
- Add props (documented):

```ts
  /** Studio looks: Calm / Lively / Wild. Sermons default to Calm. */
  captionEnergy?: string;
  onCaptionEnergyChange?: (next: CaptionEnergy) => void;
  /** Re-roll which effect each line gets (a new seed). */
  onShuffleEffects?: () => void;
```

- Pass `showStudio` to `<AnimationPicker value={typographyPreset} onChange={onTypographyPresetChange} showStudio />`.
- Replace the `<div className="mt-3"> … </div>` (layout select + depth) with:

```tsx
      {isStudioLook(typographyPreset) ? (
        <div className="mt-3 space-y-3">
          <StudioEffectsControls
            look={typographyPreset}
            energy={captionEnergy || 'calm'}
            onEnergyChange={(next) => onCaptionEnergyChange?.(next)}
            onShuffle={() => onShuffleEffects?.()}
          />
        </div>
      ) : (
        <div className="mt-3">
          {/* the existing layout <select> and depth <label>, unchanged */}
        </div>
      )}
```

- [ ] **Step 5: Implement `TimelinePage` + storage**

In `client/src/lib/storage.ts`, add after `sclTypographyPreset`:

```ts
    sclCaptionEnergy: 'BF_SCL_CAPTION_ENERGY',
    sclCaptionSeed: 'BF_SCL_CAPTION_SEED',
```

In `client/src/pages/TimelinePage.tsx`:
- Import `{ isStudioLook, nextSeed, randomSeed, type CaptionEnergy } from '../lib/studioCaptions'`.
- After the `typographyPreset` persisted state add:

```tsx
    // Studio looks: sermons default to Calm; the seed picks each line's effect.
    const [captionEnergy, setCaptionEnergy] = usePersistedState<CaptionEnergy>(STORAGE_KEYS.sclCaptionEnergy, 'calm');
    const [captionSeed, setCaptionSeed] = usePersistedState<number>(STORAGE_KEYS.sclCaptionSeed, randomSeed());
```

- Word cap (~line 774): change `if (shouldRenderCaptions && words.length > MAX_CAPTION_WORDS) {` to `if (shouldRenderCaptions && !isStudioLook(typographyPreset) && words.length > MAX_CAPTION_WORDS) {` and add above it the comment `// Studio looks (libass) have no word cap; the server enforces it if it has to fall back.`
- Checklist (~line 2035): change `...(kineticCaptions && transcript && transcript.length > MAX_CAPTION_WORDS` to `...(kineticCaptions && !isStudioLook(typographyPreset) && transcript && transcript.length > MAX_CAPTION_WORDS`.
- `/api/render/captioned-video` body: after `depth,` add `...(isStudioLook(typographyPreset) ? { captionEnergy, captionSeed } : {}),`.
- On BOTH `<CaptionStylePanel>` usages add:

```tsx
                                captionEnergy={captionEnergy}
                                onCaptionEnergyChange={setCaptionEnergy}
                                onShuffleEffects={() => setCaptionSeed((s) => nextSeed(s))}
```

(match each usage's indentation). If either `useCallback`/`useMemo` that contains the word-cap code or the checklist has a dependency array, add `typographyPreset` (and for the request body `captionEnergy`, `captionSeed`) to it.

- [ ] **Step 6: Run the tests to see them pass**

Run (from `client/`): `npx vitest run src/components/voicelab src/components/timeline src/pages`
Expected: PASS, 0 failures.
Run (from `client/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/voicelab client/src/components/timeline client/src/pages/TimelinePage.tsx client/src/lib/storage.ts
git commit -m "feat: Studio effects in the Sermon clip picker"
```

---

### Task 7: Series caption style picker

**Files:**
- Create: `client/src/components/series/SeriesCaptionStyle.tsx`
- Create: `client/src/components/series/__tests__/SeriesCaptionStyle.test.tsx`
- Modify: `client/src/pages/SeriesPage.tsx` (state ~line 43; request ~line 119; options grid ~line 214)
- Modify: `client/src/lib/bibleApi.ts` (`SeriesGenerateInput`)

**Interfaces:**
- Consumes: Task 3's `StudioLookOptions`, `StudioEffectsControls`, `isStudioLook`, `CaptionEnergy`, `StudioOption`; Task 2's server `GenerateSchema` fields `typographyPreset` and `captionEnergy`.
- Produces: `SeriesCaptionStyle({ value, onChange, energy, onEnergyChange })` where `value` is `''` for the series default style.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/series/__tests__/SeriesCaptionStyle.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeriesCaptionStyle } from '../SeriesCaptionStyle';
import { api } from '../../../lib/api';

afterEach(() => vi.restoreAllMocks());

const mockCatalogue = () =>
  vi.spyOn(api, 'get').mockResolvedValue({
    ok: true,
    data: { ok: true, studioLooks: [{ id: 'studio-gospel-gold', label: 'Gospel Gold' }], libass: true },
  } as any);

describe('SeriesCaptionStyle', () => {
  it('defaults to the scripture style and offers Studio looks', async () => {
    mockCatalogue();
    const onChange = vi.fn();
    render(<SeriesCaptionStyle value="" onChange={onChange} energy="lively" onEnergyChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Caption style' });
    expect(select).toHaveValue('');
    await screen.findByRole('option', { name: 'Gospel Gold' });
    await userEvent.setup().selectOptions(select, 'studio-gospel-gold');
    expect(onChange).toHaveBeenCalledWith('studio-gospel-gold');
  });

  it('a Studio look shows Energy and no Shuffle (each part gets its own mix)', async () => {
    mockCatalogue();
    const onEnergyChange = vi.fn();
    render(<SeriesCaptionStyle value="studio-gospel-gold" onChange={vi.fn()} energy="lively" onEnergyChange={onEnergyChange} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Energy' }), 'calm');
    expect(onEnergyChange).toHaveBeenCalledWith('calm');
    expect(screen.queryByRole('button', { name: /shuffle effects/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run (from `client/`): `npx vitest run src/components/series`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `client/src/components/series/SeriesCaptionStyle.tsx`:

```tsx
import { useEffect, useState, type ChangeEvent } from 'react';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { StudioLookOptions, StudioEffectsControls } from '../captions/StudioEffects';
import { isStudioLook, type CaptionEnergy, type StudioOption } from '../../lib/studioCaptions';

export interface SeriesCaptionStyleProps {
  /** '' = the series default (scripture emphasis), else a Studio look id. */
  value: string;
  onChange: (next: string) => void;
  energy: CaptionEnergy;
  onEnergyChange: (next: CaptionEnergy) => void;
}

/**
 * Caption style for a Series. Every part is scripture, so the default stays
 * the scripture style; a Studio look swaps in the kinetic engine. There is no
 * Shuffle: each part is rendered with its own mix of effects.
 */
export function SeriesCaptionStyle({ value, onChange, energy, onEnergyChange }: SeriesCaptionStyleProps) {
  const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
  const [energies, setEnergies] = useState<StudioOption[]>([]);
  const [libass, setLibass] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<{ ok: boolean; studioLooks?: StudioOption[]; energies?: StudioOption[]; libass?: boolean }>('/api/tts/animations');
      if (cancelled || !res.ok) return; // Optional: the default style still works.
      setStudioLooks(res.data?.studioLooks ?? []);
      setEnergies(res.data?.energies ?? []);
      setLibass(res.data?.libass !== false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption">Caption style</span>
      <Select aria-label="Caption style" value={value} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
        <option value="">Scripture (default)</option>
        <StudioLookOptions looks={studioLooks} libass={libass} value={value} />
      </Select>
      {isStudioLook(value) && (
        <StudioEffectsControls look={value} energy={energy} energies={energies} onEnergyChange={onEnergyChange} />
      )}
    </div>
  );
}
```

In `client/src/lib/bibleApi.ts`, add to `SeriesGenerateInput`:

```ts
    /** Caption style: a Studio look id; omitted = the scripture default. */
    typographyPreset?: string;
    captionEnergy?: 'calm' | 'lively' | 'wild';
```

In `client/src/pages/SeriesPage.tsx`:
- Import `{ SeriesCaptionStyle } from '../components/series/SeriesCaptionStyle'` and `type { CaptionEnergy } from '../lib/studioCaptions'`.
- After the `aspect` state add:

```tsx
    const [captionStyle, setCaptionStyle] = useState('');
    const [captionEnergy, setCaptionEnergy] = useState<CaptionEnergy>('lively');
```

- In `seriesApi.generate({ … })`, after `useGenImage,` add:

```tsx
                ...(captionStyle ? { typographyPreset: captionStyle, captionEnergy } : {}),
```

- In the "Publish & render options" grid, after the Aspect `<label>…</label>`, add:

```tsx
                        <SeriesCaptionStyle
                            value={captionStyle}
                            onChange={setCaptionStyle}
                            energy={captionEnergy}
                            onEnergyChange={setCaptionEnergy}
                        />
```

- [ ] **Step 4: Run the tests to see them pass**

Run (from `client/`): `npx vitest run src/components/series src/pages`
Expected: PASS, 0 failures.
Run (from `client/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/series client/src/pages/SeriesPage.tsx client/src/lib/bibleApi.ts
git commit -m "feat: Series parts can use a Studio caption look"
```

---

### Task 8: Full verification and client bundle

**Files:**
- Modify (generated): `server/public/**` via the client build

- [ ] **Step 1: Full suites**

Run (from `server/`): `npm test` — Expected: 0 failures (record pass/skip counts).
Run (from `client/`): `npx vitest run` — Expected: 0 failures (record counts).
Run (from `client/`): `npx tsc -b` — Expected: no errors.

- [ ] **Step 2: Build the client bundle**

Run (from `client/`): `npm run build`
Expected: success; `server/public` regenerated.

- [ ] **Step 3: Commit the bundle**

```bash
git add server/public
git commit -m "chore: rebuild client bundle"
```

---

## Out of scope (later steps)

- Timeline editor render (`proofRenderer.js`) and Ambient get the real Studio path in step 4; until then the Timeline route draws a Studio pick with its fallback preset (Task 5 Step 4).
- Social auto-post *schedules* have no caption-style UI; a schedule payload carrying `typographyPreset`/`captionEnergy` already renders through the campaign path (Task 2).
- A Script title card (`captionTitle`) is not offered on Script/Series renders.
