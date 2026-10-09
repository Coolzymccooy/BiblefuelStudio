# Kinetic Captions — Step 1 (engine core + Story) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Story video can pick a "Studio effects" caption look (Lagos Night, Gospel Gold, Clean White) and an energy level. Its captions are then drawn by a new libass engine with word pops, stacked tilted blocks and brush slams with sparks. Any server without libass falls back to an existing drawtext preset.

**Architecture:** A pure engine in `server/src/lib/kinetic/`:
- `planPhrases` (the director) picks an effect per phrase;
- the effect modules turn each planned phrase into ASS `Dialogue` lines;
- `buildAss` assembles the file;
- `studioCaptionFilter` returns the `ass=` filter string plus the file to write.

The Story renderer branches to it when the caption preset is a Studio look, and writes the `.ass` beside the filter script before spawning ffmpeg.

**Tech Stack:** Node 22 ESM, `node:test` with `node:assert/strict`, ffmpeg's `ass` filter (libass), the existing HarfBuzz `measureText`, React with Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-kinetic-caption-engine-design.md` (this plan covers "Build order" step 1).

## Global Constraints

**Runtime and rendering**
- Prod runs ffmpeg **5.1.9** (Debian bookworm). Dev runs 8.x. Use only `ass` filter options that exist in 5.1: `filename`, `fontsdir`.
- Filter graphs reach ffmpeg via `-filter_complex_script` (the existing `toFilterScriptArgs`). Do not change that.
- Escape paths inside filter options with `escapeFontPath` from `server/src/lib/videoFilters.js`, because a Windows drive colon breaks the graph.
- Fonts live in `server/assets/fonts` (`FONT_DIR`). Every new font is committed with its licence file beside it.
- A missing libass, or a failure to write the `.ass` file, must never fail a render. It falls back to the look's `fallbackPreset` through the existing drawtext path.
- Existing (non-Studio) caption output must stay byte-for-byte unchanged.

**Testing**
- Server tests: `cd server && node --test <file>`. Full suite: `npm test` in `server/`.
- Client tests: `cd client && npx vitest run <file>`. Before any push, the build check is `cd client && npm run build`. Never use `tsc -p .`, which checks nothing.

