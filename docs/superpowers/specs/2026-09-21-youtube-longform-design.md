# YouTube long-form — income layer on top of the Shorts funnel

**Date:** 2026-09-21
**Branch:** feat/unified-editor-quick-jobs
**Status:** Design approved in chat (4 sections), pending spec review

## Goal

Turn BibleFuel from a Shorts machine into a channel that can actually earn: **scripted
long-form (16:9, 30–60 min sleep/scripture sessions first, 8–12 min mini-docs second) on
the existing @Biblefuel YouTube channel, 3 a week, batched, reviewed, scheduled.** Shorts keep
running unchanged as the discovery funnel.

Economics that decide the shape (2026 figures, faith niche): Shorts pay ~$0.05–0.10 RPM;
faith long-form ~$4–12 RPM; sleep/prayer content skews higher. Monetisation needs 1,000 subs
+ 4,000 public **watch hours** in 12 months — only long-form accrues those. A human review
gate before anything goes public is also the practical defence against YouTube's July-2025
"inauthentic content" policy on mass-produced repetitive AI uploads.

## What already exists (verified in code, not assumed)

- **Story Video** is a full narration-to-video pipeline: upload/import → Whisper word timings
  (`lib/stt`, local or OpenAI) → LLM scene segmentation (`lib/story/sceneSegmenter.js`, capped
  at `STORY_MAX_SCENES` = 60, widened for long audio) → one AI image per scene in 4 styles →
  Ken Burns + crossfades + kinetic captions (`storyRender.js`; kinetic off past
  `STORY_KINETIC_MAX_WORDS` = 1500) → render. **No duration cap** on this route.
- **Timeline** editor: 4 lanes, landscape 16:9, no duration cap; ffmpeg input ceilings of 24
  B-roll / 24 VO clips (`timelineRender/proofRenderer.js`). Its `ShareKitPanel` posts direct to
  `/api/social/post` with a YouTube privacy picker.
- **TTS**: ElevenLabs, Fish, Azure, Chatterbox (self-hosted), Edge, Piper via
  `lib/voice/registry.js`. **No chunking anywhere** — `story/script-to-audio` sends the whole
  script in one call.
- **YouTube**: OAuth (`youtube.upload` + `youtube.readonly`), `videos.insert` with title +
  description + privacy only (`routes/social.js` `postToYoutube`). `youtube.readonly` is only
  used for `channels.list`.
- **Automation**: cron `auto_generate` → `campaign_auto_post` job, capped at
  `MAX_RENDER_SECONDS` (180 on prod). Shorts-only by construction.
- `import-script` seam on Story (`routes/story.js`) accepts pre-written text + audio + optional
  word timings and lands the project at SEGMENTING. This is the integration point for all
  long-form work.

## Gaps this design closes

| # | Gap | Where | Section |
|---|---|---|---|
| 1 | Upload sends title + description only — no thumbnail, tags, category, `publishAt` | `social.js` `postToYoutube` | 1 |
| 2 | Remote-URL upload buffers whole file in RAM (`Buffer.from(await resp.arrayBuffer())`) — OOM on a 60-min 1080p file | `social.js` `resolveVideoInputForUpload` | 1 |
| 3 | Automated loop is Shorts-only; Story/Timeline have no scheduler | `jobs.js`, `social.js` | 4 |
| 4 | No long-form script structure; templates top out at 60s; no TTS chunking | `story/scriptTemplates.js`, `scriptRefine.js`, `script-to-audio` | 2 |
| 5 | Scene cap and kinetic cutoff are global, not per format | `sceneSegmenter.js`, `storyRender.js` | 2 |
| 6 | Analytics scope granted, never used | `social.js` | 4 |

## Approach chosen

**C — Story pipeline as the render engine, wrapped in a reviewable long-form plan.**
Rejected: **A** alone (manual forever), **B** (a second render engine in the ~1,950-line
`jobs.js`, and unattended public long-form is the demonetisation pattern).

Build order: Section 1 → 2 → 3 (Phase 1, ships real 30–60 min videos) → Section 4 (Phase 2).

## Channel decision

All BibleFuel content stays on the existing **@Biblefuel** channel (keep history + subs).
Lumina demo videos (Aethercast, `aether2`) go to a separate **Lumina Presenter** brand
channel later — one Google account can own several channels; never re-authorise the
BibleFuel social store against the Lumina channel.

---

