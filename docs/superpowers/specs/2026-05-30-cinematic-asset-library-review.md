# Cinematic Asset Library — Review Against Existing Features

**Date:** 2026-05-30
**Branch:** `worktree-feat-cinematic-asset-library` (isolated worktree)
**Reviewer:** Claude (architecture review, no code changed)

This reviews the proposed *BibleFuel Cinematic Asset Library* spec against what
BibleFuel Studio already ships. Goal: identify what's already built, what
genuinely needs building, where the spec conflicts with current architecture,
and the cheapest correct path to "1000+ assets out of the box."

---

## 1. What already exists (the spec is ~40% built)

| Spec requirement | Current state | File |
|---|---|---|
| A "Library" of background assets | **Exists.** JSON-backed store with add/remove/normalize. | `server/src/lib/library.js`, `server/data/library.json` |
| Categories / collections | **Exists.** 17 canonical categories + keyword→category map. | `server/src/lib/categorize.js` |
| AI selects library before external | **Exists.** `pickBestBackground()` matches script mood→category, falls back to query, then random. | `server/src/lib/categorize.js:147` |
| Script-aware visual matching ("Sermon-Aware Director") | **Exists (basic).** `classifyScript()` weights the hook double, classifies verse/reflection/CTA. | `categorize.js:115` |
| External providers (Pexels/Pixabay) | **Exists.** Search + save into library. | `server/src/lib/pexels.js`, `pixabay.js`, routes |
| User uploads / local import | **Exists.** `POST /library/import-local` copies a folder of clips in. | `routes/library.js:138` |
| Library browse/tag UI | **Exists.** Full page with search, save, tag, delete. | `client/src/pages/BackgroundsPage.tsx` |
| AI image generation fallback | **Exists.** Cloudflare/Imagen providers for per-beat generated stills. | `server/src/lib/imageGen/` |
| Per-beat background selection in campaigns | **Exists.** Each scene picks its own mood-matched bg after TTS. | `routes/jobs.js:1134-1297` |

**Takeaway:** The *plumbing* the spec describes (a library, category tagging,
AI selection priority, render integration) is already in production. What's
missing is **content (5 items today vs. 1000+ target)** and a few **systems**
(shared catalog, usage learning, packs).

---

## 2. Gaps — what the spec adds that does NOT exist

1. **Volume of curated content.** `library.json` currently holds **5 items**.
   The spec wants 500–1500. This is the single biggest piece of real work, and
   it's a *content/curation* task more than an engineering one.

2. **Shared "Premium" library separate from user libraries.** *(Architectural — see §3.)*
   Today every library is **per-user** (`req.ctx.dataDir`). There is no concept
   of a global/seeded catalog all tenants draw from.

3. **Usage / retention learning system.** No `timesUsed`, `averageWatchRetention`,
   or `engagementScore` tracking exists anywhere (confirmed by grep). The spec's
   "AI gradually learns which visuals retain audiences" is net-new — and depends
   on retention data we don't yet ingest from any platform.

4. **Asset packs (one-click install).** `gumroadPacks.js` is a **misleading name** —
   it builds devotional *text* (markdown), not visual asset packs. No pack
   install/registry exists.

5. **Quality enforcement (1080p min, vertical/square/landscape safe).** Current
   `library.json` mixes SD (426p, 640p) and HD/4K. Nothing enforces minimum
   resolution or aspect-safety. The selection logic is mood-aware but
   **resolution/orientation-blind**.

6. **Collection taxonomy mismatch.** Spec's 8 collections (Mountains, Sky, Water,
   Worship, Abstract Motion, Glory, Warfare, Modern) don't map 1:1 to the 17
   existing categories. Needs a reconciliation layer, not a rewrite.

---

## 3. REVISED DIRECTION (2026-05-30): per-user pool + auto-select everywhere

