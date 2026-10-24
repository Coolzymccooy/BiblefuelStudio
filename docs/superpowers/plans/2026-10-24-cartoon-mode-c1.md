# Cartoon mode C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can make a talking Bible cartoon (at most 40 s), with characters speaking their lines on screen. They pick Cartoon in Scene script, then take the script (pasted, written by BibleFuel, or from an example) through cast, style, storyboard and film to a finished video.

**Architecture:**
- **Separate engine, shared building blocks.** Cartoon mode is its own server module (`server/src/lib/cartoon/`), with its own store (`DATA_DIR/cartoons/`) and router (`/api/cartoon`). Human mode's line/voice/timeline model does not fit dialogue clips, so the two stay apart.
- **What it reuses:** the project-store code (made generic), the Seedance provider (new options), the spend ledger, the visual library, music beds, the Remotion bundle and asset server, the loudness finish, and the YouTube publish panel.
- **Client:** a new Cartoon journey under the Scene script page.

**Tech Stack:** Node 24 ESM + Express 4, `node:test`; React 18 + TypeScript + Vite, Vitest; Remotion 4; ffmpeg; BytePlus Seedance 2.0 Mini; Gemini 2.5 Flash Image; OpenAI gpt-4o-transcribe.

**Spec:** `docs/superpowers/specs/2026-10-24-cartoon-mode-design.md`. Read it first; this plan argues from it. Section numbers below (§) refer to it.

**Worktree:** `C:\Users\segun\source\repos\bf-scene-script`, branch `feat/cartoon-mode`, created from `docs/cartoon-mode`. Server tests run with `cd server && node --test <file>`; client tests run with `cd client && npx vitest run <file>`.

## Global Constraints

- Admins only: mount with `requireAuth, withUserScope, requireVerifiedEmail, requireSuperAdmin`, exactly like `/api/scene-script` (`server/index.js:469`).
- The finished film is ≤ **40 s**, including the verse card (**2.5 s**) and the end card (**3 s**). The story therefore gets ≤ 34.5 s.
- A film has ≤ **8 shots**. Each shot is **4–12 s**. Speaking rate is **2.5 words/s**, plus a **1.0 s** breath, rounded up (§7.6, my call; the C0 results may adjust the rate).
- Seedance: model `SEEDANCE_MODELS.mini`, `720p`, `generate_audio: true`. Every prompt ends with `No background music.` plus `NO_TEXT_LINE`.
- The word "Pixar" never appears in UI copy, prompts, titles or post text. A test enforces this.
- Every paid clip goes through `reserveSpend` / `settleSpend` / `releaseSpend` with the key `cartoon:<projectId>:<shotId>`. The whole remaining film must pass `wouldExceedCap` before any order (§7.6).
- The $10 benchmark (`benchmarkUsd()` in `sceneScript/shotStage.js`) needs `confirmOverBenchmark: true` above it.
- Paid clips are never deleted: a re-make adds a new clip to the visual library (`source.kind: "cartoon"`).
- Cartoon shots never fall back to text-only after a person refusal (§7.6).
- Verbatim: a saved script's spoken lines are sent exactly as written.
- In BibleFuel-written scripts and examples, Jesus speaks only words found in the fetched verse text (§7.2).
- The UI follows `~/.claude/standards/DESIGN_QUALITY_STANDARD.md` and the existing Scene script components' tokens: no new button styles, sentence-case labels, labelled icon buttons, and tabular numerals for seconds and dollars.
- Write regex and backslash-heavy code with the Write/Edit tools, never with bash heredocs.
- Never commit a client bundle (`client/dist`) or `server/filter-bed.m4a.txt`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## C0 results (fill in before Task 4; the prompt template depends on them)

> Recorded from `scratchpad/c0` on 2026-10-24: voice consistency across 4 chained shots; whether `reference_image` is accepted; whether a fixed `seed` is accepted; whether two speakers work in one shot; whether Seedance adds music; the measured speaking rate. Task 4's template and Task 7's options follow these.

## Review Focus

1. **Pasted scripts from Word or phones.** Curly quotes (“ ” ‘ ’), CRLF line endings, no quotes at all around a line, and a speaker written in another case ("ELI:") must all parse. Owner: Task 2.
2. **A speaker missing from the Cast list.** The character is added with an empty look, and a warning says so. Portraits are blocked until a look is filled. It never crashes and the line is never dropped. Owner: Task 3.
3. **A restart mid-film.** Shots ordered before the restart are collected without paying again. Queued shots that were never ordered fail with "order again", and chained shots waiting on them stay waiting rather than ordering from a stale frame. Owner: Task 10.
4. **Editing the script after clips exist.** Once any clip has been ordered, line text is locked (409 `LOCKED`). "Start over" re-parses into a new project; the clips stay in the library. Owner: Task 12.
5. **Double clicks and parallel orders.** A second film order while one runs returns 409 `RUNNING`, and the cap check counts open reservations. Owner: Tasks 10 and 12.

---

### Task 1: Generic project store and the cartoon store

**Files:**
- Modify: `server/src/lib/sceneScript/projectStore.js`
- Create: `server/src/lib/cartoon/store.js`
- Test: `server/src/lib/cartoon/store.test.js`