## Section 1 — YouTube publish upgrade

### Server (`routes/social.js` + new `lib/social/youtubePublish.js`)

`postToYoutube` accepts a full metadata payload:

- `title` (≤100), `description` (≤5000), `tags[]` (≤500 chars total), `categoryId`
  (default `"22"` People & Blogs), `publishAt` (ISO datetime, must be in the future).
- **`publishAt` forces `privacyStatus: "private"`** (YouTube API requirement; the video flips
  public itself at that time). The response states this rather than letting YouTube reject.
- `thumbnailPath` (output alias or URL) → `youtube.thumbnails.set` immediately after
  `videos.insert`. Same `youtube.upload` scope — no re-consent. If YouTube refuses (channel
  not phone-verified), the post still succeeds and the response carries `thumbnailError`.
- Pure `buildYoutubeDescription({ summary, chapters, links, hashtags })`: chapters need ≥3
  `MM:SS Title` lines starting at `00:00`; derived from Story sections/scenes. Unit-tested.
- Validation up front with **named** errors (title too long, `publishAt` in the past, tags
  over budget). A scheduled failure must say why.
- **Streaming fix**: `resolveVideoInputForUpload` pipes `resp.body` to the temp file with
  `stream/promises.pipeline` instead of buffering. Local-alias paths stay zero-copy.

### Client — one shared `YoutubePublishPanel`

Extracted from the YouTube branch of `components/timeline/ShareKitPanel.tsx`, used in:
Timeline (replacing that branch), Story Video output step (new — today it has no publish
surface), and Render/Jobs `ShareSheet` as a direct-YouTube option beside Postiz. Fields:
title, description (prefilled from the script), tags, publish-at date/time, thumbnail picker
(Story scene images or upload).

### Out of scope
Playlists, title A/B testing, AI thumbnail generation (Section 2 owns that).

### Tests
Unit: description/chapters builder; payload validator; `publishAt`→private rule.
Route: `/api/social/post` with mocked `googleapis` asserting `videos.insert` +
`thumbnails.set`; streamed-download path with mocked `fetch`.

---

## Section 2 — Long-form templates (new `server/src/lib/longform/`)

The core new piece is **chunked narration**, not templates: ElevenLabs caps a request at
5k chars (40k on higher tiers), Azure at ~10 min audio, Chatterbox at a few hundred chars
for good quality; a 60-min session is ~50k chars.

### `templates.js` — pure definitions
Phase 1: `sleep-30`, `sleep-60`. Phase 2: `minidoc-10` (same shape). Each declares:
- structure prompt, target length, pacing (sleep ≈ 110 wpm, mini-doc ≈ 150)
- scene policy: `targetSceneSec`, `maxScenes`, captions `none | static | kinetic`
  (sleep = `none`, ~10–12 scenes, ~20s crossfades)
- voice policy: provider preference (Chatterbox/Azure first for sleep; ElevenLabs for
  mini-docs), speaking rate, pause between blocks (sleep 4–6s)
- music policy: bed volume, no auto-duck for sleep
- thumbnail prompt template

### `scriptPlanner.js` — two-step LLM
Outline first (sections with headings + target durations), then per-section text.
**Scripture is never LLM-written**: the planner picks references, `lib/bible` fetches exact
verse text, the model writes only the reflections between verses. Sleep structure: gentle
intro → N × (verse read slowly → short reflection → pause) → closing blessing. Output is
`sections[]` `{ heading, reference?, text, targetSec }` — also the source of Section 1's
chapter timestamps.

### `narration.js` — chunked TTS
Split by section then sentence to stay under the chosen provider's limit; synthesise
sequentially through the existing voice orchestrator; insert the template's silence between
blocks with ffmpeg; concatenate. Record each chunk's duration so **section start-times are
known without word timings** (sleep sessions have no captions → no alignment, no Whisper).
Each chunk cached by content hash so a failure at chunk 40/60 resumes.

### Integration
Result flows into Story `import-script` with `sections` (each carrying its measured
`startMs`/`endMs`) and `captions: "none"`. Today an import without `words` falls through to
the Whisper transcribe stage; the import path must **skip transcription when captions are
`none`** and segment on section timings instead of word timings. `segmentScenes` takes
per-project `targetSec` / `maxScenes` overrides (instead of the global cap); `storyRender`
honours captions `none`. Story project gains
`longform: { templateId, sections }`. **No changes to the render engine.**