**Git**
- Commit messages are conventional (`feat:`, `fix:`, `test:`, `chore:`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never push or open a PR without the operator's explicit go-ahead. The repo is PUBLIC, so never commit secrets.
- Work only in the worktree `C:\Users\segun\source\repos\bf-kinetic` (branch `feat/kinetic-captions`).

**Data and naming**
- Studio look ids are `studio-<look>` (`studio-lagos-night`, `studio-gospel-gold`, `studio-clean-white`).
- Energies are `calm`, `lively` and `wild`. Story defaults to `lively`.
- Effects in this step are `pop`, `stack` and `slam`.

**Ruling (deviation from spec, recorded):** Studio looks are served as a separate `studioLooks` array from `GET /api/tts/animations`, not merged into `animations`. That way each picker opts in only once its renderer is wired, and no picker offers a look that would silently render as its fallback. The same endpoint also returns `energies` and `libass`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/lib/fontMetrics.js` (modify) | `loadFont` also returns `cellUnits` (OS/2 win ascent + descent), which is how libass sizes a font |
| `server/src/lib/kinetic/capability.js` | `hasLibass()`: is the `ass` filter present? (cached) |
| `server/src/lib/kinetic/looks.js` | `LOOKS`, `ENERGIES`, `isStudioLook`, `resolveLook`, `resolveEnergy`, `listStudioLooks`, `FALLBACK_FONT` |
| `server/src/lib/kinetic/text.js` | ASS escaping, colours and times; font sizing (`widthAt`, `fitSize`); glyph coverage |
| `server/src/lib/kinetic/layout.js` | Slots and safe widths per aspect; vertical clamping |
| `server/src/lib/kinetic/director.js` | Seeded PRNG, hook detection, `planPhrases` |
| `server/src/lib/kinetic/effects/common.js` | `lineEvent`, `sparksEvent`, `holdEnd`, `fontsFor`, `caseText`, `wrapWords` |
| `server/src/lib/kinetic/effects/pop.js`, `stack.js`, `slam.js` | One effect each, returning `Dialogue` strings |
| `server/src/lib/kinetic/ass.js` | `buildAss`: phrases → plan → events → the ASS document |
| `server/src/lib/kinetic/filter.js` | `studioCaptionFilter`: `{ filter, sideFiles }` |
| `server/assets/fonts/Knewave-Regular.ttf` and `Knewave-LICENSE.txt` | All-caps brush hit font (OFL) |
| `server/src/lib/story/storyRender.js` (modify) | Studio branch, `sideFiles`, fallback |
| `server/src/lib/story/projectStore.js` (modify) | `captionEnergy`, `captionSeed` |
| `server/src/routes/story.js` (modify) | Pass energy and seed to the render |
| `server/src/routes/tts.js` (modify) | `studioLooks`, `energies`, `libass` on `/animations` |
| `server/index.js` (modify) | `capabilities.libass` on `/api/health` |
| `client/src/lib/storyTypes.ts` (modify) | `captionEnergy`, `captionSeed` |
| `client/src/components/story/StoryCaptionsPanel.tsx` (modify) | Studio group, Energy, Shuffle; hide drawtext-only controls |

---

### Task 1: Font cell metrics and libass capability

**Files:**
- Modify: `server/src/lib/fontMetrics.js` (`loadFont`, around lines 115-128)
- Create: `server/src/lib/kinetic/capability.js`
- Modify: `server/index.js` (the `capabilities` object, around line 275)
- Test: `server/src/lib/kinetic/capability.test.js`, `server/src/lib/fontMetrics.test.js` (append)

**Interfaces:**
- Produces:
  - `loadFont(file).cellUnits: number`, the sum of `usWinAscent` and `usWinDescent` from OS/2. It falls back to `hhea` ascender − descender, then to `unitsPerEm`.
  - `hasLibass(): boolean` and `_setLibassForTest(value: boolean | undefined): void`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/fontMetrics.test.js` (create the import if the file doesn't import these yet):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadFont } from "./fontMetrics.js";
import { FONT_DIR } from "./videoFilters.js";

test("loadFont reports the cell height libass sizes fonts by", () => {
  for (const file of ["PermanentMarker.ttf", "Anton.ttf", "DejaVuSans.ttf", "Drybrush.ttf"]) {
    const f = loadFont(path.join(FONT_DIR, file));
    assert.ok(Number.isInteger(f.cellUnits), `${file} cellUnits is an integer`);
    // A cell is taller than the em for every real font, but not absurdly so.
    assert.ok(f.cellUnits >= f.unitsPerEm * 0.9 && f.cellUnits <= f.unitsPerEm * 2.5, `${file}: ${f.cellUnits} vs ${f.unitsPerEm}`);
  }
});
```

Create `server/src/lib/kinetic/capability.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasLibass, _setLibassForTest } from "./capability.js";

test("hasLibass answers a boolean and caches it", () => {
  _setLibassForTest(undefined);
  const first = hasLibass();
  assert.equal(typeof first, "boolean");
  assert.equal(hasLibass(), first);
});

test("the answer can be pinned for tests", () => {
  _setLibassForTest(false);
  assert.equal(hasLibass(), false);
  _setLibassForTest(true);
  assert.equal(hasLibass(), true);
  _setLibassForTest(undefined);
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `cd server && node --test src/lib/fontMetrics.test.js src/lib/kinetic/capability.test.js`
Expected: FAIL. `cellUnits` is undefined, and `capability.js` cannot be found.

- [ ] **Step 3: Implement**

In `loadFont` (`server/src/lib/fontMetrics.js`), after `const advanceOf = …`:

```js
  // libass sizes text by the font's CELL (Windows ascent + descent), not its
  // em, like VSFilter. Kinetic captions measure with this to know how wide a
  // \fs size really draws.
  const os2 = t["OS/2"];
  const winCell = os2 ? buf.readUInt16BE(os2.offset + 74) + buf.readUInt16BE(os2.offset + 76) : 0;
  const hheaCell = buf.readInt16BE(t.hhea.offset + 4) - buf.readInt16BE(t.hhea.offset + 6);
  const cellUnits = winCell || hheaCell || unitsPerEm;
```

Then add `cellUnits` to the returned `font` object:
`const font = { unitsPerEm, cellUnits, glyphOf: …, advanceOf, kerning: …, hasGpos: … };`

Create `server/src/lib/kinetic/capability.js`:

```js
import { execFileSync } from "node:child_process";

/**
 * Whether this server's ffmpeg has the `ass` filter (libass). Studio caption
 * looks need it; without it they render as their drawtext fallback. Asked
 * once per process.
 */
let cached;

export function hasLibass() {
  if (cached !== undefined) return cached;
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    const out = execFileSync(ff, ["-hide_banner", "-filters"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    });
    cached = /^\s*\S+\s+ass\s+V->V/m.test(out);
  } catch {
    cached = false;
  }
  return cached;
}

/** Pin (or with undefined, forget) the answer. Tests only. */
export function _setLibassForTest(value) {
  cached = value;
}
```

In `server/index.js`, import at the top with the other `./src/lib` imports:
`import { hasLibass } from "./src/lib/kinetic/capability.js";`
Then add this to the `capabilities` object of `/api/health`, after `kineticCaptions`:

```js
      // Studio caption looks draw with ffmpeg's ass filter (libass); false
      // means they fall back to drawtext presets on this box.
      libass: hasLibass(),
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd server && node --test src/lib/fontMetrics.test.js src/lib/kinetic/capability.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/fontMetrics.js server/src/lib/fontMetrics.test.js server/src/lib/kinetic/capability.js server/src/lib/kinetic/capability.test.js server/index.js
git commit -m "feat: report libass on /api/health and font cell heights for caption sizing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Looks, the Knewave font, and text utilities

**Files:**
- Create: `server/assets/fonts/Knewave-Regular.ttf`, `server/assets/fonts/Knewave-LICENSE.txt`
- Create: `server/src/lib/kinetic/looks.js`, `server/src/lib/kinetic/text.js`
- Test: `server/src/lib/kinetic/looks.test.js`, `server/src/lib/kinetic/text.test.js`

**Interfaces:**
- Consumes: `loadFont(file).cellUnits` and `.glyphOf(cp)`; `measureText(file, text, fontSize)` from `../fontMetrics.js`; `FONT_DIR` from `../videoFilters.js`.
- Produces:
  - `LOOKS`: a record keyed by look id. Each value is `{ id, label, description, body: Face, hit: Face, outline: "#RRGGBB", uppercase: boolean, fallbackPreset: string }`, where `Face = { file, family, colour }`.
  - `FALLBACK_FONT: { file, family }`.
  - `ENERGIES: Array<{id, label, description}>`.
  - `STUDIO_PREFIX = "studio-"`.
  - `isStudioLook(id): boolean`; `resolveLook(id): Look` (unknown ids give clean-white); `resolveEnergy(id, fallback = "lively"): "calm" | "lively" | "wild"`; `listStudioLooks(): Array<{id, label, description}>`, with ids prefixed.
  - `text.js`:
    - `fontPath(file)`, `widthAt(file, text, fs)`, `fitSize(file, lines, preferred, maxWidth, min = 24)`, `covers(file, text)`;
    - `assEscape(text)`, `assColour("#RRGGBB")` returning `"&H00BBGGRR&"`, `assTime(sec)` returning `"h:mm:ss.cc"`.

- [ ] **Step 1: Add the font**

```bash
cd /c/Users/segun/source/repos/bf-kinetic
curl -sSL -o server/assets/fonts/Knewave-Regular.ttf https://github.com/google/fonts/raw/main/ofl/knewave/Knewave-Regular.ttf
curl -sSL -o server/assets/fonts/Knewave-LICENSE.txt https://github.com/google/fonts/raw/main/ofl/knewave/OFL.txt
node -e "const b=require('fs').readFileSync('server/assets/fonts/Knewave-Regular.ttf');console.log(b.length, b.readUInt32BE(0).toString(16))"
head -3 server/assets/fonts/Knewave-LICENSE.txt
```

Expected: a size over 20000 and the magic number `10000` (TrueType), and a licence starting `Copyright`. If the magic number is wrong, stop and report BLOCKED. Do not commit an HTML error page as a font.

- [ ] **Step 2: Write the failing tests**

`server/src/lib/kinetic/looks.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LOOKS, FALLBACK_FONT, isStudioLook, resolveLook, resolveEnergy, listStudioLooks } from "./looks.js";
import { FONT_DIR, resolveTypographyPreset, listTypographyPresets } from "../videoFilters.js";

test("every look's fonts are in the repo and its fallback preset exists", () => {
  for (const look of Object.values(LOOKS)) {
    for (const face of [look.body, look.hit]) {
      assert.ok(fs.existsSync(path.join(FONT_DIR, face.file)), `${look.id}: ${face.file}`);
      assert.match(face.colour, /^#[0-9A-F]{6}$/i);
    }
    assert.ok(listTypographyPresets().includes(look.fallbackPreset), `${look.id} fallback ${look.fallbackPreset}`);
  }
  assert.ok(fs.existsSync(path.join(FONT_DIR, FALLBACK_FONT.file)));
});

test("studio ids are prefixed and resolve; everything else is not a studio look", () => {
  assert.equal(isStudioLook("studio-lagos-night"), true);
  assert.equal(isStudioLook("studio-nope"), false);
  assert.equal(isStudioLook("marker"), false);
  assert.equal(isStudioLook(undefined), false);
  assert.equal(resolveLook("studio-gospel-gold").id, "gospel-gold");
  assert.equal(resolveLook("rubbish").id, "clean-white");
  assert.deepEqual(listStudioLooks().map((l) => l.id), ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"]);
});

test("energy falls back to the caller's default", () => {
  assert.equal(resolveEnergy("wild"), "wild");
  assert.equal(resolveEnergy("loud"), "lively");
  assert.equal(resolveEnergy(undefined, "calm"), "calm");
});
```

`server/src/lib/kinetic/text.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { widthAt, fitSize, covers, assEscape, assColour, assTime } from "./text.js";

test("ASS colours are BGR with a zero alpha", () => {
  assert.equal(assColour("#F5D33A"), "&H003AD3F5&");
  assert.equal(assColour("#ffffff"), "&H00FFFFFF&");
});

test("ASS times are h:mm:ss.cc and never negative", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(61.237), "0:01:01.24");
  assert.equal(assTime(-3), "0:00:00.00");
});

test("text cannot inject override blocks or line breaks", () => {
  assert.equal(assEscape("a {\\pos(1,1)} b\\N c\nd"), "a /pos(1,1) b/N c d");
});

test("width grows with size and text; fitSize shrinks to fit", () => {
  const a = widthAt("PermanentMarker.ttf", "I STILL DEY", 60);
  assert.ok(a > 200 && a < 700, `width ${a}`);
  assert.ok(widthAt("PermanentMarker.ttf", "I STILL DEY", 120) > a * 1.9);
  const fs = fitSize("PermanentMarker.ttf", ["A VERY LONG LINE OF LYRICS HERE"], 120, 500);
  assert.ok(fs < 120 && widthAt("PermanentMarker.ttf", "A VERY LONG LINE OF LYRICS HERE", fs) <= 500 + 1);
  assert.equal(fitSize("PermanentMarker.ttf", ["HI"], 90, 1000), 90);
});

test("covers spots letters a font cannot draw", () => {
  assert.equal(covers("DejaVuSans.ttf", "Ọlọ́run ṣe é"), true);
  assert.equal(covers("PermanentMarker.ttf", "I STILL DEY"), true);
  assert.equal(covers("PermanentMarker.ttf", "ẹ ọ ṣ"), false);
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `cd server && node --test src/lib/kinetic/looks.test.js src/lib/kinetic/text.test.js`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`server/src/lib/kinetic/looks.js`:

```js
/**
 * Studio caption looks: the fonts and colours the kinetic engine draws in.
 * The ids the pickers use are "studio-" + id. `fallbackPreset` is the
 * drawtext preset used where libass is missing.
 */
export const STUDIO_PREFIX = "studio-";

export const LOOKS = Object.freeze({
  "lagos-night": Object.freeze({
    id: "lagos-night",
    label: "Lagos Night",
    description: "Yellow brush hits over white marker lines.",
    body: { file: "PermanentMarker.ttf", family: "Permanent Marker", colour: "#FFFFFF" },
    hit: { file: "Knewave-Regular.ttf", family: "Knewave", colour: "#F5D33A" },
    outline: "#101010",
    uppercase: true,
    fallbackPreset: "marker",
  }),
  "gospel-gold": Object.freeze({
    id: "gospel-gold",
    label: "Gospel Gold",
    description: "Gold headline hits over cream serif lines.",
    body: { file: "PlayfairDisplay-BoldItalic.ttf", family: "Playfair Display", colour: "#F4EBD0" },
    hit: { file: "Anton.ttf", family: "Anton", colour: "#E8B04B" },
    outline: "#1A1208",
    uppercase: false,
    fallbackPreset: "scripture-emphasis",
  }),
  "clean-white": Object.freeze({
    id: "clean-white",
    label: "Clean White",
    description: "White marker throughout, bold white hits.",
    body: { file: "PermanentMarker.ttf", family: "Permanent Marker", colour: "#FFFFFF" },
    hit: { file: "Anton.ttf", family: "Anton", colour: "#FFFFFF" },
    outline: "#000000",
    uppercase: true,
    fallbackPreset: "hero-bold",
  }),
});

/** Used for a phrase whose letters a look's fonts cannot draw (ẹ, ọ, ṣ …). */
export const FALLBACK_FONT = Object.freeze({ file: "DejaVuSans.ttf", family: "DejaVu Sans" });

export const ENERGIES = Object.freeze([
  { id: "calm", label: "Calm", description: "Words pop in and stack. Best for sermons and readings." },
  { id: "lively", label: "Lively", description: "Adds big brush slams on the lines that repeat." },
  { id: "wild", label: "Wild", description: "Slams everywhere. Made for songs." },
]);

export function isStudioLook(id) {
  return typeof id === "string" && id.startsWith(STUDIO_PREFIX) && Boolean(LOOKS[id.slice(STUDIO_PREFIX.length)]);
}

export function resolveLook(id) {
  const key = String(id || "").startsWith(STUDIO_PREFIX) ? String(id).slice(STUDIO_PREFIX.length) : String(id || "");
  return LOOKS[key] || LOOKS["clean-white"];
}

export function resolveEnergy(id, fallback = "lively") {
  return ENERGIES.some((e) => e.id === id) ? id : fallback;
}

export function listStudioLooks() {
  return Object.values(LOOKS).map((l) => ({ id: STUDIO_PREFIX + l.id, label: l.label, description: l.description }));
}
```

`server/src/lib/kinetic/text.js`:

```js
import path from "node:path";
import { loadFont, measureText } from "../fontMetrics.js";
import { FONT_DIR } from "../videoFilters.js";

export const fontPath = (file) => path.join(FONT_DIR, file);

/**
 * Pixel width of `text` drawn at ASS size `fs`. libass makes the font's
 * cell (win ascent + descent) `fs` pixels tall, so the em is smaller than fs.
 */
export function widthAt(file, text, fs) {
  const f = loadFont(fontPath(file));
  return measureText(fontPath(file), String(text), fs * (f.unitsPerEm / f.cellUnits));
}

/** The largest size up to `preferred` at which every line fits `maxWidth`, but never below `min`. */
export function fitSize(file, lines, preferred, maxWidth, min = 24) {
  let fs = Math.round(preferred);
  for (const line of lines) {
    const w = widthAt(file, line, fs);
    if (w > maxWidth) fs = Math.floor((fs * maxWidth) / w);
  }
  return Math.max(min, fs);
}

/** Whether the font has a glyph for every non-space character of `text`. */
export function covers(file, text) {
  const f = loadFont(fontPath(file));
  for (const ch of String(text)) {
    if (/\s/u.test(ch)) continue;
    if (f.glyphOf(ch.codePointAt(0)) === 0) return false;
  }
  return true;
}

/** Plain text safe inside an ASS Dialogue: no override blocks, no breaks. */
export function assEscape(text) {
  return String(text).replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\r?\n/g, " ");
}

export function assColour(hex) {
  const h = String(hex).replace("#", "").toUpperCase();
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}

export function assTime(sec) {
  const cs = Math.max(0, Math.round(Number(sec) * 100) || 0);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `cd server && node --test src/lib/kinetic/looks.test.js src/lib/kinetic/text.test.js`
Expected: PASS. If the `covers("PermanentMarker.ttf", "ẹ ọ ṣ")` assertion fails because the font does have those glyphs, swap in a character it lacks (check with `loadFont(...).glyphOf(cp)`) and note it in the report.

- [ ] **Step 6: Commit**

```bash
git add server/assets/fonts/Knewave-Regular.ttf server/assets/fonts/Knewave-LICENSE.txt server/src/lib/kinetic/looks.js server/src/lib/kinetic/looks.test.js server/src/lib/kinetic/text.js server/src/lib/kinetic/text.test.js
git commit -m "feat: studio caption looks, Knewave brush font and ASS text helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Layout and the director

**Files:**
- Create: `server/src/lib/kinetic/layout.js`, `server/src/lib/kinetic/director.js`
- Test: `server/src/lib/kinetic/layout.test.js`, `server/src/lib/kinetic/director.test.js`

**Interfaces:**
- Produces from `layout.js`:
  - `aspectOf(w, h)`, returning `"wide"` or `"tall"`.
  - `slotsFor(aspect)`, returning `Array<{ x: number, y: number, side: boolean }>` (fractions of the frame).
  - `maxWidthFor(slot, w, aspect)`, in px.
  - `clampBlockY(cy, blockHeight, h, aspect)`, the centre y in px kept inside the safe area.
  - `LOWER`, keyed by aspect, `{ x, y }` fractions for `pop`.
  - `CENTRE`, keyed by aspect, `{ x, y }` fractions for `slam`.
- Produces from `director.js`:
  - `EFFECT_IDS = ["pop", "stack", "slam"]`.
  - `mulberry32(seed): () => number`.
  - `normaliseLine(text): string`.
  - `findHooks(phrases): Set<number>`.
  - `planPhrases({ phrases, energy, seed, overrides, slotCount }): Array<{ index, phrase, effect, slot, hook, rot }>`.
    - `phrases` is `Array<{ text: string, start: number, end: number, words: Array<{text, start, end}> }>`, in seconds.
    - `rot` is an integer in −4…4.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/kinetic/layout.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aspectOf, slotsFor, maxWidthFor, clampBlockY } from "./layout.js";

test("aspect follows the frame", () => {
  assert.equal(aspectOf(1280, 720), "wide");
  assert.equal(aspectOf(720, 1280), "tall");
});

test("tall slots keep clear of the TikTok/Reels controls", () => {
  for (const s of slotsFor("tall")) {
    assert.ok(s.y <= 0.70, `slot y ${s.y}`);
    const half = maxWidthFor(s, 720, "tall") / 2;
    assert.ok(s.x * 720 + half <= 720 * 0.88 + 1, "clear of the right 12%");
    assert.ok(s.x * 720 - half >= 720 * 0.06 - 1, "inside the left margin");
  }
});

test("a block never runs into the bottom strip or off the top", () => {
  assert.ok(clampBlockY(1200, 300, 1280, "tall") + 150 <= 1280 * 0.82);
  assert.ok(clampBlockY(10, 300, 1280, "tall") - 150 >= 1280 * 0.06);
  assert.equal(clampBlockY(360, 100, 720, "wide"), 360);
});
```

`server/src/lib/kinetic/director.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, findHooks, planPhrases } from "./director.js";

const P = (text, start) => ({ text, start, end: start + 1.2, words: text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.2, end: start + i * 0.2 + 0.2 })) });
const song = [
  P("After the rain", 0), P("Five in the morning", 1.5), P("Who still dey", 7), P("I still dey", 8.4),
  P("By his grace", 9.8), P("I still dey!", 11.2), P("From Lagos traffic to the last train home", 13), P("I STILL DEY", 20),
];

