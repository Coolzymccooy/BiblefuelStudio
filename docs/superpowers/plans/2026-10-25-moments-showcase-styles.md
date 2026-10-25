# Moments Showcase Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Showcase" family of four Moments styles (Fellowship, Scrapbook, Party Pop, Premiere) that show many photos per scene through beat-cut templates, rendered with Remotion. They allow up to 100 photos, lengths of 30–180 s, a 9:16 or 16:9 shape, and an invite end card.

**Architecture:** The pure ffmpeg classic path stays as it is. A Showcase style branches inside `momentRenderStage`. A pure director (`lib/showcase/director.js`) turns photos, the beat grid and the words into a scene plan. `lib/showcase/render.js` stages bounded-size images, renders the silent picture with the Remotion composition `MomentShowcase`, then runs the existing `finishArgs` finish pass for grade, kinetic captions, audio mix and loudness, using a small adapter plan.

**Tech Stack:** Node ESM + `node:test` (server), zod, Remotion 4.0.538 (`server/remotion`), React + Vitest (client), ffmpeg (prod 5.1.9).

**Spec:** `docs/superpowers/specs/2026-10-25-moments-showcase-styles-design.md`

## Global Constraints

- Prod ffmpeg is 5.1.9. Every new ffmpeg filter must be on `FFMPEG_51_FILTERS`; `seams.test.js` / the finish tests enforce it.
- Classic styles (glow, celebrate, hype, gallery) must render byte-for-byte the same plans as before. Do not change `directMoment`, `cutPoints` or `validatePlan`.
- Photo staging: card images have a long side ≤ 1400 px, aspect kept. Blur images are 216×384 (tall shape) or 384×216 (wide shape).
- Shapes: `"tall"` = 1080×1920, `"wide"` = 1920×1080, fps 30.
- Lengths: classic `[15, 30, 60]`, Showcase `[30, 60, 90, 120, 180]`.
- Photos: `MIN_PHOTOS` 3, `MAX_PHOTOS` 100.
- Statement limits: `{15:3, 30:5, 60:8, 90:10, 120:12, 180:16}`. `MAX_STATEMENTS` 16.
- Showcase finishes over 60 s encode with `-crf 21 -maxrate 8M -bufsize 16M`. 60 s and under keep `-crf 19`.
- UI copy is sentence case. UI uses the existing tokens and classes (`segmentedCls`, `segmentCls`, `fieldLabelCls`, `text-help`), with no new button style. The design-quality rules apply.
- Never push, open a PR or deploy without the operator's explicit go-ahead.

## Review Focus

1. **Song shorter than the chosen length** (a 2:30 song at 180 s). Expected: the Moment is shortened to the song's whole seconds, with the note "Your song is N s, so this Moment is N s." There is no long silent tail. *Test in Task 8.*
2. **Old project or old client sends a classic style with lengthSec 120 or shape "wide"**. Expected: the server clamps to 60 s and "tall", with no error, so an earlier client can't wedge a project. *Test in Task 5.*
3. **Beat grid runs out before the Moment ends** (pulse or voice grid, or a song whose marks stop early). Expected: the director still lands scenes contiguously at `durationSec`, using `period` (or 2 s) steps past the last mark. *Test in Task 3.*
4. **Very few photos for a long Moment** (3 photos at 180 s). Expected: photos cycle and no template asks for more distinct photos than exist. Grid and filmstrip may repeat photos only when fewer than their count exist. *Test in Task 3.*
5. **Portrait EXIF-rotated phone photos** (orientation 6/8). Expected: staged cards come out upright on both ffmpeg 5.1 and 8, using the same `-noautorotate` + transpose logic as `motion/prepare.js`. *Test in Task 7.*

---

### Task 1: Styles registry gains the Showcase family

**Files:**
- Modify: `server/src/lib/motion/styles.js`
- Modify: `server/src/lib/motion/styles.test.js`

