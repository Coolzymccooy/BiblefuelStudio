# Moments + Motion Engine — Design (Phase 1)

**Date:** 2026-10-12
**Status:** Draft for operator review
**Branch:** `feat/moments-motion`
**Evidence:** the 2026-10-11 spike (12 photos, 99.5 BPM gospel track, 20 s 9:16 edit, beat-cut, Studio statements) proved every Phase 1 effect with plain ffmpeg on the laptop in 27 s.

## 1. Goal

Give BibleFuel users CapCut/TikTok-class "power statement" videos made from their own photos: birthdays, anniversaries, weddings, sermon promos, church events, memorials. The user picks an occasion, adds photos, and presses **Make it**. BibleFuel then:
- cuts the photos on the beat of a song, and/or paces them to a voiceover;
- moves each photo and transitions between them;
- lands AI-suggested statements on the downbeats using the Studio caption engine.

The output is a 9:16 MP4 ready to post.

Energy covers both moods the operator asked for: calm and devotional at one end, hype at the other.

## 2. Programme and scope

The motion work is one programme in four phases. **This spec is Phase 1 only.** Phases 2–4 each get their own spec. Phase 1 is shaped so they plug in without rework.

| Phase | Delivers |
|---|---|
| **1 (this spec)** | Shared motion engine: beats, director, plain-ffmpeg effects, four smart styles. AI statements. Moments mode with one tap plus touch-ups. |
| 2 | Python vision service (rembg `u2net_human_seg`) on coolify-prod with hard caps (2 CPU / 1.5 GB, one job at a time, model loaded on demand and unloaded when idle). Unlocks text-behind-subject, neon outline and pop-out effects. If the service is unavailable, renders fall back to no cut-out effects, with a notice. |
| 3 | Motion in the editors: Story scenes, Timeline clips and Ambient (calm only). "Open in Timeline" converts a Moment's motion plan into Timeline clips. |
| 4 | More styles and occasions. Optional paid image-to-video add-on for photos that move. |

**Out of scope for Phase 1:**
- cut-out effects;
- posting straight to social platforms (Download only; the Queue integration comes later);
- "Open in Timeline";
- aspect ratios other than 9:16;
- captions of the voiceover's words (the on-screen text is always the statements).

## 3. Decisions already made

- **Where it lives:** a new Moments mode, plus a shared engine that the editors adopt in Phase 3 (operator choice "C").
- **Statements:** the AI suggests them and the user edits, reorders or reshuffles. Church occasions also offer scripture (choice "A").
- **Control:**
  - one tap with defaults;
  - light touch-ups (reorder or remove photos, star a hero photo, edit statements, change style, Energy or length, Shuffle);
  - full control later via "Open in Timeline" (choice "A").
- **Architecture:** one shared motion engine with Moments built on top (approach 1), not a Moments-only pipeline and not "a Moment is a Timeline project".
- **Vision hosting (for Phase 2):** a separate capped service on coolify-prod. Measured headroom on 2026-10-12 was 7.7 GB available of 15.6 GB, no swap, load about 0.5 on 8 vCPU. A paid cut-out API is the fallback if RAM ever gets tight.

## 4. Architecture

### 4.1 Shared motion engine: `server/src/lib/motion/`

It follows the structure of `server/src/lib/kinetic/`: small pure modules, each with its own tests.

| Module | Responsibility |
|---|---|
| `beats.js` | Decode the audio to mono PCM with ffmpeg, then compute the onset-energy envelope, the tempo by autocorrelation, beat times and downbeats (every 4th beat, phase aligned to the strongest bar). Tempos outside 70–160 BPM are doubled or halved. Also scores every candidate window of the chosen length and returns the highest-energy one. If no clear tempo is found, it returns `{ tempo: null }` so callers fall back to a pulse grid. Also contains `pausesFrom(pcm)`, which finds silence gaps in a voiceover for the voice-paced grid. |
| `director.js` | `directMoment({ photos, grid, statements, style, energy, lengthSec, seed })` returns a motion plan. It is pure and deterministic: the same inputs and seed give the same plan. It uses `normaliseSeed` from the kinetic engine and a seeded PRNG. |
| `plan.js` | The motion-plan schema plus `validatePlan(plan)`, which reports clear errors. This is the single contract between the director, the renderer and (in Phase 3) "Open in Timeline". |
| `effects/` | One file per effect. Each one exports `{ id, kind: 'move' \| 'entrance' \| 'overlay', needs: [], build(shot, ctx) }`, where `build` returns ffmpeg filter fragments. `needs` lists capabilities such as `'mask'` (Phase 2). The director never picks an effect whose needs are not met; this is how the vision fallback works. |
| `styles.js` | The four launch styles. Each has weighted move, entrance and overlay palettes, a colour grade, and a Studio caption look. Every palette entry must name an existing effect. |
| `render.js` | `renderPlan(plan, { workDir, onProgress, signal })` turns a motion plan into an MP4 (see §6). |

