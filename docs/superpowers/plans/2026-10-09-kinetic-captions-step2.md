# Kinetic Captions Step 2: quote, curve, frame, title, previews

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Studio effects catalogue and ship it in Story video:
- four new effects, `quote`, `curve`, `frame` and `title`;
- an opt-in title card;
- Gospel Gold that reads as large as the other looks;
- a 6-second sample clip for each look, played in the Story caption picker.

**Architecture:**
- Each effect is a pure module in `server/src/lib/kinetic/effects/` that turns one planned phrase into ASS `Dialogue` lines, like the existing `pop`, `stack` and `slam`.
- The director learns the new effects, adds their mixes and their rationing rules (frame hooks only, at most one frame every 30 s and one curve every 20 s), and makes a wild video open on a title.
- `buildAss` gains a `title` option.
- Story stores a `captionTitle` and passes it to the render.
- A dev-only script renders the sample clips into `client/public/studio-looks/`.

**Tech Stack:**
- Node 22/24 ESM, `node:test`;
- libass via ffmpeg's `ass` filter (prod ffmpeg 5.1.9, dev 8.x);
- React + TS, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-kinetic-caption-engine-design.md`. This plan covers build-order step 2 plus the Gospel Gold size fix found in step 1's end-to-end check.

## Global Constraints

- **ffmpeg filter.** Prod runs ffmpeg 5.1.9. The `ass` filter is used only with its `filename` and `fontsdir` options, and filter graphs go through `-filter_complex_script`.
- **Effects are pure.** An effect never touches the filesystem. It returns `Dialogue:` lines, and every piece of user text in them passes through `assEscape`.
- **Tall safe area.** On 9:16, the bottom 18% and the right 12% stay clear for the TikTok/Reels controls, with 6% side margins. Shrinking never drops a word.
- **Director determinism.** The director draws exactly 3 PRNG values per phrase (effect, slot, rotation), so an override never reshuffles its neighbours. The same seed always gives the same plan.
- **Director rules:**
  - no effect twice in a row, except `pop`;
  - a phrase over 5 words is only `pop` or `stack`;
  - `slam` needs ≤ 4 words and a 4 s gap since the last slam ended;
  - `frame` is wild-only, hooks only, at most once every 30 s;
  - `curve` at most once every 20 s;
  - calm never slams, and lively slams only hooks;
  - an override wins over every rule.
- **Invalid input never throws.** Unknown looks, energies and overrides fall back silently.
- **How to run tests.** From `server/`: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`. A bare directory argument fails on Node 24. Client: `npx vitest run src/components/story` from `client/`.
- **Writing files.** Write code with the Write and Edit tools, never shell heredocs, because ASS uses backslashes. The Edit tool may turn `“`-style escapes into literal characters. Literal curly quotes or bullets in source are fine; literal control characters are NOT. After an edit, check with `grep -nP '[\x00-\x08\x0b\x0c\x0e-\x1f]' <file>` that there are none.
- **Commits.** Every commit message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `git add` and `git commit` as separate commands. Never use `--no-verify`, and never push.
- **No side effects.** Do not start the server or pm2, and do not dispatch subagents.

---

## File map

| File | Change |
|---|---|
| `server/src/lib/kinetic/looks.js` | Gospel Gold body gets `scale: 1.3, bold: true, italic: true` |
| `server/src/lib/kinetic/effects/common.js` | `bodyScale(font)`; `lineEvent` accepts `bold` and `italic` |
| `server/src/lib/kinetic/effects/pop.js`, `stack.js` | size × `bodyScale`, pass bold/italic; `stack.js` exports `chunk` |
| `server/src/lib/kinetic/layout.js` | `ARC` (where curved text sits) |
| `server/src/lib/kinetic/effects/testkit.js` | shared test helpers for the new effect test files (not a test file itself) |
| `server/src/lib/kinetic/effects/quote.js` + `quote.test.js` | new |
| `server/src/lib/kinetic/effects/curve.js` + `curve.test.js` | new |
| `server/src/lib/kinetic/effects/frame.js` + `frame.test.js` | new |
| `server/src/lib/kinetic/effects/title.js` + `title.test.js` | new |
| `server/src/lib/kinetic/director.js` + test | new ids, mixes and rules; `titleFirst` |
| `server/src/lib/kinetic/ass.js` + test, `render.test.js` | wire effects, `title` option, real-libass smoke test |
| `server/src/lib/story/projectStore.js`, `storyRender.js`, `routes/story.js` + tests | `captionTitle` |
| `client/src/lib/storyTypes.ts`, `client/src/components/story/StoryCaptionsPanel.tsx` + test | Title intro field, preview clip |
| `server/scripts/make-studio-previews.mjs` | new, dev-only generator |
| `client/public/studio-looks/*.mp4` | generated sample clips (committed) |

---

### Task 1: Gospel Gold reads as large as the other looks

Playfair is mixed case and its x-height is 0.365 of its cell, against Permanent Marker's cap height of 0.519. At the same `\fs`, Gospel Gold's lowercase therefore looks about 40% smaller than Lagos Night's capitals. The repo's `PlayfairDisplay-BoldItalic.ttf` is really the upright Regular variable font, so libass is asked to synthesise bold and italic (`\b1\i1`).

**Files:**
- Modify: `server/src/lib/kinetic/looks.js` (gospel-gold body)
- Modify: `server/src/lib/kinetic/effects/common.js` (`bodyScale`, `lineEvent`)
- Modify: `server/src/lib/kinetic/effects/pop.js`, `server/src/lib/kinetic/effects/stack.js`
- Test: `server/src/lib/kinetic/looks.test.js`, `server/src/lib/kinetic/effects/effects.test.js`

**Interfaces:**
- Produces: `bodyScale(font) -> number`, which is `font.scale` when it is a positive finite number, otherwise 1.
- Produces: `lineEvent({ ..., bold = false, italic = false })`, which emits `\b1` / `\i1` right after `\fs<n>` when they are set.
- Produces: `stack.js` exports `chunk(words) -> words[][]` (it is already defined there; add `export`).

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/kinetic/looks.test.js` (it already imports `LOOKS`; check the import line and add it if missing):

```js
test("Gospel Gold's body is scaled up and synthesised bold italic", () => {
  const body = LOOKS["gospel-gold"].body;
  assert.equal(body.scale, 1.3);
  assert.equal(body.bold, true);
  assert.equal(body.italic, true);
  assert.equal(LOOKS["lagos-night"].body.scale, undefined);
});
```

Append to `server/src/lib/kinetic/effects/effects.test.js`:

```js
test("Gospel Gold's body is set larger and in bold italic so it reads like the marker looks", () => {
  const fsOf = (lines) => Number(lines[0].match(/\\fs(\d+)/)[1]);
  const tall = { w: 720, h: 1280, aspect: "tall" };
  const lagos = stack(ctx(planned("Fear thou", "stack"), tall));
  const gold = stack(ctx(planned("Fear thou", "stack"), { ...tall, look: resolveLook("studio-gospel-gold") }));
  assert.ok(fsOf(gold) >= Math.round(fsOf(lagos) * 1.25), `gold ${fsOf(gold)} vs lagos ${fsOf(lagos)}`);
  assert.match(gold[0], /\\fs\d+\\b1\\i1\\frz/);
  assert.doesNotMatch(lagos[0], /\\b1|\\i1/);
  const goldPop = pop(ctx(planned("Fear thou not", "pop"), { look: resolveLook("studio-gospel-gold") }));
  assert.match(goldPop[0], /\\b1\\i1/);
});
```

- [ ] **Step 2: Run them and see them fail**

Run from `server/`: `node --test src/lib/kinetic/looks.test.js src/lib/kinetic/effects/effects.test.js`.
Expected: the two new tests FAIL (`scale` is undefined, and there is no `\b1`).

- [ ] **Step 3: Implement**

In `looks.js`, change the gospel-gold body line to:

```js
    body: { file: "PlayfairDisplay-BoldItalic.ttf", family: "Playfair Display", colour: "#F4EBD0", scale: 1.3, bold: true, italic: true },
