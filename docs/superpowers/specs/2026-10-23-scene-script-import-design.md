# Scene scripts: authored cinematic scripts made into video, word for word

**Date:** 2026-10-23
**Status:** Direction approved by the operator on 2026-10-23 (rulings in section 7). Not yet built.
**Proven by:** the "Grace Made Me" prototype of 2026-10-23 (1 Corinthians 15:10, 101 s, 9:16). Video, clips and prototype source are in `Documents\BibleFuel\grace-made-me-prototype-2026-10-23`. The input script is `fixtures/grace-made-me.scene-script.md`.
**Builds on:** `2026-10-16-ai-scenes-design.md` (Seedance provider, spend ledger, cap), `2026-10-09-kinetic-caption-engine-design.md`, `2026-09-24-soundtrack-builder-design.md`, the long-form pasted-script parser (`lib/longform/scriptParser.js`).

## 1. Goal

The operator pastes a fully written cinematic script and gets the video that script describes:
- every spoken word exactly as written, in the voice the script asks for;
- each scene's own `Visual:` direction used as that scene's shot;
- music that follows the script's own cues, including drops;
- captions that treat narration, declarations and scripture differently;
- the script's final screen as the end card.

Today no BibleFuel flow can do this. Section 3 shows why: most flows rewrite or strip the pasted text, every flow has one voice, and Story has one music bed.

**Success:**
- Pasting the fixture script produces a video equivalent to the prototype, with no hand-editing of the script.
- A preview shows, before any money is spent, exactly what will be spoken (by which voice), what each shot will be, and which music plays where. Nothing spoken appears that the operator did not write.
- The cost estimate is shown before Seedance is called, and the existing monthly cap is respected.

## 2. What the prototype proved (measured 2026-10-23)

| Question | Answer | Evidence |
|---|---|---|
| Can Seedance Mini carry a 90 s devotional? | Yes. 16 text-to-video shots at 720p, upscaled to 1080×1920, read as one cinematic film. | Contact sheets in the prototype folder |
| Can one man stay recognisable across shots? | Yes, from wording alone. The same descriptor in every prompt kept the face, beard and olive work shirt across 6 shots. | Shots H1, H2, R1, R3, D1, D2 |
| Can a reference image keep him identical? | **No.** BytePlus refused an AI-generated face as `reference_image` with `InputImageSensitiveContentDetected.PrivacyInformation` ("may contain real person"), the same refusal first frames get. | Request id 0217927383150537701a42f23cc3d37ac47a8e8735f343a7f6486 |
| Does BytePlus refuse other things? | Yes: "a man on a hilltop at sunrise lifting his arms" failed after generation with "may be related to copyright restrictions". Reworded as a rooftop at dawn, it passed. | Shot D2 |
| Does an unspecified person drift off-brand? | Yes. "A worshipper" came back as a white man. Every person in a shot needs an explicit description. | Shot T4, re-rolled |
| Cost | 2,628,900 output tokens for 16 clips plus 2 re-rolls ≈ **$9.20 at list price** ($3.50 per million tokens, Mini 720p). | `spend.js` rates |
| Two voices and a chant | Azure Speech HD voices (`en-US-Davis:DragonHDLatestNeural` narrator, `en-US-Ava:DragonHDLatestNeural` scripture) sound right. Nine voices, including two Nigerian English and two child voices, layered with 0–80 ms offsets and room reverb, make a convincing ensemble chant. | `tts.mjs`, `timeline.mjs` |
| Timing | Synthesising **one line per file** and placing lines with planned gaps put the six scenes within about 2 s of the script's own timestamps, with no time-stretching. | `timeline.json` |
| Music cues | Three library beds (Falling Snow, Lifting Dreams, Aurora Borealis Expedition), loudness-matched, crossfaded at scene boundaries, ducked under each line and gated silent for 1.07 s before the hit worked. A synthesized heartbeat and low impact needed no sample files. | `prep.mjs`, `mix.ts`, `sfx.mjs` |
| Delivery | Remotion render at 1080×1920, 30 fps, 101.6 s, then a loudness pass to −14 LUFS: 67 MB. | `Grace-Made-Me-1Cor15-10.mp4` |