**Interfaces:**
- Produces:
  - `STYLES[id].family: "classic" | "showcase"`
  - `SHOWCASE_IDS: string[]` = `["fellowship","scrapbook","partyPop","premiere"]`
  - `CLASSIC_IDS: string[]`
  - `isShowcase(id): boolean`
  - `familyOf(id): "classic"|"showcase"`
  - `CLASSIC_LENGTHS = [15,30,60]`
  - `SHOWCASE_LENGTHS = [30,60,90,120,180]`
  - `lengthsFor(id): number[]`
  - `TEMPLATE_IDS = ["single","polaroids","split","grid","swipe","triptych","spotlight","filmstrip"]`
- Each Showcase entry carries:
  - `{ id, family, energy, label, description, look, grade, templates: Record<TemplateId, weight>, palette: { backdrop: "blur"|"paper"|"colour"|"dark", card, accent, ink, blocks?: string[] }, flashes: boolean, letterbox: boolean }`
  - **fellowship**: energy 0.6, look `studio-gospel-gold`, backdrop blur, flashes true, all eight templates.
  - **scrapbook**: energy 0.35, look `studio-gospel-gold`, backdrop paper, templates polaroids / single / split / triptych / grid.
  - **partyPop**: energy 0.8, look `studio-lagos-night`, backdrop colour with ≥ 4 `blocks`, templates grid / swipe / spotlight / split / single / polaroids.
  - **premiere**: energy 0.45, look `studio-clean-white`, backdrop dark, letterbox true, templates single / filmstrip / spotlight / triptych / split.
  - Labels: "Fellowship", "Scrapbook", "Party pop", "Premiere". Descriptions are one sentence each, as in spec §2.

- [ ] **Step 1: Update the failing tests**
  - Change "the four launch styles" so it asserts `CLASSIC_IDS` deep-equals `["glow","celebrate","hype","gallery"]` and `SHOWCASE_IDS` deep-equals `["fellowship","scrapbook","partyPop","premiere"]`. `STYLE_IDS` should equal both lists joined.
  - Restrict the palette-entry test to `family === "classic"`.
  - Add `showcase styles use only known templates and a real caption look`: every weight > 0, every key in `TEMPLATE_IDS`, and `isStudioLook(look)`. `grade` must contain only filters listed in `FFMPEG_51_FILTERS`; reuse whatever `seams.test.js` uses.
  - Add `lengthsFor`:
    - `lengthsFor("glow")` → `[15,30,60]`
    - `lengthsFor("premiere")` → `[30,60,90,120,180]`
    - `lengthsFor("nope")` → `[15,30,60]`
  - Add `isShowcase("partyPop") === true` and `isShowcase("hype") === false`.
- [ ] **Step 2: Run them and see them fail.** Run `cd server && node --test src/lib/motion/styles.test.js`. Expected: FAIL (`SHOWCASE_IDS` is undefined).
- [ ] **Step 3: Implement.** Add `family: "classic"` to the four existing entries and add the four Showcase entries and the exports above. Leave `resolveStyle`'s fallback as `celebrate`.
- [ ] **Step 4: Run the server suite.** Run `cd server && npm test`. Expected: PASS. Fix every place that assumed every style has `moves`; grep `STYLES)` and `Object.values(STYLES)`.
- [ ] **Step 5: Commit.** `feat: Showcase style family in the Moments registry`

### Task 2: Longer lengths, more statements, more photos (shared limits)

**Files:**
- Modify: `server/src/lib/motion/director.js:105` (`STATEMENT_LIMITS`)
- Modify: `server/src/lib/moments/occasions.js` (`LENGTHS`, `MAX_STATEMENTS`)
- Modify: `server/src/lib/moments/projectStore.js:17` (`MAX_PHOTOS`)
- Modify: `server/src/lib/moments/renderStage.js` (`droppedNote` gains a `lengths` parameter)
- Test: `director.test.js`, `occasions.test.js`, `renderStage.test.js`

**Interfaces:**
- Produces:
  - `STATEMENT_LIMITS = {15:3, 30:5, 60:8, 90:10, 120:12, 180:16}`
  - `LENGTHS = [15,30,60,90,120,180]` (the union)
  - `MAX_STATEMENTS = 16`
  - `MAX_PHOTOS = 100`
  - `droppedNote(dropped, lengthSec, lengths = CLASSIC_LENGTHS)`