**Interfaces:**
- Produces: `createProjectStore(dir: string) -> { isProjectId, readProject, writeProject, updateProject, createProject, listProjects, deleteProject, projectOutputDir, projectOutputUrl }`, with the same behaviour as today's exports, parameterised by folder.
- `projectStore.js` keeps its current named exports, bound to `"scene-scripts"`, so no Human-mode caller changes.
- `cartoon/store.js` exports the same names bound to `"cartoons"`.
- `listProjects` in the cartoon store returns `{ id, title, updatedAt, renderStatus, mode: "cartoon" }`.

- [ ] **Step 1: Write the failing test.** Test `"cartoon projects live in cartoons/ and never show in scene-scripts/"`:
  - create a cartoon in a temp dataDir;
  - assert `fs.existsSync(path.join(dir, "cartoons", id + ".json"))`;
  - assert Human `listProjects(dir)` is `[]`;
  - assert cartoon `listProjects(dir)[0].mode === "cartoon"`;
  - assert `projectOutputUrl(id, "a b.mp4") === "/outputs/cartoons/" + id + "/a%20b.mp4"`.
- [ ] **Step 2:** Run `node --test src/lib/cartoon/store.test.js`. Expect FAIL (module not found).
- [ ] **Step 3:** Refactor `projectStore.js` into `createProjectStore(dir)` and re-export the bound functions. Write `cartoon/store.js`.
- [ ] **Step 4:** Run the new test plus `node --test src/lib/sceneScript/*.test.js src/routes/sceneScript.test.js`. Expect all PASS.
- [ ] **Step 5:** Commit: `refactor: project store shared by scene scripts and cartoons`.

### Task 2: Cartoon script parser

**Files:**
- Create: `server/src/lib/cartoon/parse.js`
- Test: `server/src/lib/cartoon/parse.test.js`

**Interfaces:**
- Produces: `parseCartoonScript(markdown: string) -> { title: string, verse: string, style: string|null, cast: {name, look, voice}[], scenes: {id, place, note, beats: ({kind:"line", speaker, text, lineNo} | {kind:"action", text, lineNo})[]}[], ignored: {lineNo, text}[], warnings: string[] }`.
- `MAX_SCRIPT_CHARS = 8000`.

The format is §7.2. The rules:
- `# Title`.
- `Verse:` and `Style:` are matched case-insensitively.
- `Cast:` is followed by `- Name: look. Voice: voice note.` (the voice is split off at the last `Voice:`).
- `Scene: place, note` (the text before the first comma is the place; the rest is the note).
- `Name: "line"`, with straight or curly quotes, or none.
- `(action)` is an action.
- Blank lines are skipped. Anything else goes to `ignored`.
- A line before any `Scene:` opens an implicit scene `{place: "", note: ""}`.
- Speaker names are matched to cast names case-insensitively and stored in the cast spelling.
- Scene ids are `s1`, `s2`, and so on.

- [ ] **Step 1: Write the failing tests.**
  - `"reads the Lost Lamb sample"`: the §7.2 sample gives 2 cast, 2 scenes and beats `[line Eli, action, line Pip, line Eli]`. `Eli`'s voice is `"bright and eager"`.
  - `"accepts curly quotes, CRLF, no quotes and ELI:"`: each gives the text `Pip? Pip, where are you?`.
  - `"keeps unknown lines in ignored with their line numbers"`.
  - `"a line before any Scene: opens an implicit scene"`.
  - `"an unknown speaker is kept and warned about"`: the warnings include `'"Moses" speaks but is not in the Cast list.'`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement `parseCartoonScript`. It is a pure, line-by-line state machine with no LLM.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon script parser`.

### Task 3: Shot planner, length rules and the project model

**Files:**
- Create: `server/src/lib/cartoon/plan.js`, `server/src/lib/cartoon/model.js`
- Test: `server/src/lib/cartoon/plan.test.js`, `server/src/lib/cartoon/model.test.js`

**Interfaces:**
- Consumes: `parseCartoonScript` (Task 2); `estimateTokens`, `usdForTokens` from `videoGen/spend.js`; `SEEDANCE_MODELS`.
- Produces from `plan.js`:
  - constants `WORDS_PER_SEC = 2.5`, `BREATH_SEC = 1`, `SILENT_SHOT_SEC = 4`, `VERSE_CARD_SEC = 2.5`, `END_CARD_SEC = 3`, `MAX_FILM_SEC = 40`, `MAX_SHOTS = 8`;
  - `shotSeconds(text: string) -> number`;
  - `planShots(parsed) -> Shot[]`;
  - `checkFilm(shots, scenes) -> { storySec, filmSec, ok, overBySec, trimScene: {id, place}|null, tooLong: {shotId, words}[], tooMany: boolean }`.
- `Shot` is `{ id: "sh1".., sceneId, speaker: string|null, line: string|null, action: string|null, note: string, seconds: number, firstFrame: "board"|"chain" }`.
- Produces from `model.js`:
  - `cartoonFromScript(markdown) -> { project fields, check, warnings }`, which builds the stored shape below;
  - `CAST_DEFAULTS`;
  - `estimateFilm(project, only?: string[]) -> { clips, seconds, usd, images, imageUsd, spentUsd, totalUsd, benchmarkUsd, overBenchmark, shotIds }`. `IMAGE_USD = 0.04`.

Planning rules (§7.6):
- One line is one shot.
- An action joins the previous shot in the same scene (appended to `action`).
- An action that opens a scene becomes its own silent shot of `SILENT_SHOT_SEC`.
- `seconds = clamp(ceil(words / 2.5 + 1), 4, 12)`. A line whose unclamped value is over 12 goes in `tooLong`.
- `firstFrame` is `"board"` for the first shot of each scene and `"chain"` otherwise.
- `trimScene` is the scene with the most seconds when `filmSec > 40`.

The stored project:

```
{ mode: "cartoon", meta: { title, verse: { reference, text: "" }, aspect: "portrait", style },
  source: { markdown, ignored, warnings, parsedAt },
  cast: { [name]: { name, look, voice, portrait: null, approved: false, shelfId: null } },
  scenes: [{ id, place, note }], shots: [Shot & { board: null, clip: null }],
  storyboardApproved: false, music: { bed: null }, captions: { enabled: true },
  endCard: { text: "" }, spentUsd: 0, render: { status: "idle" } }