**What was not available:**
- **Music generation.** MiniMax answered "This Music API is no longer available to new users". Afro-soul percussion, gángan and a sung choir therefore came only from what the library beds contain.
- **ElevenLabs locally.** Both local `ELEVENLABS_API_KEY` values are key IDs, not secret keys (401 "API key ID used as API key"). Prod may differ.

## 3. What happens to a pasted script today (survey of master `abd277a9`)

| Flow | What happens to the pasted text | Voice |
|---|---|---|
| Story, Script tab | **Always rewritten by an LLM** (`refineScript`, targets template seconds × 2.5 words, told to drop stage directions). No bypass. Captions come from Whisper re-hearing the rewrite. | One Edge voice |
| Long-form, "Paste my script" | Deterministic parser. Drops whole-line `(...)`, `[...]`, `*...*`. **Speaks** `Narrator (...):`, `**Visual:**`, `Music:` lines and inline timestamps. | One voice |
| Voice page | `cleanSpeakableText` **overwrites the textarea**. | One voice |
| Moments | Typed text kept, cut to 1200 characters. | One Edge voice |
| Render page | Cut to the first 6 lines, then 72–140 characters per line. | One voice |
| Every `/api/tts/*` route | `cleanSpeakableText` on the server: strips `*`, `_`, `~`, `` ` ``, drops `#` headings and blank lines, keeps parentheses. | — |
| Voice orchestrator | `prepareScriptureForSpeech` rewrites "Book N:N" and also catches timestamps after a capitalised word ("At 0:12" → "At chapter zero, verse twelve"). | — |

**Also found:**
- No voice-per-line support exists anywhere.
- Story renders one looped music bed with sidechain ducking: no sections, fades, automation or SFX.
- Story scenes cannot be given spans or prompts over HTTP. `createStoryFromScenes` (story.js:486) can, internally.

**Ruling:** this feature does not "fix" the other flows' formatters. They are right for their own inputs. Instead:
- scene scripts get their own path with a **verbatim contract** (4.2);
- the other paste boxes detect a scene script and offer to open it there (Phase 3).

## 4. Design

### 4.1 Scene-script parser (pure, deterministic, no LLM)
New `server/src/lib/sceneScript/parse.js`, `parseSceneScript(markdown) → { script, warnings }`. It reads the shape chat assistants produce (the fixture):

| Input | Becomes |
|---|---|
| `### Scene N — Title (0:00–0:12)` | A scene with its title and target window |
| `*Visual: ...*` (also `Visual:` and `**Visual:**`) | The scene's visual direction. Never spoken. |
| `**Narrator (deep, emotional voice):**` or `Narrator:` | The speaker for the following lines, with its tone note. Never spoken. |
| Quoted lines `"..."` after a speaker tag, one per paragraph | Spoken lines, quotes removed, words untouched |
| `**...**` inside a spoken block | The same line, marked `emphasis` |
| A single-quoted passage inside narration (`'But by the grace of God...'`) | A `scripture` line. Recommendation 4.3 gives it the scripture voice. |
| A line that is only a reference, or "First Corinthians, chapter fifteen, verse ten" | A `reference` line: spoken and shown as the reference card |
| `*Final screen: ...*` | The end card text |
| `## Music and sound direction` with `0:00–0:27 | Mood` plus notes | Music cues with windows and notes |
| "Drop the instrumentals briefly before “X”" | A drop gate before the line matching X |
| "an ensemble ... softly repeat: > "..."" | A `chant` line, placed after the scripture and under the end card |
| Title lines (`TITLE:`, `# ...`), "90-second", "9:16", genre line | Project metadata: title, target length, aspect, mood words |
| Image links `[text](https://...)`, horizontal rules, chat preamble and commentary | Ignored, listed in the preview as "not used" |

- **Output** is plain JSON (`SceneScript`, 4.6), with every source line accounted for as used or ignored.
- **Warnings** (shown in the preview, never fatal): a scene with no visual, a spoken block with no speaker (the narrator is assumed), a timestamp window that overlaps the next one, a montage visual with more subjects than the scene has seconds.
- **Ruling:** no LLM in parsing. An LLM may only *suggest* missing visuals (4.4), and never touches spoken words.