- [ ] **Step 1: Write the failing tests.**
  - `statementLimit(90) === 10`, `statementLimit(120) === 12`, `statementLimit(180) === 16`, and `statementLimit(60) === 8` (unchanged).
  - `droppedNote(3, 60)` still ends "Try …?" absent. Its text is exactly `"3 photos didn't fit 60 s."`.
  - `droppedNote(3, 60, SHOWCASE_LENGTHS)` is `"3 photos didn't fit 60 s. Try 90 s?"`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the constants and the `droppedNote` parameter.** The classic call site keeps the classic default.
- [ ] **Step 4: Run `npm test` in `server/`.** Expected: PASS. Existing tests that assert `MAX_PHOTOS` 20 or "up to 8 statements" copy must be updated to the new values; that is intended.
- [ ] **Step 5: Commit.** `feat: Moments limits for long Showcase videos`

### Task 3: Showcase director (pure)

**Files:**
- Create: `server/src/lib/showcase/templates.js`
- Create: `server/src/lib/showcase/director.js`
- Create: `server/src/lib/showcase/inviteDate.js`
- Test: `server/src/lib/showcase/director.test.js`, `server/src/lib/showcase/inviteDate.test.js`

**Interfaces:**
- Consumes:
  - `STYLES`, `TEMPLATE_IDS` (Task 1)
  - `placeCaptions`, `statementLimit` (`motion/director.js`)
  - `mulberry32` (`kinetic/director.js`)
  - grid shape `{ kind, marks:[{t,downbeat,strong}], period }`
- Produces:
  - `TEMPLATES: Record<id, { photos: number, beats: number }>`:
    - single {1,3}, spotlight {1,3}, split {2,4}, polaroids {3,5}, swipe {3,5}, triptych {3,4}, grid {4,5}, filmstrip {5,8}
    - closing templates finale {1, min 3 s} and invite {1, min 3 s}
  - `readInviteDate(text: string): { month: number (1-12), day: number, label: string /* "NOV" */ } | null`
  - `directShowcase({ photos: {shape}[], heroIndex, grid, title, statements, styleId, energy, lengthSec, seed, shape: "tall"|"wide", details }) → { plan, dropped }`, where `plan` is spec §7.2's object:
    - `version: 1`, `kind: "showcase"`
    - `w`, `h`, `fps: 30`
    - `durationSec`, `seed`, `style`, `energy`, `shape`
    - `scenes: [{ template, photos: number[], start, end }]`
    - `captions` (from `placeCaptions`, cuts = scenes mapped to `{start, end, downbeat}`)
    - `invite`
    - `flashes: number[]` (scene starts that open a new "section": every 4th scene when `style.flashes`, else `[]`)

- [ ] **Step 1: Write the failing `inviteDate` tests.**
  - Each of these reads as `{month: 11, day: 21, label: "NOV"}`: "21 November", "21st Nov", "November 21", "21/11", "2026-11-21", "Sat 21 Nov 2026".
  - "13/14" → null, "next Sunday" → null, "" → null, "31 February" → null.
- [ ] **Step 2: Write the failing director tests.** They use a synthetic beat grid (`period` 0.6, marks every 0.6 s to 200 s):
  - `deterministic for a seed`: the same input gives `deepEqual` plans.
  - `scenes are contiguous on beats from 0 to durationSec`: the first start is 0, each `end === next.start`, the last end is `durationSec`, and every inner boundary is a grid mark `t`.
  - `every photo once, in order, hero first, when they fit`: 40 photos at 120 s. Flattening `scenes[].photos` gives the hero, then the rest in order, with no repeats.
  - `dense templates before dropping`: 100 photos at 30 s, energy 0.5. The share of `grid` + `filmstrip` scenes is greater than with 20 photos, and `dropped === 100 - usedCount`.
  - `never the same template twice running`
  - `opens on single, closes on finale or invite`: `invite` when `details.date = "21 November"`, else `finale`. The closing scene is ≥ 3 s.
  - `Energy changes scene length`: the mean scene length at energy 0.1 is greater than at energy 0.9.
  - `wide shape sets 1920×1080`
  - **Review Focus 3**, `grid that stops early still fills the length`: marks to 20 s only at lengthSec 60. Scenes still end at 60 and stay contiguous.
  - **Review Focus 4**, `3 photos at 180 s cycle without over-asking`: every scene's `photos.length === TEMPLATES[template].photos`. Templates needing more distinct photos than exist are not chosen.
  - `captions are placed`: with title "T" and 3 statements, `plan.captions[0].effect === "title"` and the last caption starts inside the closing scene.