```

- [ ] **Step 1: Write the failing tests.**
  - `"one line is one shot; an action joins the shot before it"`.
  - `"an action that opens a scene is a 4 s silent shot"`.
  - `"shotSeconds: 10 words -> 5, 1 word -> 4, 30 words -> 12 and flagged tooLong"`.
  - `"a 36 s story is over 40 s with cards and names the longest scene"`: `filmSec === 41.5`, `ok === false`, `trimScene.id === "s2"`.
  - `"9 lines is tooMany"`.
  - `"first shot of each scene starts from its board, the rest chain"`.
  - `"cartoonFromScript fills cast for an unknown speaker with an empty look"`.
  - `"estimateFilm counts only shots without a done clip, and the images"`: the cost for 3 shots of 5 s equals `usdForTokens` over `estimateTokens` per shot.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement `plan.js` and `model.js`. Style defaults to `"family3d"` when `Style:` is missing or unknown; Task 4's `styleId` maps label text to an id.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon shot planner and 40 s rule`.

### Task 4: Styles and prompt builders

**Files:**
- Create: `server/src/lib/cartoon/styles.js`, `server/src/lib/cartoon/prompts.js`
- Test: `server/src/lib/cartoon/prompts.test.js`

**Interfaces:**
- Produces from `styles.js`: `STYLES = { family3d: {id, label: "3D family film", prompt}, storybook: {…, label: "Storybook"}, clay: {…, label: "Claymation"} }`, `styleId(text) -> id`, `DEFAULT_STYLE = "family3d"`.
- Produces from `prompts.js`:
  - `portraitPrompt(character, styleId) -> string`;
  - `boardPrompt(project, shot) -> string`;
  - `clipPrompt(project, shot) -> string`.

The style prompts:
- `family3d`: "3D animated family film style, soft global illumination, rounded appealing shapes, expressive large eyes, rich warm colour, cinematic depth of field".
- `storybook`: "hand-painted storybook illustration style, soft gouache textures, warm paper tones, gentle light".
- `clay`: "handmade claymation style, visible clay texture and fingerprints, miniature set, soft studio light".

The clip prompt follows the C0 template:
- style;
- the scene place;
- the shot note;
- `<Speaker look>. <Speaker> speaks in <voice>, saying: "<line>" Only <Speaker> speaks; everyone else stays silent with their mouth closed.` for a line;
- `No one speaks.` plus the action for a silent shot;
- the action text when there is one;
- the other cast in the scene, by look only;
- it ends with `No background music.` and `NO_TEXT_LINE`.
- The line is inserted byte for byte.

- [ ] **Step 1: Write the failing tests.**
  - `"names the one speaker and quotes the line exactly"`: the line contains `"I've got you."` with the apostrophe intact.
  - `"a silent shot says no one speaks"`.
  - `"every prompt carries the style, no background music and the no-text line"`.
  - `"no prompt, style label or example ever contains Pixar"`: build every prompt for every example (Task 5) and every style; assert `!/pixar/i.test(...)`. Mark it `todo` until Task 5 exists, then enable it in Task 5.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement `styles.js` and `prompts.js`.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon styles and prompts`.

### Task 5: Example scripts and the scripture-only rule for Jesus

**Files:**
- Create: `server/src/lib/cartoon/examples.js`, `server/src/lib/cartoon/scripture.js`
- Test: `server/src/lib/cartoon/examples.test.js`

**Interfaces:**
- Produces from `examples.js`: `EXAMPLES: { id, title, verse, blurb, markdown }[]` with ids `lost-lamb`, `david-giant`, `jonah`, `loaves-fishes`, `ruth`; `PLACEHOLDER = EXAMPLES[0].markdown`.
- Produces from `scripture.js`:
  - `normaliseForQuote(text) -> string` (lower case, curly quotes made straight, punctuation and spaces collapsed);
  - `unquotedJesusLines(parsed, verseText) -> {sceneId, text}[]` (lines whose speaker matches `/^jesus$/i` and whose normalised text is not a substring of the normalised verse text).

Each example:
- uses the §7.2 format and passes `checkFilm` with `filmSec ≤ 40`;
- has a cast of 2–3 with full looks and voices, in varied ages, sexes and kinds (children, elders, animals);
- shows Jesus only in `loaves-fishes`, where he says only KJV John 6:10 words: `"Make the men sit down."`.

- [ ] **Step 1: Write the failing tests.**
  - `"every example parses with no ignored lines and fits 40 s"`.
  - `"examples cover at least 9 distinct characters"`.
  - `"Jesus speaks only scripture in the examples"`: for `loaves-fishes`, `unquotedJesusLines(parsed, "Make the men sit down. Now there was much grass in the place.")` is `[]`.
  - `"an invented Jesus line is caught"`.
  - Enable Task 4's Pixar test.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Write the five scripts and `scripture.js`.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon example scripts`.