### 4.2 Verbatim contract
- Spoken text is exactly the parsed line. The only transforms are removing markup (`*`, `_`, quote marks) and expanding a Bible reference **only on lines marked `reference`**.
- The scene-script voice path calls the provider directly with `scriptureMode:false` and skips `cleanSpeakableText`, `refineScript`, `buildSpeakableLines` and all truncation.
- Captions show the parsed text. Word timings come from the provider; Whisper is used only to place known words in time, never to replace them (the prototype's `alignWords`).
- A unit test asserts that, for the fixture, the concatenated spoken text equals the script's quoted text with markup removed.

### 4.3 Voices
- **Cast map:** speaker name → voice. Defaults:
  - `Narrator` → `en-US-Davis:DragonHDLatestNeural`;
  - `scripture` → `en-US-Ava:DragonHDLatestNeural`;
  - `ensemble` → the nine-voice set from the prototype.
  The operator can change each in the preview. Tone notes ("deep, emotional") are shown beside the voice, not sent.
- **One file per line.** This gives exact line timing, per-line re-takes and per-line voices for free.
- **Azure path:** today `azureSpeechClient` calls `speakTextAsync` with plain text, so prosody is ignored. Add an SSML call (`speakSsmlAsync`) used by this path, with `rate` per voice. Word boundaries still come back.
- **Ensemble:** synthesize the chant once per ensemble voice, then mix with offsets, `amix`, low-pass, `aecho` and a limiter (the prototype's `mixChant`). Store it as one file.
- **Flexibility (operator ruling 2026-10-23: the prototype's voice blend must be available in the app):**
  - **Speakers come from the script.** Any tag such as `**Scripture voice (female):**`, `**Child:**` or `**Ensemble:**` becomes a speaker in the cast map. A new speaker gets a suggested voice from the tone and gender words in its tag.
  - **Per-line override.** Any line can take a different voice from its speaker's default, for example one scripture quote read by the narrator.
  - **Delivery per voice and per line:** rate, pitch and the gap after the line. A speaking style is offered only on voices that support one. Tone notes stay visible beside the line as the author's guidance.
  - **Ensemble builder.** Choose the voices (adult and child, any accent the provider has), the number of layers, the timing spread and the room size. One play button previews the mix before it is used.
  - **Preview and re-take.** Each line plays on its own once voiced. A re-take re-synthesizes that line only, and the timeline moves the later lines.
  - **Cast presets.** A cast can be saved by name ("Testimony: deep narrator, gentle scripture, mixed ensemble") and applied to the next script.
- **Ruling:** Azure HD voices by default; ElevenLabs as an option when a valid key exists. Recommendation: confirm the prod ElevenLabs key before offering it.
- **Gaps:**
  - the default gap after a line is 0.35 s;
  - an ellipsis adds 0.3 s;
  - an emphasis line adds 0.4 s;
  - the last line of a scene adds 0.6 s;
  - the gap before a drop gate is 1.3 s in all (it replaces the other gaps, it does not add to them);
  - a chant line is followed by 1.2 s, and the closing chant by 3 s.
  These values are what the prototype used, and `timeline.js` holds them. The operator can nudge each gap in the preview.

### 4.4 Shots
- Each scene's visual becomes one or more **shots**. A shot runs from a line's start to the next shot's start, with a 0.45 s cross-dissolve.
  - A scene of up to 8 s is one shot.
  - Longer scenes split at line starts into shots of 4–12 s (Seedance limits).
  - A **montage visual** ("a mother..., a young man..., a woman graduating, and a worshipper...") splits into one shot per listed subject, in order.
- **The prompt** is the author's visual sentence, plus the **lead character descriptor** wherever "the man", "the central character" or "a figure" appears, plus a style suffix. Each person who appears must be described.
- **Lead character:** one descriptor per project, editable, suggested by the LLM from the script's title and genre. Ruling: the default is "a Black Nigerian man in his late thirties…" only when the script says "man" and nothing else; otherwise the operator is asked.
- **Missing or thin visuals:** one LLM call proposes shot prompts for scenes with no visual or with a montage that needs more detail. These are marked "suggested" in the preview until accepted.
- **Generation:**
  - through the existing provider (`submitSeedanceTask` → `waitForSeedanceTask` → download), text-to-video, Mini 720p 9:16, saving task ids before polling;
  - reserved and settled through the existing spend ledger (`spend.js`), never a side file;
  - concurrency 4;
  - a shot refused for copyright or sensitive content is reported per shot with a "Reword and retry" action. There is no automatic rewording loop.
- **Re-roll** per shot from the preview, showing the cost of one clip. The earlier clip is kept in the visual library (4.11), never deleted.
- **Library first.** Before ordering, each shot can take a clip from the visual library instead, at no cost.

### 4.5 Music and sound
- **Cues** come from the script's music section (windows plus mood notes). With no music section, each scene becomes one cue, with its mood taken from the scene title.
- **Each cue takes one library bed.** The operator picks the bed, or the server suggests one by matching mood words against the library's mood tags and loudness profile. The prototype shows a quiet bed for reflection, a warm one for grace and a loud one for victory.
- **Mixing** follows the prototype's `mix.ts`:
  - cut each bed at an offset and loudness-match it (−20 LUFS);
  - 1.8 s fades and 2.2 s overlaps between cues;
  - ducking computed from the known line times (no sidechain compressor, so ducking is exact and testable);
  - drop gates;
  - a short lift after the hit.
- **SFX** synthesized with ffmpeg, so there are no sample files to license:
  - `heartbeat` when a cue mentions heartbeat or pulse;
  - `impact` on every line after a drop gate.
- **Final loudness** is −14 LUFS integrated, −1 dBTP.
- **Out of scope:** generated music. No provider is available (section 2). Revisit if ElevenLabs Music or a MiniMax account becomes available.

### 4.6 Data model
Stored as `DATA_DIR/scene-scripts/<id>.json`, per user, written atomically like the other stores:

```
SceneScript {
  id, ownerUid, title, reference, aspect: "portrait"|"landscape",
  source: { markdown, parsedAt, ignored: [lineNo...], warnings: [...] },
  lead: { descriptor },
  cast: { [speaker]: { provider, voice, rate } },
  scenes: [{ id, title, targetStart, targetEnd, visual, lines: [lineId...], shots: [shotId...] }],
  lines: [{ id, sceneId, speaker, kind: "narration"|"scripture"|"reference"|"chant",
            text, emphasis, gapAfter, audio: { file, durationSec, words }, start }],
  shots: [{ id, sceneId, startLineId, offsetSec, prompt, suggested,
            clip: { taskId, status, file, tokens, error } }],
  music: { cues: [{ from, to, mood, notes, bed, offsetSec }], drops: [{ beforeLineId }], sfx: [...] },
  endCard: { lines: [...] },
  render: { status, file, startedAt, error }
}
```

- `start` and the shot spans are computed from line durations and gaps. They are never typed in.

### 4.7 Render
**Ruling (operator, 2026-10-23): Remotion, as a new render path for scene scripts only.**

- **Why:** the prototype's caption treatments, volume automation and per-shot slow-motion were a few hundred lines of React (`GraceMadeMe.tsx`, `Captions.tsx`, `mix.ts`). Doing the same in the ffmpeg filtergraph means hand-built `volume=enable` expressions for every duck, ASS styling for three caption treatments, and more filtergraph length risk on prod's FFmpeg 5.1.
- **Risks:**
  - Remotion needs a Chrome headless shell in the Docker image (about 100 MB);
  - Remotion's company licence is free for companies of up to 3 people. Tiwaton Ltd qualifies today; recheck if that changes;
  - prod has no swap and 7.7 GB free, so a render must take the existing heavy-job gate and use concurrency 2–3;
  - the render time on prod is unknown. The laptop render was not timed.
- **Alternative:** extend `storyRender.js`. It is cheaper to deploy and slower to build, with a weaker result for captions.
- **Shape:**
  - new `server/remotion/` package (composition plus `data.json` props), rendered with `@remotion/renderer`'s `renderMedia` from a job;
  - then the loudness pass and a 100 MB check (Cloudflare limit);
  - the existing ffmpeg renders are untouched.
- **Deploys kill running renders:** the render records its progress and can be restarted from the job list. Clips and voice files persist, so a restart costs render time, not money.

### 4.8 Captions
Taken from the prototype (`Captions.tsx`), all from the line model:
- **narration:** words land as spoken, active word gold, lower third;
- **emphasis:** large gold capitals in the centre, spring-in;
- **scripture:** serif italic in the upper centre, with a small speaker label ("THE APOSTLE PAUL", taken from the narration line before it);
- **reference:** a card with gold rules, using lining numerals;
- **chant:** serif italic in the centre;
- **opening title** for 1.6 s, and the **end card** from `Final screen`, with a small "BibleFuel Studio" line.
- **Ruling:** captions on by default; one switch turns all of them off.

### 4.9 API (all `requireSuperAdmin` in Phase 1, because Seedance spend is shared)
| Route | Does |
|---|---|
| `POST /api/scene-script/parse` `{markdown}` | Parse only, nothing saved. Returns `{script, warnings, ignored, estimate}`. |
| `POST /api/scene-script` `{markdown, cast?, lead?, aspect?}` | Save a project |
| `PATCH /api/scene-script/:id` | Edit cast, lead, line text, gaps, shot prompts, cues, end card. Editing a line's text clears its audio. |
| `POST /api/scene-script/:id/voice` | Synthesize missing lines, mix chants, compute the timeline |
| `POST /api/scene-script/:id/shots` `{only?: [shotId]}` | Order missing or named clips within the cap |
| `POST /api/scene-script/:id/render` | Render, loudness pass, file under the user's outputs |
| `GET /api/scene-script/:id` | State, including per-shot and per-line status |

- `estimate` is `{ clips, seconds, tokens, usd, fromLibrary }` from `estimateTokens` and the Mini rate. Shots filled from the library count as zero.
- **Benchmark (operator ruling 2026-10-23): $10 per video.** The estimate is shown against it before any order. Above $10 the order button asks for a second confirmation that names the amount. This is a warning, not a block; a hard per-video cap is deferred. The monthly cap in `spend.js` still applies as today.
- **Fit to the benchmark:** Grace Made Me cost about $9.20 for 16 shots plus 2 re-rolls at Mini 720p. The same video at 1080p would cost 2.25 times as much (about $21), so 720p clips upscaled in the render stay the default.

### 4.10 Client
A new **Scene script** page under Create (super admins in Phase 1), with four steps. Operator UI follows the design quality standard.
1. **Paste:** a textarea that is never reformatted, then **Read script**.
2. **Preview:** a table with one row per scene:
   - the spoken lines, each with a voice chip and a play button once voiced;
   - the visual prompt, editable, marked "suggested" when it came from the LLM;
   - the music cue;
   - an "Ignored" drawer lists every line not used.
   Above the table sit the lead character field and the cast pickers.
3. **Voice, then shots:** buttons with the estimate ("16 clips · about $9.20"). Shots then fill with thumbnails, each with a Re-roll action.
4. **Render:** the result, with Publish options reusing the existing social flows.

### 4.11 Visual library: every paid clip is kept, reused and refined
Today a Story re-roll deletes the clip it replaces (`finishTask` in `lib/story/animateStage.js`), and a clip keeps no record of the prompt that made it. Paid footage is lost.

- **Store.** Every Seedance clip from any flow (scene scripts, Story Animate, Series, AI music videos) is saved once in a per-user library: `DATA_DIR/visual-library/<id>.json` beside the clip file. A record holds the prompt, lead descriptor, model, resolution, aspect, duration, tokens, cost, task id, source project and shot, date, tags, a poster frame and an optional rating.
- **Never deleted by a re-roll.** A re-roll adds a new clip next to the old one. Deleting is a separate, explicit action.
- **Reuse.** A shot can take any library clip instead of ordering a new one, at no cost. The library is searchable by words in the prompt and tags, and filterable by aspect and by "shows the lead character".
- **Suggest.** When a shot's prompt is close to an existing clip's prompt, the preview offers that clip first. Phase 2 uses plain text similarity.
- **Refine for free, in the render.** In and out points, playback rate, reframe or crop, flip and grade are stored on the shot, never baked into the clip, so one clip can serve many videos differently.
- **Refine for money.** "Re-roll from this prompt" opens the clip's prompt for editing and orders a new clip, which joins the library beside the original. Image-to-video from a frame of a clip works only for frames without a realistic face (section 2). Extending a clip, or using it as a reference video, has not been tested; Phase 2 probes it with one paid request before offering it.
- **Back-fill.** The 16 Grace Made Me clips are imported with their prompts. Existing Story AI clips on prod are imported without prompts, marked "prompt unknown".
- **As built:** the planner gives Grace Made Me 17 shots (the prototype hand-picked 16). Scene 5 runs about 15 s, so it splits at line starts into three shots near the 7 s target where the prototype used two.
- **Size.** The prototype's clips are 2.4–6.4 MB each, 59 MB for all 16. The library lives on the same volume as other user outputs. Prod disk headroom must be checked before Phase 1 ships.

## 5. Phases
- **Phase 1:** parser and fixture tests, verbatim voice path with cast map, per-line voices and ensemble, timeline, shots through the ledger, visual library store (every clip kept, pick a clip for a shot, Grace back-fill), the $10 benchmark warning, Remotion render, minimal page. Done when the fixture builds end to end on prod.
- **Built in Phase 1 ahead of plan:** the ensemble builder (add, remove and offset layers) and music bed suggestions by mood. Cast presets are still Phase 2.
- **Phase 2:** ensemble builder and cast presets, library browser with suggestions and free refine controls, Story re-rolls stop deleting clips and feed the library, the extend-clip probe, music bed suggestions by mood, 16:9 layout, a 3-minute variant with a repeating hook.
- **Phase 3:**
  - "Write a scene script" assistant from a verse: an LLM writes in this format, and the operator edits before Read script;
  - scene-script detection in the Story Script tab, Voice page and Long-form paste box;
  - the small fixes below.

**Small fixes found in passing (separate PRs, not blocking):**
- `REFERENCE_RE` rewrites timestamps after a capitalised word ("At 0:12").
- Azure prosody is ignored (`speakTextAsync` plain text).
- Series → Story falls back to the **uncleaned** client text for even timings.
- Long-form help text says "Psalm four, verse eight", but speech says "Psalm chapter four, verse eight".
- Four of five style anchors say "vertical 9:16" in landscape projects.
- The Story Script tab has no "use my words exactly" option.

## 6. Tests
- **Parser:** golden test on the fixture. Exact scenes, speakers, line kinds and emphasis; the ignored list includes the image links and commentary; the visuals are never in spoken text. Edge cases: no speaker tag, no music section, montage split, overlapping windows.
- **Verbatim:** the spoken text for the fixture equals the quoted text with markup removed. A reference expands only on `reference` lines.
- **Timeline:** given line durations and gaps, the scene windows and shot spans are contiguous, and every shot is 4–12 s or slowed to fit with a rate of at least 0.6.
- **Mix:** `duckAt`, `dropGate` and `musicVolume` at known times: full between lines, ducked inside, 0 inside the drop, a lift after the hit.
- **Spend:** shots reserve and settle through `spend.js`. A refusal releases the reservation. The cap blocks before any submit.
- **Render smoke test** (local, not CI): a 10 s two-scene script renders, has an audio stream, measures −14 ± 1 LUFS, and has silence exactly at the drop.

## 7. Operator rulings (2026-10-23)
1. **Render path: Remotion**, built into BibleFuel as a new render path for scene scripts (4.7). The app ships fixed, data-driven compositions taken from the prototype. No AI writes React code at run time.
2. **Access: super admins only** for Phase 1 (4.9).
3. **Voices: full flexibility**, as in the prototype blend (4.3). Default narrator stays Azure Davis HD; Nigerian English voices are offered in the cast pickers and the ensemble.
4. **Spend: a $10 per-video benchmark** shown before ordering, with a second confirmation above it. A hard per-video cap is deferred (4.9).
5. **Visuals: every paid clip is kept, reusable and refinable** inside BibleFuel (4.11).