- [ ] **Step 3: Run them and see them fail.** Run `cd server && node --test src/lib/showcase/`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement `templates.js` and `inviteDate.js`.** Slashes are read day-first. Validate the day against the month's length, with February allowing 29.
- [ ] **Step 5: Implement `directShowcase`.** The approach is:
  - Energy factor is 1.5 below 0.34, 1 up to 0.66, and 0.75 above.
  - Beats per scene = `max(2, round(TEMPLATES[t].beats * factor))`.
  - Walk the grid's marks to find each scene's end. Past the last mark, step by `grid.period || 2`.
  - Reserve the closing scene first: the last `max(3, 4 beats)` seconds.
  - Choose templates by seeded weighted pick from `style.templates`. Exclude the previous template and any whose photo count exceeds the photos remaining before the cycle restarts. When the estimated scene count × average photos is less than the remaining photos, raise the weights of grid, filmstrip and polaroids ×3.
  - The opening scene is `single` on the hero.
  - When all photos are used and time remains, cycle from the hero again.
  - `dropped` = photos never shown.
- [ ] **Step 6: Run the tests.** Expected: PASS.
- [ ] **Step 7: Commit.** `feat: Showcase director plans beat-cut multi-photo scenes`

### Task 4: Showcase plan validation

**Files:**
- Create: `server/src/lib/showcase/plan.js`
- Test: `server/src/lib/showcase/plan.test.js`

**Interfaces:**
- Produces: `validateShowcasePlan(plan, { photoCount }) → { ok: true } | { ok: false, errors: string[] }`. It is a zod schema plus a contiguity check:
  - `durationSec` ≤ 181
  - scenes 1..400, captions ≤ 20
  - `style` ∈ `SHOWCASE_IDS`
  - `w×h` is 1080×1920 for `shape` "tall" and 1920×1080 for "wide"

