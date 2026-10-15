# Song mode Phase 4: Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A rendered lyric video carries:
  - the user's logo and artist name in a corner;
  - an intro credit;
  - an end card.
- When the song ends too soon after the last line, the video runs 3 s longer.
- A 3–3:10 portrait song can be trimmed to 2:59 so it counts as a YouTube Short.
- The user can switch each item off.

**Architecture:**
- The branding text is extra ASS events appended to the captions document, drawn by the same `ass=` filter.
- The logo is drawn with image overlays after the captions. Each overlay is shown or hidden over time by a tiny alpha "mask" stream, so it fades.
- When the corner logo and name hide is worked out once:
  - parse the caption events;
  - find the times any caption's ink reaches the logo band.
  - This one rule covers `frame` bands, tall stacks, and anything future effects draw up there.
- A pure planning module decides every time and size. The ffmpeg builder and the ASS builder only draw what the plan says.

**Tech Stack:**
- Node ESM, `node:test`, ffmpeg (prod 5.1.9, local 8.x), ASS via libass.
- React 18, TypeScript, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-song-mode-lyric-video-design.md`, sections §8 (Branding), §10 (Render) and §14 (Phase 4). The "publish draft" part of Phase 4 already shipped in PR #63, which this branch is based on.

## Global Constraints

- **Filters:** every filter must exist in ffmpeg 5.1:
  - `movie`, `loop`, `setpts`, `scale`, `format`, `alphaextract`, `alphamerge`, `blend`, `geq`, `fade`, `overlay`, `ass`, `apad`, `afade`;
  - no `y_align`, no filters newer than 5.1;
  - graphs go through `toFilterScriptArgs` → `-filter_complex_script`.
- **Audio:** the song's audio stays out of `-filter_complex`. It is mapped from its input and shaped only by `-af` (a separate simple graph). Every input keeps its own input-side `-t`. See the ffmpeg audio tail race memory: ffmpeg 8 drops the end of a mixed track under load.
- **Code with backslashes:** write code containing backslashes (ASS override tags such as `\fad`, `\p1`, `\1a`, and regexes) with the Write/Edit tools only, never a shell heredoc. Heredocs silently drop backslashes.
- **Colours and sizes:**
  - Wordmark and "Song by" colour: `#E6C47A`.
  - End card dim: black at ASS alpha `&H21&` (about 87% opaque).
  - Intro credit window: 0.8–7.4 s.
  - End card: the last 4 s.
  - Tail extension: 3 s when the tail after the last caption is under 3 s.
  - Shorts trim target: 179 s, with the audio fading over the last 3 s. Offered for portrait songs of 180–190 s.
- **Branding geometry** (fractions of the frame):
  - tall (portrait): band top 0.115 h, left 0.04 w, logo height 0.055 h, text size 0.026 h, gap 0.015 w;
  - wide (landscape and square): band top 0.05 h, left 0.04 w, logo height 0.08 h, text size 0.036 h, gap 0.012 w;
  - the logo fits inside a box of 3 × logo height by logo height.
- **Copy** (sentence case, plain English):
  - intro credit `♪ {title} — song by {artist}`, or `♪ {title}` with no artist;
  - end card `{title}` and `Song by {artist}`;
  - toggles `Logo and artist name`, `Intro credit`, `End card`;
  - trim `Trim to 2:59 so it counts as a Short`.
- **UI:**
  - The design rules in `~/.claude/standards/DESIGN_QUALITY_STANDARD.md` apply.
  - Reuse `formStyles`, with no new colours or hex values in components.
  - Labelled controls and visible focus.