### Task 6: "Write it for me"

**Files:**
- Create: `server/src/lib/cartoon/writer.js`
- Test: `server/src/lib/cartoon/writer.test.js`

**Interfaces:**
- Consumes: `defaultLlmComplete` (`story/scriptRefine.js`); `lookupVerses(reference)` (`bible/scriptureApi.js`); `parseCartoonScript`; `planShots`; `checkFilm`; `unquotedJesusLines`; `STYLES`.
- Produces: `writeCartoonScript({ verse?: string, theme?: string, cast?: string, style?: string }, { llm = defaultLlmComplete, lookup = lookupVerses } = {}) -> Promise<{ ok: true, markdown, verseText } | { ok: false, code: "NO_VERSE"|"WRITE_FAILED", error }>`.

Behaviour:
- At least one of verse or theme is required.
- With a verse, it is looked up first. A failed lookup returns `NO_VERSE`.
- The LLM prompt states the §7.2 format with the Lost Lamb as the example, and the rules: ≤ 3 speaking characters, ≤ 8 shots, ≤ 25 words a line, ≤ 34 s at 2.5 words/s, Jesus only in exact verse words, reverent, family audience, no "Pixar".
- The reply is accepted only if it parses with zero ignored lines, `checkFilm(...).ok`, and `unquotedJesusLines` is empty. Otherwise it retries once with the failure reasons appended, then returns `WRITE_FAILED`.
- The `Verse:` line is rewritten to the looked-up canonical reference.

- [ ] **Step 1: Write the failing tests** (with a stub `llm` and `lookup`):
  - `"returns a script that fits on the first good reply"`.
  - `"retries once when the reply is too long, then succeeds"`: `llm` is called twice, and the second prompt includes `"too long"`.
  - `"refuses invented words for Jesus"`: two bad replies give `WRITE_FAILED`.
  - `"a verse that cannot be found is NO_VERSE"`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: BibleFuel writes cartoon scripts`.

### Task 7: Seedance options for cartoons

**Files:**
- Modify: `server/src/lib/videoGen/providers/seedance.js`
- Test: `server/src/lib/videoGen/providers/seedance.test.js` (add cases)

**Interfaces:**
- Produces: `submitSeedanceTask` gains `generateAudio = false`, `allowTextFallback = true`, `referenceImagePaths = []` and `seed = null`.
  - Each new option is sent only when used.
  - Adding `referenceImagePaths` and `seed` depends on the C0 results: when C0 shows BytePlus refuses either one, leave that option out and record why in a comment.
  - With `allowTextFallback: false`, a person refusal returns `{ ok: false, code: "PERSON_REFUSED", error: "BytePlus thinks this picture shows a real person. Make a new picture for this shot." }`.
- Every existing caller is unchanged (the defaults keep today's body).

- [ ] **Step 1: Write the failing tests:**
  - `"generateAudio sends generate_audio true"`.
  - `"allowTextFallback false returns PERSON_REFUSED and posts once"`.
  - `"default body is unchanged"`: `generate_audio: false`, and no `seed` key.
  - Plus one test for each C0-approved option.
- [ ] **Step 2:** Run `node --test src/lib/videoGen/providers/seedance.test.js`. Expect FAIL on the new cases.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: seedance audio, no-fallback and reference options`.

### Task 8: Character pictures (portraits and storyboard stills)

**Files:**
- Modify: `server/src/lib/imageGen/providers/imagen.js`
- Create: `server/src/lib/cartoon/images.js`
- Test: `server/src/lib/imageGen/providers/imagen.test.js` (add cases), `server/src/lib/cartoon/images.test.js`

**Interfaces:**
- Produces from `imagen.js`: `generateImageWithRefs({ prompt, refs: string[] /* image file paths, ≤ 3 */, aspect, signal }) -> Promise<{ ok: true, b64, mimeType } | { ok: false, error, status }>`. It is Gemini only: refs become `inlineData` parts after the text part, and the model is `IMAGEN_MODEL` if it starts with `gemini-`, else `gemini-2.5-flash-image`.
- Produces from `cartoon/images.js`:
  - `makePortrait(ctx, project, name, deps?) -> Promise<project>`;
  - `makeBoard(ctx, project, shotId, deps?) -> Promise<project>`.
  - Both write PNGs under `projectOutputDir(ctx.outputDir, id)/pictures/` and set `{ file, url, status: "done"|"error", matched: boolean, error }`.
  - A board uses the approved portraits of the cast in the shot's scene as refs.
  - Fallback: when `generateImageWithRefs` fails with 429, 403 or not-configured, call `generateBibleImage({ rawPrompt, aspect })` without refs and set `matched: false` (the UI then shows "Not matched to your cast: Gemini image billing is off").
  - `deps = { withRefs, plain }` for tests.