- [ ] **Step 1: Write the failing tests.**
  - A plan from `directShowcase` is valid.
  - Each of the following is rejected with an error that names it:
    - a gap between scenes
    - an overlap
    - a scene with the wrong photo count
    - a photo index ≥ `photoCount`
    - `style: "hype"`
    - `durationSec: 200`
    - a wide shape at 1080×1920
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `validateShowcasePlan`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: validate Showcase plans`

### Task 5: Project model, route meta and MCP

**Files:**
- Modify: `server/src/lib/moments/projectStore.js` (`createProject`, `applyUpdate`, `readProject` default)
- Modify: `server/src/routes/moments.js:84-95` (`/meta`)
- Modify: `server/src/mcp/momentsView.js` (`MOMENT_STYLES`, `MOMENT_LENGTHS`, `MAX_PHOTOS`, plus `MOMENT_SHAPES = ["tall","wide"]`)
- Modify: `server/src/mcp/tools/moments.js` (the update schema accepts `shape`; descriptions name Showcase styles, shapes and the 30–180 s lengths, and "at most 16" statements)
- Test: `projectStore.test.js`, the routes test for moments meta (find it with `grep -rl "/meta" server/test server/src --include=*.test.js`), and the MCP moments test that keeps the lists equal.

**Interfaces:**
- Produces:
  - `project.shape: "tall"|"wide"`. It defaults to `"tall"` on create and is filled as `"tall"` when an old stored project lacks it.
  - `/meta` adds:
    - `styles[].family`
    - `lengthsByFamily: { classic: number[], showcase: number[] }`
    - `shapes: ["tall","wide"]`
  - `lengths` keeps the union.

- [ ] **Step 1: Write the failing tests.**
  - `shape is saved for a Showcase style`: `applyUpdate({...p, style:"premiere"}, {shape:"wide"})` keeps "wide".
  - `shape is forced tall for a classic style`
  - **Review Focus 2**, `a classic style clamps length and shape`: a premiere project at 120 s wide, updated with `{style:"glow"}`, becomes 60 s tall with `ok: true`. Updating `{lengthSec:120}` on a glow project is ok and is stored as 60.
  - `a Showcase style refuses 15 s`: `{style:"fellowship", lengthSec:15}` gives `ok: false`, error "the length must be 30, 60, 90, 120 or 180 seconds".
  - `switching to a Showcase style lifts a 15 s length to 30`
  - `100 photos accepted, 101 refused`
  - `meta lists families, lengths by family and shapes`
  - The MCP lists equal `SHOWCASE_IDS`, `CLASSIC_IDS` and `LENGTHS`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the clamp.**
  - Apply style first, then length, then shape.
  - Clamp length to the nearest value in `lengthsFor(style)`, rounding down and never below that family's minimum.
  - A classic style forces shape "tall".
  - A non-classic length sent explicitly with a classic style clamps (Review Focus 2).
  - An explicit illegal length with a Showcase style is an error.
- [ ] **Step 4: Run the server suite.** Run `npm test` in `server/`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: Moments shape and per-family lengths in the project model`

### Task 6: Remotion composition `MomentShowcase`

**Files:**
- Create: `server/remotion/src/showcase/types.ts`
- Create: `server/remotion/src/showcase/MomentShowcase.tsx`
- Create: `server/remotion/src/showcase/backdrops.tsx`
- Create: `server/remotion/src/showcase/templates/*.tsx`, one per template: Single, Polaroids, Split, Grid, Swipe, Triptych, Spotlight, Filmstrip, Finale, Invite. Each takes `{ scene, shape, palette, images, frames }` and switches its layout on `shape`.
- Modify: `server/remotion/src/Root.tsx` (register `MomentShowcase` with `calculateMetadata` from `p.durationSec * p.fps`, `p.w`, `p.h`)
- Reference (port from, not imported): the scratchpad Remotion project `mh/mh-video/src/templates.tsx` (portrait) and `wideTemplates.tsx` (16:9) in this session's scratchpad folder.

**Interfaces:**
- Consumes: the plan from Task 3.
- Produces: `ShowcaseProps`:
  ```ts
  {
    fps: number; w: number; h: number; durationSec: number; shape: "tall" | "wide";
    scenes: { template: string; photos: number[]; start: number; end: number }[];
    flashes: number[]; invite: { day: number; label: string } | null;
    palette: { backdrop: "blur" | "paper" | "colour" | "dark"; card: string; accent: string; ink: string; blocks?: string[] };
    letterbox: boolean; seed: number;
    images: { card: string; blur: string }[];   // asset-server URLs, indexed like plan photo indices
    fonts: { display?: string };                // Anton URL for the calendar card
  }
  ```
- Rules:
  - Animation uses `useCurrentFrame` with `spring` / `interpolate` only. No CSS transitions.
  - Images are `<Img>`.
  - `Sequence` per scene (`from = round(start*fps)`, `durationInFrames = round(end*fps) - from`).
  - `letterbox`: black bars, 8 % of height, wide only; on tall, 6 % top and bottom.
  - `flashes`: an 8-frame cream (`palette.card`) flash at each time.
  - The composition renders no audio.