- **Builds and commits:**
  - Never commit a client bundle built with `client/.env.local` present; `grep -rl AIza server/public` must print nothing.
  - Implementers never commit `server/public`. The controller rebuilds the bundle once at the end.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`. Never push.
- **Tests:** run suites sequentially, never two `node --test` or vitest runs at once. Concurrent runs cause spurious failures here.

## Review Focus

1. **A caption drawn high on the screen** (a stack at the top slot, a `frame` band, a curve) must never sit under the logo or name. The band must step aside. Pinned in Task 1, which parses events and finds the windows, and Task 3, which draws nothing in hidden windows.
2. **A song whose last line ends right at the end of the audio** gets 3 s more picture with silence (or the faded end). The end card must not cover a caption that is still showing. Pinned in Task 2's end card start rule and Task 4's duration tests.
3. **A user with no logo uploaded:** the name, intro credit and end card still work and the render has no logo overlay. Equally, a user who switched off "Add my logo to every video" in Settings gets no logo by default. Pinned in Tasks 4 and 5.
4. **Shorts trim when a line ends after 2:58.5:** it is refused with a plain sentence, both in the UI and by the server. Pinned in Tasks 2, 5 and 6.
5. **Odd text:** a title or artist holding ASS-special characters (`{`, `}`, `\`), emoji, Yoruba diacritics, or a very long title must stay inside the frame and must not break the ASS. Pinned in Task 3.

---

## File map

- Create `server/src/lib/lyricVideo/captionBands.js`: parses caption ASS events into ink windows; `bandHideWindows`, `captionsEnd`.
- Create `server/src/lib/lyricVideo/brandingPlan.js`: pure. Covers geometry, timeline, audio shape, `shortsTrimOffer`.
- Create `server/src/lib/lyricVideo/brandingAss.js`: the branding events (wordmark, credit, end card).
- Create `server/src/lib/lyricVideo/renderPlan.js`: puts captions, branding and the plan together for the route.
- Modify `server/src/lib/lyricVideo/lyricRender.js`: logo overlays, picture length, `-af`.
- Modify `server/src/routes/lyricVideo.js`:
  - `GET/PUT /:id/branding`;
  - render `shortsTrim`;
  - wiring and the disk estimate.
- Modify `server/src/lib/lyricVideo/projectStore.js`: the `branding` field.
- Modify on the client:
  - `client/src/lib/lyricVideoTypes.ts` and `client/src/lib/lyricVideoApi.ts`;
  - create `client/src/lib/shortsTrim.ts`;
  - create `client/src/components/lyricVideo/BrandingOptions.tsx`;
  - modify `client/src/components/lyricVideo/RenderStep.tsx`.
- Tests go beside each file, in the repo's existing style.

---

### Task 1: Caption ink windows

**Files:**
- Create: `server/src/lib/lyricVideo/captionBands.js`
- Test: `server/src/lib/lyricVideo/captionBands.test.js`

**Interfaces:**
- Produces:
  - `parseInkEvents(ass: string) -> Array<{ start: number, end: number, top: number }>`
  - `bandHideWindows(events, { bandBottom: number, pad?: number = 0.25, joinGap?: number = 1 }) -> Array<[number, number]>`
  - `captionsEnd(events) -> number` (0 when there are none)

Parsing rules for each `Dialogue:` line:
- Fields are `Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`. Split only the first 9 commas.
- Times are `H:MM:SS.cc` → seconds.
- Skip drawing events: the text holds `\p1` (or any `\pN` with N > 0) before the text.
- y is taken from the first `\pos(x,y)`. For `\move(x1,y1,x2,y2...)` it is `min(y1, y2)`. The size is the first `\fs<n>`. Skip events with no position or size.
- Alignment `\anN`, default 5:
  - for 7, 8 and 9 the top is y;
  - for 4, 5 and 6 the top is `y - 0.5 × fs × 1.35`;
  - for 1, 2 and 3 the top is `y - fs × 1.35`.
  - 1.35 allows for the pop scale the effects start at.
- `top` is that value minus the border (`\bord<n>`, default 0).

`bandHideWindows`:
- Take the events whose `top < bandBottom`. Each becomes `[start - pad, end + pad]`.
- Merge windows that overlap or sit less than `joinGap` apart.
- Clamp the starts at 0.

- [ ] **Step 1: Write the failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInkEvents, bandHideWindows, captionsEnd } from "./captionBands.js";

const ev = (start, end, text) => `Dialogue: 0,${start},${end},Kinetic,,0,0,0,,${text}`;
const ASS = [
  "[Events]",
  ev("0:00:01.00", "0:00:02.00", "{\\an5\\pos(360,300)\\fs40\\bord5}HIGH"),
  ev("0:00:05.00", "0:00:06.50", "{\\an5\\move(360,700,360,690,0,180)\\fs60}LOW"),
  ev("0:00:07.00", "0:00:08.00", "{\\an7\\pos(40,100)\\fs30}TOP LEFT"),
  ev("0:00:03.00", "0:00:04.00", "{\\an7\\pos(0,0)\\p1}m 0 0 l 10 0 10 10{\\p0}"),
  ev("0:00:09.00", "0:00:09.50", "{\\an2\\pos(360,240)\\fs40}BOTTOM ANCHOR"),
].join("\n");

test("each text event gives its time and the top of its ink; drawings are skipped", () => {
  const events = parseInkEvents(ASS);
  assert.equal(events.length, 4);
  assert.deepEqual(events[0], { start: 1, end: 2, top: 300 - 0.5 * 40 * 1.35 - 5 });
  assert.equal(events[1].top, 690 - 0.5 * 60 * 1.35);
  assert.equal(events[2].top, 100);
  assert.equal(events[3].top, 240 - 40 * 1.35);
});

test("windows cover the captions that reach into the band, padded, and close gaps under a second", () => {
  const events = parseInkEvents(ASS);
  assert.deepEqual(bandHideWindows(events, { bandBottom: 300 }), [[0.75, 2.25], [6.75, 9.75]]);
  assert.deepEqual(bandHideWindows(events, { bandBottom: 50 }), []);
});

test("captionsEnd is the last moment any caption is on screen", () => {
  assert.equal(captionsEnd(parseInkEvents(ASS)), 9.5);
  assert.equal(captionsEnd([]), 0);
});
```