- [ ] **Step 1: Write the failing tests:**
  - `"sends refs as inlineData after the prompt"` (stub fetch).
  - `"a portrait is saved and marked matched"`.
  - `"a board falls back to a plain picture and says it is not matched"`.
  - `"a board uses only approved portraits of characters in its scene"`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon portraits and storyboard stills`.

### Task 9: Speech check and speech windows

**Files:**
- Create: `server/src/lib/cartoon/speech.js`
- Test: `server/src/lib/cartoon/speech.test.js`

**Interfaces:**
- Produces:
  - `transcribeClip(file, { ffmpeg, fetchImpl }) -> Promise<{ ok, text, error }>`: extracts mono 16 kHz WAV with ffmpeg, then POSTs to `https://api.openai.com/v1/audio/transcriptions` with `model: "gpt-4o-transcribe"` and `OPENAI_API_KEY`. With no key it returns `{ ok: false, error: "not configured" }`.
  - `speechScore(expected, heard) -> number` (0–1: word-level LCS length / expected word count, after `normaliseForQuote`).
  - `SPEECH_OK = 0.8`.
  - `parseSilences(stderr: string, durationSec) -> {from, to}[]` (speech windows: the complement of `silencedetect` silences, merged when under 0.25 s apart, dropping windows under 0.2 s).
  - `speechWindows(file, { ffmpeg, probe }) -> Promise<{from,to}[]>` (runs `-af silencedetect=noise=-32dB:d=0.35 -f null -`).

- [ ] **Step 1: Write the failing tests:**
  - `"exact speech scores 1, one word missing of five scores 0.8"`.
  - `"curly quotes and punctuation do not lower the score"`.
  - `"silences become speech windows"`: with fixed silencedetect stderr text and a 6 s clip, windows are `[{from:0.42,to:2.9},{from:3.6,to:5.1}]`.
  - `"no key means not configured, never a throw"`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon speech check and speech windows`.

### Task 10: Film stage (ordering clips)

**Files:**
- Create: `server/src/lib/cartoon/filmStage.js`
- Test: `server/src/lib/cartoon/filmStage.test.js`

**Interfaces:**
- Consumes:
  - `submitSeedanceTask`, `waitForSeedanceTask`, `downloadSeedanceVideo`;
  - spend functions;
  - `addClip` (visual library);
  - `downloadClip`, `makePoster` from `sceneScript/shotStage.js` (already exported);
  - `clipPrompt` (Task 4);
  - `transcribeClip`, `speechScore`, `speechWindows` (Task 9);
  - the cartoon store.
- Produces:
  - `isFilming(id)`, `cancelFilm(id)`;
  - `filmLedgerKey(projectId, shotId) = "cartoon:" + projectId + ":" + shotId`;
  - `startFilm(ctx, id, { only?, ledgerDir, deps? }) -> project|null`;
  - `resumeFilm(ctx, projects, { ledgerDir, deps? }) -> Promise<number>`;
  - `lastFrameOf(deps, clipFile, out) -> Promise<string|null>`.

Behaviour, on top of `shotStage.js`'s reserve → submit → save taskId → wait → charge once → download → library pattern:
- **Order of work.** Shots with `firstFrame: "board"` start at once (concurrency 4). A `"chain"` shot waits until the shot before it is `done`, then takes that clip's last frame (`ffmpeg -sseof -0.1 … -frames:v 1`) as its first frame. If the shot before fails, the waiting shot gets `status: "waiting"`, `error: "Waiting for shot N"`, and is not ordered.
- **Submit options:** `generateAudio: true`, `allowTextFallback: false`, and the C0-approved reference/seed options. A board shot's first frame is `shot.board.file`.
- **After download:** run `speechWindows`, then (for a line shot) `transcribeClip` and `speechScore`. Store `clip.speech = { heard, score, ok: score >= 0.8 }` and `clip.windows`. A transcription failure stores `speech: { ok: null, error }`, never blocks, and never re-orders.
- **Refusals:** `PERSON_REFUSED` marks the clip `status: "refused"` and releases the reservation.
- **Re-make:** re-ordering a done shot sets `clip.previous`. If the next shot is `"chain"` and done, it is set to `stale: true` (cleared when that shot is re-made).
- **Library:** `addClip` with `source: { kind: "cartoon", projectId, shotId }`, `lead:` the speaker's look, and `tags: [title, speaker]`.

- [ ] **Step 1: Write the failing tests** (stub `deps` for submit/wait/download/ffmpeg/probe/transcribe/windows; temp dirs):
  - `"orders board shots at once and a chained shot after its parent, from the parent's last frame"`: assert the submit order and that the chained submit's `firstFramePath` ends with `-last.png`.
  - `"sends generate_audio and never falls back to text"`.
  - `"a refused picture marks the shot refused and charges nothing"`.
  - `"a failed parent leaves its chained child waiting and unordered"`.
  - `"charges each task once, even when collected again after a restart"`.
  - `"resume collects ordered shots and fails never-ordered ones"`.
  - `"a speech mismatch is flagged, never re-made"`: `transcribe` returns `"I am stuck"` for `"I'm stuck, Eli!"`, giving `ok: false` and one submit.
  - `"re-making a shot marks the chained next shot stale"`.
  - `"a second start while running returns null"`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement it. Keep the file under 400 lines; split the chain scheduler into `chain.js` if it grows.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon film stage`.

### Task 11: Character shelf

**Files:**
- Create: `server/src/lib/cartoon/shelf.js`
- Test: `server/src/lib/cartoon/shelf.test.js`

**Interfaces:**
- Produces:
  - `listShelf(ctx) -> Character[]`;
  - `shelve(ctx, project, name) -> Character` (copies the approved portrait to `outputDir/cartoon-cast/<id>.png`);
  - `fromShelf(ctx, project, characterId, asName?) -> project` (cast entry `approved: true`, `shelfId` set);
  - `removeFromShelf(ctx, characterId)`.