**Phase 1 effects.** All were proven in the spike, using plain ffmpeg 5.1-compatible filters.

| Kind | Effects |
|---|---|
| Move | `push` (slow zoom), `punch` (fast zoom-in on the beat), `shake`, `pan` (for landscape photos), `still` |
| Entrance | `cut`, `crossfade`, `flash` (white fade), `whip` (directional blur), `glitch` (rgbashift + noise) |
| Overlay | `lightLeak` (geq + screen blend), `viewfinder` (drawbox/drawtext frame), `split2` / `split3` (duo/triple split), `sparkles`, `doodles`, `rayBurst` (end card) |

**Rule from the spike:** any `blend` runs in `gbrp`. A screen blend in YUV tints everything magenta.

### 4.2 Smart styles

| Style | Feel | Moves | Entrances | Overlays | Caption look (`kinetic/looks.js`) |
|---|---|---|---|---|---|
| **Glow** | Calm, devotional | push, pan, still | crossfade, cut | lightLeak | `gospel-gold` |
| **Celebrate** | Birthdays, parties | punch, push | flash, cut, whip | sparkles, doodles, rayBurst | `lagos-night` |
| **Hype** | TikTok energy | shake, punch | whip, glitch, flash | split2, split3 | `lagos-night` |
| **Gallery** | Events, sermon promos | push, pan | cut, crossfade | viewfinder, split3 | `clean-white` |

Moments Energy is a number from 0 to 1. It sets the intensity within a style: cut rhythm, effect strength, and how often the strongest effects appear.

The Studio caption engine only takes three named levels, so Energy is mapped onto them:

| Moments Energy | Caption energy |
|---|---|
| below 0.34 | `calm` |
| 0.34–0.66 | `lively` |
| above 0.66 | `wild` |

Names with Yoruba letters (ẹ, ọ, ṣ) already fall back to `FALLBACK_FONT`.

### 4.3 Moments mode

**Server**
- `server/src/lib/moments/projectStore.js`: per-user project files, modelled on `lib/ambient/projectStore.js`.
- `server/src/lib/moments/statements.js`: the AI statement writer.
- `server/src/lib/moments/occasions.js`: occasions, their detail fields, defaults and template statements.
- `server/src/lib/moments/renderStage.js`: the render job.
- `server/src/routes/moments.js`: mounted at `/api/moments`.

**Client**
- `client/src/pages/MomentsPage.tsx`, with its components under `client/src/components/moments/`.
- `client/src/lib/momentsApi.ts`.
- A card on `CreateHubPage.tsx`.

## 5. User flow

Everything after step 2 has a default, so **photos plus an occasion is enough to enable Make it**.

1. **Occasion.**
   - Choices: Birthday, Anniversary, Wedding, Sermon / service promo, Church event, Thanksgiving, Memorial, Just for fun.
   - Optional detail fields vary by occasion: name, age or milestone, event title, date, venue, Bible verse.
   - The occasion sets the default style, Energy and song. For example, Birthday gives Celebrate at 0.8, and Memorial gives Glow at 0.15.
2. **Photos.**
   - Upload 3–20 photos, or pick from the user's library or generated images, using the existing bulk-upload pattern (`uploadSeveral` in `StoryImageTools.tsx`).
   - The user can drag to reorder and remove photos.
   - **Star one photo as the hero.** It opens the video with the title and returns for the end card. The first photo is the hero by default.
3. **Sound.**
   - **Song:** pick from the bundled library (`library:<id>`), My library (`mylib:<uuid>`), or an own upload. The engine picks the strongest window of the chosen length, and the user can nudge it with the existing `MediaTrimmer`.
   - **Optional voiceover:** typed, or written by the AI as a short script, then spoken by a voice from the existing TTS voices. With a voiceover, the song ducks under it.
   - **Default:** the occasion's song.