- [ ] **Step 2:** Run `cd server && node --test src/lib/lyricVideo/captionBands.test.js`. Expect FAIL: module not found.
- [ ] **Step 3:** Implement the module as the rules above describe. Use a regex for the time, and `/\\pos\(\s*([\d.-]+)\s*,\s*([\d.-]+)/`-style matchers, written with the Write tool.
- [ ] **Step 4:** Add a test that runs `parseInkEvents` over `buildLyricAss` output for a real project. Use the `mini`/`timed` helpers pattern from `lyricAss.test.js`, at 720×1280 with the shorts layout. Assert that every event has finite numbers and that `captionsEnd` is greater than the last line's `end`. Run the tests again and expect PASS.
- [ ] **Step 5:** Commit: `feat: find when lyric captions reach the logo band`.

### Task 2: Branding plan (pure)

**Files:**
- Create: `server/src/lib/lyricVideo/brandingPlan.js`
- Test: `server/src/lib/lyricVideo/brandingPlan.test.js`

**Interfaces:**
- Consumes: `bandHideWindows` and `captionsEnd` from Task 1 (the caller passes their results in).
- Produces:
  - `SHORTS_TRIM_SEC = 179`, `TAIL_SEC = 3`, `END_CARD_SEC = 4`, `INTRO = [0.8, 7.4]`, `FADE = 0.25`
  - `bandGeometry({ w, h, logo: { width, height } | null }) -> { logo: { x, y, w, h } | null, text: { x, y, fs }, bandBottom }`
  - `shortsTrimOffer({ aspect, durationSec, lines }) -> { offered: boolean, allowed: boolean, reason: string }`
  - `planBranding({ durationSec, audibleEnd, captionsEnd, hideWindows, options: { logo, intro, endCard }, hasLogo, artist, shortsTrim }) -> Plan`

The `Plan` shape:

```js
{
  totalSec,                    // the video's length
  audio: { inputSec, padToSec, fadeFromSec, fadeSec },   // fadeSec 0 = no fade
  bandPieces: [[a, b], ...],   // when the logo and the name line are on screen (each ≥ 1 s), all before endCard.start
  intro: [[a, b], ...] | [],   // pieces of the intro window inside bandPieces (each ≥ 1.5 s)
  wordmark: [[a, b], ...] | [],// bandPieces minus the intro pieces (each ≥ 1 s); [] when there is no artist
  showLogo: boolean,           // options.logo && hasLogo
  endCard: { start, end } | null,
}
```

Rules, each one tested:

- **Shorts trim** (`shortsTrim` true and `shortsTrimOffer` allowed):
  - `totalSec = 179`;
  - audio is `inputSec 179, padToSec 179, fadeFromSec 176, fadeSec 3`.
- **No trim:**
  - `tail = durationSec - captionsEnd`.
  - If `options.endCard && tail < TAIL_SEC`, then `totalSec = durationSec + 3`. Otherwise `totalSec = durationSec`.
  - audio is `inputSec = durationSec` and `padToSec = totalSec`.
  - Fade the last 1.5 s of the song (`fadeFromSec = durationSec - 1.5`, `fadeSec = 1.5`) only when the video was extended AND `audibleEnd >= durationSec - 0.3`, meaning the song stops abruptly. Otherwise `fadeSec = 0`.
- **End card** (when `options.endCard`):
  - `start = max(totalSec - 4, captionsEnd + 0.2)`, `end = totalSec`.
  - It is null if `end - start < 2`.
- **bandPieces:**
  - the complement of `hideWindows` inside `[0, endCard?.start ?? totalSec]`;
  - pieces under 1 s are dropped;
  - `[]` when `options.logo` is false. The name line follows the logo toggle.