- `Character` is `{ id, name, look, voice, style, portraitUrl, createdAt }`, stored with `writeJsonAtomic` in `ctx.dataDir/cartoon-cast.json`.

- [ ] **Step 1: Write the failing tests:**
  - `"a shelved character comes back approved in a new cartoon with the same portrait"`.
  - `"only an approved portrait can be shelved"`.
  - `"a character from another style is allowed but marked"` (`styleMismatch: true` in the cast entry).
- [ ] **Step 2–4:** Run it and expect FAIL, implement it, run it and expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon character shelf`.

### Task 12: Router, mount and restart recovery

**Files:**
- Create: `server/src/routes/cartoon.js`
- Modify: `server/index.js` (mount beside line 469; resume beside line 549)
- Test: `server/src/routes/cartoon.test.js`

**Interfaces:**
- Consumes: Tasks 1–11; `wouldExceedCap`, `ledgerSummary`; `benchmarkUsd`; `isSeedanceConfigured`.
- Produces: `createCartoonRouter({ ledgerDir = DATA_DIR, deps = {} })` and `resumeCartoonFilms({ ledgerDir })`.
- Errors use `{ ok: false, code, error }`, like `sceneScript.js`.
- `view(ctx, project)` adds `check` (from `checkFilm`), `estimate` (from `estimateFilm`), `running: { pictures, film, render }`, and `blockers`.

| Route | Does |
|---|---|
| `GET /styles` | `{ styles }` |
| `GET /examples` | `{ examples: [{id,title,verse,blurb,markdown}], placeholder }` |
| `GET /` | the cartoon list |
| `POST /parse {markdown}` | `{ preview, check, estimate }`; nothing saved. The client meter calls it, debounced. |
| `POST / {markdown \| exampleId}` | Creates a project. Refused with 400 `TOO_LONG_FILM` when `!check.ok`, with `check` in the body. |
| `POST /write {verse?, theme?, cast?, style?}` | `writeCartoonScript`. 60 s timeout, giving 504 `TIMEOUT`. |
| `GET /:id`, `DELETE /:id` | Read and delete (the library keeps the clips). |
| `PATCH /:id` | `title`, `style`, `markdown` (409 `LOCKED` once any clip has a `taskId`, else re-parse), `cast: {[name]: {look?, voice?}}` (a changed look clears `approved` and the portrait), `shots: [{id, note?, firstFrame?}]`, `captions`, `bed`, `endCard`. |
| `POST /:id/portraits {only?: names[]}` | Makes the missing or named portraits, in the background. |
| `POST /:id/cast/:name/approve` | Approves a portrait. |
| `GET /shelf`, `POST /:id/cast/:name/shelve`, `POST /:id/cast/from-shelf {characterId, asName?}`, `DELETE /shelf/:characterId` | The character shelf. |
| `POST /:id/storyboard {only?}` | 409 `CAST_NOT_READY` until every speaking character is approved. |
| `POST /:id/storyboard/approve` | Approves the storyboard. |
| `POST /:id/film/estimate {only?}` | `{ estimate, month }` |
| `POST /:id/film {only?, confirmOverBenchmark?}` | Checks in order: 503 `NOT_CONFIGURED`, 409 `STORYBOARD_NOT_APPROVED`, 409 `RENDERING`, 409 `RUNNING`, 409 `BUDGET` (the estimate for every shot without a done clip passed to `wouldExceedCap`), then 409 `OVER_BENCHMARK`. |
| `POST /:id/film/cancel` | Stops the film run. |
| `POST /:id/render`, `POST /:id/render/cancel` | Task 13 |

- [ ] **Step 1: Write the failing tests** (supertest over the router with a fake `req.ctx`, stub deps):
  - `"non-admins are refused"`: mount through the real middleware chain and check a 403 for a non-admin user, using the helper `sceneScript.test.js` uses.
  - `"creating an over-40 s script is refused with the scene to trim"`.
  - `"creating from an example copies its cast"`.
  - `"editing the script is locked once a clip was ordered"`.
  - `"a film order that would pass the monthly cap orders nothing"`.
  - `"over the benchmark needs confirmation"`.
  - `"storyboard waits for every speaking character to be approved"`.
  - `"a second film order while one runs is 409 RUNNING"`.
  - `"a changed look clears the portrait approval"`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement the router. Mount it in `index.js`: `app.use("/api/cartoon", requireAuth, withUserScope, requireVerifiedEmail, requireSuperAdmin, createCartoonRouter());` and call `resumeCartoonFilms` at start-up beside `resumeSceneScriptShots`.
- [ ] **Step 4:** Run it plus the full server suite (`npm test`). Expect all PASS.
- [ ] **Step 5:** Commit: `feat: cartoon API`.

### Task 13: Render: data, Remotion composition, render stage

**Files:**
- Create: `server/src/lib/cartoon/renderData.js`, `server/src/lib/cartoon/renderStage.js`, `server/remotion/src/CartoonVideo.tsx`, `server/remotion/src/cartoonTypes.ts`
- Modify: `server/remotion/src/Root.tsx` (add `<Composition id="Cartoon" …>` using the same `calculateMetadata` shape); `server/src/lib/sceneScript/renderStage.js` (export `remotionRender` with a `compositionId` parameter defaulting to `"SceneScript"`, and export `finish` as `finishLoudness`)
- Test: `server/src/lib/cartoon/renderData.test.js`, `server/src/lib/cartoon/renderStage.test.js`

**Interfaces:**
- Produces: `buildCartoonRenderData(project, { url, names }) -> CartoonRenderData`.

```
CartoonRenderData = { fps: 30, width: 1080, height: 1920, total,
  verse: { reference, text, from: 0, to: 2.5 },
  shots: [{ id, from, to, src, trimTo }],          // hard cuts, from 2.5 s, each clip's own audio at volume 1
  captions: [{ shotId, speaker, showName, words: [{text,start,end}] }], captionsOn,
  bed: { src, base: 0.32, duck: 0.12, windows: [{from,to}] } | null,
  endCard: { from: total - 3, to: total, reference, text, brand: "BibleFuel Studio" },
  fonts }