4. **Statements.**
   - The AI suggests a title plus 3–6 statements.
   - The user can edit, reorder, delete or add statements, or press **Reshuffle** for a new set.
   - Church occasions also offer a verse line.
   - The count fits the length:

     | Length | Statements (title excluded) |
     |---|---|
     | 15 s | max 3 |
     | 30 s | max 5 |
     | 60 s | max 8 |

5. **Style, Energy and length.**
   - Four style cards, each with a small looping preview clip that ships with the app as a static asset.
   - An Energy slider from calm to hype.
   - Length: 15, 30 or 60 s.
6. **Make it.**
   - Progress shows by stage.
   - The result shows a player, **Download**, **Shuffle** (new seed, same inputs), and **Edit** (jump back to any step).
   - History keeps the last 20 renders.

## 6. Director rules

### 6.1 Timing grid

- **Song present:** use the beats and downbeats from `beats.js`, restricted to the chosen window.
- **Voiceover only:** use the grid from `pausesFrom()`, so cuts land between phrases.
- **Neither, or no clear tempo:** use an even 2 s pulse grid.
- **Song plus voiceover:** use the song's beats for cuts. The voiceover only affects the audio mix.

### 6.2 Energy and cutting rhythm

| Energy | Shot length | Typical effects |
|---|---|---|
| Calm (< 0.34) | 4–8 beats | push / pan, crossfade, lightLeak |
| Medium (0.34–0.66) | 2 beats | push / punch, flash on downbeats |
| Hype (> 0.66) | 1 beat, plus double-cut bursts on the strongest beats | shake, whip, glitch, splits, flash |

- Shots always last between **0.35 s and 4 s**, whatever the tempo.
- The strongest effects (flash, glitch, split, title slam) go on downbeats and the top-onset beats.
- No move or entrance repeats on consecutive shots.
- Choices come from the style's weighted palette through the seeded PRNG.

### 6.3 Photos and shots

- **Hero:** it opens the video (with the title) and closes it (end card: final statement plus `sparkles` or `rayBurst`).
- **More shots than photos:** reuse photos with a different crop or move (a punch-in on a detail, or a slot in a split). The same photo never appears in consecutive shots.
- **More photos than fit:** keep the user's order, drop photos from the end, and return a warning such as `{ dropped: 4, suggestLength: 30 }`. The UI shows "4 photos didn't fit 15 s. Try 30 s?"
- **Landscape photos** (aspect > 1): use `pan` inside the 9:16 frame or a split slot. Never letterbox them.
- **Framing without a mask:** zoom anchors aim at the upper-middle of the photo (x = 0.5, y = 0.38). Phase 2 replaces this with the subject mask's head position.

### 6.4 Statements

- **Title:** on the opening shot(s), entering on the first downbeat with a slam or pop according to the style.
- **Each statement:**
  - starts on a downbeat and spans 1–3 shots;
  - reveals its words on successive beats, using the per-line `reveal` added in kinetic step 4;
  - holds until the next statement starts, using `holdUntil`.
- **Text-free shots:** with few statements, some shots carry no text.
- **Studio engine:** statements are rendered by the existing `buildAss` with the style's look, the Energy and the seed. All Studio effects (pop, stack, slam, quote, sparks) apply.

### 6.5 Determinism

- The motion plan is saved with the project. Re-rendering the same plan is identical.
- **Shuffle** changes only the seed.
- Edits (statements, photo order, style) keep the seed. The plan changes only where the inputs changed.

## 7. Data and API

### 7.1 Moment project

```js
{
  id, userId, createdAt, updatedAt,
  occasion: 'birthday' | 'anniversary' | 'wedding' | 'sermon' | 'event'
          | 'thanksgiving' | 'memorial' | 'fun',
  details: { name?, milestone?, eventTitle?, date?, venue?, verse? },
  photos: [{ ref, width, height }],          // own upload / library refs, user order
  heroIndex: 0,
  sound: {
    song: { ref, windowStartSec } | null,
    voiceover: { script, voiceId, file } | null,
  },
  title: '…', statements: ['…'],
  style: 'glow' | 'celebrate' | 'hype' | 'gallery',
  energy: 0.0–1.0, lengthSec: 15 | 30 | 60, seed,
  plan: <motion plan> | null,
  history: [{ jobId, file, createdAt, seed }],   // keep the last 20
}
```