- **intro:** when `options.intro`, the pieces of `INTRO ∩ bandPieces` that are at least 1.5 s long. The intro credit shows even with `options.logo` off: compute it against the complement of `hideWindows` in that case.
- **wordmark:**
  - `bandPieces` minus `INTRO` when the intro shows (minus nothing otherwise);
  - pieces of at least 1 s;
  - `[]` if the artist is blank.
- **`shortsTrimOffer`:**
  - `offered = aspect === "portrait" && durationSec >= 180 && durationSec <= 190`;
  - `allowed = offered && every line with a finite end has end <= 178.5`;
  - `reason` is:
    - `""` when allowed;
    - `"A lyric line ends after 2:58, so trimming would cut it."` when offered but not allowed;
    - `"Only for portrait songs between 3:00 and 3:10."` when not offered.
- **`bandGeometry`:**
  - Use the constants from Global Constraints, by `w >= h ? wide : tall`.
  - The logo box is height `even(logoH × h)`, width `min(3 × boxH, round(boxH × logo.width / logo.height))`, made even.
  - The text sits at `x = left·w + logoBoxW + gap·w` (or `left·w` with no logo) and `y = top·h + boxH / 2`, anchored left-centre.
  - `bandBottom = top·h + boxH + 0.01·h`.
  - With no logo, `boxH` still sets `y` and `bandBottom`, so the band is the same size.

- [ ] **Step 1: Write the failing tests.** Cover each rule with exact numbers. Include these:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBranding, shortsTrimOffer, bandGeometry } from "./brandingPlan.js";

const on = { logo: true, intro: true, endCard: true };
const base = { durationSec: 120, audibleEnd: 118, captionsEnd: 110, hideWindows: [], options: on, hasLogo: true, artist: "Sthill Waters", shortsTrim: false };

test("a song with time after its last line keeps its length; the end card takes the last 4 s", () => {
  const p = planBranding(base);
  assert.equal(p.totalSec, 120);
  assert.deepEqual(p.endCard, { start: 116, end: 120 });
  assert.deepEqual(p.audio, { inputSec: 120, padToSec: 120, fadeFromSec: 0, fadeSec: 0 });
  assert.deepEqual(p.bandPieces, [[0, 116]]);
  assert.deepEqual(p.intro, [[0.8, 7.4]]);
  assert.deepEqual(p.wordmark, [[0, 0.8], [7.4, 116]].filter(([a, b]) => b - a >= 1));
});

test("a song that ends right after its last line runs 3 s longer, and the end card waits for the captions", () => {
  const p = planBranding({ ...base, captionsEnd: 119, audibleEnd: 119.9 });
  assert.equal(p.totalSec, 123);
  assert.deepEqual(p.endCard, { start: 119.2, end: 123 });
  assert.deepEqual(p.audio, { inputSec: 120, padToSec: 123, fadeFromSec: 118.5, fadeSec: 1.5 });
});

test("the band steps aside while captions reach it", () => {
  const p = planBranding({ ...base, hideWindows: [[3, 5], [40, 40.5]] });
  assert.deepEqual(p.bandPieces, [[0, 3], [5, 40], [40.5, 116]]);
  assert.deepEqual(p.intro, [[5, 7.4]]);
});

test("the Shorts trim cuts to 2:59 with a 3 s fade, and only when no line would be cut", () => {
  const lines = [{ end: 170 }, { end: 178.4 }];
  assert.deepEqual(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines }), { offered: true, allowed: true, reason: "" });
  assert.equal(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines: [{ end: 178.6 }] }).allowed, false);
  assert.equal(shortsTrimOffer({ aspect: "landscape", durationSec: 185, lines }).offered, false);
  const p = planBranding({ ...base, durationSec: 185, captionsEnd: 178.9, shortsTrim: true, aspect: "portrait", lines });
  assert.equal(p.totalSec, 179);
  assert.deepEqual(p.audio, { inputSec: 179, padToSec: 179, fadeFromSec: 176, fadeSec: 3 });
  assert.equal(p.endCard, null, "under 2 s remain after the captions");
});
```

  - The Shorts trim test shows that `planBranding` also takes `aspect` and `lines` (it uses them to check the offer itself). Add them to its signature.
  - Also add tests for: all options off (no pieces, no end card, no extension); no logo (`showLogo` false while the pieces still exist); a blank artist (`wordmark` is `[]`); and the `bandGeometry` numbers at 720×1280 and 1280×720 for a 512×256 logo.

- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement. Keep functions under 50 lines and use helpers for interval maths: `complement(windows, [a, b])`, `subtract`, `minLength`. Round all times to 2 decimals.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat: plan where and when a lyric video's branding shows`.