```

- Each clip plays to its measured `durationSec`, capped at its planned `seconds + 0.5`.
- Caption words are the line's words spread over that shot's speech windows (offset by the shot's start), so the script text is always what is shown.
- `showName` is true the first time each speaker speaks.
- The duck windows are every shot's speech windows in film time, each padded 0.15 s.
- The bed is `music.bed` resolved with `resolveBed`; it is null when unset.
- Produces: `startCartoonRender(ctx, id, { deps })`, `isRenderingCartoon(id)`, `cancelCartoonRender(id)`, `cartoonRenderBlockers(ctx, project) -> string[]`, `recoverInterruptedCartoonRender(project)`.
  - These follow `sceneScript/renderStage.js`: stage assets, `startAssetServer`, `remotionRender(..., "Cartoon")`, `finishLoudness`, `runExclusive`, `reportRenderFailure("cartoon", …)`.
  - Blockers: a shot without a done clip; a stale shot (warning only, not a blocker); a total over 40 s.

`CartoonVideo.tsx` reuses `useFonts`, `GOLD` and the caption styling from `Captions.tsx` (gold active word, lower third). The verse card is a serif-italic verse over a soft dark scrim on the first frame of the first clip. The end card matches Scene script's `EndCard`. The bed volume eases to `duck` over 0.2 s inside each window.

- [ ] **Step 1: Write the failing tests:**
  - `"shots follow the verse card back to back and the film is ≤ 40 s"`.
  - `"captions use the script words, timed inside the speech windows"`.
  - `"the speaker's name shows only the first time"`.
  - `"duck windows are speech windows in film time, padded"`.
  - `"no bed means bed: null"`.
  - `"blockers name missing clips and a too-long film"`.
  - `"render stage renders composition Cartoon and finishes at -14 LUFS"` (stub `render`/`ffmpeg`; assert `compositionId === "Cartoon"` and that the loudnorm args were run).
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement it, then wire `POST /:id/render` and `/render/cancel` into the router.
- [ ] **Step 4:** Run the tests, plus `cd server/remotion && npx tsc --noEmit`. Expect PASS and a clean type check.
- [ ] **Step 5:** Commit: `feat: cartoon render`.

### Task 14: Client API and types

**Files:**
- Create: `client/src/lib/cartoonApi.ts`, `client/src/lib/cartoonTypes.ts`
- Test: `client/src/lib/__tests__/cartoonApi.test.ts`

**Interfaces:**
- Produces: `CartoonProject`, `CartoonShot`, `CartoonCastEntry`, `CartoonCheck`, `CartoonEstimate`, `CartoonExample`, `CartoonStyle` and `ShelfCharacter`, mirroring Tasks 3, 11 and 12.
- Produces: `cartoonApi` with `styles, examples, list, parse, create, write, get, update, remove, portraits, approvePortrait, shelf, shelve, fromShelf, removeFromShelf, storyboard, approveStoryboard, estimate, film, cancelFilm, render, cancelRender`.
- It is built like `sceneScriptApi.ts`: `failure()` turns errors into `ApiError` with the server's code and sentence.

- [ ] **Step 1: Write the failing tests:**
  - `"create sends exampleId and returns the project"`.
  - `"a 409 BUDGET becomes an ApiError with code BUDGET and the server sentence"`.
- [ ] **Step 2–4:** Run with `npx vitest run src/lib/__tests__/cartoonApi.test.ts` and expect FAIL, implement it, then run again and expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon client API`.

### Task 15: Mode choice, project list and the Script step

**Files:**
- Modify: `client/src/pages/SceneScriptPage.tsx`, `client/src/App.tsx` (routes `scene-script/cartoon/new` and `scene-script/cartoon/:id` to a lazy `CartoonPage`)
- Create:
  - `client/src/pages/CartoonPage.tsx`: the step shell. Steps are Script, Cast, Style, Storyboard, Film, Finish; a step is reachable once the ones before it are satisfied. It uses a `useCartoonProject(id)` hook that polls every 3 s while `running` has anything true, like `useSceneScriptProject`.
  - `client/src/components/cartoon/ModeChoice.tsx`
  - `client/src/components/cartoon/ScriptStep.tsx`
  - `client/src/components/cartoon/LengthMeter.tsx`
  - `client/src/components/cartoon/ExampleShelf.tsx`
  - `client/src/components/cartoon/WriteForMe.tsx`
- Test: `client/src/components/cartoon/__tests__/ScriptStep.test.tsx`, `ModeChoice.test.tsx`