test("the PRNG is deterministic per seed", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const xs = [a(), a(), a()];
  assert.deepEqual([b(), b(), b()], xs);
  assert.notDeepEqual([c(), c(), c()], xs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("a line sung two or more times is a hook, ignoring case and punctuation", () => {
  assert.deepEqual([...findHooks(song)].sort((a, b) => a - b), [3, 5, 7]);
});

test("same seed, same plan; another seed, another plan", () => {
  const a = planPhrases({ phrases: song, energy: "wild", seed: 7, slotCount: 5 });
  const b = planPhrases({ phrases: song, energy: "wild", seed: 7, slotCount: 5 });
  assert.deepEqual(a.map((p) => [p.effect, p.slot, p.rot]), b.map((p) => [p.effect, p.slot, p.rot]));
  const others = [1, 2, 3, 4, 5].map((s) => JSON.stringify(planPhrases({ phrases: song, energy: "wild", seed: s, slotCount: 5 }).map((p) => [p.effect, p.slot])));
  assert.ok(new Set(others).size > 1, "different seeds give different plans");
});

test("rules: no repeat except pop, slams spaced 4 s, long lines never slam, slots never repeat", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const plan = planPhrases({ phrases: song, energy: "wild", seed, slotCount: 5 });
    let lastSlamEnd = -Infinity;
    plan.forEach((p, i) => {
      if (i > 0 && p.effect !== "pop" && plan[i - 1].effect === p.effect) {
        assert.equal(p.effect, "stack", "only the stack fallback may repeat");
      }
      if (p.effect === "slam") {
        assert.ok(p.phrase.text.split(/\s+/).length <= 4);
        assert.ok(p.phrase.start - lastSlamEnd >= 4, `seed ${seed}: slams too close`);
        lastSlamEnd = p.phrase.end;
      }
      if (i > 0) assert.notEqual(p.slot, plan[i - 1].slot);
      assert.ok(Number.isInteger(p.rot) && Math.abs(p.rot) <= 4);
    });
  }
});

test("calm never slams; lively slams only hooks", () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    assert.ok(planPhrases({ phrases: song, energy: "calm", seed, slotCount: 5 }).every((p) => p.effect !== "slam"));
    planPhrases({ phrases: song, energy: "lively", seed, slotCount: 5 }).forEach((p) => {
      if (p.effect === "slam") assert.equal(p.hook, true);
    });
  }
});

