# Kinetic Captions Step 4: Timeline Editor and Ambient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio effects captions (the libass kinetic engine) render in the Timeline editor's project render and in Ambient scripture videos. Both pickers offer a Studio look with Energy and Shuffle, and the Timeline live preview shows a "Studio effects appear in the render" badge.

**Architecture:** Both renderers already have timed lines: Timeline caption clips (`startSec`, `durationSec`, `text`) and Ambient verse pages (from `captionPages`/`pageWindows`). They go to the engine as `lines: [{ text, start, end }]` through `studioCaptionFilter`, which `phrasesFrom` honours. Do NOT use `prepareStudioCaptions`'s `lines`, because that path ignores line timings.
- **Timeline.** It follows the Story pattern. The pure `buildProofRenderCommand` returns `sideFiles`. `renderTimelineProof` writes them, and on a write failure rebuilds with the look's `fallbackPreset`, then removes the `.ass` after ffmpeg exits.
- **Ambient.** `buildAmbientFfmpegArgs` already writes caption text files into its `workDir`, so it writes `captions.ass` there directly. On failure it falls back to today's serif drawtext.

**Tech Stack:** Node 24 ESM, Express, node:test, supertest, ffmpeg + libass; React 18 + TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-kinetic-caption-engine-design.md`. The relevant sections are "Wiring (piece 2)" (the Timeline and Ambient rows, the per-project settings and the preview paragraph), "Prod constraints", "Errors" and "Build order" step 4.

## Global Constraints

- **Workspace.** Worktree `C:\Users\segun\source\repos\bf-kinetic`, branch `feat/kinetic-captions-step4`. Never push. Never use `--no-verify`.
- **Prod.** Prod runs ffmpeg 5.1.9 (Debian bookworm). The `ass` filter string comes only from `studioCaptionFilter`, which already escapes Windows drive colons.
- **Fallback.** "If `hasLibass()` is false, every Studio look renders with its `fallbackPreset` (an existing drawtext preset). The render never fails because of the engine." For Ambient, which has no presets, the fallback is today's serif caption, unchanged.
- **Default energy.** "Timeline editor render … calm"; "Ambient scripture video … calm". Unknown values normalise to the defaults (`resolveEnergy`, `normaliseSeed` in `server/src/lib/kinetic/`).
- **No regressions.** Non-Studio presets, and Ambient with no Studio look, must render exactly as before. Existing drawtext tests stay green unchanged.
- **Escaping.** Caption text reaches ASS only through `buildAss`/`studioCaptionFilter`. Never build ASS text anywhere else.
- **Logging.** A failure to write the `.ass` file logs `[CAPTIONS] studio fallback: <reason>` and renders the fallback.
- **Server tests.** Run from `server/`:
  - focused: `node --test <file>`;
  - kinetic: `node --test src/lib/kinetic/*.test.js src/lib/kinetic/effects/*.test.js` (a bare directory argument fails on Node 24);
  - full suite: `npm test`.
  - Tests that need real ffmpeg/libass must skip cleanly when either is missing (see `test/routes/studioCaptionRenders.test.js`).
  - Force the capability in pure tests with `_setLibassForTest(true|false)` from `server/src/lib/kinetic/capability.js`, and reset it with `_setLibassForTest(undefined)` in `t.after`/`afterEach`.
- **Client tests.** Run from `client/`: `npx vitest run <path>`; types `npx tsc -b`; build `npm run build`. The build regenerates `server/public`; that is committed last, separately, as `chore: rebuild client bundle`.
- **Commits.** Run `git add` and `git commit` as separate commands. The message format is `<type>: <description>`, and the message ends with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If a hook blocks a multi-line `-m`, write the message to a file in `C:\Users\segun\AppData\Local\Temp\claude\C--Users-segun-source-repos-biblefuel-studio\3d3b577d-3d38-4be5-aad7-37ffbbcb0f5d\scratchpad\` and use `git commit -F <file>`.
- **Tooling.** Use the Write/Edit tools for source changes. Do not dispatch subagents. Leave untracked `server/filter-bed.m4a.txt` alone.

## File Structure

| File | Responsibility |
|---|---|
| `server/src/lib/timelineRender/proofRenderer.js` | `buildProofRenderCommand`: a Studio branch that returns `sideFiles`. `renderTimelineProof`: write the side files, fall back, clean up |
| `server/src/routes/timeline.js` | stop mapping Studio looks to the fallback; carry `captionEnergy`/`captionSeed` from the body (or `renderSettings`) into the job |
| `client/src/lib/api.ts` | `timelineApi.render` accepts `{ captionEnergy, captionSeed }` |
| `client/src/pages/TimelinePage.tsx` | send energy and seed for Studio looks |
| `client/src/components/timeline/LivePreviewStage.tsx` (+ `CaptionPreview.tsx` if needed) | plain text and the badge for Studio looks |
| `server/src/lib/ambient/ambientRender.js` | Studio branch in the caption step: pages become ASS lines; reference line; fallback |
| `server/src/lib/ambient/stages.js` | only if needed to pass the project id or seed or clean up `captions.ass` |
| `client/src/components/ambient/AmbientCaptionsPanel.tsx` | "Caption look" choice (Classic serif + Studio looks), Energy, Shuffle, unavailable state |
| `client/src/components/ambient/AmbientLookStep.tsx`, `client/src/lib/ambientApi.ts`, `client/src/lib/ambientTypes.ts` | widen the patch type so the look, energy and seed save through `PATCH /api/ambient/:id/captions` |

---

### Task 1: Timeline render draws Studio looks (server)

**Files:**
- Modify: `server/src/lib/timelineRender/proofRenderer.js` (caption block ~:364-406; `renderTimelineProof` ~:526-544)
- Modify: `server/src/routes/timeline.js` (~:376-391 job creation; `runTimelineJob` ~:150-185)
- Test: `server/src/lib/timelineRender/proofRenderer.test.js`, `server/src/routes/timeline.test.js`, plus one real-ffmpeg test (new file `server/test/routes/timelineStudioRender.test.js`, or inside an existing real-render test file)

**Interfaces:**
- Consumes:
  - `studioCaptionFilter({ assPath, lines, w, h, look, energy, seed })` returns `{ filter, sideFiles: [{ path, text }] }`; `filter === ""` when there is nothing to caption.
  - `isStudioLook(id)`, `resolveLook(id).fallbackPreset`, `resolveEnergy(id, fallback)`, `hasLibass()` from `server/src/lib/kinetic/`.
  - `normaliseSeed(seed)` from `kinetic/renderCaptions.js`.
- Produces:
  - `buildProofRenderCommand(plan, opts)` accepts `opts.captionEnergy` and `opts.captionSeed`. When it takes the Studio branch, its result gains `sideFiles: [{ path, text }]`. The field is always present (`[]` otherwise).
  - `renderTimelineProof` accepts the same two options.

**Behaviour:**
1. **When the Studio branch runs.** In `buildProofRenderCommand`, when `isStudioLook(opts.typographyPreset)` and `hasLibass()`, and there are caption clips:
   - Build `lines = captions.map(c => ({ text: <clip text, sliced to MAX_CAPTION_CHARS, NOT upper-cased>, start: c.startSec, end: c.startSec + c.durationSec }))`.
   - Put `assPath` beside the output: `path.join(path.dirname(outputPath), \`captions-${path.basename(outputPath, '.mp4')}.ass\`)`.
   - Call `studioCaptionFilter({ assPath, lines, w, h, look: opts.typographyPreset, energy: resolveEnergy(opts.captionEnergy, 'calm'), seed: normaliseSeed(opts.captionSeed) })`.
   - If `filter` is non-empty, push `` `${videoLabel}${filter}[vtxt]` `` (the same label as the drawtext path) and return its `sideFiles`. The drawtext builders are not called.
   - Seed: `normaliseSeed` returns a random seed for a missing value. That is acceptable here, because the client always sends one (Task 2).
2. **Fallback presets.** A Studio look with `hasLibass()` false draws with drawtext using `resolveLook(id).fallbackPreset`, through the existing path. Every value that came from the Studio id (style, `uppercase`, motion) must come from the fallback preset.
3. **Writing and cleanup.** `renderTimelineProof` does the following:
   - It writes each side file (`fs.writeFileSync(f.path, f.text, 'utf8')`) after creating the output dir and before running ffmpeg.
   - If the write throws, it logs `[CAPTIONS] studio fallback: <message>` and rebuilds the command with `typographyPreset: resolveLook(id).fallbackPreset`.
   - After the runner settles (success or failure), it removes the side files (best effort). Use `try/finally` around the runner call.
4. **Route.** In `timeline.js`:
   - Pass `typographyPreset` through unmapped: the body's string, else `project.renderSettings.typographyPreset`, else null. Remove the `drawtextPresetFor` mapping and its "until step 4" comment.
   - Read `captionEnergy` (string) and `captionSeed` (number) from the body, falling back to `project.renderSettings`.
   - Store them on the job and forward them through `runTimelineJob` into `renderTimelineProof`.
   - Remove the `drawtextPresetFor` import if it becomes unused.
5. **Graph.** Keep the inline `-filter_complex`. The `ass=` filter is short. Switching to a script file is out of scope.

**Tests (write first, watch them fail):**
- **Pure, `_setLibassForTest(true)`.** A plan with two caption clips and `typographyPreset: 'studio-lagos-night'`:
  - The `-filter_complex` value contains `ass=filename='…captions-<base>.ass':fontsdir=` and no `drawtext`.
  - `cmd.sideFiles` has one entry with that path.
  - Its `text` has `Dialogue:` events whose start times match the clips (e.g. `0:00:01.00` for a clip at 1 s).
  - `captionEnergy: 'wild'` changes the ASS text against `'calm'` with the same seed.
  - Same seed gives identical text.
- **Pure, `_setLibassForTest(false)`.** With the same Studio id, the filter contains `drawtext` and equals the output of a direct `typographyPreset: <fallbackPreset>` build. `sideFiles` is `[]`.
- **Non-Studio regression.** A non-Studio preset build is byte-identical before and after. Assert `sideFiles` is `[]` and that the existing caption tests still pass unchanged.
- **`renderTimelineProof` with a fake `runner`.** The `.ass` exists while the runner runs, and is gone after.
- **Write failure.** Force it by passing an `outputPath` whose directory is a FILE, or by stubbing `fs.writeFileSync` with `mock.method`. The runner gets drawtext args and the warning is logged.
- **Route (supertest + `_setTimelineRendererForTest`).** A body with `typographyPreset: 'studio-gospel-gold', captionEnergy: 'wild', captionSeed: 42` reaches the renderer with those exact values; the preset is NOT mapped to the fallback.
- **Real ffmpeg.** Skip without ffmpeg or libass. Render a 2 s, 1280×720 timeline plan with one white caption clip from 0.2 s to 1.8 s over a black or colour-placeholder background, using `studio-clean-white`. Then:
  - assert the output exists;
  - sample a frame at 1.0 s and assert more than 300 near-white pixels;
  - sample a frame at 0.05 s and assert it is clean (fewer than 20 near-white pixels);
  - assert no `.ass` is left in the output dir.

  Reuse the frame-sampling helper pattern from `test/routes/studioCaptionRenders.test.js`.

**Steps:**
- [ ] Write the pure tests and run them: `node --test src/lib/timelineRender/proofRenderer.test.js`. They should FAIL.
- [ ] Implement the Studio branch in `buildProofRenderCommand`, then run the tests: PASS.
- [ ] Write the `renderTimelineProof` side-file, fallback and cleanup tests: FAIL. Implement: PASS.
- [ ] Write the route test: FAIL. Implement the route change: PASS.
- [ ] Write the real-ffmpeg test, then run it. It must PASS, or SKIP where there is no libass. Note in the report which one happened.
- [ ] Run the full server `npm test`. Commit as `feat: Timeline renders draw Studio effects captions`.

---

### Task 2: Timeline client sends energy and seed; live preview badge

**Files:**
- Modify: `client/src/lib/api.ts:455-456` (`timelineApi.render`)
- Modify: `client/src/pages/TimelinePage.tsx` (`handleRenderDocumentaryTimeline` ~:1308-1340; the `LivePreviewStage` props ~:2916)
- Modify: `client/src/components/timeline/LivePreviewStage.tsx` (~:184-205), and `CaptionPreview.tsx` only if needed
- Test: a new `client/src/lib/__tests__/timelineApi.test.ts`; `client/src/components/timeline/__tests__/LivePreviewStage.test.tsx` (create it if missing) and/or `CaptionPreview.test.tsx`

**Interfaces:**
- Consumes:
  - the Task 1 route body fields `captionEnergy`, `captionSeed`;
  - `isStudioLook` from `client/src/lib/studioCaptions.ts`;
  - TimelinePage's existing `captionEnergy`/`captionSeed` state (~:350-354).
- Produces: `timelineApi.render(project, quality?, typographyPreset?, studio?: { captionEnergy?: string; captionSeed?: number })`. The `studio` fields are spread into the POST body only when given.

**Behaviour:**
1. **Render call.** `handleRenderDocumentaryTimeline` passes `{ captionEnergy, captionSeed }` only when `isStudioLook(typographyPreset)`. A non-Studio render sends the same body as today, with no extra keys.
2. **Live preview.** For a Studio look, the preview draws the plain caption text, using the look's readable fallback (see `client/src/lib/studioCaptions.ts`, which may already map ids to fallbacks; reuse it rather than duplicating). It also shows a small badge reading exactly `Studio effects appear in the render`, next to the existing "Live preview · approximate…" note. No badge for non-Studio looks.

**Tests (first):**
- `timelineApi.render` with a `studio` argument posts `{ project, quality, typographyPreset, captionEnergy, captionSeed }`. Without it, the body has no `captionEnergy` or `captionSeed` keys. Spy on `api.post`, as `storyApi.test.ts` does.
- The preview with `preset: 'studio-lagos-night'` shows the caption text and the badge.
- With `'cinematic-worship'` there is no badge.
- If testing TimelinePage itself is impractical (it has no test today), keep the page change minimal and cover it through the api test. Say so in the report.

**Steps:**
- [ ] Write the tests: FAIL. Implement: PASS.
- [ ] Run `npx vitest run src/components/timeline src/lib src/pages`, then `npx tsc -b`.
- [ ] Commit as `feat: Timeline sends Studio energy and seed, and the live preview flags Studio effects`.

---

### Task 3: Ambient render draws Studio looks (server)

**Files:**
- Modify: `server/src/lib/ambient/ambientRender.js` (`captionFilters` ~:132-194; the caption step in `buildAmbientFfmpegArgs` ~:268-275)
- Modify: `server/src/lib/ambient/stages.js` (~:500-609) only if needed to clean up `captions.ass`
- Test: `server/src/lib/ambient/ambientRender.test.js`; a real-ffmpeg Ambient Studio test, skipped without libass

**Interfaces:**
- Consumes:
  - the project fields `captionPreset`, `captionEnergy`, `captionSeed`, which Ambient already stores through `normaliseCaptionSettings`;
  - `captions`, `captionSpan`, `captionPosition`;
  - `studioCaptionFilter`, `isStudioLook`, `resolveEnergy`, `hasLibass`.
- Produces: `buildAmbientFfmpegArgs(...)` keeps its signature and return `{ args, filter, scriptFile }`.

**Behaviour:**
1. **The Studio branch.** When captions are on and `isStudioLook(project.captionPreset)` and `hasLibass()` and there is a `workDir`:
   - Build `lines` from the SAME pages and windows the drawtext path uses (`captionWindow`, `captionPages`/`balanceLines`, `pageWindows`). Each page becomes `{ text: <page text, lines joined with a space>, start, end }` in seconds.
   - Factor the page and window computation into a small helper that both paths share, so the timings cannot drift.
   - Write the file with `studioCaptionFilter({ assPath: path.join(workDir, 'captions.ass'), lines, w, h, look, energy: resolveEnergy(project.captionEnergy, 'calm'), seed })` and `fs.writeFileSync` the side file.
   - Use its `filter` in place of the drawtext chain: `` `${captionIn}${filter}[vout]` ``.
   - The file name is fixed, so the AMF-then-CPU double build rewrites the same file (idempotent).
2. **Seed.** Use `project.captionSeed` when it is an integer. Otherwise derive a stable seed from `project.projectId` (e.g. a small string hash masked to 31 bits), so that re-renders of an old project don't reshuffle. Never fall back to a random seed here.
3. **Reference line.** In section span the drawtext path draws a reference line (`referenceLine(drop, project)`). Under Studio, keep it as a drawtext line: the same font, size and fade, centred near the bottom of the frame and inside the safe area (9:16: above the bottom 18%), shown in the same window as its pages. It is chained after the `ass` filter: `` `${captionIn}${assFilter},${referenceDrawtexts}[vout]` ``. In spoken span there is no reference line, as today.
4. **Position.** `captionPosition` (`lower`/`centre`) is a drawtext concept. The director places Studio phrases itself, so ignore it under Studio. Note that in the code with a short comment.
5. **Fallback.** If `hasLibass()` is false, or the write throws, use today's serif drawtext path unchanged, logging `[CAPTIONS] studio fallback: <reason>` on a write failure.
6. **Cleanup.** `captions.ass` sits in the project's render dir next to the existing `caption-*.txt` files, which are not cleaned up today. Leave it there. The file is rewritten on every render and is a few KB, so cleanup is not required.

**Tests (first):**
- **Pure, `_setLibassForTest(true)`.** A section-span project with one voiced drop and `captionPreset: 'studio-gospel-gold'`:
  - the `filter` contains `ass=filename='…captions.ass'` and no `textfile='…caption-`;
  - `captions.ass` exists in `workDir`, and its first `Dialogue:` start equals the first page window start;
  - the reference line drawtext is present (non-KJV adds `· TRANSLATION`).
- **Spoken span.** No reference drawtext.
- **Fallback.** `_setLibassForTest(false)` with the same project gives a filter identical to the same project with `captionPreset: 'default'`.
- **No regressions.** The existing caption tests pass unchanged. `captions: 'none'` gives no `ass=`.
- **Seed.** No `captionSeed` and the same `projectId` give identical `captions.ass` text across two builds. A different `captionSeed` gives different text.
- **Real ffmpeg (skip without libass).** Build args for a 3 s portrait (1080×1920) project:
  - one drop, section span, `studio-clean-white`, over a solid-colour image;
  - run ffmpeg;
  - assert near-white pixels in a frame inside the window, and a clean frame before it.

**Steps:**
- [ ] Write the pure tests: FAIL. Implement the shared page helper and the Studio branch: PASS. The existing ambient tests stay green.
- [ ] Write the real-ffmpeg test: PASS or SKIP (say which in the report).
- [ ] Run the full server `npm test`. Commit as `feat: Ambient scripture videos draw Studio effects captions`.

---

### Task 4: Ambient caption look picker (client)

**Files:**
- Modify: `client/src/components/ambient/AmbientCaptionsPanel.tsx`
- Modify: `client/src/components/ambient/AmbientLookStep.tsx` (~:41-48, :90), `client/src/lib/ambientApi.ts` (~:143-151 `setScriptureDisplay` / `AmbientScripturePatch`), `client/src/lib/ambientTypes.ts` if needed
- Test: `client/src/components/ambient/__tests__/AmbientCaptionsPanel.test.tsx`, `AmbientLookStep.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/tts/animations`, which returns `{ studioLooks, energies, libass }` (see how `StoryCaptionsPanel.tsx:88-205` loads it);
  - `StudioLookOptions`/`StudioEffectsControls` from `client/src/components/captions/StudioEffects.tsx`;
  - `isStudioLook`, `nextSeed` from `client/src/lib/studioCaptions.ts`;
  - the server `PATCH /api/ambient/:id/captions`, which already accepts `captionPreset`, `captionEnergy`, `captionSeed` via `normaliseCaptionSettings`.
- Produces: `AmbientScripturePatch` gains the optional `captionPreset?: string; captionEnergy?: string; captionSeed?: number`.

**Behaviour:**
1. **Caption look.** When captions are on (not Off), the panel shows a **Caption look** select:
   - first option `Classic serif` (value `default`);
   - then the Studio looks group, from the catalogue, via `StudioLookOptions`.

   The value is `isStudioLook(project.captionPreset) ? project.captionPreset : 'default'`. Any non-Studio stored preset shows as Classic serif, because the Ambient renderer ignores those.
2. **Studio controls.** With a Studio look selected, show `StudioEffectsControls`:
   - its sample clip;
   - Energy, defaulting to `calm` when unset;
   - Shuffle, which sends `captionSeed: nextSeed(project.captionSeed)`.

   Hide Position, because Studio ignores it. Keep "Scripture on screen" (span).
3. **No libass.** When the catalogue says `libass: false`, the Studio options are disabled and the controls show the existing "Studio effects unavailable on this server" state. Reuse the shared component's `unavailable` prop.
4. **Saving.**
   - Choosing a look sends `{ captionPreset }`. On the FIRST switch to a Studio look when `captionSeed` is unset, it also sends a seed: use `randomSeed()` from `studioCaptions.ts`.
   - Energy sends `{ captionEnergy }`.
   - Everything goes through the existing `onChange`, then `setScriptureDisplay`, then `PATCH /captions`.
   - Widen the patch type rather than adding a second save path.
5. **Busy.** While `busy`, every new control is disabled, like the existing ones.

**Tests (first):**
- With captions on, the panel shows Caption look with Classic serif selected for `captionPreset: 'default'` and for an unknown preset.
- Choosing `studio-lagos-night` calls `onChange` with `captionPreset: 'studio-lagos-night'` and a numeric `captionSeed` when none was set.
- With a Studio look, Energy and Shuffle appear and Position is hidden. Shuffle sends a different seed.
- With `libass: false`, the unavailable state shows.
- With captions Off, no Caption look control.
- `AmbientLookStep` forwards the widened patch to `ambientApi.setScriptureDisplay`.

**Steps:**
- [ ] Write the tests: FAIL. Implement: PASS.
- [ ] Run `npx vitest run src/components/ambient src/lib src/pages`, `npx tsc -b`, then `npm run build`.
- [ ] Commit the feature as `feat: Ambient offers Studio caption looks with Energy and Shuffle`.
- [ ] Commit the rebuilt `server/public` separately as `chore: rebuild client bundle`.
