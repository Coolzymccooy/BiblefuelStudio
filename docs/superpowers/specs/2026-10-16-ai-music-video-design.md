# AI music videos (AI scenes phase 3)

**Date:** 2026-10-16
**Status:** Written overnight on the operator's instruction ("complete phase 2 and 3, test and deploy if pass"). Every open decision is recorded below as a **Ruling**, so the operator can reverse any of them in the morning.
**Builds on:**
- `2026-10-16-ai-scenes-design.md` (provider, spend ledger, cap, Animate stage, Phase 2 auto-animate);
- the song-mode lyric video (upload, lyrics sheet, timing, captions, branding).

## 1. Goal

Turn one of the operator's songs into a music video whose scenes are AI pictures that move (Seedance), cut on the song's own sections, with the song as the soundtrack. Kinetic lyric captions are optional. The existing renders do all the work; this phase is a bridge plus a lyric-aware scene writer.

**Success:**
- From a timed lyric project, one click makes a Story project with one scene per section, split to at most 12 s. Each scene has a lyric-aware picture prompt, and its pictures are generated and then animated within the cap.
- The Story render plays the song untouched (no narration, no music bed) under the moving scenes.
- The finished Story video can become the lyric video's background in one click, so the lyric render adds the kinetic captions, branding and end card over it.
- Only super admins see or can use any of it.

## 2. What already exists (measured 2026-10-16)

| Piece | Where | Use |
|---|---|---|
| Song upload, lyrics sheet, timing (words, lines, sections with `start`) | `routes/lyricVideo.js`, `lib/lyricVideo/*` | Source of scene boundaries and lyric text |
| Story import with a given transcript; `segmentStage` skips when scenes exist | `routes/story.js` | Build the project directly from sections |
| Story render plays `source.audioPath` as the only track when `music.path` is null | `lib/story/storyRender.js` | The song is the soundtrack, untouched |
| `aiMotion` + auto-animate after pictures (Phase 2) | `lib/story/autoAnimate.js` | Pictures then motion with no clicks |
| Lyric background accepts any `.mp4` under the user's output dir | `PUT /api/lyric-video/:id/background` | Captions over the AI video |

## 3. Design

### 3.1 Scene plan from the song (pure function)
New `server/src/lib/musicVideo/scenePlan.js`, `planMusicScenes({ sections, lines, durationSec, maxSec = 12, minSec = 4 })`:
- **Boundaries:** each section that has a `start` runs to the next section's `start`. The last one runs to the song's end, which is `timing.audibleEnd` when set and `durationSec` otherwise. A section with no `start` is skipped; its lines fold into the section before it.
- **Long sections** (over `maxSec`) are split at line starts into pieces of at most `maxSec`. A line that is itself longer than `maxSec` is split evenly. A piece shorter than `minSec` is merged into its neighbour.
- **No sections:** if no section has a start, the whole song is cut at line starts into pieces of about 8 s, with the same rules.
- **Intro and instrumental gaps:** a stretch with no lyric lines still gets a scene, with empty text and kind `instrumental`.
- **Output:** `[{ startMs, endMs, kind, label, text }]`, contiguous from 0 to the end.

### 3.2 Picture prompts (one LLM call)
New `server/src/lib/musicVideo/scenePrompts.js`, `writeMusicPrompts({ title, artist, scenes, character, llm })`:
- **One call** (the same `_llm` helper the segmenter uses) returns a JSON array with one `imagePrompt` per scene. It is told:
  - each prompt is one cinematic music-video shot;
  - prompts follow the song's story;
  - the same `character` description is repeated whenever the singer or protagonist appears;
  - chorus scenes revisit a recurring visual motif;
  - no text, captions or logos.
- **Fallback** (LLM error or wrong count): `"<character>, cinematic music video shot, <section label>: <first lyric line>"`. A build never fails on prompts.
- **Ruling:** the default `character` is empty. The operator can type one ("a young Black African man in his late twenties, short hair, plain olive shirt" kept one man across five clips on 2026-10-16). The prompt then says "the singer" generically.
- **New style anchor** `music-video` in `styleAnchors.js`: "cinematic music video still, natural film grain, motivated practical light, shallow depth of field, no text, no watermark". It has no aspect words, unlike the biblical anchors, which say "vertical 9:16".

### 3.3 The bridge route
`POST /api/lyric-video/:id/to-story` (`requireSuperAdmin`), with body `{ aspect?: "portrait"|"landscape"|"square", character?: string, aiMotion?: boolean, quality?: "standard"|"high" }`:
- **Refuses:**
  - 409 when the song has no timed lines ("Run Timing first.");
  - 409 while timing or a render runs (existing `busy`).