test("an override wins over every rule; unknown overrides are ignored", () => {
  const plan = planPhrases({ phrases: song, energy: "calm", seed: 1, slotCount: 5, overrides: { 0: "slam", 1: "explode" } });
  assert.equal(plan[0].effect, "slam");
  assert.notEqual(plan[1].effect, "explode");
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `cd server && node --test src/lib/kinetic/layout.test.js src/lib/kinetic/director.test.js`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`server/src/lib/kinetic/layout.js`:

```js
/**
 * Where phrases sit. Positions are fractions of the frame. Wide video
 * scatters phrases round the subject; tall video stacks them in bands that
 * keep clear of the TikTok/Reels controls (bottom 18%, right 12%).
 */
const SIDE = 0.06;
const TALL_BOTTOM = 0.82;
const TALL_X = 0.47; // centre of the band left after the right-hand 12%

const SLOTS = Object.freeze({
  wide: [
    { x: 0.27, y: 0.30, side: true },
    { x: 0.73, y: 0.55, side: true },
    { x: 0.50, y: 0.78, side: false },
    { x: 0.73, y: 0.28, side: true },
    { x: 0.27, y: 0.60, side: true },
  ],
  tall: [
    { x: TALL_X, y: 0.20, side: false },
    { x: TALL_X, y: 0.40, side: false },
    { x: TALL_X, y: 0.62, side: false },
  ],
});

export const LOWER = Object.freeze({ wide: { x: 0.5, y: 0.80 }, tall: { x: TALL_X, y: 0.70 } });
export const CENTRE = Object.freeze({ wide: { x: 0.5, y: 0.45 }, tall: { x: TALL_X, y: 0.42 } });

export function aspectOf(w, h) {
  return Number(w) >= Number(h) ? "wide" : "tall";
}

export function slotsFor(aspect) {
  return SLOTS[aspect] || SLOTS.wide;
}

export function maxWidthFor(slot, w, aspect) {
  if (aspect === "tall") return w * (1 - SIDE - 0.12);
  return slot?.side ? w * 0.42 : w * (1 - 2 * SIDE);
}

export function clampBlockY(cy, blockHeight, h, aspect) {
  const top = h * SIDE + blockHeight / 2;
  const bottom = (aspect === "tall" ? h * TALL_BOTTOM : h * (1 - SIDE)) - blockHeight / 2;
  return Math.round(Math.min(Math.max(cy, top), Math.max(top, bottom)));
}
```

`server/src/lib/kinetic/director.js`:

```js
/**
 * Picks how each phrase is drawn. Deterministic: the same phrases, energy
 * and seed always give the same plan, so a re-render matches the approved
 * video and Shuffle (a new seed) gives a new one.
 */
export const EFFECT_IDS = Object.freeze(["pop", "stack", "slam"]);

const MIX = Object.freeze({
  calm: { normal: ["pop", "stack"], hook: ["stack", "pop"] },
  lively: { normal: ["stack", "pop", "stack"], hook: ["slam", "stack"] },
  wild: { normal: ["stack", "slam", "stack", "pop"], hook: ["slam"] },
});

const SLAM_GAP_SEC = 4;
const SLAM_MAX_WORDS = 4;
const LONG_PHRASE_WORDS = 5;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normaliseLine(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function findHooks(phrases) {
  const counts = new Map();
  phrases.forEach((p) => {
    const k = normaliseLine(p.text);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  });
  const hooks = new Set();
  phrases.forEach((p, i) => { if ((counts.get(normaliseLine(p.text)) || 0) >= 2) hooks.add(i); });
  return hooks;
}

function allowed(effect, { prev, words, start, lastSlamEnd }) {
  if (effect === prev && effect !== "pop") return false;
  if (words > LONG_PHRASE_WORDS && effect !== "pop" && effect !== "stack") return false;
  if (effect === "slam" && (words > SLAM_MAX_WORDS || start - lastSlamEnd < SLAM_GAP_SEC)) return false;
  return true;
}

export function planPhrases({ phrases, energy = "lively", seed = 1, overrides = {}, slotCount = 5 }) {
  const rnd = mulberry32(Number(seed) || 1);
  const mix = MIX[energy] || MIX.lively;
  const hooks = findHooks(phrases);
  const slots = Math.max(1, slotCount);
  let prev = null;
  let lastSlamEnd = -Infinity;
  let slot = -1;
  return phrases.map((phrase, index) => {
    const words = String(phrase.text).trim().split(/\s+/).filter(Boolean).length;
    const hook = hooks.has(index);
    let effect;
    if (EFFECT_IDS.includes(overrides[index])) {
      effect = overrides[index];
    } else {
      const pool = (hook ? mix.hook : mix.normal).filter((e) => allowed(e, { prev, words, start: phrase.start, lastSlamEnd }));
      effect = pool.length ? pool[Math.floor(rnd() * pool.length)] : (energy === "calm" ? "pop" : "stack");
    }
    if (effect === "slam") lastSlamEnd = phrase.end;
    slot = slots === 1 ? 0 : (slot + 1 + Math.floor(rnd() * (slots - 1))) % slots;
    const rot = (index % 2 === 0 ? -1 : 1) * (1 + Math.floor(rnd() * 4));
    prev = effect;
    return { index, phrase, effect, slot, hook, rot };
  });
}
```

Notes on the rotation and slot formulas:
- `rot` is never 0 because a slight tilt is the look; its magnitude is 1–4.
- The slot formula `(slot + 1 + k) % n`, with `k` in `0…n-2`, never returns the previous slot. The first phrase starts from −1, so it lands in `0…n-2`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd server && node --test src/lib/kinetic/layout.test.js src/lib/kinetic/director.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic/layout.js server/src/lib/kinetic/layout.test.js server/src/lib/kinetic/director.js server/src/lib/kinetic/director.test.js
git commit -m "feat: caption director picks a seeded effect and slot per phrase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The pop, stack and slam effects

**Files:**
- Create: `server/src/lib/kinetic/effects/common.js`, `pop.js`, `stack.js`, `slam.js`
- Test: `server/src/lib/kinetic/effects/effects.test.js`

**Interfaces:**
- Consumes:
  - `text.js` (`widthAt`, `fitSize`, `covers`, `assEscape`, `assColour`, `assTime`);
  - `looks.js` (`FALLBACK_FONT`);
  - `layout.js` (`slotsFor`, `maxWidthFor`, `clampBlockY`, `LOWER`, `CENTRE`).
- Produces:
  - Each effect module exports `render(ctx): string[]` (ASS `Dialogue:` lines). `ctx` is `{ planned, look, energy, w, h, aspect, nextStart }`:
    - `planned` is a `planPhrases` item;
    - `look` comes from `resolveLook`;
    - `nextStart` is the start (in seconds) of the next phrase, or `Infinity`.
  - `common.js` exports:
    - `holdEnd(phrase, nextStart)` and `caseText(look, s)`;
    - `fontsFor(look, text)`, returning `{ body: Face, hit: Face }`; both are `FALLBACK_FONT` with the look's colours if either look font misses a glyph;
    - `wrapWords(words, file, fs, maxWidth)`, returning `Array<Array<word>>`;
    - `lineEvent({ start, end, x, y, fs, family, rot, pop, bord, shad, outline, words })`, where `words` is `Array<{ text, t, colour }>`;
    - `sparksEvent({ x, y, at, r, colour })`.

- [ ] **Step 1: Write the failing test**

`server/src/lib/kinetic/effects/effects.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render as pop } from "./pop.js";
import { render as stack } from "./stack.js";
import { render as slam } from "./slam.js";
import { holdEnd, fontsFor, lineEvent } from "./common.js";
import { resolveLook } from "../looks.js";

const words = (text, start) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.25, end: start + i * 0.25 + 0.25 }));
const phrase = (text, start = 2) => ({ text, start, end: start + text.split(" ").length * 0.25, words: words(text, start) });
const planned = (text, effect, extra = {}) => ({ index: 0, phrase: phrase(text), effect, slot: 0, hook: false, rot: -2, ...extra });
const ctx = (p, over = {}) => ({ planned: p, look: resolveLook("studio-lagos-night"), energy: "lively", w: 1280, h: 720, aspect: "wide", nextStart: 10, ...over });
const posOf = (line) => line.match(/\\(?:move|pos)\((-?\d+),(-?\d+)/).slice(1).map(Number);

test("a phrase holds until just before the next one, at least 0.25 s past its last word", () => {
  assert.equal(holdEnd({ start: 1, end: 2 }, 2.1), 2.25);
  assert.equal(holdEnd({ start: 1, end: 2 }, 5), 4.95);
  assert.equal(holdEnd({ start: 1, end: 2 }, Infinity), 3.2);
});

test("letters the look's fonts lack switch the phrase to DejaVu", () => {
  const look = resolveLook("studio-lagos-night");
  assert.equal(fontsFor(look, "I STILL DEY").hit.family, "Knewave");
  const f = fontsFor(look, "Ọlọ́run ṣe é");
  assert.equal(f.body.family, "DejaVu Sans");
  assert.equal(f.hit.family, "DejaVu Sans");
  assert.equal(f.hit.colour, look.hit.colour);
});

test("lineEvent: first word shows at once, later words fade in on their beat", () => {
  const line = lineEvent({ start: 2, end: 4, x: 640, y: 360, fs: 80, family: "Knewave", rot: -2, pop: 135, bord: 5, shad: 3, outline: "#101010",
    words: [{ text: "I", t: 2, colour: "#F5D33A" }, { text: "STILL", t: 2.5, colour: "#F5D33A" }] });
  assert.match(line, /^Dialogue: 0,0:00:02\.00,0:00:04\.00,Kinetic,,0,0,0,,/);
  assert.match(line, /\\fnKnewave\\fs80/);
  assert.match(line, /\\fscx135\\fscy135\\t\(0,1[36]0,\\fscx100\\fscy100\)/);
  assert.match(line, /\{\\c&H003AD3F5&\}I \{\\c&H003AD3F5&\\alpha&HFF&\\t\(500,570,\\alpha&H00&\)\}STILL$/);
});

test("pop sits in the lower band and reveals every word", () => {
  const lines = pop(ctx(planned("When life feels dark and heavy", "pop")));
  assert.ok(lines.length >= 1 && lines.length <= 2);
  const text = lines.join(" ");
  for (const w of ["WHEN", "LIFE", "FEELS", "DARK", "AND", "HEAVY"]) assert.ok(text.includes(w), w);
  for (const l of lines) assert.ok(posOf(l)[1] > 720 * 0.6, "lower band");
});

test("stack breaks a phrase into short stacked lines at its slot, tilted", () => {
  const lines = stack(ctx(planned("Five in the morning NEPA", "stack")));
  assert.ok(lines.length >= 2);
  const ys = lines.map((l) => posOf(l)[1]);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, "top to bottom");
  for (const l of lines) assert.match(l, /\\frz-2/);
  assert.match(lines.at(-1), /&H003AD3F5&/, "last word in the hit colour when lively");
});

test("calm stack keeps every word in the body colour unless the line is a hook", () => {
  const calm = stack(ctx(planned("By his grace", "stack"), { energy: "calm" })).join(" ");
  assert.ok(!calm.includes("&H003AD3F5&"));
  const hook = stack(ctx(planned("I still dey", "stack", { hook: true }), { energy: "calm" })).join(" ");
  assert.ok(hook.includes("&H003AD3F5&"));
});

test("slam is huge, centred, in the hit font, and fires sparks on its last word", () => {
  const lines = slam(ctx(planned("I still dey", "slam", { hook: true })));
  const text = lines.filter((l) => !l.includes("\\p1"));
  const sparks = lines.filter((l) => l.includes("\\p1"));
  assert.ok(text.every((l) => l.includes("\\fnKnewave")));
  const fs = Number(text[0].match(/\\fs(\d+)/)[1]);
  assert.ok(fs >= 110, `slam size ${fs}`);
  assert.equal(sparks.length, 1);
  assert.match(sparks[0], /^Dialogue: 1,0:00:02\.50,/);
});

test("tall frames keep stacked text inside the safe band", () => {
  const lines = stack(ctx(planned("From Lagos traffic to the last train home", "stack", { slot: 2 }), { w: 720, h: 1280, aspect: "tall" }));
  for (const l of lines) assert.ok(posOf(l)[1] <= 1280 * 0.82, "above the bottom strip");
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `cd server && node --test src/lib/kinetic/effects/effects.test.js`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`server/src/lib/kinetic/effects/common.js`:

```js
import { widthAt, covers, assEscape, assColour, assTime } from "../text.js";
import { FALLBACK_FONT } from "../looks.js";

export const MIN_HOLD = 0.25;
const GAP = 0.05;
const TAIL = 1.2; // last phrase: hold this long after its last word

/** When a phrase leaves: just before the next one, never sooner than 0.25 s after it ends. */
export function holdEnd(phrase, nextStart) {
  const floor = phrase.end + MIN_HOLD;
  const ceiling = Number.isFinite(nextStart) ? nextStart - GAP : phrase.end + TAIL;
  return Number(Math.max(floor, ceiling).toFixed(2));
}

export function caseText(look, s) {
  return look.uppercase ? String(s).toLocaleUpperCase() : String(s);
}

export function fontsFor(look, text) {
  if (covers(look.body.file, text) && covers(look.hit.file, text)) return { body: look.body, hit: look.hit };
  return {
    body: { ...FALLBACK_FONT, colour: look.body.colour },
    hit: { ...FALLBACK_FONT, colour: look.hit.colour },
  };
}

/** Greedy wrap: words onto lines no wider than maxWidth. */
export function wrapWords(words, file, fs, maxWidth) {
  const lines = [];
  let current = [];
  for (const w of words) {
    const next = [...current, w];
    if (current.length && widthAt(file, next.map((x) => x.text).join(" "), fs) > maxWidth) {
      lines.push(current);
      current = [w];
    } else {
      current = next;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/**
 * One line of text as one event. The line pops when it appears, and each
 * later word fades in on its own beat. Words never scale on their own,
 * because that would reflow the line mid-phrase.
 */
export function lineEvent({ start, end, x, y, fs, family, rot = 0, pop = 135, bord = 5, shad = 3, outline = "#000000", words, layer = 0 }) {
  const settle = pop >= 150 ? 160 : 130;
  const head = `{\\an5\\move(${Math.round(x)},${Math.round(y + 8)},${Math.round(x)},${Math.round(y)},0,180)`
    + `\\fn${family}\\fs${Math.round(fs)}\\frz${rot}\\bord${bord}\\shad${shad}\\3c${assColour(outline)}\\fad(50,160)`
    + `\\fscx${pop}\\fscy${pop}\\t(0,${settle},\\fscx100\\fscy100)}`;
  const body = words.map((w, i) => {
    const dt = Math.max(0, Math.round((w.t - start) * 1000));
    const reveal = i === 0 ? "" : `\\alpha&HFF&\\t(${dt},${dt + 70},\\alpha&H00&)`;
    return `{\\c${assColour(w.colour)}${reveal}}${assEscape(w.text)}`;
  }).join(" ");
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},Kinetic,,0,0,0,,${head}${body}`;
}

/** A burst of short strokes fanning upwards from (x, y) as a word lands. */
export function sparksEvent({ x, y, at, r, colour }) {
  const strokes = [];
  for (let i = 0; i < 7; i += 1) {
    const a = ((-150 + i * 22) * Math.PI) / 180;
    const p = (d, side) => [Math.round(Math.cos(a) * d - Math.sin(a) * side), Math.round(Math.sin(a) * d + Math.cos(a) * side)];
    const pts = [p(r, -3), p(r, 3), p(r * 1.4, 2), p(r * 1.4, -2)];
    strokes.push(`m ${pts[0].join(" ")} l ${pts[1].join(" ")} ${pts[2].join(" ")} ${pts[3].join(" ")}`);
  }
  return `Dialogue: 1,${assTime(at)},${assTime(at + 0.45)},Kinetic,,0,0,0,,`
    + `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\bord0\\shad0\\1c${assColour(colour)}\\fscx60\\fscy60`
    + `\\t(0,160,\\fscx115\\fscy115)\\fad(0,220)\\p1}${strokes.join(" ")}{\\p0}`;
}
```

`server/src/lib/kinetic/effects/pop.js`:

```js
import { fitSize } from "../text.js";
import { LOWER, maxWidthFor } from "../layout.js";
import { caseText, fontsFor, holdEnd, lineEvent, wrapWords } from "./common.js";

/** Words pop in on one or two lines in the lower safe band. Calm and readable. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const fonts = fontsFor(look, phrase.text);
  const anchor = LOWER[aspect];
  const maxWidth = maxWidthFor({ side: false }, w, aspect);
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.body.colour }));
  let fs = aspect === "tall" ? Math.round(w * 0.085) : Math.round(h * 0.075);
  let lines = wrapWords(words, fonts.body.file, fs, maxWidth);
  if (lines.length > 2) {
    fs = fitSize(fonts.body.file, [words.map((x) => x.text).join(" ")], fs, maxWidth * 2);
    lines = wrapWords(words, fonts.body.file, fs, maxWidth).slice(0, 2);
  }
  const end = holdEnd(phrase, nextStart);
  const lineGap = fs * 1.05;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot: 0, pop: 120, bord: 4, shad: 2, outline: look.outline, words: ln,
  }));
}
```

`server/src/lib/kinetic/effects/stack.js`:

```js
import { fitSize } from "../text.js";
import { slotsFor, maxWidthFor, clampBlockY } from "../layout.js";
import { caseText, fontsFor, holdEnd, lineEvent } from "./common.js";

const MAX_WORDS_PER_LINE = 2;
const MAX_CHARS_PER_LINE = 12;

function chunk(words) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const text = [...cur, w].map((x) => x.text).join(" ");
    if (cur.length && (cur.length >= MAX_WORDS_PER_LINE || text.length > MAX_CHARS_PER_LINE)) {
      lines.push(cur);
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** The phrase as short stacked lines, tilted, at the planned slot. */
export function render({ planned, look, energy, w, h, aspect, nextStart }) {
  const { phrase, hook, rot } = planned;
  const fonts = fontsFor(look, phrase.text);
  const slots = slotsFor(aspect);
  const slot = slots[planned.slot % slots.length];
  const last = phrase.words.length - 1;
  const words = phrase.words.map((x, i) => ({
    text: caseText(look, x.text),
    t: x.start,
    colour: hook || (energy !== "calm" && i === last) ? fonts.hit.colour : fonts.body.colour,
  }));
  const lines = chunk(words);
  const maxWidth = maxWidthFor(slot, w, aspect);
  const preferred = aspect === "tall" ? Math.round(w * 0.11) : Math.round(h * 0.095);
  const fs = fitSize(fonts.body.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, maxWidth);
  const lineGap = fs * 1.05;
  const blockHeight = lines.length * lineGap;
  const cy = clampBlockY(slot.y * h, blockHeight, h, aspect);
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const end = holdEnd(phrase, nextStart);
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: slot.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot, pop: 135, bord: 5, shad: 3, outline: look.outline, words: ln,
  }));
}
```

`server/src/lib/kinetic/effects/slam.js`:

```js
import { fitSize, widthAt } from "../text.js";
import { CENTRE, maxWidthFor } from "../layout.js";
import { caseText, fontsFor, holdEnd, lineEvent, sparksEvent } from "./common.js";

/** A short phrase slammed huge in the hit font, with sparks on its last word. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase, rot } = planned;
  const fonts = fontsFor(look, phrase.text);
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.hit.colour }));
  const lines = words.length <= 2 ? [words] : [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))];
  const maxWidth = maxWidthFor({ side: false }, w, aspect) * 0.95;
  const preferred = aspect === "tall" ? Math.round(w * 0.2) : Math.round(h * 0.22);
  const fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, maxWidth, 48);
  const anchor = CENTRE[aspect];
  const lineGap = fs * 1.0;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  const end = holdEnd(phrase, nextStart);
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot: Math.sign(rot) * Math.min(2, Math.abs(rot)), pop: 150, bord: 6, shad: 4, outline: look.outline, words: ln,
  }));
  const lastLine = lines[lines.length - 1];
  const lastWidth = widthAt(fonts.hit.file, lastLine.map((x) => x.text).join(" "), fs);
  events.push(sparksEvent({
    x: anchor.x * w + lastWidth / 2 - w * 0.01,
    y: y0 + (lines.length - 1) * lineGap - fs * 0.55,
    at: lastLine[lastLine.length - 1].t,
    r: Math.round(Math.min(w, h) * 0.05),
    colour: fonts.hit.colour,
  }));
  return events;
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `cd server && node --test src/lib/kinetic/effects/effects.test.js`
Expected: PASS. If the `lineEvent` regex for the settle time is off (130 vs 160), keep the code and fix the test to the code's documented rule: settle is 160 ms for pops of 150 or more, otherwise 130 ms.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic/effects
git commit -m "feat: pop, stack and slam caption effects as ASS events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: buildAss, the filter, and real-ffmpeg checks

**Files:**
- Create: `server/src/lib/kinetic/ass.js`, `server/src/lib/kinetic/filter.js`
- Test: `server/src/lib/kinetic/ass.test.js`, `server/src/lib/kinetic/render.test.js` (real ffmpeg)

**Interfaces:**
- Consumes:
  - `splitPhrases(words, { maxWords, maxChars })` from `../captions.js`. Words are `{ text, start, end }` in seconds, and it returns `Array<{ text, start, end, words }>`.
  - `planPhrases` and the effect `render` functions.
  - `resolveLook` and `resolveEnergy`; `aspectOf` and `slotsFor`.
  - `escapeFontPath` and `FONT_DIR` from `../videoFilters.js`.
- Produces:
  - `buildAss({ words?, lines?, w, h, look, energy, seed, overrides }): string`.
    - `words` are `{text, start, end}` in seconds; `lines` are `{text, start, end}`.
    - It returns `""` when there is nothing to draw.
  - `phrasesFrom({ words, lines })`, which returns the phrases.
  - `studioCaptionFilter({ assPath, ...buildAssOpts }): { filter: string, sideFiles: Array<{ path: string, text: string }> }`. When there is nothing to draw, the filter is `""` and `sideFiles` is `[]`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/kinetic/ass.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, phrasesFrom } from "./ass.js";
import { studioCaptionFilter } from "./filter.js";

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
  for (const t of ["AFTER", "GRACE", "DEY"]) assert.ok(ass.includes(t), t);
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
  assert.match(out.filter, /^ass=filename=C\\:\/work\/job\/captions-x\.ass:fontsdir=/);
  assert.equal(out.sideFiles.length, 1);
  assert.equal(out.sideFiles[0].path, "C:\\work\\job\\captions-x.ass");
  assert.match(out.sideFiles[0].text, /^\[Script Info\]/);
});
```

`server/src/lib/kinetic/render.test.js` (real ffmpeg; skipped where libass is absent):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { hasLibass } from "./capability.js";
import { studioCaptionFilter } from "./filter.js";
import { widthAt } from "./text.js";
import { LOOKS, FALLBACK_FONT } from "./looks.js";

const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const skip = hasLibass() ? false : "ffmpeg here has no libass";

/** Render one frame at time t of a w×h black clip with the captions, as greyscale or rgb24 bytes. */
function frameAt({ assText, w, h, t, pix = "rgb24" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-"));
  const assPath = path.join(dir, "c.ass");
  // The filter string comes from production code (same escaping); the file
  // it reads holds this test's own document.
  const { filter } = studioCaptionFilter({ assPath, words: [{ text: "x", start: 0, end: 1 }], w, h });
  fs.writeFileSync(assPath, assText);
  const out = execFileSync(ff, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${w}x${h}:d=${t + 1}:r=25`,
    "-vf", filter, "-ss", String(t), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pix, "pipe:1"],
    { maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test("each look's fonts load by family name, not a system substitute", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-"));
  const faces = [...new Set(Object.values(LOOKS).flatMap((l) => [l.body, l.hit]).concat([FALLBACK_FONT]).map((f) => f.family))];
  const events = faces.map((fam, i) => `Dialogue: 0,0:00:00.00,0:00:01.00,Kinetic,,0,0,0,,{\\an5\\pos(640,${60 + i * 80})\\fn${fam}}TEST`).join("\n");
  const assPath = path.join(dir, "fonts.ass");
  fs.writeFileSync(assPath, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Kinetic,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`);
  const { filter } = studioCaptionFilter({ assPath, words: [{ text: "x", start: 0, end: 1 }], w: 1280, h: 720 });
  const r = spawnSync(ff, ["-hide_banner", "-v", "info", "-f", "lavfi", "-i", "color=black:s=1280x720:d=0.2", "-vf", filter, "-f", "null", "-"], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  for (const fam of faces) {
    const line = r.stderr.split("\n").find((l) => l.includes(`fontselect: (${fam},`));
    assert.ok(line, `no fontselect line for ${fam}`);
    const chosen = line.split("->")[1].trim().split(",")[0].toLowerCase().replace(/[^a-z]/g, "");
    assert.ok(chosen.startsWith(fam.toLowerCase().replace(/[^a-z]/g, "")), `${fam} resolved to ${chosen}`);
  }
});

test("drawn width matches the engine's measurement within 6%", { skip }, () => {
  for (const face of [LOOKS["lagos-night"].body, LOOKS["lagos-night"].hit, LOOKS["gospel-gold"].hit]) {
    const text = "MMMMMMMM";
    const assText = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Kinetic,${face.family},100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Kinetic,,0,0,0,,{\\an5\\pos(640,360)}${text}\n`;
    const buf = frameAt({ assText, w: 1280, h: 720, t: 0.5, pix: "gray" });
    let minX = 1280, maxX = -1;
    for (let y = 0; y < 720; y += 1) for (let x = 0; x < 1280; x += 1) {
      if (buf[y * 1280 + x] > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    const ink = maxX - minX + 1;
    const measured = widthAt(face.file, text, 100);
    assert.ok(Math.abs(ink - measured) / measured <= 0.06, `${face.family}: ink ${ink}px vs measured ${measured.toFixed(1)}px`);
  }
});

test("a slam paints the hit colour at the centre while it is up, and nothing before the first word", { skip }, () => {
  const words = [{ text: "I", start: 1.0, end: 1.2 }, { text: "still", start: 1.2, end: 1.5 }, { text: "dey", start: 1.5, end: 1.9 }];
  const out = studioCaptionFilter({ assPath: "unused", words, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 1, overrides: { 0: "slam" } });
  const assText = out.sideFiles[0].text;
  const yellow = (buf) => {
    let n = 0;
    for (let y = 200; y < 460; y += 2) for (let x = 200; x < 1080; x += 2) {
      const i = (y * 1280 + x) * 3;
      if (buf[i] > 200 && buf[i + 1] > 170 && buf[i + 2] < 120) n += 1;
    }
    return n;
  };
  assert.equal(yellow(frameAt({ assText, w: 1280, h: 720, t: 0.5 })), 0, "nothing before the first word");
  assert.ok(yellow(frameAt({ assText, w: 1280, h: 720, t: 1.8 })) > 500, "yellow slam on screen");
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `cd server && node --test src/lib/kinetic/ass.test.js src/lib/kinetic/render.test.js`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`server/src/lib/kinetic/ass.js`:

```js
import { splitPhrases } from "../captions.js";
import { planPhrases } from "./director.js";
import { resolveLook, resolveEnergy } from "./looks.js";
import { aspectOf, slotsFor } from "./layout.js";
import { render as pop } from "./effects/pop.js";
import { render as stack } from "./effects/stack.js";
import { render as slam } from "./effects/slam.js";

const EFFECTS = { pop, stack, slam };

/** Phrases from timed words, or from timed lines with their words spread evenly. */
export function phrasesFrom({ words, lines }) {
  const timed = (Array.isArray(words) ? words : [])
    .filter((w) => w && String(w.text || "").trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
  if (timed.length) {
    return splitPhrases(timed, { maxWords: 5, maxChars: 28 }).map((p) => ({ text: p.text, start: p.start, end: p.end, words: p.words }));
  }
  return (Array.isArray(lines) ? lines : [])
    .filter((l) => l && String(l.text || "").trim() && Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start)
    .map((l) => {
      const parts = String(l.text).trim().split(/\s+/);
      const step = (l.end - l.start) / parts.length;
      return {
        text: String(l.text).trim(), start: l.start, end: l.end,
        words: parts.map((t, i) => ({ text: t, start: Number((l.start + i * step).toFixed(3)), end: Number((l.start + (i + 1) * step).toFixed(3)) })),
      };
    });
}

function header(w, h) {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Kinetic,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,0,0,0,0,100,100,1,0,1,4,3,5,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

/**
 * The whole caption track as an ASS document: phrases, then a plan, then
 * events. Returns "" when there is nothing to draw.
 */
export function buildAss({ words, lines, w, h, look, energy, seed = 1, overrides = {} }) {
  const phrases = phrasesFrom({ words, lines });
  if (!phrases.length) return "";
  const aspect = aspectOf(w, h);
  const theLook = resolveLook(look);
  const theEnergy = resolveEnergy(energy);
  const plan = planPhrases({ phrases, energy: theEnergy, seed, overrides, slotCount: slotsFor(aspect).length });
  const events = plan.flatMap((planned, i) => EFFECTS[planned.effect]({
    planned, look: theLook, energy: theEnergy, w, h, aspect,
    nextStart: i + 1 < plan.length ? plan[i + 1].phrase.start : Infinity,
  }));
  return `${header(w, h)}\n${events.join("\n")}\n`;
}
```

`server/src/lib/kinetic/filter.js`:

```js
import { escapeFontPath, FONT_DIR } from "../videoFilters.js";
import { buildAss } from "./ass.js";

/**
 * The ffmpeg filter for Studio captions, plus the .ass file it reads. Pure:
 * the caller writes `sideFiles` before starting ffmpeg, which keeps the arg
 * builders testable.
 */
export function studioCaptionFilter({ assPath, ...opts }) {
  const text = buildAss(opts);
  if (!text) return { filter: "", sideFiles: [] };
  return {
    filter: `ass=filename=${escapeFontPath(assPath)}:fontsdir=${escapeFontPath(FONT_DIR)}`,
    sideFiles: [{ path: assPath, text }],
  };
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd server && node --test src/lib/kinetic/ass.test.js src/lib/kinetic/render.test.js`
Expected:
- `ass.test.js`: PASS.
- `render.test.js`: PASS on this machine (ffmpeg 8 with libass).
- **If the 6% width check fails:** print the ink and measured widths for each face. Do not loosen the tolerance. Report DONE_WITH_CONCERNS with the numbers, because the `cellUnits` sizing rule would then be wrong.
- **If the fontselect check fails for Playfair:** the family name in the file may differ. Read the name the log reports and set `LOOKS["gospel-gold"].body.family` to it.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic/ass.js server/src/lib/kinetic/filter.js server/src/lib/kinetic/ass.test.js server/src/lib/kinetic/render.test.js
git commit -m "feat: build Studio caption tracks as ASS and the ffmpeg ass filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Story render, project settings and the catalogue endpoint

**Files:**
- Modify:
  - `server/src/lib/story/storyRender.js` (`buildStoryFfmpegArgs` around 212-310, `runStoryRender` around 383-400)
  - `server/src/lib/story/projectStore.js` (`normaliseCaptionSettings` 47-67, `createProject` ~91)
  - `server/src/routes/story.js` (the `_renderFn({...})` call, ~944-951)
  - `server/src/routes/tts.js` (`/animations`, ~547)
- Test:
  - `server/src/lib/story/storyRender.test.js` (append)
  - `server/src/lib/story/projectStore.test.js` (append, or create if absent)
  - `server/src/routes/tts.animations.test.js` (create)

**Interfaces:**
- Consumes:
  - `isStudioLook` and `resolveLook` from `../kinetic/looks.js`;
  - `studioCaptionFilter` from `../kinetic/filter.js`;
  - `hasLibass` from `../kinetic/capability.js`.
- Produces:
  - `buildStoryFfmpegArgs(...)` also takes `captionEnergy` and `captionSeed`, and now returns `{ args, totalDurationSec, sideFiles }`, where `sideFiles` is `Array<{path, text}>` and may be empty.
  - `runStoryRender` takes and forwards `captionEnergy` and `captionSeed`.
  - Projects carry `captionEnergy?: "calm" | "lively" | "wild"` and `captionSeed?: integer`; `createProject` always sets `captionSeed`.
  - `GET /api/tts/animations` returns `{ ok, animations, motions, studioLooks, energies, libass }`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/story/storyRender.test.js` (it already imports `buildStoryFfmpegArgs`, `fs`, `os` and `path`):

```js
import { _setLibassForTest } from "../kinetic/capability.js";

describe("Studio caption looks", () => {
  const img = path.join(os.tmpdir(), `studio-img-${process.pid}.png`);
  const aud = path.join(os.tmpdir(), `studio-aud-${process.pid}.mp3`);
  fs.writeFileSync(img, "x");
  fs.writeFileSync(aud, "x");
  const base = {
    scenes: [{ id: "s1", imagePath: img, startMs: 0, endMs: 4000 }],
    words: [{ text: "I", startMs: 500, endMs: 700 }, { text: "still", startMs: 700, endMs: 1000 }, { text: "dey", startMs: 1000, endMs: 1400 }],
    audioPath: aud, width: 1280, height: 720, outPath: path.join(os.tmpdir(), "studio-out.mp4"),
    audioDurationSec: 4, captions: "kinetic",
  };
  const graph = (args) => args[args.indexOf("-filter_complex") + 1];

  test("a studio look draws with the ass filter and hands back the .ass to write", () => {
    _setLibassForTest(true);
    const built = buildStoryFfmpegArgs({ ...base, captionPreset: "studio-lagos-night", captionEnergy: "wild", captionSeed: 5 });
    assert.match(graph(built.args), /\[vcat\]ass=filename=.*captions-studio-out\.ass:fontsdir=.*\[vout\]/);
    assert.equal(built.sideFiles.length, 1);
    assert.match(built.sideFiles[0].text, /DEY/);
    assert.ok(!graph(built.args).includes("drawtext"));
    _setLibassForTest(undefined);
  });

  test("without libass the look renders as its drawtext fallback", () => {
    _setLibassForTest(false);
    const built = buildStoryFfmpegArgs({ ...base, captionPreset: "studio-lagos-night" });
    assert.ok(graph(built.args).includes("drawtext"));
    assert.ok(!graph(built.args).includes("ass=filename"));
    assert.deepEqual(built.sideFiles, []);
    _setLibassForTest(undefined);
  });

  test("ordinary presets are untouched and write no side files", () => {
    _setLibassForTest(true);
    const before = buildStoryFfmpegArgs({ ...base, captionPreset: "marker" });
    assert.deepEqual(before.sideFiles, []);
    assert.ok(graph(before.args).includes("drawtext"));
    _setLibassForTest(undefined);
  });
});
```

Append to `server/src/lib/story/projectStore.test.js` (create it with these imports if missing):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normaliseCaptionSettings, createProject } from "./projectStore.js";

test("caption energy and seed are validated and merged", () => {
  assert.equal(normaliseCaptionSettings({ captionEnergy: "wild" }).captionEnergy, "wild");
  assert.equal(normaliseCaptionSettings({ captionEnergy: "loud" }).captionEnergy, undefined);
  assert.equal(normaliseCaptionSettings({}, { captionEnergy: "calm" }).captionEnergy, "calm");
  assert.equal(normaliseCaptionSettings({ captionSeed: 12345 }).captionSeed, 12345);
  assert.equal(normaliseCaptionSettings({ captionSeed: -1 }).captionSeed, undefined);
  assert.equal(normaliseCaptionSettings({ captionSeed: 1.5 }).captionSeed, undefined);
  assert.equal(normaliseCaptionSettings({ captionSeed: "7" }).captionSeed, 7);
});

test("a new project gets its own caption seed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-"));
  const a = createProject(dir, { title: "A" });
  const b = createProject(dir, { title: "B" });
  assert.ok(Number.isInteger(a.captionSeed) && a.captionSeed >= 0);
  assert.notEqual(a.captionSeed, b.captionSeed);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Create `server/src/routes/tts.animations.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import router from "./tts.js";

function call(pathName) {
  const layer = router.stack.find((l) => l.route?.path === pathName && l.route.methods.get);
  return new Promise((resolve) => {
    const res = { json: (body) => resolve(body), status() { return res; } };
    layer.route.stack[0].handle({ query: {}, body: {} }, res, () => resolve(null));
  });
}

test("the caption catalogue lists studio looks, energies and whether libass is here", async () => {
  const body = await call("/animations");
  assert.equal(body.ok, true);
  assert.deepEqual(body.studioLooks.map((l) => l.id), ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"]);
  assert.deepEqual(body.energies.map((e) => e.id), ["calm", "lively", "wild"]);
  assert.equal(typeof body.libass, "boolean");
  assert.ok(Array.isArray(body.animations) && Array.isArray(body.motions));
});
```

If `tts.js` has no default export of its router, read its last lines and import the router the same way `server/index.js` mounts it.

- [ ] **Step 2: Run them and check they fail**

Run: `cd server && node --test src/lib/story/storyRender.test.js src/lib/story/projectStore.test.js src/routes/tts.animations.test.js`
Expected: FAIL. There is no `sideFiles`, the energy and seed are not normalised, and there is no `studioLooks`.

- [ ] **Step 3: Implement**

`server/src/lib/story/storyRender.js`:

1. Add the imports:

```js
import { isStudioLook, resolveLook } from "../kinetic/looks.js";
import { studioCaptionFilter } from "../kinetic/filter.js";
import { hasLibass } from "../kinetic/capability.js";
```

2. Add `captionEnergy, captionSeed,` to the `buildStoryFfmpegArgs` parameter list, next to `captionHighlight`.
3. Replace the block from `const drawtext = captions === "none" ? "" : buildStoryCaptions({` through its closing `});` with:

```js
  // Studio looks draw with libass from an .ass file written beside the
  // render. Where this ffmpeg has no libass they degrade to the look's
  // drawtext preset, so a render never fails over captions.
  const sideFiles = [];
  const studio = captions !== "none" && isStudioLook(captionPreset);
  let drawtext = "";
  if (studio && hasLibass()) {
    const assPath = path.join(path.dirname(outPath), `captions-${path.basename(outPath, ".mp4")}.ass`);
    const built = studioCaptionFilter({
      assPath, words: drawWords, w: width, h: height,
      look: captionPreset, energy: captionEnergy || "lively", seed: captionSeed ?? 1,
    });
    drawtext = built.filter;
    sideFiles.push(...built.sideFiles);
  } else if (captions !== "none") {
    drawtext = buildStoryCaptions({
      words: drawWords,
      w: width,
      h: height,
      durationSec: totalDurationSec,
      captions,
      captionPreset: studio ? resolveLook(captionPreset).fallbackPreset : captionPreset,
      captionMotion,
      captionLayout,
      captionDepth,
      captionStagger,
      captionHighlight,
      kineticMaxWords,
    });
  }
```

4. Find `buildStoryFfmpegArgs`'s `return` statement (it returns `args` and `totalDurationSec`) and add `sideFiles` to the returned object. If `path` is not yet imported in this file, add `import path from "path";`. It is used by `toFilterScriptArgs`, so it most likely is.
5. In `runStoryRender`:
   - Add `captionEnergy, captionSeed` to the destructured parameters and pass them to `buildStoryFfmpegArgs`.
   - Then, inside the `try` that calls `toFilterScriptArgs`, before it, write the side files. If writing fails, rebuild with the fallback preset:

```js
      try {
        for (const f of built.sideFiles || []) fs.writeFileSync(f.path, f.text, "utf8");
      } catch (err) {
        console.warn(`[CAPTIONS] studio fallback: ${err?.message || err}`);
        built = buildStoryFfmpegArgs({
          scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height,
          outPath, audioDurationSec, captions,
          captionPreset: resolveLook(captionPreset).fallbackPreset,
          captionMotion, captionLayout, captionDepth, captionStagger, captionHighlight, logo,
        });
      }
```

   `built` is declared with `let` already. Confirm that, and change it to `let` if it isn't. Then run `grep -rn "buildStoryFfmpegArgs\|runStoryRender" server/src --include=*.js`; any other caller that destructures the result keeps working, because only a property was added.

`server/src/lib/story/projectStore.js`, in `normaliseCaptionSettings`'s returned object, after `captionHighlight`:

```js
    captionEnergy: pick("captionEnergy", ["calm", "lively", "wild"]),
    captionSeed: (() => {
      const raw = input.captionSeed === undefined ? current.captionSeed : input.captionSeed;
      const n = Number(raw);
      return raw !== null && raw !== undefined && Number.isInteger(n) && n >= 0 && n <= 2147483647 ? n : undefined;
    })(),
```

In `createProject`, replace the line `...normaliseCaptionSettings(captionOpts),` with:

```js
    ...normaliseCaptionSettings(captionOpts),
    // Each story gets its own caption choreography; Shuffle replaces it.
    captionSeed: normaliseCaptionSettings(captionOpts).captionSeed ?? Math.floor(Math.random() * 2147483647),
```

`server/src/routes/story.js`, in the `_renderFn({ ... })` call after `captionHighlight: project.captionHighlight,`:

```js
      captionEnergy: project.captionEnergy,
      captionSeed: project.captionSeed,
```

`server/src/routes/tts.js`:

- Add the imports:

```js
import { listStudioLooks, ENERGIES } from "../lib/kinetic/looks.js";
import { hasLibass } from "../lib/kinetic/capability.js";
```

- Change the `/animations` handler body to:

```js
  res.json({
    ok: true,
    animations: listKineticAnimations(),
    motions: listCaptionMotions(),
    // Studio looks (libass) are a separate list: each picker shows them once
    // its renderer can draw them, instead of silently getting a fallback.
    studioLooks: listStudioLooks(),
    energies: ENERGIES,
    libass: hasLibass(),
  });
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd server && node --test src/lib/story/storyRender.test.js src/lib/story/projectStore.test.js src/routes/tts.animations.test.js`
Expected: PASS, including every pre-existing test in those files.

Then run: `cd server && npm test`
Expected: the whole suite passes. Record the count.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story/storyRender.js server/src/lib/story/storyRender.test.js server/src/lib/story/projectStore.js server/src/lib/story/projectStore.test.js server/src/routes/story.js server/src/routes/tts.js server/src/routes/tts.animations.test.js
git commit -m "feat: Story renders Studio caption looks with libass, falling back to drawtext

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Story caption panel — Studio effects, Energy, Shuffle

**Files:**
- Modify: `client/src/lib/storyTypes.ts` (`StoryCaptionSettings`, ~line 70-82)
- Modify: `client/src/components/story/StoryCaptionsPanel.tsx`
- Test: `client/src/components/story/__tests__/StoryCaptionsPanel.test.tsx` (append; read its existing mock of `api.get` first and reuse it)

**Interfaces:**
- Consumes: `GET /api/tts/animations` returning `{ studioLooks: {id,label,description}[], energies: {id,label,description}[], libass: boolean }`.
- Produces: patches `{ captionPreset: 'studio-…' }`, `{ captionEnergy }` and `{ captionSeed: number }` through the existing `onChange`.

- [ ] **Step 1: Write the failing tests**

Read `client/src/components/story/__tests__/StoryCaptionsPanel.test.tsx` and copy how it mocks `api.get` for `/api/tts/animations`. Add a catalogue fixture with the Studio fields and these tests (use the file's existing render helper and mock style):

```tsx
const studioCatalogue = {
  ok: true,
  animations: [{ id: 'karaoke-pop', label: 'Karaoke pop', renderable: true }],
  motions: [{ id: 'words', label: 'Per word' }, { id: 'lines', label: 'Per line' }],
  studioLooks: [{ id: 'studio-lagos-night', label: 'Lagos Night', description: 'Yellow brush hits' }],
  energies: [{ id: 'calm', label: 'Calm' }, { id: 'lively', label: 'Lively' }, { id: 'wild', label: 'Wild' }],
  libass: true,
};

it('lists Studio effects looks in the animation picker', async () => {
  mockCatalogue(studioCatalogue); // the file's existing helper, or vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: studioCatalogue })
  render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'cinematic-default' }} onChange={vi.fn()} />);
  expect(await screen.findByRole('option', { name: 'Lagos Night' })).toBeInTheDocument();
});

it('a Studio look swaps motion/layout/depth for Energy and Shuffle', async () => {
  mockCatalogue(studioCatalogue);
  const onChange = vi.fn();
  render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'studio-lagos-night', captionSeed: 3 }} onChange={onChange} />);
  const energy = await screen.findByRole('combobox', { name: 'Energy' });
  expect(screen.queryByRole('combobox', { name: 'Caption motion' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Text layout' })).not.toBeInTheDocument();
  expect(energy).toHaveValue('lively');
  await userEvent.selectOptions(energy, 'wild');
  expect(onChange).toHaveBeenCalledWith({ captionEnergy: 'wild' });
  await userEvent.click(screen.getByRole('button', { name: /shuffle/i }));
  const seed = onChange.mock.calls.at(-1)[0].captionSeed;
  expect(Number.isInteger(seed)).toBe(true);
  expect(seed).not.toBe(3);
});

it('Studio looks are unavailable when the server has no libass', async () => {
  mockCatalogue({ ...studioCatalogue, libass: false });
  render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'cinematic-default' }} onChange={vi.fn()} />);
  const opt = await screen.findByRole('option', { name: /Lagos Night/ });
  expect(opt).toBeDisabled();
  expect(opt.textContent).toMatch(/unavailable/i);
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `cd client && npx vitest run src/components/story/__tests__/StoryCaptionsPanel.test.tsx`
Expected: the 3 new tests FAIL, and the existing tests still pass.

- [ ] **Step 3: Implement**

`client/src/lib/storyTypes.ts`, inside `StoryCaptionSettings` after `captionHighlight?: boolean;`:

```ts
  /** Studio looks only: how wild the effect mix is. */
  captionEnergy?: 'calm' | 'lively' | 'wild';
  /** Studio looks only: which choreography; Shuffle sets a new one. */
  captionSeed?: number;
```

In `StoryCaptionsPanel.tsx`:

1. Next to the other interfaces:
   `interface StudioOption { id: string; label: string; description?: string }`
2. State and fetch: add these states:
   - `const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);`
   - `const [energies, setEnergies] = useState<StudioOption[]>([]);`
   - `const [libass, setLibass] = useState(true);`

   Widen the `api.get` generic with `studioLooks?: StudioOption[]; energies?: StudioOption[]; libass?: boolean`, and after `setMotions(...)` add:

```tsx
      setStudioLooks(res.data?.studioLooks ?? []);
      setEnergies(res.data?.energies ?? []);
      setLibass(res.data?.libass !== false);
```

3. After `effectiveMotion`, add:

```tsx
  // Studio looks choreograph themselves (libass): the drawtext timing,
  // layout and depth controls don't apply, so they give way to Energy and
  // Shuffle.
  const studio = (value.captionPreset || '').startsWith('studio-');
  const shuffle = () => {
    let next = Math.floor(Math.random() * 2147483647);
    if (next === value.captionSeed) next = (next + 1) % 2147483647;
    onChange({ captionSeed: next });
  };
```

4. Wrap the existing **Caption motion** `Field` block's condition: change `{motions.length > 0 && (` to `{!studio && motions.length > 0 && (`.
5. In the **Caption animation** `Select`, insert this as the FIRST child, before the animations optgroup:

```tsx
              {studioLooks.length > 0 && (
                <optgroup label="Studio effects">
                  {studioLooks.map((l) => (
                    <option key={l.id} value={l.id} disabled={!libass}>
                      {l.label}{libass ? '' : ' (unavailable on this server)'}
                    </option>
                  ))}
                </optgroup>
              )}
```

6. Directly after the **Caption animation** `Field`, add:

```tsx
          {studio && (
            <Field
              label="Energy"
              tooltip="How wild the effects get. Calm pops and stacks words; Lively adds big brush slams on lines that repeat; Wild slams everywhere, made for songs."
            >
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Energy"
                  value={value.captionEnergy || 'lively'}
                  disabled={busy}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionEnergy: e.target.value as StoryCaptionSettings['captionEnergy'] })}
                >
                  {energies.map((en) => (
                    <option key={en.id} value={en.id}>{en.label}</option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={shuffle}
                  disabled={busy}
                  className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-content-secondary hover:text-bf-cream disabled:opacity-50"
                  title="Re-roll which effect each line gets"
                >
                  Shuffle effects
                </button>
              </div>
            </Field>
          )}
```

7. Change the **Text layout** `Field`'s render to `{!studio && ( <Field label="Text layout" …>…</Field> )}`, and the depth checkbox's condition from `effectiveMotion === 'words' && (` to `!studio && effectiveMotion === 'words' && (`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd client && npx vitest run src/components/story/__tests__/StoryCaptionsPanel.test.tsx`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/storyTypes.ts client/src/components/story/StoryCaptionsPanel.tsx client/src/components/story/__tests__/StoryCaptionsPanel.test.tsx
git commit -m "feat: Story caption panel offers Studio effects with Energy and Shuffle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end check, full suites, bundle

**Files:**
- Modify: `server/public/**` (rebuilt bundle, committed by convention)

- [ ] **Step 1: Run the full suites and the production build**

```bash
cd /c/Users/segun/source/repos/bf-kinetic/server && npm test 2>&1 | tail -5
cd ../client && npx vitest run 2>&1 | grep -E "Test Files|Tests "
npm run build 2>&1 | tail -3
```

Expected: 0 server failures, 0 client failures, and the build ends with `✓ built in`.

- [ ] **Step 2: Render a real Story with each aspect (controller does this, not a subagent)**

Use the scratchpad copy of local data (`DATA_DIR` set to the scratchpad `devdata`) and the "Hold My Hand" project, or any project with done images. Through the API:
1. PATCH `/api/story/:id/captions` with `{ captionPreset: "studio-lagos-night", captionEnergy: "wild" }`.
2. POST `/api/story/:id/render`, and wait for done.
3. Extract a contact sheet:
   `ffmpeg -i out.mp4 -vf fps=2,scale=320:-1,tile=6x4 -frames:v 1 sheet.jpg`
4. Look at it, and check for:
   - stacked tilted lines and slams with sparks;
   - nothing off-screen;
   - no text in the TikTok strip for portrait.

Repeat for a landscape project.

- [ ] **Step 3: Commit the bundle**

```bash
cd /c/Users/segun/source/repos/bf-kinetic && git add -A server/public && git commit -m "chore: rebuild client bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand back to the operator for go-ahead to push and PR (Refs #41)**

Do NOT push. Report the contact sheets, the test counts, and that prod must show `capabilities.libass: true` on `/api/health` after deploy, which is the spec's first prod check.