Beat analysis is cached per user, keyed by the audio file's content hash. Rendered MP4s are stored in the user's outputs directory and served via `/outputs`.

### 7.2 Endpoints (`/api/moments`, auth + `userScope`)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | List the user's Moments |
| POST | `/` | Create a project (occasion required) |
| GET | `/:id` | Read the project and the current job state (the client polls this) |
| PUT | `/:id` | Update the project; validated |
| DELETE | `/:id` | Delete the project and its outputs |
| POST | `/:id/statements` | AI suggestions. Charges `scripts` |
| POST | `/:id/voiceover` | Script (typed or AI-written) to TTS. Charges `tts`. Reuses the story script-to-audio pieces (`refineScript`, `cleanSpeakableText`, `synthesize`) |
| POST | `/:id/render` | `{ seed? }`. Shuffle sends a new seed. Charges `render` |

**Quotas**
- No new quota buckets.
- Charging is inline with `charged(bucket, req, res)` and happens only after validation, as in `routes/ambient.js`. Polling never charges.

**Render guards**
- A second render on a Moment that is already rendering returns 409.
- Renders run inside `runExclusive` (`lib/heavyJobGate.js`), sharing the one-heavy-job-per-process gate with Story and Ambient.
- Jobs use `lib/renderJobs.js` (`createJob`, `markProgress`, `markDone`, `markError`, `persistJob`).

### 7.3 AI statements

`statements.js` follows `lib/story/scriptRefine.js`:
- `defaultLlmComplete` uses OpenAI `gpt-4o-mini` and falls back to Gemini `gemini-2.0-flash`;
- `_setLlmImpl` / `_resetLlmImpl` seams are provided for tests;
- JSON mode and tolerant parsing follow `lib/story/sceneSegmenter.js`.

The prompt includes the occasion, the details and the target count. It asks for a short title and statements in a warm, faith-friendly voice, and asks for no invented facts about the person beyond the details given. For church occasions, it also asks for **one verse reference only**. The verse text is never taken from the LLM:
1. the reference is checked with `normalizeReference` (`lib/bible/bibleReference.js`);
2. the text is fetched with `lookupVerses(reference, 'kjv')` (`lib/bible/scriptureApi.js`).

An invalid reference or a failed lookup drops the verse silently.

**Output** is `{ title, statements: [], verse?: { reference, text } }`. It is clamped as follows:
- title ≤ 40 characters;
- each statement ≤ 60 characters;
- at most the count allowed for the length.

**On any failure** (error, timeout of 15 s, or unusable JSON), the occasion's template statements from `occasions.js` are returned with the `{name}` and `{milestone}` placeholders filled. A request always yields editable statements.

## 8. Render pipeline (`renderStage.js` + `motion/render.js`)

The render runs as a background job. The stages, with their share of the progress bar, are:

1. **Prepare (0–10%).** Resolve each photo through `resolveOwnUpload` or the library, apply the EXIF rotation, and scale once to a working size (long side 2160). Unreadable photos are skipped and noted. If fewer than 3 usable photos remain, the job fails.
2. **Analyse (10–20%).** Run beats from the cache, or compute them; get voiceover pauses; then direct, validate and save the plan.
3. **Shots (20–75%).** Render each shot to a short 1080×1920, 30 fps intermediate clip. Progress advances per shot. Rendering shot by shot keeps memory flat.
4. **Join (75–85%).** Apply each shot's entrance, and join the clips.
5. **Finish (85–100%).** Burn the statements in as an ASS file (Studio engine) and apply the overlays. Mix the audio: the song window, plus the voiceover with sidechain ducking as in `storyRender.js`. Normalise loudness and encode H.264/AAC.

**Rules**
- Use only ffmpeg 5.1-compatible filters, passed via `-filter_complex_script` (prod runs 5.1.9).
- The ASS side files and intermediates live in a per-job work directory, removed in a `finally` block.
- A cancel signal kills the running ffmpeg.

## 9. Validation and safety