The behaviour (§7.1–7.2):
- With no id, the Scene script page shows `ModeChoice`: two large cards, "Human" (unchanged flow, today's subtitle) and "Cartoon" ("Characters speak their own lines. Up to 40 seconds.").
- The project list merges both lists, sorted by `updatedAt`. Cartoon rows carry a "Cartoon" tag and link to `/app/scene-script/cartoon/:id`.
- `ScriptStep` has:
  - a textarea with `placeholder={placeholder}` (grey sample), never reformatted;
  - `LengthMeter`, which calls `parse` 600 ms after typing stops and shows `NN s of 40` (tabular numerals) and `about $N.NN`. Over 40 it reads "NN s over: trim "<place>"", and too-long lines are listed;
  - `ExampleShelf`: five cards, where "Use this example" creates a project from `exampleId`;
  - `WriteForMe`: verse or theme, an optional cast note and a style select. The draft fills the textarea for the admin to edit before Next;
  - Next, which creates the project and is disabled while `!check.ok`.

- [ ] **Step 1: Write the failing tests:**
  - `"choosing Cartoon opens the cartoon journey"`.
  - `"the empty editor shows the placeholder sample"`.
  - `"over 40 s disables Next and names the scene to trim"` (mock `cartoonApi.parse`).
  - `"Write it for me fills the editor with the draft"`.
  - `"an example creates a project and navigates to it"`.
- [ ] **Step 2–4:** Run with `npx vitest run src/components/cartoon` and expect FAIL, implement it, then run again and expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon mode choice and script step`.

### Task 16: Cast, Style and Storyboard steps

**Files:**
- Create: `client/src/components/cartoon/CastStep.tsx`, `StyleStep.tsx`, `StoryboardStep.tsx`
- Test: `client/src/components/cartoon/__tests__/CastStep.test.tsx`, `StoryboardStep.test.tsx`

The behaviour (§7.3–7.5):
- **Cast:** one card per character with look and voice fields (saved on blur), a portrait with "Make portrait" / "Make again" / "Approve", a "Not matched to your cast" note when `matched === false`, "Save to shelf", and an "Add from shelf" picker. Next needs every speaking character approved.
- **Style:** three choices with a one-line description. Changing style after portraits exist warns that portraits will be remade.
- **Storyboard:** a filmstrip, one still per shot, with the line under it, the director's note (editable) and a first-frame toggle ("Continue from last shot" / "Start from this picture"). It has "Make again" per frame and "Approve storyboard". It shows the total picture cost.

- [ ] **Step 1: Write the failing tests:**
  - `"Next waits until every speaking character is approved"`.
  - `"a fallback portrait says it is not matched"`.
  - `"approving the storyboard calls approveStoryboard"`.
  - `"the first-frame toggle patches the shot"`.
- [ ] **Step 2–4:** Run it and expect FAIL, implement it, then run it and expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon cast, style and storyboard steps`.

### Task 17: Film and Finish steps

**Files:**
- Create: `client/src/components/cartoon/FilmStep.tsx`, `FinishStep.tsx`
- Test: `client/src/components/cartoon/__tests__/FilmStep.test.tsx`

The behaviour (§7.6–7.7):
- **Film:**
  - the estimate line ("6 clips · 31 s · about $2.36 · $X left this month");
  - "Make the film", with a second confirmation naming the amount when `OVER_BENCHMARK`;
  - per-shot cards with the status (Queued, Making, Waiting for shot N, Done, Refused, Failed), a video preview, and badges "Speech doesn't match" (showing what was heard) and "Out of date: starts from the old frame";
  - "Re-make" per shot with its price, plus Retry and Stop.
- **Finish:**
  - a music bed picker (the existing library bed list used by `MusicPanel`), a captions switch and an end-card text field;
  - "Render", with progress;
  - the video, a Download link, and the post caption (title, verse reference and text) with Copy;
  - `YoutubePublishPanel` with `videoUrl={render.url}`, `initial={{ title, description: caption, thumbnailTitle: false }}` and `thumbnailOptions` from the storyboard stills.

- [ ] **Step 1: Write the failing tests:**
  - `"over the benchmark asks again naming the amount"`.
  - `"a mismatched clip shows what was heard"`.
  - `"a stale shot says it is out of date"`.
  - `"BUDGET shows the server sentence and orders nothing"`.
- [ ] **Step 2–4:** Run it and expect FAIL, implement it, then run it and expect PASS.
- [ ] **Step 5:** Commit: `feat: cartoon film and finish steps`.

### Task 18: End-to-end check

**Files:**
- Create: `server/test/cartoon.e2e.test.js`

- [ ] **Step 1:** Write `"an example becomes a rendered cartoon with stubbed providers"`:
  - create from `lost-lamb`;
  - stub the portraits, approve them;
  - stub the storyboard, approve it;
  - run the film with stub clips (`ffmpeg -f lavfi` tone plus colour, 4–6 s);
  - render with a stub `render` that writes a file;
  - assert `render.status === "done"`, `spentUsd > 0`, one ledger settlement per shot, and every clip in the library with `source.kind === "cartoon"`.
- [ ] **Step 2:** Run the full suites: `cd server && npm test`, `cd client && npm test && npm run build` (`tsc -b` must be clean). Expect all green.
- [ ] **Step 3:** Browser check on the local rig (port 5077, throwaway JWT):
  - the mode choice, the placeholder, the meter (over and under 40 s), the examples and the cast cards;
  - check 375 px width and keyboard focus.
  - No paid calls: open a stubbed or pre-made project only.
- [ ] **Step 4:** Commit: `test: cartoon end to end`.
