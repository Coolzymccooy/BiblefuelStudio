# AI Scenes: moving AI video for Series Bible passages

**Date:** 2026-10-16
**Status:** Draft for the operator's review. Nothing is built until it is approved.
**Provider:** BytePlus ModelArk, Dreamina Seedance (account active, $30 AI Savings Plan, Seedance 2.0 and 2.0 Mini activated)

## 1. What we are trying to achieve

**In the operator's words:** make 30-second to 3-minute videos for his own curated content. Series sessions should get *real visuals* for Bible passages, and the same engine should later serve his music records. Budget is about £30 a month.

**What this design delivers (phase 1 and 2):**
- A Series part (a Bible passage) goes to Story Video, as it does today.
- Each Story scene can then be **animated**: its still picture becomes a short Seedance video clip that starts from that picture and moves.
- The Story render already plays video clips in scenes, so the finished video is narration, captions and music over moving scenes.
- A monthly spending cap stops generation before the operator's BytePlus balance is exceeded.

**Success looks like:**
- A Series part of 30 s to 3 min renders with every scene moving, in one click after the pictures are ready.
- The cost shown before generating matches what BytePlus charges, to within about 10%.
- Generation never goes past the monthly cap, and a failed clip never blocks the render (the scene keeps its picture).
- A server restart in the middle of generating does not lose the clips already paid for (lesson from #55).

**Assumptions (please correct):**
1. **Only the operator's account** (super_admin, and premium if he chooses) can generate AI scenes. Free users must never spend his BytePlus balance.
2. **Default model:** Seedance 2.0 Mini at 720p. It is the cheapest (40% of list price during the current promotion) and the 2026-10-16 test showed good quality. Seedance 2.0 at 1080p is an option per project.
3. **Default cap:** $30 a month, matching the Savings Plan.
4. **Silent clips:** Seedance never makes sound. The narration and music come from BibleFuel, as now.
5. **Music videos** (songs such as "Grace Beyond the Race") are **phase 3**, a separate spec. They share the provider and the cap built here.

## 2. Evidence from the test (2026-10-16)

- Five clips for the first 45 s of "Grace Beyond the Race": Seedance 2.0 Mini, 720×1280, 24 fps, no sound.
- 998,100 tokens: about **$3.49 at list price, about $1.40** with the promotion.
- Tokens match the official formula: duration × width × height × fps / 1024. For a 5 s clip, 720×1280×24×5/1024 = 108,000; BytePlus billed 108,900 because the clip was 5.04 s.
- Quality: the same character held across five separate prompts, lighting was cinematic, and no stray text appeared. Saved in `Documents\BibleFuel\ai-scenes-test-2026-10-16`.
- **API flow:**
  - `POST /api/v3/contents/generations/tasks` with `{model, content:[{type:"text"…}], ratio, resolution, duration, generate_audio:false, watermark:false}`. It returns an id.
  - `GET …/tasks/{id}` returns `status` and, when it has succeeded, `content.video_url` and `usage.completion_tokens`.
  - Clips took about 1–3 minutes each, and several ran in parallel.

## 3. How it fits what already exists

These things are already in master:

| Already there | Where | How AI Scenes uses it |
|---|---|---|
| A scene can hold a video clip (`videoPath`, `videoUrl`, `mediaKind:"video"`, poster in `imagePath`) | `server/src/lib/story/sceneVideo.js`, `routes/story.js` `PUT /:id/scenes/:sid/image` | The generated clip is stored in exactly these fields |
| The render plays a scene clip (looped, trimmed to the scene, sound dropped) and falls back to the poster if the file is missing | `server/src/lib/story/storyRender.js` L283–330 | No render changes are needed |
| Series part → Story Video | `client/src/pages/SeriesPage.tsx` `sendPartToStory`, `client/src/lib/sendToStoryVideo.ts` | Gains an "AI motion" option |
| A video-generation seam with a provider chain | `server/src/lib/videoGen/index.js` (`listVideoProviderChain`, `VIDEO_GEN_PROVIDER`), `providers/veo.js` | Seedance becomes a second provider beside Veo |
| A per-user scope with its own data and output folders | `middleware/userScope.js`, `lib/paths.js` | The clips and spend ledger live per user |

## 4. Design

### 4.1 Seedance provider

**New file:** `server/src/lib/videoGen/providers/seedance.js`

- `isSeedanceConfigured()` returns true when `BYTEPLUS_ARK_API_KEY` is set.
- `generateVideoSeedance({ prompt, firstFrameImagePath, aspect, durationSec, resolution, model, signal })`:
  - Sends an **image-to-video** request when a first frame is given, attaching the scene's picture as an image item in `content`. That keeps the clip faithful to the picture and to the Story cast. Otherwise it sends text-to-video.
  - Clamps the duration to whole seconds within the model's range. 4–12 s is the safe range for 2.0 Mini; confirm the upper limit against the official API reference before building.
  - Accepts `9:16`, `16:9` and `1:1`.
  - Polls every 10 s until the task succeeds or fails, up to 15 minutes. Cancels with the given `signal`.
  - Downloads the MP4 at once, because BytePlus links expire after 24 h.
  - Returns `{ ok, taskId, tempFile, completionTokens, model }`, or `{ ok:false, code, error }`. A content-moderation refusal comes back as code `REFUSED`, so the UI can ask for a gentler prompt; BytePlus does not charge for it.
- **Environment variables:**
  - `BYTEPLUS_ARK_API_KEY` (already set locally and in Coolify);
  - `BYTEPLUS_ARK_BASE_URL`, default `https://ark.ap-southeast.bytepluses.com/api/v3`;
  - `SEEDANCE_MODEL`, default `dreamina-seedance-2-0-mini-260615`;
  - `SEEDANCE_RESOLUTION`, default `720p`.
- **`videoGen/index.js` changes:** add `seedance` to `listVideoProviderChain`. In `auto` mode Seedance comes first and Veo is the fallback; `VIDEO_GEN_PROVIDER=seedance` forces it. Also pass `seedImagePath` through to the provider, which the current code drops.

### 4.2 Spend ledger and cap

**New file:** `server/src/lib/videoGen/spend.js`

- **Price table**, per model: dollars per million tokens without and with video input, and the promotion multiplier. The values come from BytePlus's pricing page of 2026-10-08:
  - Mini: $3.5 without video input, $2.1 with;
  - 2.0: $7.0 at 720p and $7.7 at 1080p;
  - Fast: $5.6.

  One place to update when prices change.
- `estimateTokens({ durationSec, width, height, fps:24 })` uses the formula above. `estimateUsd(model, tokens)` turns tokens into dollars.
- **Ledger:** `<dataDir>/videogen-spend.json` holds `{ month:"2026-10", usd, tokens, clips }`. It is written atomically and resets when the month changes.
- **Cap:** `VIDEO_GEN_MONTHLY_CAP_USD`, default 30.
  - Before a batch, **reserve** the estimated cost. If the reservation would cross the cap, refuse with a plain message: "This would take October's AI video spend to $31.20 of $30."
  - After each clip, settle against BytePlus's real `completion_tokens`.
  - Reservations not used (failures, cancels) are released.
- **Plan gate:** a new `videoGen` bucket in `middleware/quota.js`. The free plan gets 0; premium and super_admin follow the cap.

### 4.3 Story: an "Animate" stage

**Scene fields added:**
- `aiVideoStatus`: `none | queued | generating | done | error`;
- `aiVideoTaskId`;
- `aiVideoError`;
- `aiVideoModel`;
- `aiVideoCostUsd`.

A finished clip sets the existing `videoPath`, `videoUrl` and `mediaKind:"video"`, and keeps the picture as the poster.

**New routes** in `routes/story.js`, all requiring the `videoGen` plan gate:
- `POST /:id/animate/estimate`: given `{ sceneIds? }`, returns `{ clips, seconds, usd, monthSpentUsd, capUsd }`.
- `POST /:id/animate`: given `{ sceneIds? }` (omitted means every scene with a picture), runs detached.
- `POST /:id/scenes/:sid/animate`: one scene, including a re-roll.
- `POST /:id/animate/cancel`.

**How the stage runs** (`server/src/lib/story/animateStage.js`):
- Up to 3 scenes at once. BytePlus allows 10, but 3 keeps the server's download and normalise work light.
- **Prompt:** the scene's existing `imagePrompt`, plus a motion line chosen from the project style, plus "No text, no captions, no logos." Example: "slow push-in, gentle light shift, subtle natural movement".
- **Clip length:** the scene length, rounded up to a whole second and clamped to the model's range. Longer scenes loop, as the render already does. The Series flow asks the segmenter for scenes of 12 s or less, so loops are rare (see 4.4).
- **Finishing each clip:** pass the downloaded file through the existing `resolveSceneVideo` normalise step, then write the scene fields. The project is written after every clip, so progress survives a crash.
- **Restart resilience:** `aiVideoTaskId` is saved **before** polling begins. On boot, a sweep finds scenes still `queued` or `generating` with a task id, and resumes polling those tasks. Clips already paid for at BytePlus are collected, not re-bought. A task older than 24 h is marked `error` ("expired at BytePlus — re-animate").
- **Failures:** a failed clip leaves the scene's picture in place with `aiVideoStatus:"error"`. The render never waits for animation.
- **Cancel:** it stops polling and submitting. Tasks already submitted may still finish at BytePlus and be charged, and the UI says so.
- **Choosing a new picture:** an existing rule clears a scene's video when a new picture is set. That still applies, and it also resets `aiVideoStatus`.

### 4.4 Series: an "AI motion" option

- **The Series part card** (`SeriesPage.tsx`) gains an **"AI motion"** toggle beside "Send to Story Video". It only shows when the plan allows it. It displays the estimate, for example "about 6 clips · ≈ $0.90".
- **`narrateAndSendToStory`** passes `{ aiMotion: true, aspect: "9:16" }` to `import-script`. The project stores `aiMotion` and targets 12 s scenes.
- **When the images stage finishes on an `aiMotion` project**, the server starts the Animate stage on its own, within the cap. If the cap would be crossed, it animates as many scenes as fit and shows "3 of 6 scenes animated: monthly AI budget reached".

### 4.5 Client

**Story scene card:**
- an **Animate** button showing the price for that scene;
- a **Re-roll**;
- a small status badge: queued, generating, done or failed;
- a hover or tap preview of the clip.

**Story header:**
- **Animate all scenes · ≈ $X**, using the estimate endpoint, with "October: $4.20 of $30 used" beside it;
- a confirmation step before spending more than $2 in one go.

**Settings (admin):** model (2.0 Mini or 2.0), resolution (720p or 1080p), and the monthly cap readout. The API key stays in env and is never shown.

**Design rules:** follow `DESIGN_QUALITY_STANDARD`.
- Existing button styles (`secondaryBtnCls`) and the shared tokens.
- No glows.
- Plain-language labels.
- Money shown with tabular numerals.

## 5. What it costs (Seedance 2.0 Mini, 720p, current promotion)

| Video | Clips | Generated seconds | Approx. cost |
|---|---|---|---|
| 30 s Series part | 3–4 | about 30 | $0.35 |
| 90 s part | 8 | about 90 | $1.00 |
| 3 min part | 15 | about 180 | $2.00 |

- After the promotion ends, multiply by 2.5.
- Seedance 2.0 at 1080p costs about 4.6 times the promotional Mini rate.
- At these rates, $30 covers roughly 15 three-minute videos a month, or many more short ones.

## 6. Out of scope

- Music videos from songs (phase 3, separate spec). These are lyric-timed scenes, possibly using Seedance 2.5's song-audio reference, which needs the 2.5 reserve fund.
- Seedance 2.5, Veo and other providers beyond keeping the provider chain.
- Animating Ambient, Moments or Timeline (they can reuse the provider later).
- Clips longer than one generation (Seedance's "extend").

## 7. Testing

**Provider:** a fake `fetch` covers:
- the request body for both text-to-video and image-to-video;
- a create error;
- polling through `queued`, `running` and `succeeded`;
- a `failed` task and a moderation refusal;
- a timeout and a cancel;
- download, plus the fact that the key never appears in errors or logs.

**Spend:**
- the estimate formula against the 2026-10-16 measurements;
- the month rollover;
- reserve, settle and release;
- the cap refusal, with its exact message;
- partial animation when the cap is crossed mid-batch.

**Animate stage:**
- concurrency;
- per-scene failure leaves the picture;
- progress is written after every clip;
- the boot sweep resumes a saved task id and does not resubmit;
- cancel;
- a new picture clears the clip.

**Routes:**
- the plan gate (free plan is refused);
- the estimate endpoint;
- the single-scene re-roll.

**Render:** a project with a mix of AI clips and pictures renders. The existing path is checked on ffmpeg 5.1.9.

**Client:** buttons, badges, the estimate text, the confirmation above $2, and the Series toggle shown only to allowed plans.

**Manual on production:** one 30 s Series part with AI motion, with BytePlus usage compared to the ledger.

## 8. Rollout

**Phase 1:**
- the provider and spend ledger;
- Story's per-scene Animate and Animate-all;
- the boot sweep;
- one PR.

**Phase 2:**
- the Series toggle;
- automatic animation after images;
- 12 s scene targeting;
- one PR.

Each phase goes through a PR and a Codex review, and is merged on the operator's go-ahead. Merging will not interrupt a live render; see #55 and #56.
