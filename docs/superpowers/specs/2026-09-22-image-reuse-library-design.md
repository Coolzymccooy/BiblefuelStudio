# Image reuse library — design

**Date:** 2026-09-22
**Status:** approved (operator, 2026-09-22)
**Branch:** `feat/youtube-longform`

## Problem

Every Story scene generates a fresh image. Images land in
`outputs/genImg/{projectId}/part-N.png`, keyed by project and part, and are
never read by anything again. A 30-minute sleep session burns 12 images; the
Cloudflare Workers AI free tier has a daily cap, and on 2026-09-22 that cap
stopped a re-render dead with five failed scenes.

Meanwhile the repo already contains the pattern we want — `autoBackground.js`
mood-matches a library asset and only generates when nothing fits — but it is
wired into the shorts/render path only. `routes/story.js` calls
`generateBibleImage` directly for every scene.

The asset library itself is nearly empty and the wrong medium: `library.json`
holds 5 Pexels **videos**, saved as remote URLs and never downloaded.

**The constraint is quota, not cash.** On the free tier, reuse buys more
videos per day. It becomes money only on a paid plan.

## Goal

A Story scene asks the library for a picture before it asks a generator, and
every generated picture joins that library. Nothing else changes.

## Non-goals

- Stock-photo search for Story scenes (Pexels/Pixabay). Already built and
  free, but the library is videos, stock photography fights the four
  cinematic styles, and it pulls in the faith-filter and licensing surface.
  Deferred deliberately: once reuse is live, the match logs say how many
  scenes still miss, and that evidence decides whether stock is worth it.
- Reuse in the series / jobs / render paths. Story is where the volume is.
- Any vector database. At the sizes involved, brute-force cosine in JS is
  milliseconds.

## Operator decisions

- **Reuse freely across videos.** An image may return in any later video.
- **Never twice in the same video.** Hard rule, enforced by exclusion.
- Automatic, not suggested: a reused scene is labelled in the UI, and the
  existing per-scene Regenerate button is the override.

## Architecture

### 1. The pool (harvest)

A successful generate is copied into a stable per-tenant pool at
`<outputDir>/imageLib/<sha256-of-bytes>.png` and indexed.

It must be a **copy**. `outputs/genImg/{projectId}/` is purged on every
re-segment and forced regenerate, so an index pointing into it would lose
images out from under other projects.

Content-addressing by image bytes gives free de-duplication: two identical
renders collapse to one file and one entry.

### 2. The index

`<dataDir>/imageLibrary.json`, separate from the existing `library.json` so
the video library is untouched.

```jsonc
{
  "items": [{
    "id": "img_<sha256[0:16]>",
    "hash": "<sha256 of the image bytes>",
    "path": "<absolute path in the pool>",
    "publicUrl": "/outputs/imageLib/<hash>.png",
    "prompt": "<the scene imagePrompt that produced it>",
    "style": "cinematic-bible",
    "aspect": "landscape",
    "categories": ["peace", "light"],
    "embedding": "<base64 Float32Array, 512 dims>",
    "provider": "cloudflare",
    "projectId": "<project that first generated it>",
    "createdAt": 1790000000000,
    "lastUsedAt": 1790000000000,
    "useCount": 3
  }]
}
```

Embeddings use `text-embedding-3-small` with `dimensions: 512` (OpenAI
supports shortened output). 512 floats stored as base64 is ~2.7 KB per entry,
so a 500-image library is ~1.4 MB — small enough to read, and cached in
memory with an mtime check so a 12-scene project parses it once.

`library.json` is not migrated. Its entries have no `kind` field; anything
missing `kind` continues to read as a video.

### 3. Matching

`findReusableImage({ dataDir, prompt, style, aspect, excludeIds })`

1. **Hard filters** — same `aspect`, same `style`, `id` not in `excludeIds`
   (every image already used by the current project).
2. **Score** — cosine similarity between the scene prompt's embedding and
   each surviving entry's.
3. **Accept** at or above `IMAGE_REUSE_THRESHOLD` (default `0.82`); the
   highest score wins. Below it, return `null` and let the scene generate.
4. **No `OPENAI_API_KEY`** — fall back to category overlap using the existing
   `categorize.js` `classifySearchQuery`, accepting on a Jaccard overlap of
   0.6 or better. No key and no categories means no reuse, which is correct:
   generating is the safe default.

Every decision — hit or miss, with its score — is logged, so the threshold
can be calibrated against a real library instead of guessed at now.

Kill switch: `IMAGE_REUSE_ENABLED=false` disables lookup entirely while
leaving harvest on.

### 4. Pipeline change

In `imagesStage` (`routes/story.js`), per scene, in order:

1. `findReusableImage(...)` with the ids used so far in this project.
2. Hit → set `imagePath`, `imageUrl`, `imageStatus: "done"`,
   `imageSource: "library"`, `imageReuseScore`; bump `lastUsedAt`/`useCount`.
3. Miss → generate exactly as today, then harvest the result and set
   `imageSource: "generated"`.

A harvest failure must never fail the scene: the image exists, the index is
an optimisation. It is caught, logged and swallowed.

### 5. One more free generator

`providers/together.js` — FLUX.1-schnell-Free, same
`{ ok, provider, imageBuffer, error }` shape as the existing providers,
enabled by `TOGETHER_API_KEY`, inserted into the chain after Cloudflare and
before Pollinations. Documented in `.env.example`.

This raises the daily ceiling. It does not improve quality — FLUX schnell is
a step below Lucid Origin.

### 6. Growth

`pruneLibrary({ dataDir, max })`, default cap 2000 entries, evicting
least-recently-used and deleting their pool files. Runs after harvest.

## Isolation

The pool and index live under the tenant's own `outputDir`/`dataDir`. One
account never sees another's images. This follows the existing multi-tenant
rule that all route I/O goes through `req.ctx`.

## Testing

Unit:
- cosine similarity, and that the highest scorer above threshold wins
- a below-threshold best match returns `null`
- `excludeIds` removes an otherwise-winning entry
- aspect and style mismatches are filtered before scoring
- harvest de-duplicates by content hash (same bytes → one file, one entry)
- the keyword fallback path when no embedding implementation is configured
- prune evicts least-recently-used and removes the file

Pipeline:
- a second project with the same scene prompts generates **zero** images
- within one project, two scenes with near-identical prompts do not receive
  the same image
- a harvest failure leaves the scene `done`

The embedding call is injectable (`_setEmbedImpl` / `_resetEmbedImpl`),
matching the `_setLlmImpl` seam used elsewhere in the codebase.

## Risks

| Risk | Handling |
|---|---|
| Threshold wrong on real data | Env-tunable, every score logged, calibrate after the first few videos |
| Library grows unbounded | LRU cap at 2000, files deleted on eviction |
| Reuse makes the channel look repetitive | Operator's explicit choice; never twice per video; per-scene Regenerate overrides |
| `genImg` purge destroys indexed images | Pool is a copy, outside `genImg` |
| Index corrupted or unreadable | Treated as empty; generation proceeds |

## Files

- new `server/src/lib/imageGen/imageLibrary.js` + test
- new `server/src/lib/imageGen/providers/together.js` + test
- `server/src/lib/imageGen/index.js` — provider chain
- `server/src/routes/story.js` — ask before generating, harvest after
- `client/src/components/story/StoryScenePreview.tsx` (or the scene card) —
  a "reused" badge
- `server/.env.example` — `TOGETHER_API_KEY`, `IMAGE_REUSE_THRESHOLD`,
  `IMAGE_REUSE_ENABLED`