### UI
Story Video → *Write a script* tab: Long-form template picker (template, duration, voice).
Shows the generated outline as editable text before narration; per-chunk progress bar; then
the existing scenes → images → render → (Section 1) publish steps.

### Accepted constraints
60-min 1080p render on prod is slow (batch day, not real-time). ~12 images per session is
well inside image-gen quota. Windows `ENAMETOOLONG` does not apply (no kinetic captions on
sleep; prod already uses `-filter_complex_script`, ffmpeg 5.1).

### Judgment calls (operator accepted)
(a) Chatterbox/Azure as default sleep voice, not ElevenLabs. (b) No captions on sleep sessions.

### Tests
Templates (pure); planner prompt builder + parser with fake LLM; chunker (sentence-boundary
splits under limit, offset arithmetic, silence insertion); resume-from-cache; segment
override; story route test that a long-form import lands at SEGMENTING with sections intact.

---

## Section 3 — Inspiration → draft

One text box ("What's on your heart?") in the Create flow: a verse, a phrase, a theme, or a
voice note → a long-form **draft** you edit before anything is synthesised or rendered.

### Server
- `POST /api/longform/draft { idea, templateId?, durationSec? }` → runs `scriptPlanner` with
  the idea as seed → creates a Story project at new status `DRAFT_SCRIPT` with
  `longform.sections` filled and no audio. If no template given, the planner suggests one
  (verse about rest → sleep; story/question → mini-doc) and says so in the response.
- `POST /api/story/:id/narrate` = approve: kicks off chunked narration, continues down the
  existing pipeline. Refuses on a project with no sections.
- Voice notes: audio upload → existing `transcribeAudio` → idea text. No new STT code.

### UI
Reuses Section 2's outline editor; draft opens straight into it. Drafts appear in Recent
Projects with a "Draft" badge so Tuesday's idea is still there on batch day.

### Deliberately not building
Auto-narrating drafts, auto-publishing drafts, "generate 10 ideas".

### Tests
Route: idea → project at `DRAFT_SCRIPT` with sections, no audio. Template suggestion (pure).
`narrate` refuses without sections.

---

## Section 4 — Weekly planner + analytics (Phase 2)

### Server
- `lib/longform/weeklyPlan.js` — per-user plan in the social store:
  `{ cadence: { sleep: 2, minidoc: 1 }, slots: [{ dow, time }], plan: [{ slotAt, projectId, status }] }`.
  Pure functions: next-week slots from cadence + timezone; assign projects to slots.
- `POST /api/longform/plan/generate` — for each empty slot, run the planner with a **topic
  rotation** (extend `highPerformerProfile`'s deterministic rotation to long-form themes;
  sleep sessions rotate Psalms/Isaiah/John) and drop a waiting inspiration draft into a slot
  if one exists. Output: one `DRAFT_SCRIPT` project per slot.
- `POST /api/longform/plan/approve { projectId }` — enqueues a `longform_publish` job:
  narrate → segment → images → render → thumbnail → Section 1 upload with the slot's
  `publishAt`. Sequential on the worker (a batch of 3 must not triple-load prod ffmpeg).
- Optional cron: `auto_generate` gains a third type `longform_drafts` that **only ever
  produces drafts** — never a public video. That line is what separates this from Approach B.
- **Analytics** (gap 6): nightly job calls `videos.list` (`statistics`, `contentDetails`) for
  the channel's last 30 uploads; stores views / average view duration per template + topic;
  planner shows "best performing this month" and the rotation weights toward it. Read-only,
  already-granted scope.

### UI
"This week": one card per slot — date/time, template badge, title, outline preview,
thumbnail, status (draft → approved → rendering → scheduled → live + YouTube link). Actions:
edit outline, swap in an inspiration draft, approve, skip. "Generate drafts for next week" at top.

### Tests
Slot computation across timezone/DST (pure); rotation determinism; approve enqueues exactly
one job; `longform_drafts` cron never sets a public privacy; analytics parser with fixtures.

---

## Non-goals (whole design)
- No second render engine; no changes to the Shorts `campaign_auto_post` path.
- No unattended public long-form uploads at any phase.
- No new Google account / channel for BibleFuel content.
- No Postiz dependency (parked).

## Deploy note
Per project workflow: client must be `npm run build`'d locally and `server/public/**`
committed before deploy; operator decides push/deploy timing per change.