- [ ] **Step 1: Write the type check and a still render as the test.** Create `server/remotion/fixtures/showcase-sample.json`: 12 scenes covering all ten templates, 8 photos, tall. Create `showcase-sample-wide.json`, the same at wide. Point `images` at `http://127.0.0.1:0/` placeholders. The test script serves fixtures from `server/test/fixtures/` (pick any 8 existing JPGs there or in `client/public`) through `startAssetServer`.
- [ ] **Step 2: Add `server/scripts/showcase-stills.mjs`.** It bundles via `getServeUrl()`, starts the asset server, and renders one still per scene midpoint for both fixtures with `@remotion/renderer` `renderStill` into a scratch folder.
- [ ] **Step 3: Run it and see it fail.** Run `cd server && node scripts/showcase-stills.mjs`. Expected: FAIL (composition `MomentShowcase` not found).
- [ ] **Step 4: Implement the composition, backdrops and the ten templates.** Port them from the reference.
- [ ] **Step 5: Type-check and render the stills.**
  - Run `cd server/remotion && npx tsc --noEmit -p .`, or the tsconfig the bundle uses. Expected: no errors.
  - Run `node scripts/showcase-stills.mjs`. Expected: 24 PNGs written.
  - Open and inspect every still. No template may crop a whole photo on wide. Captions are not drawn here.
- [ ] **Step 6: Commit.** `feat: MomentShowcase Remotion composition and templates`

### Task 7: Showcase render (stage, picture, finish)

**Files:**
- Create: `server/src/lib/showcase/render.js`
- Modify: `server/src/lib/motion/finish.js` (`finishArgs` gains optional `encode = { crf: 19 }`. When `encode.maxrate` is set, add `-maxrate`/`-bufsize`. Classic callers keep their args.)
- Test: `server/src/lib/showcase/render.test.js`, `server/src/lib/motion/finish.test.js`

**Interfaces:**
- Consumes:
  - `orientationOf` and the rotation logic in `motion/prepare.js` (extract a shared `rotationFilters(orientation)` if it is not already exported)
  - `remotionRender`, `getServeUrl` (`render/lifecycle.js`)
  - `startAssetServer`
  - `finishArgs`, `statementsAss`, `finishProgressReader`, `runFfmpeg`, `moveInto`, `hasLibass` (`motion/render.js`)
  - `STYLES`
- Produces:
  - `stageImageArgs({ src, card, blur, orientation, shape }) → string[][]`: two ffmpeg arg lists, card and blur.
  - `finishPlanOf(plan) → { durationSec, fps, w, h, style, energy, seed, captions, shots: [{ role: "end", start: closingScene.start, overlays: [] }] }`
  - `encodeFor(durationSec) → { crf: 19 } | { crf: 21, maxrate: "8M", bufsize: "16M" }`
  - `renderShowcase({ plan, sources: string[], song, voice, workDir, out, signal, onProgress, runner = runFfmpeg, remotion = { render: remotionRender, serveUrl: getServeUrl } }) → Promise<{ ok: true, file } | { ok: false, error, detail? }>`. It has the same result shape as `renderPlan`. Progress stages are `"prepare" | "shots" | "finish"`.