| Input | Rule |
|---|---|
| Photos | 3–20. Each ref must be the user's own upload or library item, within the `resolveOwnUpload` limits (25 MB, side ≤ 8192, ≤ 40 MP). |
| Song ref | A valid `library:`, `mylib:` or own-upload ref. |
| Title / statements | Title ≤ 40 chars, statements ≤ 60 chars, ≤ 8 statements. Text goes through the existing ASS escaping in the kinetic engine, so users cannot inject override tags. |
| Details | Each field ≤ 80 characters, plain text. |
| Enums | `occasion`, `style`, `lengthSec` come from fixed lists. `energy` is clamped to 0–1. `seed` is normalised. |
| Ownership | Every project read and write is scoped to `req.ctx` user. Other users' IDs return 404. |

## 10. Failure handling

| Failure | Behaviour |
|---|---|
| AI statements fail or time out | Occasion templates are returned; the user always gets editable text |
| Some photos unreadable | Skipped; the result lists them. Fewer than 3 usable photos means the job fails with "Need at least 3 readable photos" |
| No clear tempo | Pulse grid (or voice pauses, if there is a voiceover) |
| Voiceover TTS fails | The step shows the error; the project is untouched |
| Render fails | Job `error` with a friendly message; detailed server log. As in Ambient, the render charge stands and the user presses Make it again |
| Server restarts mid-render | `reconcilePersistedJobs` marks the job `interrupted`. Moments are short, so the UI offers **Make it again** rather than resume |

## 11. Testing

The coverage target is 80%+ on all new modules.

### 11.1 Engine unit tests

- **`beats.js`**
  - Synthetic click tracks at 90, 120 and 150 BPM give tempo within ±1 BPM and beat times within ±30 ms.
  - A track with a loud section has that section chosen as its window.
  - Silence and noise return `tempo: null`.
  - `pausesFrom` finds the gaps in a synthetic tone-silence-tone signal.
- **`director.js`**
  - The same seed gives an identical plan; a different seed gives a different plan.
  - The Energy bands produce the specified shot lengths, within the 0.35–4 s clamp.
  - No consecutive repeats.
  - The strongest effects land on downbeats.
  - The hero opens and closes the video.
  - Too-many-photos produces the warning; too-few-photos reuses photos without consecutive repeats.
  - Statements start on downbeats and never overlap.
  - Effects with unmet `needs` are never chosen.
- **`plan.js`:** malformed plans are rejected with clear messages.
- **Effects**
  - A snapshot of each `build()` output.
  - Every filter name used is on an allow-list of ffmpeg 5.1 filters.
- **`styles.js`:** every palette entry names an existing effect.

### 11.2 Moments tests

- **`statements.js`**, with the LLM stubbed through the seam:
  - valid JSON;
  - malformed JSON leads to the templates;
  - a timeout leads to the templates;
  - the count matches the length;
  - character clamps;
  - the verse text comes from the stubbed `lookupVerses`, never from the LLM;
  - an invalid reference drops the verse.
- **Routes**
  - Auth and per-user isolation.
  - Validation errors.
  - 409 when already rendering.
  - The quota is charged exactly once, only after validation.
  - Polling never charges.
- **Render stage**, with the ffmpeg runner stubbed:
  - stage order and progress;
  - unreadable-photo skip and abort;
  - work-directory cleanup on failure;
  - interrupted jobs.

### 11.3 Real render

- **Smoke test.** A 15 s Moment from 4 small generated photos and a 3 s tone, rendered by real ffmpeg. It asserts:
  - the MP4 exists;
  - it is 1080×1920;
  - it runs 15 s ± 0.1 s.

  It is skipped only when ffmpeg is unavailable, the same rule as the kinetic render tests.
- **Manual check before the PR.** All four styles at calm and hype, rendered locally with the operator's 12 photos. A contact sheet and the videos go to the operator for judgement.

### 11.4 Client

- **Wizard**, tested with Vitest + Testing Library:
  - the occasion sets the defaults;
  - Make it is enabled with photos plus an occasion;
  - statement edit, reorder and Reshuffle;
  - the length-fit warning;
  - polling states lead to the result, Shuffle and Download.
- **Browser pass.** A full run on the local stack, from upload to render to playback.

## 12. Constraints

- **Prod environment:**
  - ffmpeg 5.1.9;
  - Cloudflare caps request bodies at 100 MB, so photos are uploaded individually, never as one request.
- **No new runtime dependencies on the server in Phase 1.** Beat detection is plain JS over PCM from ffmpeg.
- **Never echo `.env` values.** The repo is public.