### Task 3: Branding ASS events

**Files:**
- Create: `server/src/lib/lyricVideo/brandingAss.js`
- Test: `server/src/lib/lyricVideo/brandingAss.test.js`

**Interfaces:**
- Consumes:
  - the `Plan` and `bandGeometry` from Task 2;
  - `resolveLook` and `fontsFor` from `kinetic/looks.js` and `kinetic/effects/common.js`;
  - `assEscape`, `assColour`, `assTime`, `fitSize` and `widthAt` from `kinetic/text.js`.
- Produces: `brandingEvents({ plan, geometry, look, title, artist, w, h }) -> string[]`, a list of `Dialogue:` lines on layers 20 and up, using style `Kinetic`.

What it draws:
- **Name line**, for each `wordmark` piece:
  - `{\an4\pos(x,y)\fn<body family>\fs<fs>\c<#E6C47A>\bord2\shad1\fad(250,250)}{artist}`.
  - The font is the look's body font, via `fontsFor(look, artist)` so missing glyphs fall back.
  - The size is fitted with `fitSize` to `0.88·w - x`, floor 14 px.
- **Intro credit**, for each `intro` piece: the same position and style, with text `♪ {title} — song by {artist}` (or `♪ {title}`).
  - The size is fitted to the same width, floor 14 px. If it still overflows, cut the title with `…` until it fits.
  - The `♪` character must be covered by the chosen font. If not, use `FALLBACK_FONT` for the whole line.
- **End card** (when `plan.endCard`):
  1. A dim on layer 20, from the card's start to its end: `{\an7\pos(0,0)\p1\bord0\shad0\1c&H000000&\1a&H21&\fad(400,0)}m 0 0 l W 0 W H 0 H{\p0}`.
  2. The title on layer 21, centred `\an5` at `x = w/2`:
     - y is `0.58·h` with a logo, or `0.47·h` without (tall); `0.62·h` or `0.47·h` (wide);
     - size `0.05·h` tall or `0.065·h` wide, fitted to `0.84·w`;
     - colour the look's body colour, `\bord3\fad(500,0)`.
  3. `Song by {artist}` on layer 21, at title y + `0.07·h`, size `0.032·h` tall or `0.04·h` wide, colour `#E6C47A`. Left out when there is no artist.
- Every user string goes through `assEscape`. That function must stop `{`, `}` and `\` from acting as tags; check it does, and extend it if not.

- [ ] **Step 1: Write the failing tests:**
  - **Name line:** one event per `wordmark` piece, with exact start and end times, `\an4`, and the `#E6C47A` colour in ASS form (`&H7AC4E6&`).
  - **Intro credit:** its events carry `♪` and `song by`.
  - **Long title:** a 140-character title stays inside the frame. Compute `x + widthAt(file, text, fs) <= 0.88·w`.
  - **End card:** the dim drawing covers `0 0` to `W H` with `\1a&H21&`. The title is centred, and there is no "Song by" line without an artist.
  - **Special characters:** a title of `My {\b1} Song \\ x` produces no stray `{\b1}` override. Assert the only `{...}` blocks are the generated tag blocks.
  - **Diacritics and emoji:** a Yoruba title (`Ọlọ́run ṣé o`) and an emoji title render with a font that covers them (`covers(...)` is true for the chosen file).
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement with the Write tool, because of the ASS backslashes.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat: draw a lyric video's name line, intro credit and end card`.

### Task 4: Render with the plan (ffmpeg)

**Files:**
- Modify: `server/src/lib/lyricVideo/lyricRender.js`
- Create: `server/src/lib/lyricVideo/renderPlan.js`
- Tests: `server/src/lib/lyricVideo/lyricRender.test.js`, `server/src/lib/lyricVideo/renderPlan.test.js`

**Interfaces:**
- Consumes: Tasks 1–3, `buildLyricAss`, and `probeMediaSize` (from `../story/sceneFraming.js`).
- Produces:
  - `async buildRenderAss(project, { width, height, aspect, options, logo, shortsTrim }) -> { ass, plan, geometry }`, in `renderPlan.js`:
    - `logo` is `{ file, width, height, opacity } | null`;
    - `layout` is `aspect === "portrait" ? "shorts" : "default"`.
    - Steps:
      1. Build the captions with `buildLyricAss`.
      2. `parseInkEvents`.
      3. `bandHideWindows` with `geometry.bandBottom`.
      4. `planBranding`.
      5. Append `brandingEvents` to the captions document. Insert the lines before the trailing newline; the header stays the captions' header.
    - Returns `""` for `ass` when no line is placed, as `buildLyricAss` does.
  - `buildLyricRenderArgs(...)` gains `{ plan, geometry, logo }`. It must behave exactly as before when `plan` is absent; the existing tests prove that.