```

and add this comment line above `"gospel-gold": Object.freeze({`:

```js
  // Playfair's small x-height reads ~40% smaller than the marker capitals at the same size,
  // and the repo's file is the upright Regular variable font, so libass synthesises bold italic.
```

In `effects/common.js`, add after `caseText`:

```js
/** A body font's size multiplier (1 unless the look sets `scale`). */
export function bodyScale(font) {
  const s = Number(font?.scale);
  return Number.isFinite(s) && s > 0 ? s : 1;
}
```

In `lineEvent`, change the signature and the `head`:

```js
export function lineEvent({ start, end, x, y, fs, family, rot = 0, pop = 135, bord = 5, shad = 3, outline = "#000000", words, layer = 0, bold = false, italic = false }) {
  const settle = pop >= 150 ? 160 : 130;
  const style = `${bold ? "\\b1" : ""}${italic ? "\\i1" : ""}`;
  const head = `{\\an5\\move(${Math.round(x)},${Math.round(y + 8)},${Math.round(x)},${Math.round(y)},0,180)`
    + `\\fn${family}\\fs${Math.round(fs)}${style}\\frz${rot}\\bord${bord}\\shad${shad}\\3c${assColour(outline)}\\fad(50,160)`
    + `\\fscx${pop}\\fscy${pop}\\t(0,${settle},\\fscx100\\fscy100)}`;
```

(The rest of `lineEvent` is unchanged.)

In `effects/pop.js`:
- import `bodyScale` from `./common.js`;
- change the size line to `let fs = Math.round((aspect === "tall" ? w * 0.12 : h * 0.11) * bodyScale(fonts.body));`;
- add `bold: fonts.body.bold, italic: fonts.body.italic,` to the `lineEvent({...})` call.

In `effects/stack.js`:
- import `bodyScale`;
- change `function chunk` to `export function chunk`;
- change the size line to `const preferred = Math.round((aspect === "tall" ? w * 0.14 : h * 0.13) * bodyScale(fonts.body));`;
- add `bold: fonts.body.bold, italic: fonts.body.italic,` to the `lineEvent({...})` call.

- [ ] **Step 4: Run the kinetic suite**

Run: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic
git commit -m "fix: Gospel Gold captions read as large as the other Studio looks"
```

---

### Task 2: `quote` effect

The phrase sits in quotation marks at its slot, and a hand-drawn underline draws itself under the last line, left to right, as the last word lands.

**Files:**
- Create: `server/src/lib/kinetic/effects/testkit.js`
- Create: `server/src/lib/kinetic/effects/quote.js`
- Test: `server/src/lib/kinetic/effects/quote.test.js`

**Interfaces:**
- Consumes: `fitSize`, `widthAt`, `covers`, `assColour`, `assTime` from `../text.js`; `slotsFor`, `maxWidthFor`, `clampBlockY` from `../layout.js`; `bodyScale`, `caseText`, `fontsFor`, `holdEnd`, `keyWordIndex`, `lineEvent`, `wrapWords` from `./common.js` (Task 1 adds `bodyScale` and the `bold`/`italic` options).
- Produces: `render(ctx) -> string[]`, where ctx is `{ planned, look, energy, w, h, aspect, nextStart }`. Also `underlineShape(width, thickness) -> string` and `underlineEvent({ x0, y, width, thickness, at, end, colour }) -> string`.
- Produces (tests): `testkit.js` exports `words`, `phrase`, `planned`, `ctx`, `posOf`, `visible`.

- [ ] **Step 1: Create the shared test helpers**

`server/src/lib/kinetic/effects/testkit.js`:

```js
// Helpers shared by the effect test files. Not a test file itself.
import { resolveLook } from "../looks.js";

export const words = (text, start) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.25, end: start + i * 0.25 + 0.25 }));
export const phrase = (text, start = 2) => ({ text, start, end: start + text.split(" ").length * 0.25, words: words(text, start) });
export const planned = (text, effect, extra = {}) => ({ index: 0, phrase: phrase(text), effect, slot: 0, hook: false, rot: -2, ...extra });
export const ctx = (p, over = {}) => ({ planned: p, look: resolveLook("studio-lagos-night"), energy: "lively", w: 1280, h: 720, aspect: "wide", nextStart: 10, ...over });
/** Final (x, y) of an event: the end point of \move, or \pos. */
export const posOf = (line) => {
  const move = line.match(/\\move\(-?\d+,-?\d+,(-?\d+),(-?\d+)/);
  const m = move || line.match(/\\pos\((-?\d+),(-?\d+)/);
  return m.slice(1, 3).map(Number);
};
/** The words a set of Dialogue lines show on screen, in order, with override blocks removed. */
export const visible = (lines) => lines
  .map((l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, ""))
  .join(" ")
  .split(" ")
  .filter(Boolean);
```

- [ ] **Step 2: Write the failing tests**

`server/src/lib/kinetic/effects/quote.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render as quote, underlineShape } from "./quote.js";
import { ctx, planned, posOf, visible } from "./testkit.js";

const textOf = (lines) => lines.filter((l) => !l.includes("\\p1"));
const underOf = (lines) => lines.find((l) => l.includes("\\p1"));

test("quote wraps the phrase in quotation marks and keeps every word", () => {
  const lines = quote(ctx(planned("By his grace alone", "quote")));
  const shown = visible(textOf(lines)).join(" ");
  assert.match(shown, /^[“"]BY HIS GRACE ALONE[”"]$/);
});

test("the underline draws itself left to right as the last word lands", () => {
  const lines = quote(ctx(planned("By his grace alone", "quote")));
  const under = underOf(lines);
  assert.ok(under, "an underline drawing");
  // "alone" is the 4th word: 2 + 3 * 0.25 = 2.75 s
  assert.match(under, /^Dialogue: 1,0:00:02\.75,/);
  const m = under.match(/\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)\\t\(0,350,\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)\)/);
  assert.ok(m, "an animated clip");
  const [l1, , r1, , l2, , r2] = m.slice(1).map(Number);
  assert.equal(l1, r1, "starts empty");
  assert.equal(l2, l1);
  assert.ok(r2 > l2 + 100, "ends wide");
});

test("the underline sits below the last line of text", () => {
  const lines = quote(ctx(planned("By his grace alone", "quote")));
  const lastY = Math.max(...textOf(lines).map((l) => posOf(l)[1]));
  const underY = Number(underOf(lines).match(/\\pos\(-?\d+,(-?\d+)\)/)[1]);
  assert.ok(underY > lastY, `underline ${underY} below text ${lastY}`);
});

test("on a tall frame quote stays inside the safe band", () => {
  const lines = quote(ctx(planned("Even the darkest night ends", "quote", { slot: 2 }), { w: 720, h: 1280, aspect: "tall" }));
  for (const l of textOf(lines)) assert.ok(posOf(l)[1] <= 1280 * 0.82, "text above the bottom strip");
  const m = underOf(lines).match(/\\t\(0,350,\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)\)/).slice(1).map(Number);
  assert.ok(m[0] >= 0.06 * 720 - 1 && m[2] <= 0.88 * 720 + 1, `underline x ${m[0]}..${m[2]}`);
  assert.ok(m[3] <= 1280 * 0.82 + 1, `underline bottom ${m[3]}`);
});

test("underlineShape is a closed drawing as wide as asked", () => {
  const s = underlineShape(300, 6);
  assert.match(s, /^m 0 \d+ b /);
  const xs = s.match(/-?\d+/g).map(Number).filter((_, i) => i % 2 === 0);
  assert.equal(Math.max(...xs), 300);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `node --test src/lib/kinetic/effects/quote.test.js`
Expected: FAIL, "Cannot find module './quote.js'".

- [ ] **Step 4: Implement `effects/quote.js`**

```js
import { covers, fitSize, widthAt, assColour, assTime } from "../text.js";
import { slotsFor, maxWidthFor, clampBlockY } from "../layout.js";
import { bodyScale, caseText, fontsFor, holdEnd, keyWordIndex, lineEvent, wrapWords } from "./common.js";

const MIN_FS = 24;
const DRAW_MS = 350;

/** Curly quotes where the font has them, straight ones where it doesn't. */
function marks(file) {
  return covers(file, "“”") ? ["“", "”"] : ['"', '"'];
}

/** A hand-drawn underline as an ASS drawing: a slightly wavy stroke `width` wide. */
export function underlineShape(width, thickness) {
  const W = Math.round(width);
  const t = Math.max(3, Math.round(thickness));
  const a = Math.round(W / 3);
  const b = Math.round((2 * W) / 3);
  return `m 0 ${t} b ${a} 0 ${b} ${2 * t} ${W} ${t} l ${W} ${2 * t} b ${b} ${3 * t} ${a} ${t} 0 ${2 * t}`;
}

/** The underline draws itself left to right: a clip that widens from nothing to the full stroke. */
export function underlineEvent({ x0, y, width, thickness, at, end, colour }) {
  const left = Math.round(x0);
  const top = Math.round(y);
  const right = left + Math.round(width);
  const bottom = top + Math.max(3, Math.round(thickness)) * 3 + 2;
  return `Dialogue: 1,${assTime(at)},${assTime(end)},Kinetic,,0,0,0,,`
    + `{\\an7\\pos(${left},${top})\\bord0\\shad0\\1c${assColour(colour)}\\fad(0,160)`
    + `\\clip(${left},${top - 2},${left},${bottom})\\t(0,${DRAW_MS},\\clip(${left},${top - 2},${right},${bottom}))\\p1}`
    + `${underlineShape(width, thickness)}{\\p0}`;
}

/**
 * The phrase in quotation marks at its slot, on one or two lines, with an
 * underline that draws itself under the last line as the last word lands.
 */
export function render({ planned, look, energy, w, h, aspect, nextStart }) {
  const { phrase, hook } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")));
  const [open, close] = marks(fonts.body.file);
  const slots = slotsFor(aspect);
  const slot = slots[planned.slot % slots.length];
  const key = keyWordIndex(phrase.words.map((x) => x.text));
  const last = phrase.words.length - 1;
  const words = phrase.words.map((x, i) => ({
    text: `${i === 0 ? open : ""}${caseText(look, x.text)}${i === last ? close : ""}`,
    t: x.start,
    colour: hook || (energy !== "calm" && i === key) ? fonts.hit.colour : fonts.body.colour,
  }));
  const maxWidth = maxWidthFor(slot, w, aspect);
  let fs = Math.round((aspect === "tall" ? w * 0.12 : h * 0.11) * bodyScale(fonts.body));
  let lines = wrapWords(words, fonts.body.file, fs, maxWidth);
  while (lines.length > 2 && fs > MIN_FS) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
    lines = wrapWords(words, fonts.body.file, fs, maxWidth);
  }
  const texts = lines.map((ln) => ln.map((x) => x.text).join(" "));
  fs = fitSize(fonts.body.file, texts, fs, maxWidth, MIN_FS); // a single long word can still be too wide
  const lineGap = fs * 1.05;
  const thickness = Math.max(3, fs * 0.07);
  // The underline's rounded drawing can run ~4 px past 3 × thickness, so the block allows for it.
  const blockHeight = lines.length * lineGap + thickness * 3 + 4;
  const cy = clampBlockY(slot.y * h, blockHeight, h, aspect);
  const y0 = cy - blockHeight / 2 + lineGap / 2;
  const end = holdEnd(phrase, nextStart);
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: slot.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot: 0, pop: 125, bord: 4, shad: 2, outline: look.outline, words: ln,
    bold: fonts.body.bold, italic: fonts.body.italic,
  }));
  const width = Math.max(...texts.map((t) => widthAt(fonts.body.file, t, fs))) * 0.9;
  events.push(underlineEvent({
    x0: slot.x * w - width / 2,
    y: y0 + (lines.length - 1) * lineGap + fs * 0.5,
    width,
    thickness,
    at: phrase.words[last].start,
    end,
    colour: fonts.hit.colour,
  }));
  return events;
}
```

- [ ] **Step 5: Run the kinetic suite**

Run: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: all PASS. If the tall safe-band test fails, report the numbers. Do not loosen the test.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/kinetic/effects
git commit -m "feat: Studio quote effect with a self-drawing underline"
```