- **Builds the Story project:**
  - title `"<song title> · music video"`, style `music-video`, `captions: "none"`;
  - `source.audioPath` is the song file and `durationMs` is its length;
  - `transcript.words` comes from the timed lines (seconds to ms);
  - `music` is null;
  - `scenes` come from 3.1 and 3.2, with `imageStatus: "pending"`;
  - `aiMotion` is set when the body asks for it (and Seedance is configured);
  - status `GENERATING_IMAGES`.
- **Then** runs the Story images stage detached. When pictures finish, Phase 2's hook auto-animates within the cap.
- **Records** `musicVideo: { storyProjectId, createdAt }` on the lyric project and answers `{ ok, storyProjectId }`.
- **Seam:** the Story side needs a small exported helper (`createStoryFromScenes(ctx, {...})` plus `startStoryImages(ctx, projectId)`), so the lyric router never writes Story files by hand.

### 3.4 Captions over the AI video
`POST /api/lyric-video/:id/use-story-video` (`requireSuperAdmin`):
- Takes the linked Story project's finished render (`render.outputPath`, status done).
- Sets it as the lyric background through the same validation as `PUT /:id/background`, with fit `auto`.
- 409 "Render the music video in Story Video first." when there is none.

The operator then renders the lyric video as usual: captions, branding, end card and Shorts trim all apply.

### 3.5 Client (lyric video page, super admins only)
- A card **"AI music video"** appears after Timing is done. It has:
  - a character field (optional, one line);
  - an "Animate the scenes" checkbox, on by default, with the estimate "about N clips · ≈ $X.XX" from `GET /api/story/animate/rates` (N from 3.1's rules, computed on the client from section starts);
  - **Make AI music video**, which goes to `/app/story?project=<id>`.
- Once a Story project is linked, the card shows:
  - **Open in Story Video**;
  - when its render is done, **Use as lyric background**.
- Existing styles, tokens, sentence case, tabular numerals and a real `<label>` for each field.

### 3.6 Lip sync: what the paid test found (2026-10-16, about $1.40)
**Route A: Seedance 2.0 Mini omni-reference.**
- **Setup:**
  1. A 5 s text-to-video clip of the singer (108,900 tokens). Seedance trusts its own face clips as input, which sidesteps the real-person refusal.
  2. An 8 s omni-reference task with that clip as `reference_video`, the first 8 s of "Grace Beyond the Race" as `reference_audio` (base64 MP3), and `generate_audio: true` (303,300 tokens).
- **Measured:**
  - The clip is 720×1280, 8.04 s, with AAC sound. The man sings with convincing mouth shapes (`Documents\BibleFuel\lip-sync-test-2026-10-16`).
  - Whisper on the generated sound: "Everybody keeps eye, when you, you become, come somebody, when you leave". It **re-sings the lyrics in its own voice and timing**.
  - **Word timings drift against the real vocal.** The real "Everybody" is at 2.44 s and the generated one at 0.00 s. "When" (second line) is at 6.32 s against 6.96 s, and "leave" at 6.66 s against 7.34 s. The envelope correlation with the real song is 0.29.
- **Conclusion:** the mouth follows Seedance's own singing, not the operator's recording. Muxing the real song over the clip (file 3 in the test folder) is visibly out of sync. Route A does **not** give true lip sync, so no "singing scene" option ships in this phase.

**Route B: OmniHuman.** It takes a picture plus audio, and the mouth is driven by that exact audio.
- It is the right tool, at a listed $0.12/s for lip sync.
- It lives in **BytePlus Vision**, a separate service from ModelArk, with its own activation and its own key. The ModelArk key cannot call it.
- **Ruling:** park it until the operator activates BytePlus Vision OmniHuman and adds its key. Then it becomes an opt-in "singing scene" per scene, reusing the ledger, the cap and the super-admin gate. Its price must be added to `spend.js` first.

## 4. Out of scope
- Transcribing a song with no pasted lyrics (timing stays lyric-primed).
- Languages other than English.
- Per-line cuts or beat-synced cuts inside a scene.
- Seedance 2.5.

## 5. Testing
- **scenePlan:**
  - sections to scenes;
  - long-section split at line starts;
  - an over-long line;
  - tiny-piece merge;
  - no sections;
  - instrumental gap;
  - contiguity from 0 to the end.
- **scenePrompts:**
  - the LLM path (stub) keeps order and count;
  - wrong count or an error falls back;
  - the character is repeated.
- **Routes:**
  - 403 for a non-super-admin;
  - 409 without timing;
  - a project is created with the right fields, and the images stage is started (stubbed);
  - the lyric project records the link;
  - use-story-video sets the background and refuses without a render.
- **Client:**
  - the card is hidden for non-super-admins and before timing;
  - the estimate text;
  - the make and use buttons call the API.