Changes to `buildLyricRenderArgs` when a `plan` is given:
- **Picture input:** `-t plan.totalSec`.
- **Audio input:** `-t plan.audio.inputSec`.
- **Audio shaping:** `-af` holds:
  - `apad=whole_dur=<padToSec>` when `padToSec > inputSec`;
  - then `afade=t=out:st=<fadeFromSec>:d=<fadeSec>` when `fadeSec > 0`;
  - and nothing (no `-af`) when neither applies.
  - The audio is still never in `-filter_complex`. Update the test "the audio is not in the filter graph" so it keeps checking the graph and now allows `-af`.
- **Small logo**, when `plan.showLogo && logo && plan.bandPieces.length`, after `ass=…` and before `format=yuv420p`:
  1. The logo stream: `movie='<path>',loop=loop=-1:size=1:start=0,setpts=N/(30*TB),scale=<bw>:<bh>:force_original_aspect_ratio=decrease,format=rgba,split=2[lg][la]`.
  2. The mask: `color=c=white:s=16x16:r=30:d=<totalSec>,format=gray,geq=lum='<255·opacity·F(T)>',scale=<bw>:<bh>[m]`, where `F(T)` is the sum, over `bandPieces` `[a, b]`, of `clip((T-a)/0.25,0,1)*clip((b-T)/0.25,0,1)`.
  3. Combine: `[la]alphaextract[a0];[a0][m]blend=all_mode=multiply[a1];[lg][a1]alphamerge[logo]`.
  4. Overlay: `[cap][logo]overlay=x=<geometry.logo.x>:y=<geometry.logo.y>:shortest=1[...]`.
  - Use `filterPath` escaping from `branding.js`. Export it if needed; don't copy it.
  - `scale` with `force_original_aspect_ratio=decrease` may round one side to odd. Use `scale=<bw>:<bh>`, with the box worked out from the probed logo size in `bandGeometry`, so both sides are known and even.
- **End-card logo**, when `plan.endCard && plan.showLogo && logo`:
  - a second `movie` → `loop` → `setpts` → `scale` into a box of `0.36·min(w,h)` → `format=rgba` → `fade=t=in:st=<start>:d=0.4:alpha=1`;
  - overlaid centred at `y = 0.40·h` (tall) or `0.36·h` (wide), with `enable='gte(t,<start>)'` and `shortest=1`.
- **Order:** captions and branding ASS → small logo → end-card logo → `setparams…,format=yuv420p[v]`.

`runLyricRender` passes these through and uses `plan.totalSec` for its progress percentage.

- [ ] **Step 1: Write the failing argument tests.**
  - `-t` values for the picture and audio inputs.
  - `-af` contents for these cases: extend only, extend plus fade, trim.
  - No `-af` with no plan.
  - The filter script holds `movie=`, `alphamerge` and `fade=t=in:st=` only when the plan calls for them.
  - The old tests pass untouched.
- [ ] **Step 2: Write the failing real-ffmpeg tests.** Skip them when ffmpeg is missing, the same way the existing tests do. Reuse `makeFixtures` and `streamDurations`, plus a pixel helper like `pixelAt` in `branding.test.js` with a 64×64 solid red PNG logo:
  1. **Extension:** a 2 s song with `captionsEnd 1.9` and the end card on renders 5 s of video and 5 s of audio, each within 0.1 s. The last 1 s of audio is silent (`volumedetect` max_volume ≤ -60 dB).
  2. **Logo pieces:** with `bandPieces [[0, 0.8], [1.6, 3]]`, the logo corner pixel is red at t=0.4, not red at t=1.2, and red at t=2.5.
  3. **End-card dim:** at t = totalSec - 0.3, a background pixel away from the text is at least 80% darker than at t=0.5.
  4. **Trim with fade:** use a 4 s song and a plan built for the test (`totalSec 3`, fade from 2 for 1 s). The output is 3 s, and the last 0.2 s is quieter than 0.5–1.5 s by at least 12 dB.