---

### Task 3: `curve` effect

The phrase is set letter by letter along an arc in the upper part of the frame, with each letter turned to the curve. The letters of a word land together on that word's beat. A phrase too long for the arc at a readable size (under 60% of its preferred size) is stacked instead.

**Files:**
- Modify: `server/src/lib/kinetic/layout.js` (add `ARC`)
- Create: `server/src/lib/kinetic/effects/curve.js`
- Test: `server/src/lib/kinetic/effects/curve.test.js`

**Interfaces:**
- Consumes: `render` from `./stack.js`; `bodyScale`, `caseText`, `fontsFor`, `holdEnd`, `keyWordIndex` from `./common.js`; `widthAt`, `assEscape`, `assColour`, `assTime` from `../text.js`; `testkit.js` from Task 2.
- Produces: `ARC = { wide: { x, y, r, half }, tall: { x, y, r, half } }`. `x` and `y` are the apex as frame fractions, `r` is the radius as a fraction of width, and `half` is how far either side of the apex text may reach, as a fraction of width.
- Produces: `render(ctx) -> string[]`, where each event is one letter with `\pos` and `\frz`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/kinetic/effects/curve.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render as curve } from "./curve.js";
import { render as stack } from "./stack.js";
import { ctx, planned, posOf } from "./testkit.js";

const letterOf = (l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
const frzOf = (l) => Number(l.match(/\\frz(-?[\d.]+)/)[1]);

test("curve sets every letter of the phrase in order along an arc", () => {
  const lines = curve(ctx(planned("Hold my hand", "curve")));
  assert.equal(lines.map(letterOf).join(""), "HOLDMYHAND");
  const xs = lines.map((l) => posOf(l)[0]);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, "left to right");
  const ys = lines.map((l) => posOf(l)[1]);
  const mid = Math.floor(lines.length / 2);
  assert.ok(ys[0] > ys[mid] && ys[ys.length - 1] > ys[mid], "the ends sit lower than the middle");
  assert.ok(frzOf(lines[0]) > 0 && frzOf(lines[lines.length - 1]) < 0, "letters turn to the curve");
  assert.ok(ys.every((y) => y < 720 / 2), "upper half");
});

test("the letters of a word land together on that word's beat", () => {
  const lines = curve(ctx(planned("Hold my hand", "curve")));
  assert.ok(lines.slice(0, 4).every((l) => l.startsWith("Dialogue: 0,0:00:02.00,")), "HOLD");
  assert.ok(lines.slice(4, 6).every((l) => l.startsWith("Dialogue: 0,0:00:02.25,")), "MY");
  assert.ok(lines.slice(6).every((l) => l.startsWith("Dialogue: 0,0:00:02.50,")), "HAND");
});

test("the key word is in the hit colour when lively, and nothing is when calm", () => {
  const lively = curve(ctx(planned("Hold my hand", "curve")));
  assert.ok(lively.slice(6).every((l) => l.includes("\\1c&H003AD3F5&")), "HAND is the key word");
  assert.ok(lively.slice(0, 4).every((l) => !l.includes("&H003AD3F5&")));
  const calm = curve(ctx(planned("Hold my hand", "curve"), { energy: "calm" }));
  assert.ok(calm.every((l) => !l.includes("&H003AD3F5&")));
});

test("on a tall frame the arc stays inside the safe sides", () => {
  const lines = curve(ctx(planned("By his grace alone", "curve"), { w: 720, h: 1280, aspect: "tall" }));
  assert.ok(lines.length > 10, "drawn as a curve, not stacked");
  for (const l of lines) {
    const [x] = posOf(l);
    assert.ok(x >= 0.06 * 720 && x <= 0.88 * 720, `x ${x}`);
  }
});