- [ ] **Step 1: Write the failing tests.**
  - **Review Focus 5**, `stageImageArgs rotates EXIF 6 and 8 upright and bounds the card`: the card args contain `-noautorotate` and the transpose for 6 and for 8. The scale keeps aspect with long side 1400. Blur is 216×384 for tall and 384×216 for wide. Every filter is on `FFMPEG_51_FILTERS`.
  - `encodeFor(60)` → `{crf:19}`; `encodeFor(61)` → maxrate 8M.
  - `finishArgs` with `encode` carries `-crf 21 -maxrate 8M -bufsize 16M`. Without it, the args equal today's (snapshot the classic args).
  - `finishPlanOf` gives one end shot at the closing scene's start, and passes the captions through.
  - `renderShowcase` with fake `runner` and fake `remotion.render`:
    - calls the remotion render with `compositionId: "MomentShowcase"` and props whose `images.length === sources.length`;
    - then runs a finish whose args include the body;
    - on success moves the file to `out`;
    - a remotion throw returns `{ok:false, error:"Rendering failed at the picture."}`;
    - an aborted signal returns `{ok:false, error:"cancelled"}`;
    - the asset server is closed in every case (spy on `close`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - The Remotion body goes to `workDir/body.mp4`.
  - The asset server gets the staged images plus `Anton.ttf` from `FONT_DIR`.
  - Map Remotion progress to `onProgress({stage:"shots", fraction})`.
  - The finish reuses `finishProgressReader`.
  - Write the finish to `workDir/final.mp4`, then `moveInto(final, out)`.
  - Statements need libass, as in `renderPlan`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Check colour on a real 6 s render.** Run a scratch script calling `renderShowcase` with 6 real photos, a song and the tall fixture plan. Run `ffprobe -show_streams` on the output.
  - Expected: `color_range=tv`, `color_space=bt470bg`, as the classic output.
  - If Remotion's body is bt709, add a 5.1-safe `colorspace=all=bt470bg:iall=bt709:range=tv` (or `scale=out_color_matrix=bt601`) in front of the grade for Showcase only. Pin it with a test.
- [ ] **Step 6: Commit.** `feat: render Showcase Moments with Remotion and the shared finish`

### Task 8: Render stage branch

**Files:**
- Modify: `server/src/lib/moments/renderStage.js`
- Test: `server/src/lib/moments/renderStage.test.js`

**Interfaces:**
- Consumes: `isShowcase`, `lengthsFor`, `directShowcase`, `validateShowcasePlan`, `renderShowcase`.
- Produces:
  - `_setEngineForTest({ renderShowcase })` is supported.
  - `SHOWCASE_STAGES = { prepare:[0,10], analyse:[10,20], shots:[20,80], finish:[80,100] }`, used by `progressWriter` when the project is Showcase.

- [ ] **Step 1: Write the failing tests.** Follow the existing fakes in `renderStage.test.js`.
  - `a Showcase project renders with renderShowcase`: the injected fake receives a plan with `kind: "showcase"`, and `renderPlan` is not called.
  - `a classic project still renders with renderPlan`
  - `Showcase photos are staged as card and blur`: the fake `runFfmpeg` sees two runs per photo.
  - **Review Focus 1**, `a song shorter than the length shortens the Moment`: a fake decode gives a 150 s song with lengthSec 180. The plan has `durationSec === 150`, and notes include "Your song is 150 s, so this Moment is 150 s."
  - `dropped photos note offers the next Showcase length`
  - `a cancelled Showcase render records Cancelled and removes the work folder`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the branch.**
  - After `resolveSound`, Showcase projects stage photos with `stageImageArgs` instead of `workImageArgs`. Extract a `prepareShowcasePhotos`; keep the skip notes and the "Need at least 3" rule.
  - In `timing`, read the song's `durationSec` from `songGrid`. If it is below `lengthSec` for a Showcase project, use `floor(durationSec)` as the length and add the note.
  - Then run `directShowcase` → `validateShowcasePlan` → `engine.renderShowcase`.
  - `recordDone` is unchanged.
- [ ] **Step 4: Run `npm test` in `server/`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: Moments render stage runs Showcase styles`

### Task 9: Client Style step, types and result

**Files:**
- Modify: `client/src/lib/momentsTypes.ts`:
  - `MomentStyle` union adds `'fellowship' | 'scrapbook' | 'partyPop' | 'premiere'`
  - `MomentShape = 'tall' | 'wide'`
  - `MomentProject.shape?: MomentShape`
  - `MomentPatch.shape?`
  - `MomentMeta.styles[].family?: 'classic' | 'showcase'`
  - `MomentMeta.lengthsByFamily?`
  - `MomentMeta.shapes?`
- Modify: `client/src/components/moments/MomentsStyleStep.tsx`
- Modify: `client/src/components/moments/MomentsResult.tsx` (player `aspect-video` when `project.shape === 'wide'`)
- Test: `client/src/components/moments/__tests__/MomentsStyleStep.test.tsx`, `MomentsResult.test.tsx`

**Interfaces:**
- Consumes: the `/meta` additions from Task 5. When they are missing (old cached meta), behave exactly as today.

- [ ] **Step 1: Write the failing tests.**
  - `Showcase styles sit under their own heading`: the heading text is "Showcase · many photos at once" and it is followed by the four Showcase cards.
  - `Shape shows only for a Showcase style`: there is a group labelled "Shape" with buttons "Portrait 9:16" and "Widescreen 16:9" when `project.style` is premiere, and none for glow.
  - `picking Widescreen saves shape wide`: `momentsApi.update` is called with `{ shape: 'wide' }`.
  - `Length lists the picked family's lengths`: glow shows 15 / 30 / 60 s; premiere shows 30 / 60 / 90 / 120 / 180 s.
  - `picking a classic style from a long wide Showcase project saves the clamp in one patch`: from premiere / 120 / wide, clicking Glow sends `{ style:'glow', energy: 0.2, lengthSec: 60, shape: 'tall' }`.
  - `Result plays widescreen in a 16:9 frame`
- [ ] **Step 2: Run them and see them fail.** Run `cd client && npx vitest run src/components/moments`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Wide previews use the same `object-cover` 9:16 card, since previews are portrait.
  - The Shape control sits in the same row style as Length, using `segmentedCls` / `segmentCls`.
- [ ] **Step 4: Run the client checks.**
  - Run `cd client && npx vitest run src/components/moments && npm run build`. Expected: PASS, and `tsc -b` is clean.
- [ ] **Step 5: Commit.** `feat: Showcase styles, shape and long lengths in the Moments Style step`

### Task 10: Previews for the four Showcase styles

**Files:**
- Modify: `server/scripts/make-moment-previews.mjs`
- Create (generated): `client/public/moments/previews/{fellowship,scrapbook,partyPop,premiere}.mp4` and the same four in `server/public/moments/previews/`.

**Interfaces:**
- Consumes: `directShowcase`, the Remotion bundle, and `startAssetServer`.

- [ ] **Step 1: Extend the script.**
  - For Showcase ids, build a plan from its synthetic stills (≥ 12 photos), period 0.6, about 8 s, tall.
  - Render with `remotionRender` at `scale` 1/3 (360×640).
  - Then run ffmpeg `-crf 30 -an`.
  - The four classic previews must not be regenerated; add a `--only <ids>` flag.
- [ ] **Step 2: Generate the previews.** Run `cd server && node scripts/make-moment-previews.mjs --only fellowship,scrapbook,partyPop,premiere`. Expected: four files, each ≤ 600 KB. Check with `ls -l`.
- [ ] **Step 3: Check them.** Watch each preview (extract a contact sheet with ffmpeg `tile`) and confirm each style reads as distinct.
- [ ] **Step 4: Commit.** `chore: Showcase style previews`

### Task 11: End-to-end check in the app

- [ ] **Step 1: Run the full suites.** Run `cd server && npm test`, then `cd client && npx vitest run && npm run build`. Expected: all PASS.
- [ ] **Step 2: Render real Moments in the local stack.** Use the local stack (pm2 per project memory, or `npm run dev` in the worktree on spare ports). Create a Moment with 40 photos from `C:\Users\segun\OneDrive\biblefuel-images\menshangout`, the song "Jesu Daddy Mi", and the date "21 November". Render:
  - Fellowship at 60 s tall
  - Premiere at 60 s wide
  - Scrapbook at 30 s
  - Party pop at 30 s
- [ ] **Step 3: Check each output.**
  - Check frames: extract 1 fps contact sheets.
  - Check loudness: ebur128 ≈ −14 LUFS.
  - Check for black frames with `blackdetect`.
  - Check duration with `ffprobe` (equals the length).
  - Check the invite card appears with "NOV" and "21".
- [ ] **Step 4: Check the Style step in the browser preview.** Check the heading, Shape, Length lists and the clamp. Take a screenshot.
- [ ] **Step 5: Run the code review agents** (code-reviewer, typescript-reviewer, security-reviewer for the asset server and route changes). Fix CRITICAL and HIGH findings, then commit.
- [ ] **Step 6: Stop and ask the operator before push or PR.** The PR body carries `Closes #133`. After the PR, wait for Codex and triage it per the git-workflow rule.