- [ ] **Step 3:** Implement. Keep `buildLyricRenderArgs` under 50 lines by pulling out `logoChains(...)` and `audioShape(...)`.
- [ ] **Step 4:** Run `node --test src/lib/lyricVideo/lyricRender.test.js src/lib/lyricVideo/renderPlan.test.js`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: render a lyric video's logo, end card, tail and Shorts trim`.

### Task 5: Project branding options and the render route

**Files:**
- Modify: `server/src/lib/lyricVideo/projectStore.js`, `server/src/routes/lyricVideo.js`
- Test: `server/src/routes/lyricVideo.test.js`, `server/src/lib/lyricVideo/projectStore.test.js`

**Interfaces:**
- Consumes:
  - `buildRenderAss` (Task 4) and `shortsTrimOffer` (Task 2);
  - `readBranding` and `logoFileFor` from `../lib/branding.js`;
  - `probeMediaSize`.
- Produces:
  - **The project's `branding` field:** `{ logo: boolean | null, intro: boolean, endCard: boolean }`. `logo: null` means "follow Settings". The defaults are `{ logo: null, intro: true, endCard: true }`. Older projects without the field read as the defaults. Validate it in the store the same way the look is validated.
  - **`GET /:id/branding`** returns `{ logo, intro, endCard, hasLogo, logoFromSettings }`. `logo` is resolved: `project.branding.logo ?? readBranding(dataDir).enabled`.
  - **`PUT /:id/branding`** takes `{ logo?, intro?, endCard? }`. Booleans only; anything else is a 400. It returns `{ project }`.
  - **`POST /:id/render`** accepts `shortsTrim: boolean`:
    - if `shortsTrim` is true and `shortsTrimOffer(...).allowed` is false, return 409 with the offer's `reason`;
    - build with `buildRenderAss`. The logo is used when the resolved `logo` is true and the file exists; probe its size, and if the probe fails, render without the logo and log one line;
    - the disk estimate uses `plan.totalSec`;
    - the renders entry records `durationSec: plan.totalSec` and `shortsTrim`.
- The live preview route `/:id/captions.ass` is unchanged: captions only, no branding. See the rulings.