**Decision (owner):** Drop the shared/global "Premium Library" for now. Keep the
existing **per-user library** model (`middleware/userScope.js` — each user owns
`DATA_DIR/users/<userId>/library.json`). The feature to build is the **app
auto-selecting the best background from the user's own pool**, so users don't
hand-pick a clip for every render.

**What this means:** the architectural conflict in the original spec is moot —
no merged-read, no catalog plumbing, no storage/licensing decision needed now.
The work shrinks to **wiring the auto-select capacity that already exists into
the flows that currently require a manual pick.**

### Current auto-select coverage (the actual gap)

| Flow | Auto-selects from pool? | Where |
|---|---|---|
| Campaign auto-post | **Yes** — per beat, mood-matched | `jobs.js:1297` via `pickBestBackground` |
| Single captioned-video render | **No** — client must send `backgroundPaths[]`/`backgroundIds` | `render.js:498-594` |
| Wizard / normal render UI | **No** — user manually picks | `client` wizard + `BackgroundsPage` |

`pickBestBackground(pool, { script })` is the whole engine and it's already
production-tested in campaigns. The gap is purely that **the single-render path
and the wizard never call it** — they demand an explicit background.

### Scope to build

**Owner decisions (2026-05-30):**
- **Granularity: one clip per beat.** Auto-mode picks a mood-matched clip per
  beat (like campaigns), not a single clip for the whole video.
- **Empty pool → AI-generate.** If the user's library is empty, fall back to the
  existing `imageGen/` providers (Cloudflare/Imagen) to synthesize a background
  from the script — never hard-fail the render.

1. **Server:** add an "auto" mode to the single-render path — when the caller
   omits an explicit background (or sends `background: "auto"`), read the user's
   library and run `pickBestBackground(pool, { script })` **per beat**, reusing
   the multi-background sequence support already in `render.js`
   (`backgroundPaths[]`). Reuse `pickBestBackground` verbatim; do **not** fork
   the algorithm.
2. **Empty-pool handling:** pool empty → AI-generate via `imageGen/` and use the
   generated still(s) as the background(s). No hard throw.
3. **Client:** make "Auto (let BibleFuel choose)" the **default** option in the
   wizard/background picker, with manual selection still available as override.

This is small, isolated to `render.js` + one or two client components + the
selection call, and reuses the existing mood-matching wholesale.

---

## 4. Risks & watch-items

- **Pexels/Pixabay licensing & hotlinking.** `library.json` stores Pexels CDN
  URLs directly. Shipping 1000 hotlinked third-party URLs as "BibleFuel Premium"
  is a licensing and reliability risk (CDN can 404, ToS on redistribution).
  A curated *premium* library implies **self-hosted** assets, which means
  storage + bandwidth cost and a CDN decision. **Flag for the owner before
  curation starts.**
- **Prod FFmpeg 5.1 constraint** ([[prod_ffmpeg_version_constraint]]). Any new
  asset format/codec must render on 5.1. Stick to H.264 MP4; avoid HEVC/AV1.
- **Retention learning needs a data source.** The learning JSON example assumes
  per-asset watch-retention. We don't currently pull analytics back from
  TikTok/YouTube per asset. The learning system is blocked on that pipeline —
  scope it as Phase 3+, not launch.
- **Repo size.** Committing even metadata for 1500 assets is fine; committing
  the *media* is not. Self-hosted media belongs in object storage, not git.

---

## 5. Recommended phasing (revised — per-user auto-select)

**Phase 1 — Auto-select on the single-render path (small, pure engineering).**
- Add `background: "auto"` handling to `render.js`: read user pool →
  `pickBestBackground(pool, { script })` → use result. Reuse the engine as-is.
- Graceful empty-pool fallback (imageGen or a clear prompt), not a hard throw.
- Tests (TDD): auto picks a mood-matched item; empty pool falls back; explicit
  background still overrides auto.

**Phase 2 — Wizard/UI default to Auto.**
- "Auto (let BibleFuel choose)" becomes the default in the background picker,
  manual still available.