test("a phrase too long for the arc is stacked instead", () => {
  const c = ctx(planned("Reconciliation transformation righteousness everywhere", "curve"), { w: 720, h: 1280, aspect: "tall" });
  assert.deepEqual(curve(c), stack(c));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test src/lib/kinetic/effects/curve.test.js`
Expected: FAIL, "Cannot find module './curve.js'".

- [ ] **Step 3: Implement**

Append to `server/src/lib/kinetic/layout.js`:

```js
/**
 * The arc a curved phrase sits on, like a rainbow over the subject: apex
 * (x, y) as frame fractions, radius `r` as a share of the width, and `half`,
 * how far either side of the apex the text may reach (share of the width).
 * Tall frames keep the arc inside 6%..88% of the width.
 */
export const ARC = Object.freeze({
  wide: { x: 0.5, y: 0.17, r: 0.75, half: 0.40 },
  tall: { x: TALL_X, y: 0.15, r: 0.85, half: 0.38 },
});
```

`server/src/lib/kinetic/effects/curve.js`:

```js
import { widthAt, assEscape, assColour, assTime } from "../text.js";
import { ARC } from "../layout.js";
import { bodyScale, caseText, fontsFor, holdEnd, keyWordIndex } from "./common.js";
import { render as stack } from "./stack.js";

const MIN_SHARE = 0.6; // shrunk below 60% of its preferred size a curve reads badly: stack it instead

/** Letters of the phrase in order, each tagged with its word, with a space between words. */
function lettersOf(words) {
  const out = [];
  words.forEach((w, wi) => {
    if (wi > 0) out.push({ ch: " ", word: wi, space: true });
    for (const ch of w.text) out.push({ ch, word: wi, space: false });
  });
  return out;
}

function advance(file, letter, fs) {
  if (letter.space) return Math.max(widthAt(file, " ", fs), fs * 0.25);
  return widthAt(file, letter.ch, fs);
}

/**
 * The phrase set letter by letter along an arc in the upper part of the
 * frame, each letter turned to the curve. Letters of a word land together on
 * that word's beat. A phrase too long for the arc at a readable size is
 * stacked instead.
 */
export function render(ctx) {
  const { planned, look, energy, w, h, aspect, nextStart } = ctx;
  const { phrase, hook } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")));
  const font = fonts.body;
  const key = keyWordIndex(phrase.words.map((x) => x.text));
  const words = phrase.words.map((x, i) => ({
    text: caseText(look, x.text),
    t: x.start,
    colour: hook || (energy !== "calm" && i === key) ? fonts.hit.colour : font.colour,
  }));
  const arc = ARC[aspect] || ARC.wide;
  const R = arc.r * w;
  const maxArc = 2 * R * Math.asin(Math.min(1, (arc.half * w) / R));
  const preferred = Math.round((aspect === "tall" ? w * 0.11 : h * 0.12) * bodyScale(font));
  const letters = lettersOf(words);
  const lengthAt = (size) => letters.reduce((sum, l) => sum + advance(font.file, l, size), 0);
  let fs = preferred;
  const natural = lengthAt(fs);
  if (natural > maxArc) fs = Math.floor((fs * maxArc) / natural);
  if (fs < preferred * MIN_SHARE) return stack(ctx);
  const end = holdEnd(phrase, nextStart);
  const length = lengthAt(fs);
  const ax = arc.x * w;
  const ay = arc.y * h;
  const style = `${font.bold ? "\\b1" : ""}${font.italic ? "\\i1" : ""}`;
  const events = [];
  let s = -length / 2;
  for (const l of letters) {
    const adv = advance(font.file, l, fs);
    const mid = s + adv / 2;
    s += adv;
    const text = assEscape(l.ch);
    if (l.space || !text.trim()) continue;
    const theta = mid / R;
    const x = ax + R * Math.sin(theta);
    const y = ay + R * (1 - Math.cos(theta));
    const deg = Math.round(((-theta * 180) / Math.PI) * 10) / 10;
    const word = words[l.word];
    events.push(`Dialogue: 0,${assTime(word.t)},${assTime(end)},Kinetic,,0,0,0,,`
      + `{\\an5\\pos(${Math.round(x)},${Math.round(y)})\\fn${font.family}\\fs${fs}${style}`
      + `\\frz${deg}\\bord4\\shad2\\3c${assColour(look.outline)}\\1c${assColour(word.colour)}`
      + `\\fad(60,160)\\fscx130\\fscy130\\t(0,140,\\fscx100\\fscy100)}${text}`);
  }
  return events;
}
```

- [ ] **Step 4: Run the kinetic suite**

Run: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic
git commit -m "feat: Studio curve effect sets a phrase along an arc"
```

---

### Task 4: `frame` effect

The phrase is repeated round all four edges as scrolling bands: top and bottom run opposite ways, and the sides run up and down. The phrase is stacked big in the centre in the hit colour. On tall frames the bands stay inside 6%..88% of the width and above 82% of the height.

**Files:**
- Create: `server/src/lib/kinetic/effects/frame.js`
- Test: `server/src/lib/kinetic/effects/frame.test.js`

**Interfaces:**
- Consumes: `chunk` exported from `./stack.js` (Task 1); `caseText`, `fontsFor`, `holdEnd`, `lineEvent` from `./common.js`; `covers`, `fitSize`, `widthAt`, `assEscape`, `assColour`, `assTime` from `../text.js`.
- Produces: `render(ctx) -> string[]`, made of 4 band events (each with `\clip(`), then the centre lines.
- Produces: `frameBox(w, h, aspect) -> { left, top, right, bottom }`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/kinetic/effects/frame.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render as frame } from "./frame.js";
import { ctx, planned, visible } from "./testkit.js";
import { widthAt } from "../text.js";

const bandsOf = (lines) => lines.filter((l) => l.includes("\\clip("));
const moveOf = (l) => l.match(/\\move\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/).slice(1).map(Number);
const clipOf = (l) => l.match(/\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/).slice(1).map(Number);
const shownOf = (l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
const fsOf = (l) => Number(l.match(/\\fs(\d+)/)[1]);

test("frame runs the phrase round all four edges, top and bottom scrolling opposite ways", () => {
  const lines = frame(ctx(planned("I still dey", "frame", { hook: true })));
  const bands = bandsOf(lines);
  assert.equal(bands.length, 4);
  const [top, bottom, left, right] = bands.map(moveOf);
  assert.ok(top[2] < top[0] && top[1] === top[3], "top scrolls left");
  assert.ok(bottom[2] > bottom[0] && bottom[1] === bottom[3], "bottom scrolls right");
  assert.ok(left[3] < left[1] && left[0] === left[2], "left scrolls up");
  assert.ok(right[3] > right[1] && right[0] === right[2], "right scrolls down");
  assert.match(bands[2], /\\frz90/);
  assert.match(bands[3], /\\frz-90/);
  for (const b of bands) assert.ok(shownOf(b).split("I STILL DEY").length - 1 >= 2, "the phrase repeats along the band");
});

test("each band covers its whole edge from the first frame to the last", () => {
  const c = ctx(planned("I still dey", "frame", { hook: true }));
  const bands = bandsOf(frame(c));
  const file = c.look.body.file;
  const [top, , left] = [bands[0], bands[1], bands[2]];
  const [L, T, R, B] = clipOf(top);
  const topLen = widthAt(file, shownOf(top), fsOf(top));
  for (const x of [moveOf(top)[0], moveOf(top)[2]]) {
    assert.ok(x - topLen / 2 <= L + 1 && x + topLen / 2 >= R - 1, `top band at ${x} spans ${L}..${R}`);
  }
  const sideLen = widthAt(file, shownOf(left), fsOf(left));
  for (const y of [moveOf(left)[1], moveOf(left)[3]]) {
    assert.ok(y - sideLen / 2 <= T + 1 && y + sideLen / 2 >= B - 1, `left band at ${y} spans ${T}..${B}`);
  }
});

test("the centre shows every word big in the hit colour", () => {
  const lines = frame(ctx(planned("I still dey", "frame", { hook: true })));
  const centre = lines.filter((l) => !l.includes("\\clip("));
  assert.deepEqual(visible(centre), ["I", "STILL", "DEY"]);
  assert.ok(centre.every((l) => l.includes("&H003AD3F5&")));
  assert.ok(centre.every((l) => l.startsWith("Dialogue: 2,")), "above the bands");
});

test("on a tall frame the bands keep clear of the bottom 18% and the right 12%", () => {
  const lines = frame(ctx(planned("I still dey", "frame", { hook: true }), { w: 720, h: 1280, aspect: "tall" }));
  for (const b of bandsOf(lines)) {
    const [l, t, r, btm] = clipOf(b);
    assert.ok(l >= 0.06 * 720 - 1 && r <= 0.88 * 720 + 1, `clip x ${l}..${r}`);
    assert.ok(t >= 0 && btm <= 0.82 * 1280 + 1, `clip y ${t}..${btm}`);
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test src/lib/kinetic/effects/frame.test.js`
Expected: FAIL, "Cannot find module './frame.js'".

- [ ] **Step 3: Implement `effects/frame.js`**

```js
import { covers, fitSize, widthAt, assEscape, assColour, assTime } from "../text.js";
import { caseText, fontsFor, holdEnd, lineEvent } from "./common.js";
import { chunk } from "./stack.js";

const SPEED = 0.06; // bands scroll this share of the frame's long side per second
const MAX_REPEATS = 40;

/** The rectangle the bands run round. Tall frames keep clear of the TikTok/Reels controls. */
export function frameBox(w, h, aspect) {
  return aspect === "tall"
    ? { left: 0.06 * w, top: 0.05 * h, right: 0.88 * w, bottom: 0.82 * h }
    : { left: 0.04 * w, top: 0.05 * h, right: 0.96 * w, bottom: 0.95 * h };
}

function bandEvent({ start, end, from, to, rot, clip, family, fs, colour, outline, text }) {
  const r = (v) => Math.round(v);
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Kinetic,,0,0,0,,`
    + `{\\an5\\move(${r(from[0])},${r(from[1])},${r(to[0])},${r(to[1])})`
    + `\\clip(${clip.map(r).join(",")})\\fn${family}\\fs${fs}\\frz${rot}`
    + `\\bord2\\shad0\\3c${assColour(outline)}\\1c${assColour(colour)}\\alpha&H20&\\fad(200,200)}${assEscape(text)}`;
}

/**
 * The phrase repeated round all four edges as scrolling bands (top and
 * bottom run opposite ways, the sides run up and down), with the phrase
 * stacked big in the centre. Made for a song's hook.
 */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const shown = caseText(look, phrase.words.map((x) => x.text).join(" "));
  const fonts = fontsFor(look, shown);
  const band = fonts.body;
  const box = frameBox(w, h, aspect);
  const bandFs = Math.round(Math.min(w, h) * (aspect === "tall" ? 0.06 : 0.055));
  const sep = covers(band.file, "•") ? " • " : " / ";
  const unit = `${shown}${sep}`;
  const unitWidth = Math.max(1, widthAt(band.file, unit, bandFs));
  const start = phrase.start;
  const end = holdEnd(phrase, nextStart);
  const shift = SPEED * Math.max(w, h) * (end - start);
  const inset = bandFs * 0.6;
  const bandText = (edge) => unit.repeat(Math.min(MAX_REPEATS, Math.ceil((edge + shift) / unitWidth) + 1)).trimEnd();
  const across = bandText(box.right - box.left);
  const down = bandText(box.bottom - box.top);
  const acrossLen = widthAt(band.file, across, bandFs);
  const downLen = widthAt(band.file, down, bandFs);
  const common = {
    start, end, clip: [box.left, box.top, box.right, box.bottom],
    family: band.family, fs: bandFs, colour: band.colour, outline: look.outline,
  };
  const topY = box.top + inset;
  const bottomY = box.bottom - inset;
  const leftX = box.left + inset;
  const rightX = box.right - inset;
  const events = [
    // Top scrolls left and bottom scrolls right; each starts flush with one end of its edge.
    bandEvent({ ...common, text: across, rot: 0, from: [box.left + acrossLen / 2, topY], to: [box.left + acrossLen / 2 - shift, topY] }),
    bandEvent({ ...common, text: across, rot: 0, from: [box.right - acrossLen / 2, bottomY], to: [box.right - acrossLen / 2 + shift, bottomY] }),
    // Left reads bottom to top and scrolls up; right reads top to bottom and scrolls down.
    bandEvent({ ...common, text: down, rot: 90, from: [leftX, box.top + downLen / 2], to: [leftX, box.top + downLen / 2 - shift] }),
    bandEvent({ ...common, text: down, rot: -90, from: [rightX, box.bottom - downLen / 2], to: [rightX, box.bottom - downLen / 2 + shift] }),
  ];
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.hit.colour }));
  const lines = chunk(words);
  const room = (box.right - box.left) - 2 * (inset + bandFs);
  const preferred = aspect === "tall" ? Math.round(w * 0.16) : Math.round(h * 0.15);
  const fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, room * 0.9, 32);
  const lineGap = fs * 1.0;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  lines.forEach((ln, i) => events.push(lineEvent({
    start: ln[0].t, end, x: cx, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot: 0, pop: 140, bord: 6, shad: 4, outline: look.outline, words: ln, layer: 2,
  })));
  return events;
}
```

- [ ] **Step 4: Run the kinetic suite**

Run: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic/effects
git commit -m "feat: Studio frame effect runs a hook round the edges"
```

---

### Task 5: `title` effect and title card

The title is a full-screen two-line brush title: the first line in the body colour and the second in the hit colour, in the hit font, centred. As an effect it reveals the phrase's words on their own beats. As an opt-in **title card** it shows a given title before the first lyric: up from 0 s, the second line 0.25 s later, gone just before the first phrase. It is on screen for 1.5–3 s.

**Files:**
- Create: `server/src/lib/kinetic/effects/title.js`
- Test: `server/src/lib/kinetic/effects/title.test.js`

**Interfaces:**
- Consumes: `fitSize` from `../text.js`; `CENTRE`, `maxWidthFor` from `../layout.js`; `caseText`, `fontsFor`, `holdEnd`, `lineEvent` from `./common.js`.
- Produces:
  - `splitTitle(words) -> words[][]`, one or two lines;
  - `render(ctx) -> string[]`;
  - `titleCard({ text, look, w, h, aspect, firstStart }) -> string[]`, which returns `[]` for empty text.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/kinetic/effects/title.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render as title, splitTitle, titleCard } from "./title.js";
import { ctx, planned } from "./testkit.js";
import { resolveLook } from "../looks.js";

const w = (s) => s.split(" ").map((text) => ({ text }));
const joined = (lines) => lines.map((l) => l.map((x) => x.text).join(" "));

test("splitTitle balances two lines by length; one word stays one line", () => {
  assert.deepEqual(joined(splitTitle(w("I still dey here"))), ["I still", "dey here"]);
  assert.deepEqual(joined(splitTitle(w("After the rain"))), ["After", "the rain"]);
  assert.deepEqual(joined(splitTitle(w("Hallelujah"))), ["Hallelujah"]);
});

test("the title effect draws two big centred lines, the second in the hit colour", () => {
  const lines = title(ctx(planned("After the rain", "title")));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.includes("\\fnKnewave") && l.startsWith("Dialogue: 2,")));
  assert.ok(!lines[0].includes("&H003AD3F5&"), "first line in the body colour");
  assert.ok(lines[1].includes("&H003AD3F5&"), "second line in the hit colour");
  assert.ok(Number(lines[0].match(/\\fs(\d+)/)[1]) >= 150);
});

test("a title card shows from 0 s until just before the first lyric, 1.5 to 3 s", () => {
  const look = resolveLook("studio-lagos-night");
  const card = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart: 4 });
  assert.equal(card.length, 2);
  assert.match(card[0], /^Dialogue: 2,0:00:00\.00,0:00:03\.00,/);
  assert.match(card[1], /^Dialogue: 2,0:00:00\.25,0:00:03\.00,/);
  assert.ok(card.join(" ").includes("STILL"));
  const early = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart: 0.5 });
  assert.match(early[0], /,0:00:01\.50,/);
  const mid = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart: 2.2 });
  assert.match(mid[0], /,0:00:02\.15,/);
  assert.deepEqual(titleCard({ text: "   ", look, w: 1280, h: 720, aspect: "wide", firstStart: 4 }), []);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test src/lib/kinetic/effects/title.test.js`
Expected: FAIL, "Cannot find module './title.js'".

- [ ] **Step 3: Implement `effects/title.js`**

```js
import { fitSize } from "../text.js";
import { CENTRE, maxWidthFor } from "../layout.js";
import { caseText, fontsFor, holdEnd, lineEvent } from "./common.js";

const INTRO_MIN = 1.5;
const INTRO_MAX = 3;
const SECOND_LINE_DELAY = 0.25;

/** Split words into two lines as even in length as possible (one line for a single word). */
export function splitTitle(words) {
  if (words.length < 2) return [words];
  let best = 1;
  let bestDiff = Infinity;
  for (let k = 1; k < words.length; k += 1) {
    const a = words.slice(0, k).map((x) => x.text).join(" ").length;
    const b = words.slice(k).map((x) => x.text).join(" ").length;
    if (Math.abs(a - b) < bestDiff) { best = k; bestDiff = Math.abs(a - b); }
  }
  return [words.slice(0, best), words.slice(best)];
}

/** Two big centred lines in the hit font: the first in the body colour, the last in the hit colour. */
function titleEvents({ words, look, w, h, aspect, end, rot }) {
  const fonts = fontsFor(look, words.map((x) => x.text).join(" "));
  const split = splitTitle(words);
  const lines = split.map((ln, li) => ln.map((x) => ({
    ...x, colour: li === split.length - 1 ? fonts.hit.colour : fonts.body.colour,
  })));
  const maxWidth = maxWidthFor({ side: false }, w, aspect) * 0.92;
  const preferred = aspect === "tall" ? Math.round(w * 0.22) : Math.round(h * 0.26);
  const fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, maxWidth, 40);
  const anchor = CENTRE[aspect] || CENTRE.wide;
  const lineGap = fs * 1.0;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot, pop: 150, bord: 6, shad: 4, outline: look.outline, words: ln, layer: 2,
  }));
}

/** The first phrase as a full-screen two-line title, revealed on its own beat. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase, rot } = planned;
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start }));
  return titleEvents({ words, look, w, h, aspect, end: holdEnd(phrase, nextStart), rot: Math.sign(rot) || -1 });
}

/**
 * An opt-in title card before the first lyric: up from 0 s, the second line
 * a beat later, gone just before the first phrase (on screen 1.5–3 s).
 */
export function titleCard({ text, look, w, h, aspect, firstStart }) {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  // A missing first-lyric time would make the end NaN: show the card for the full 3 s instead.
  const first = Number.isFinite(Number(firstStart)) ? Number(firstStart) : INTRO_MAX + 0.05;
  const end = Number(Math.min(INTRO_MAX, Math.max(INTRO_MIN, first - 0.05)).toFixed(2));
  const lines = splitTitle(parts.map((p) => ({ text: caseText(look, p) })));
  const words = lines.flatMap((ln, li) => ln.map((x) => ({ text: x.text, t: li * SECOND_LINE_DELAY })));
  return titleEvents({ words, look, w, h, aspect, end, rot: -1 });
}
```

- [ ] **Step 4: Run the kinetic suite**

Run: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic/effects
git commit -m "feat: Studio title effect and opt-in title card"
```

---

### Task 6: Director and `buildAss` use every effect

**Files:**
- Modify: `server/src/lib/kinetic/director.js`
- Modify: `server/src/lib/kinetic/ass.js`
- Test: `server/src/lib/kinetic/director.test.js`, `server/src/lib/kinetic/ass.test.js`, `server/src/lib/kinetic/render.test.js`

**Interfaces:**
- Consumes: `render` from `effects/quote.js`, `curve.js` and `frame.js`; `render` and `titleCard` from `effects/title.js` (Tasks 2–5).
- Produces:
  - `EFFECT_IDS = ["pop","stack","slam","quote","curve","frame","title"]`;
  - `planPhrases({ ..., titleFirst = true })`;
  - `buildAss({ ..., title = "" })`. A non-empty title adds a title card and turns `titleFirst` off. `studioCaptionFilter` already forwards every option to `buildAss`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/kinetic/director.test.js` (add `EFFECT_IDS` to its import from `./director.js`):

```js
const long = Array.from({ length: 40 }, (_, i) => P(i % 4 === 3 ? "Hold my hand" : `Line ${i} of the song`, i * 3));

test("every effect has an id the overrides accept", () => {
  assert.deepEqual([...EFFECT_IDS].sort(), ["curve", "frame", "pop", "quote", "slam", "stack", "title"]);
});

test("calm keeps to pops and stacks; lively adds quotes and curves but never frames or titles", () => {
  const seen = { calm: new Set(), lively: new Set() };
  for (let seed = 1; seed <= 50; seed += 1) {
    for (const energy of ["calm", "lively"]) {
      planPhrases({ phrases: long, energy, seed, slotCount: 5 }).forEach((p) => seen[energy].add(p.effect));
    }
  }
  assert.deepEqual([...seen.calm].sort(), ["pop", "stack"]);
  for (const e of ["quote", "curve"]) assert.ok(seen.lively.has(e), `lively uses ${e}`);
  for (const e of ["frame", "title"]) assert.ok(!seen.lively.has(e), `lively never uses ${e}`);
});

test("frames go only on hooks, at most once per 30 s; curves at most once per 20 s", () => {
  let frames = 0;
  for (const energy of ["wild", "lively"]) {
    for (let seed = 1; seed <= 50; seed += 1) {
      let lastFrame = -Infinity;
      let lastCurve = -Infinity;
      planPhrases({ phrases: long, energy, seed, slotCount: 5 }).forEach((p) => {
        if (p.effect === "frame") {
          frames += 1;
          assert.equal(p.hook, true, `${energy} seed ${seed}: frame on a non-hook`);
          assert.ok(p.phrase.start - lastFrame >= 30, `${energy} seed ${seed}: frames too close`);
          lastFrame = p.phrase.start;
        }
        if (p.effect === "curve") {
          assert.ok(p.phrase.start - lastCurve >= 20, `${energy} seed ${seed}: curves too close`);
          lastCurve = p.phrase.start;
        }
      });
    }
  }
  assert.ok(frames > 0, "wild does frame its hooks");
});

test("a wild video opens on its first line as a title, unless a title card is given", () => {
  assert.equal(planPhrases({ phrases: song, energy: "wild", seed: 1 })[0].effect, "title");
  assert.notEqual(planPhrases({ phrases: song, energy: "wild", seed: 1, titleFirst: false })[0].effect, "title");
  assert.notEqual(planPhrases({ phrases: song, energy: "lively", seed: 1 })[0].effect, "title");
  const longFirst = [P("From Lagos traffic to the last train home", 0), ...song.slice(1)];
  assert.notEqual(planPhrases({ phrases: longFirst, energy: "wild", seed: 1 })[0].effect, "title");
});
```

Append to `server/src/lib/kinetic/ass.test.js` (add `import { EFFECT_IDS } from "./director.js";` at the top):

```js
const lyric = [
  { text: "Fear thou not", start: 0, end: 1.5 }, { text: "I still dey", start: 2, end: 3.5 },
  { text: "By his grace", start: 4, end: 5.5 }, { text: "Hold my hand", start: 6, end: 7.5 },
];

test("every effect id renders through buildAss", () => {
  for (const effect of EFFECT_IDS) {
    const ass = buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 1, overrides: { 1: effect } });
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    assert.ok(events.some((l) => /,0:00:02\.\d\d,/.test(l.slice(0, 40))), `${effect} draws phrase 1`);
    assert.ok(!/NaN|undefined|Infinity/.test(ass), `${effect} writes only real numbers`);
  }
});

test("a title card opens the video", () => {
  const ass = buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "Hold My Hand" });
  const first = ass.split("\n").find((l) => l.startsWith("Dialogue:"));
  assert.match(first, /^Dialogue: 2,0:00:00\.00,/);
  assert.ok(first.includes("HOLD"));
  const none = buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "   " });
  assert.equal(none, buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1 }));
});
```

Append to `server/src/lib/kinetic/render.test.js` (it already has `frameAt`, `skip`, `studioCaptionFilter`):

```js
test("every effect draws through real libass on wide and tall frames", { skip }, () => {
  const lines = ["Fear thou not", "I still dey", "By his grace", "Hold my hand", "I still dey", "Glory to God", "Amen amen"]
    .map((text, i) => ({ text, start: i * 2, end: i * 2 + 1.5 }));
  const order = ["pop", "stack", "slam", "quote", "curve", "frame", "title"];
  const overrides = Object.fromEntries(order.map((e, i) => [i, e]));
  for (const [w, h] of [[1280, 720], [720, 1280]]) {
    for (const look of ["studio-lagos-night", "studio-gospel-gold"]) {
      const out = studioCaptionFilter({ assPath: "unused", lines, w, h, look, energy: "wild", seed: 1, overrides });
      const assText = out.sideFiles[0].text;
      order.forEach((effect, i) => {
        const buf = frameAt({ assText, w, h, t: i * 2 + 1.2, pix: "gray" });
        let lit = 0;
        for (let k = 0; k < buf.length; k += 7) if (buf[k] > 100) lit += 1;
        assert.ok(lit > 200, `${look} ${w}x${h} ${effect}: ${lit} lit samples`);
      });
    }
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test src/lib/kinetic/director.test.js src/lib/kinetic/ass.test.js src/lib/kinetic/render.test.js`
Expected: the new tests FAIL (unknown ids are ignored, so no title or frame, and `buildAss` has no `quote`).

- [ ] **Step 3: Implement**

In `director.js`, replace `EFFECT_IDS`, `MIX`, the constants, `allowed` and `planPhrases` with:

```js
export const EFFECT_IDS = Object.freeze(["pop", "stack", "slam", "quote", "curve", "frame", "title"]);

const MIX = Object.freeze({
  calm: { normal: ["pop", "stack"], hook: ["stack", "pop"] },
  lively: { normal: ["stack", "pop", "quote", "stack", "curve"], hook: ["slam", "stack"] },
  wild: { normal: ["slam", "stack", "slam", "quote", "slam", "curve", "pop"], hook: ["frame", "slam"] },
});

const SLAM_GAP_SEC = 4;
const SLAM_MAX_WORDS = 4;
const LONG_PHRASE_WORDS = 5;
const FRAME_GAP_SEC = 30;
const CURVE_GAP_SEC = 20;
```

```js
function allowed(effect, s) {
  if (effect === s.prev && effect !== "pop") return false;
  if (s.words > LONG_PHRASE_WORDS && effect !== "pop" && effect !== "stack") return false;
  if (effect === "slam" && (s.words > SLAM_MAX_WORDS || s.start - s.lastSlamEnd < SLAM_GAP_SEC)) return false;
  if (effect === "frame" && (!s.hook || s.start - s.lastFrameStart < FRAME_GAP_SEC)) return false;
  if (effect === "curve" && s.start - s.lastCurveStart < CURVE_GAP_SEC) return false;
  return true;
}
```

```js
export function planPhrases({ phrases, energy = "lively", seed = 1, overrides = null, slotCount = 5, titleFirst = true }) {
  const s = Number(seed);
  const rnd = mulberry32(Number.isFinite(s) ? Math.floor(s) : 1);
  const forced = overrides ?? {};
  const mix = MIX[energy] || MIX.lively;
  const hooks = findHooks(phrases);
  const slots = Math.max(1, Math.floor(Number(slotCount)) || 1);
  let prev = null;
  let lastSlamEnd = -Infinity;
  let lastFrameStart = -Infinity;
  let lastCurveStart = -Infinity;
  let slot = -1;
  return phrases.map((phrase, index) => {
    // Always draw the same three values per phrase, so an override on one
    // phrase cannot shift the slot or rotation of any other phrase.
    const rEffect = rnd();
    const rSlot = rnd();
    const rRot = rnd();
    const words = String(phrase.text).trim().split(/\s+/).filter(Boolean).length;
    const hook = hooks.has(index);
    let effect;
    if (EFFECT_IDS.includes(forced[index])) {
      effect = forced[index];
    } else if (energy === "wild" && index === 0 && titleFirst && words <= LONG_PHRASE_WORDS) {
      effect = "title"; // a wild video opens on its first line as a title
    } else {
      const state = { prev, words, start: phrase.start, lastSlamEnd, lastFrameStart, lastCurveStart, hook };
      const pool = (hook ? mix.hook : mix.normal).filter((e) => allowed(e, state));
      effect = pool.length ? pool[Math.floor(rEffect * pool.length)] : fallbackEffect(energy, prev);
    }
    if (effect === "slam") lastSlamEnd = phrase.end;
    if (effect === "frame") lastFrameStart = phrase.start;
    if (effect === "curve") lastCurveStart = phrase.start;
    slot = slots === 1 ? 0 : (slot + 1 + Math.floor(rSlot * (slots - 1))) % slots;
    const rot = (index % 2 === 0 ? -1 : 1) * (1 + Math.floor(rRot * 4));
    prev = effect;
    return { index, phrase, effect, slot, hook, rot };
  });
}
```

In `ass.js`, add the imports and replace `EFFECTS` and `buildAss`:

```js
import { render as quote } from "./effects/quote.js";
import { render as curve } from "./effects/curve.js";
import { render as frame } from "./effects/frame.js";
import { render as titleEffect, titleCard } from "./effects/title.js";

const EFFECTS = { pop, stack, slam, quote, curve, frame, title: titleEffect };
const TITLE_MAX_CHARS = 60;
```

```js
/**
 * The whole caption track as an ASS document: phrases, then a plan, then
 * events. `title` adds a title card before the first lyric. Returns "" when
 * there is nothing to draw.
 */
export function buildAss({ words, lines, w, h, look, energy, seed = 1, overrides = {}, title = "" }) {
  const phrases = phrasesFrom({ words, lines });
  if (!phrases.length) return "";
  const aspect = aspectOf(w, h);
  const theLook = resolveLook(look);
  const theEnergy = resolveEnergy(energy);
  const intro = String(title || "").trim().slice(0, TITLE_MAX_CHARS);
  const plan = planPhrases({
    phrases, energy: theEnergy, seed, overrides, slotCount: slotsFor(aspect).length, titleFirst: !intro,
  });
  const card = intro ? titleCard({ text: intro, look: theLook, w, h, aspect, firstStart: phrases[0].start }) : [];
  const events = plan.flatMap((planned, i) => EFFECTS[planned.effect]({
    planned, look: theLook, energy: theEnergy, w, h, aspect,
    nextStart: i + 1 < plan.length ? plan[i + 1].phrase.start : Infinity,
  }));
  return `${header(w, h)}\n${[...card, ...events].join("\n")}\n`;
}
```

- [ ] **Step 4: Run the kinetic suite**

Run: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js`
Expected: all PASS, including every step-1 rule test, for example "wild actually slams: at least 1.5 slams per plan". A simulation gives about 2.5 for that test. If any effect's real-libass check fails, report the effect and its lit count; do not lower the threshold.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic
git commit -m "feat: the Studio director uses quote, curve, frame and title"
```

---

### Task 7: Story title intro (`captionTitle`)

**Files:**
- Modify: `server/src/lib/story/projectStore.js` (`normaliseCaptionSettings`)
- Modify: `server/src/lib/story/storyRender.js` (`buildStoryFfmpegArgs`, `runStoryRender`)
- Modify: `server/src/routes/story.js` (render call near `captionSeed: project.captionSeed,`)
- Modify: `client/src/lib/storyTypes.ts`, `client/src/components/story/StoryCaptionsPanel.tsx`
- Test: `server/src/lib/story/projectStore.test.js`, `server/src/lib/story/storyRender.test.js`, `client/src/components/story/__tests__/StoryCaptionsPanel.test.tsx`

**Interfaces:**
- Consumes: `buildAss({ title })` via `studioCaptionFilter` (Task 6).
- Produces: a project field `captionTitle?: string`. It is trimmed, has whitespace runs collapsed to one space, and is at most 60 characters; empty means unset.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/story/projectStore.test.js`:

```js
test("caption title is trimmed, single-spaced, capped at 60 and cleared by an empty string", () => {
  assert.equal(normaliseCaptionSettings({ captionTitle: "  Hold   my\nhand  " }).captionTitle, "Hold my hand");
  assert.equal(normaliseCaptionSettings({ captionTitle: "x".repeat(80) }).captionTitle.length, 60);
  assert.equal(normaliseCaptionSettings({ captionTitle: "" }, { captionTitle: "Old" }).captionTitle, undefined);
  assert.equal(normaliseCaptionSettings({}, { captionTitle: "Kept" }).captionTitle, "Kept");
});
```

Inside the `describe("Studio caption looks", …)` block of `server/src/lib/story/storyRender.test.js`, add:

```js
  test("a caption title becomes a title card at the start of the .ass", () => {
    _setLibassForTest(true);
    const built = buildStoryFfmpegArgs({ ...base, captionPreset: "studio-lagos-night", captionEnergy: "wild", captionTitle: "Hold My Hand" });
    const first = built.sideFiles[0].text.split("\n").find((l) => l.startsWith("Dialogue:"));
    assert.match(first, /^Dialogue: 2,0:00:00\.00,/);
    assert.ok(first.includes("HOLD"));
    _setLibassForTest(undefined);
  });
```

Append to `client/src/components/story/__tests__/StoryCaptionsPanel.test.tsx`, inside `describe('StoryCaptionsPanel Studio effects', …)`:

```tsx
  it('a Studio look offers an optional title intro, saved when the field loses focus', async () => {
    const user = userEvent.setup();
    mockCatalogue(studioCatalogue);
    const onChange = show({ captions: 'kinetic', captionPreset: 'studio-lagos-night', captionTitle: 'Old' });
    const field = await screen.findByRole('textbox', { name: 'Title intro' });
    expect(field).toHaveValue('Old');
    await user.clear(field);
    await user.type(field, 'Hold My Hand');
    expect(onChange).not.toHaveBeenCalledWith({ captionTitle: 'Hold My Hand' });
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ captionTitle: 'Hold My Hand' });
  });

  it('ordinary looks have no title intro', async () => {
    mockCatalogue(studioCatalogue);
    show({ captions: 'kinetic', captionPreset: 'cinematic-default' });
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(screen.queryByRole('textbox', { name: 'Title intro' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them and see them fail**

Run from `server/`: `node --test src/lib/story/projectStore.test.js src/lib/story/storyRender.test.js`
Run from `client/`: `npx vitest run src/components/story/__tests__/StoryCaptionsPanel.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

In `projectStore.js` `normaliseCaptionSettings`, add after `captionSeed`:

```js
    captionTitle: (() => {
      const raw = input.captionTitle === undefined ? current.captionTitle : input.captionTitle;
      const text = raw === null || raw === undefined ? "" : String(raw).replace(/\s+/g, " ").trim().slice(0, 60);
      return text || undefined;
    })(),
```

In `storyRender.js`:
- add `captionTitle` next to `captionEnergy, captionSeed,` in the destructured parameters of both `buildStoryFfmpegArgs` and `runStoryRender`;
- pass `captionTitle,` in `runStoryRender`'s call to `buildStoryFfmpegArgs`;
- in the `studioCaptionFilter({...})` call, add `title: captionTitle,` after `seed: captionSeed ?? 1,`.

In `server/src/routes/story.js`, add `captionTitle: project.captionTitle,` after `captionSeed: project.captionSeed,`.

In `client/src/lib/storyTypes.ts`, after `captionSeed?: number;`:

```ts
  /** Studio looks only: an optional title card shown before the first lyric. */
  captionTitle?: string;
```

In `StoryCaptionsPanel.tsx`:
- Add a draft state next to the others:

```tsx
  const [titleDraft, setTitleDraft] = useState(value.captionTitle ?? '');
  useEffect(() => { setTitleDraft(value.captionTitle ?? ''); }, [value.captionTitle]);
  const commitTitle = () => {
    const next = titleDraft.replace(/\s+/g, ' ').trim();
    if (next !== (value.captionTitle ?? '')) onChange({ captionTitle: next });
  };
```

- Add this field after the Energy `Field` (inside `{studio && ( … )}`, so wrap both in a fragment):

```tsx
            <Field
              label="Title intro"
              tooltip="Optional. Shown big before the first line, like a song title. Leave empty for none."
            >
              <input
                type="text"
                aria-label="Title intro"
                value={titleDraft}
                maxLength={60}
                disabled={busy}
                placeholder="e.g. Hold My Hand"
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary"
              />
            </Field>
```

Before adding it, check the `className` against an existing text input in `client/src/components/ui/` (for example `Input.tsx`). Use that component instead if its props allow `aria-label`, `onBlur` and `onKeyDown`.

- [ ] **Step 4: Run the tests**

Run from `server/`: `node --test src/lib/story/*.test.js src/routes/story*.test.js`
Run from `client/`: `npx vitest run src/components/story`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story server/src/routes/story.js client/src/lib/storyTypes.ts client/src/components/story
git commit -m "feat: Story Studio captions can open on a title card"
```

---

### Task 8: Studio look sample clips in the picker

**Files:**
- Create: `server/scripts/make-studio-previews.mjs`
- Create (generated): `client/public/studio-looks/lagos-night.mp4`, `gospel-gold.mp4`, `clean-white.mp4`
- Modify: `client/src/components/story/StoryCaptionsPanel.tsx`
- Test: `client/src/components/story/__tests__/StoryCaptionsPanel.test.tsx`

**Interfaces:**
- Consumes: `LOOKS` from `server/src/lib/kinetic/looks.js`; `studioCaptionFilter` from `server/src/lib/kinetic/filter.js`.
- Produces: `/studio-looks/<look id without "studio-">.mp4`, served from the client's public folder. Vite copies `client/public` into `server/public` on build.

- [ ] **Step 1: Write the failing client test**

Add inside `describe('StoryCaptionsPanel Studio effects', …)`:

```tsx
  it('plays a sample clip of the chosen Studio look', async () => {
    mockCatalogue(studioCatalogue);
    const { container } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'studio-lagos-night' }} onChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Energy' });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('/studio-looks/lagos-night.mp4');
    expect(video!.muted).toBe(true);
  });

  it('shows no sample clip for ordinary looks', async () => {
    mockCatalogue(studioCatalogue);
    const { container } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'cinematic-default' }} onChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(container.querySelector('video')).toBeNull();
  });
```

- [ ] **Step 2: Run it and see it fail**

Run from `client/`: `npx vitest run src/components/story/__tests__/StoryCaptionsPanel.test.tsx`
Expected: the two new tests FAIL (there is no video element).

- [ ] **Step 3: Add the preview to the panel**

In `StoryCaptionsPanel.tsx`, add state: `const [failedPreview, setFailedPreview] = useState<string | null>(null);`. Directly under the "Caption animation" `</Field>`, add:

```tsx
          {studio && failedPreview !== value.captionPreset && (
            <video
              key={value.captionPreset}
              src={`/studio-looks/${value.captionPreset!.replace(/^studio-/, '')}.mp4`}
              autoPlay
              muted
              loop
              playsInline
              aria-label="Studio look sample"
              onError={() => setFailedPreview(value.captionPreset ?? null)}
              className="w-full max-w-xs rounded-lg border border-white/10"
            />
          )}
```

React does not reflect `muted` as an attribute in jsdom. If `video.muted` is false in the test, set it through a ref callback, `ref={(el) => { if (el) el.muted = true; }}`, and keep the `muted` prop.

- [ ] **Step 4: Run the client test**

Run: `npx vitest run src/components/story`
Expected: all PASS.

- [ ] **Step 5: Write the generator script**

`server/scripts/make-studio-previews.mjs`:

```js
// Renders the 6-second Studio look samples the caption picker plays.
// Dev-only (needs ffmpeg with libass and the lavfi `gradients` source).
// Run from server/: node scripts/make-studio-previews.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LOOKS } from "../src/lib/kinetic/looks.js";
import { studioCaptionFilter } from "../src/lib/kinetic/filter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../client/public/studio-looks");
const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const W = 640;
const H = 360;
const DUR = 6;
// Four short lines that show a stack, a slam, a quote and a framed hook.
const LINES = [
  { text: "Fear thou not", start: 0.3, end: 1.5 },
  { text: "I still dey", start: 1.7, end: 2.9 },
  { text: "By his grace", start: 3.1, end: 4.2 },
  { text: "I still dey", start: 4.4, end: 5.6 },
];
const OVERRIDES = { 0: "stack", 1: "slam", 2: "quote", 3: "frame" };

fs.mkdirSync(outDir, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio-previews-"));
try {
  for (const id of Object.keys(LOOKS)) {
    const assPath = path.join(work, `${id}.ass`);
    const built = studioCaptionFilter({
      assPath, lines: LINES, w: W, h: H, look: `studio-${id}`, energy: "wild", seed: 1, overrides: OVERRIDES,
    });
    for (const f of built.sideFiles) fs.writeFileSync(f.path, f.text, "utf8");
    const out = path.join(outDir, `${id}.mp4`);
    const r = spawnSync(ff, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=0x1b1030:c1=0x5a2a12:x0=0:y0=0:x1=${W}:y1=${H}:d=${DUR}:speed=0.01:r=25`,
      "-vf", built.filter,
      "-t", String(DUR), "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
      out,
    ], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${id}: ffmpeg failed: ${r.stderr}`);
    console.log(`${id}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
```

- [ ] **Step 6: Generate the clips and check them**

Run from `server/`: `node scripts/make-studio-previews.mjs`.
Expected: three lines like `lagos-night: 180 KB`, each file under 600 KB. Then check that each clip is 6 s long:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 ../client/public/studio-looks/lagos-night.mp4
```

Expected: `6.000000`, give or take 0.05.

- [ ] **Step 7: Commit**

```bash
git add server/scripts/make-studio-previews.mjs client/public/studio-looks client/src/components/story
git commit -m "feat: Studio look sample clips play in the Story caption picker"
```

---

### Task 9: End-to-end check (controller)

The controller does this task itself; it is not dispatched.
1. **Full suites.** Run the server's `npm test` and the client's `npx vitest run`.
2. **Real Story renders.** Use `scratchpad/kinetic-e2e/render.mjs` with `captionTitle` added to one run:
   - tall Lagos Night, wild, with the title "Hold My Hand";
   - wide Lagos Night, lively;
   - wide Gospel Gold, calm.

   Make contact sheets and inspect the quote, curve, frame and title effects, and the Gospel Gold size.
3. **Fixes.** Tune anything that looks wrong through one fix brief, then re-render.
4. **Bundle.** Rebuild the client (`npm run build` in `client/`), then commit `server/public` as "chore: rebuild client bundle".