- [ ] **Step 1: Write the failing route tests**, using the injected `runRender` stub and `seen = o`:
  - the defaults, and an old project without the field;
  - PUT validation (non-boolean → 400; another user's project → 404);
  - the GET resolution with Settings on and off. Write `branding.json` with `writeBranding(dataDir, { enabled: true })`; `hasLogo` is false without a logo file;
  - a render passes a `plan` and `ass` that hold the branding events;
  - `shortsTrim` refused with 409 and the exact reason sentence;
  - a recorded render's `durationSec` equals `plan.totalSec`;
  - the disk estimate uses the extended length.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node --test src/routes/lyricVideo.test.js src/lib/lyricVideo/*.test.js`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: lyric video branding options and the Shorts trim on the render route`.

### Task 6: Render step branding options and Shorts trim (client)

**Files:**
- Modify:
  - `client/src/lib/lyricVideoTypes.ts`;
  - `client/src/lib/lyricVideoApi.ts`;
  - `client/src/components/lyricVideo/RenderStep.tsx`.
- Create:
  - `client/src/lib/shortsTrim.ts`;
  - `client/src/components/lyricVideo/BrandingOptions.tsx`.
- Tests:
  - `client/src/lib/__tests__/shortsTrim.test.ts`;
  - `client/src/components/lyricVideo/__tests__/BrandingOptions.test.tsx`;
  - `client/src/components/lyricVideo/__tests__/RenderStep.test.tsx`.

**Interfaces:**
- Consumes: `GET/PUT /:id/branding`, and render with `shortsTrim`.
- Produces:
  - `lyricVideoApi.branding(id)` and `lyricVideoApi.setBranding(id, patch)`;
  - `lyricVideoApi.render(id, aspect, quality, shortsTrim = false)`;
  - `shortsTrimOffer(project, aspect)`, mirroring the server rule and sentences exactly.

UI, in the Render step above the Render button:
- **A "Branding" group** (`fieldset` with `legend`) holding three checkboxes: `Logo and artist name`, `Intro credit`, `End card`.
  - Each change saves at once through `setBranding`. The checkbox is disabled while that save runs, and an error shows a toast and puts the checkbox back.
  - When `hasLogo` is false, show a hint under the first checkbox: `No logo yet. Add one in Settings → Branding.` "Settings → Branding" is a link to `/app/settings`.
  - With no artist on the project, add: `Add the artist's name on the Song step to show it.`
- **A Shorts trim checkbox**, `Trim to 2:59 so it counts as a Short`, shown only when the offer is `offered`. It is disabled with the reason underneath when not `allowed`, and sent with the render. It resets to unchecked when the frame changes away from portrait.
- All controls are disabled while a render is running, like the frame and quality selects.

- [ ] **Step 1: Write the failing tests:**
  - the offer cases, matching the server's four cases;
  - the checkboxes load from `branding()` and save each change;
  - the error path reverts;
  - the logo hint and its link;
  - the trim shows only for a portrait 185 s song;
  - the trim is disabled with the reason when a line ends at 178.6;
  - render is called with `shortsTrim: true`.
- [ ] **Step 2:** Run `cd client && npx vitest run src/components/lyricVideo src/lib`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep `RenderStep.tsx` under 300 lines by putting the group in `BrandingOptions.tsx`.
- [ ] **Step 4:** Run the tests and `npx tsc -b`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: branding options and the Shorts trim on the lyric video render step`.

### Task 7: Real-song check and ffmpeg 5.1 (controller)

The controller runs this task, not an implementer.

- [ ] **Step 1:** Render "My Time No Late", portrait 720p, from the smoke fixtures, with a test logo. Use a local server (pm2) or a short script calling `runLyricRender` with `buildRenderAss`. Pull frames at:
  - 0.5 s;
  - 3 s, during the intro credit;
  - a `frame` effect;
  - a tall stack in the top slot;
  - the end card;
  - the last frame.
  - Look at each one: no overlap between the band and any caption, and the end card is legible.
- [ ] **Step 2: ffmpeg 5.1.**
  - Run the generated filter script with ffmpeg 5.1 in Docker: `docker run --rm -v <dir>:/w jrottenberg/ffmpeg:5.1-ubuntu …`, or another 5.1 image. If none can be pulled, record a ruling and verify with one portrait render on prod after deploy.
  - Check the `geq`, `blend`, `alphamerge` and `apad=whole_dur` behaviour matches.
- [ ] **Step 3:** Run all of server lyricVideo plus routes, and the full client suite, sequentially. Then `npm run build` (no Firebase keys) and commit the bundle.

---

## Rulings made while planning (each with its cost if wrong)

- **P1:**
  - Decision: the band hides whenever any caption's estimated ink top reaches the band, rather than only during `frame` effects as the spec says.
  - Why: captions in the Shorts layout may sit as high as 0.11 h, inside the spec's logo band at 0.115–0.17 h, so `frame` alone would leave overlaps.
  - Cost if wrong: the logo blinks out more often than the operator likes. Fix by raising `pad`/`joinGap`.
- **P2:**
  - Decision: the intro credit replaces the name line in the same band (beside the logo), rather than sitting under the logo.
  - Why: under the logo is where the first caption slot's ink reaches.
  - Cost if wrong: one position constant.
- **P3:**
  - Decision: with the tail extension, the song is faded (1.5 s) only when it stops abruptly (`audibleEnd ≥ duration - 0.3`). Otherwise the song plays to its own end and silence is padded.
  - Why: the spec says "music faded", but fading a song that already ends naturally would clip its last chord.
  - Cost if wrong: the fade rule.
- **P4:**
  - Decision: the end card starts no earlier than 0.2 s after the last caption leaves, and is skipped if under 2 s remain. This only bites for the Shorts trim, since the extension guarantees 3 s otherwise.
  - Cost if wrong: a short trimmed video has no end card.
- **P5:**
  - Decision: the live preview stays captions-only. Branding shows in the rendered video, not the preview.
  - Why: the preview's ASS is fetched per edit, and branding needs the logo probe and the plan.
  - Cost if wrong: the user can't preview the end card. A later task can append the branding events to `/captions.ass`, minus the logo.
- **P6:**
  - Decision: the logo toggle defaults to Settings → Branding's "Add my logo to every video" (`logo: null` = follow), and the artist name follows the same toggle.
  - Cost if wrong: one default.
- **P7:**
  - Decision: the logo fades through a 16×16 mask stream scaled to the logo, not `geq` on the logo itself.
  - Why: `geq` with about 30 time windows on every logo pixel for 5400 frames would add minutes to a render.
  - Cost if wrong: the mask chain is the one 5.1 risk, which is why Task 7 checks it.
- **P8:**
  - Decision: Phase 3 (Backgrounds) is skipped, as the operator asked for Phase 4 next. Nothing here depends on it.
  - Cost if wrong: none for this plan.