**Phase 3 — (Optional) per-beat auto for single renders.**
- Use the existing `backgroundPaths[]` multi-bg support so auto-mode varies the
  clip per beat on longer videos, like campaigns already do.

**Deferred (not now):** shared/premium catalog, 1000-asset curation, asset
packs, usage/retention learning. Revisit once per-user auto-select ships.

---

## 5b. Implementation status (2026-05-30)

**Phase 1 (server) — DONE, TDD, all tests green.**
- New `server/src/lib/autoBackground.js`:
  - `selectBackgroundsForScript({ pool, script, text, maxBackgrounds })` — one
    mood-matched clip per beat, avoids reusing the same clip, reuses
    `pickBestBackground` verbatim.
  - `resolveAutoBackgrounds({ ..., generateImage })` — library pool first;
    empty pool → injected AI image-gen; otherwise a clear "add a background"
    error. `generateImage` injected for testability.
  - Tests: `server/test/lib/autoBackground.test.js` (10 cases).
- Wired into `POST /api/render/captioned-video` (`server/src/routes/render.js`):
  opt-in via `autoBackground: true` (or `background: "auto"`); explicit
  `backgroundPaths[]` always override. Empty pool falls back to
  `generateBibleImage`. Surfaces `autoBackground` source in the response +
  render history. Route tests added (2 cases). Full server suite: **276 pass / 0 fail.**

**Phase 2 (client) — DONE, type-checks clean.**
- Sermon Clip Studio (`client/src/pages/TimelinePage.tsx`): added an
  "Auto — let BibleFuel choose" toggle (**default ON**) at the top of the Video
  Background card. When on with no manual picks, the render sends
  `autoBackground: true` and omits `backgroundPaths`; manual picks override it.
  Guard + render-button disable conditions updated so Auto doesn't require a
  manual pick. New persisted key `sclAutoBackground`. `tsc -b` clean; client
  vitest 8/8 pass.

**Phase 3 (RenderPage per-beat auto) — DONE, TDD, all tests green.**
- Extended `selectBackgroundsForScript`/`resolveAutoBackgrounds` with an explicit
  `beats: string[]` input (overlay lines → one mood-matched pick each).
- `renderVideoCore` (`server/src/routes/jobs.js`): new `applyAutoBackground`
  converts an `autoBackground: true` payload into per-beat `scenes[]` from the
  user's library (AI-generates when empty), then the existing scene-splitter
  renders it. Enqueue validation (`validatePayloadForEnqueue`, now exported)
  bypasses the background requirement for auto payloads.
- Client `RenderPage.tsx`: "Auto — let BibleFuel choose (video)" toggle
  (**default ON**); auto video routes through the async enqueue path so it gets
  per-beat scenes; guard relaxed; manual picks override.
- Tests: +3 lib `beats[]` cases, +3 enqueue-validation cases. Server suite
  **282 pass / 0 fail**; client `tsc` clean + vitest 8/8.

**Still deferred:** waveform-mode auto (audio-viz, not cinematic-bg driven);
shared catalog, curation, packs, retention learning (per the owner's call).

---

## 6. Bottom line (revised)

Per the owner's 2026-05-30 decision, this is **no longer a catalog/curation
project** — it's a small, surgical feature: **make the app auto-pick a
background from each user's own library pool** in the normal render flow, the
way campaign auto-post already does.

- The selection engine (`pickBestBackground` + script mood matching) is **done
  and production-tested**. Nothing new to invent.
- The only real work is **wiring it into `render.js` + defaulting the wizard to
  Auto + a graceful empty-pool fallback.**
- FFmpeg constraint relaxed: prod upgraded 5.1 → ~7.1 on 2026-05-30, so the old
  filtergraph-flag limitation is no longer a blocker (still keep
  `-filter_complex_script` by convention).
- No conflict with the other agents' active branches (series/youversion,
  multi-social-publishing, voice-typography, postiz) — this lives in
  `render.js` + the library/categorize modules they don't touch.
