# Default Music Library — Design

**Date:** 2026-06-08
**Status:** Approved design — ready for implementation planning

## Summary

Ship a **library of 10 gospel music beds** selectable across Story Video, Render, Timeline, Series, and Auto-Publish. Users can pick a library track, click **"Use default audio"**, or **upload their own** (existing). Series and Auto-Publish **auto-select the designated default track** (for now, no UI there). All five renderers already support a `musicPath` + autoduck, so the work is a library + a shared picker + wiring — not new render logic.

## Goals

- 10 selectable default music tracks, with ▶ preview, available wherever a music bed applies.
- A "Use default audio" checkbox that applies one designated default track.
- Keep the existing upload-your-own option everywhere it exists today.
- Series + Auto-Publish auto-apply the default track when none is chosen.
- Ship now with placeholder audio the user swaps for real tracks later — zero code change.

## Non-Goals

- Sourcing/licensing real audio (placeholders ship; user replaces the 10 files).
- A per-series / per-auto-post music picker UI (auto-select only, for now).
- Rotation / random selection (one designated default — decided).
- Trimming/looping library tracks (the renderers already cut music to the voice length).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Audio source | Scaffold with 10 placeholder MP3s; user swaps real tracks later |
| Default behaviour | One **designated default** track (manifest `default: true`) |
| Series / Auto-Publish | Auto-select the default track when `musicPath` is unset |
| Library ref scheme | `musicPath = "library:<id>"`, resolved server-side to the bundled file |

## Verified Facts (grounding)

- `campaign_auto_post` (Series + Auto-Publish renderer, `jobs.js` ~697) already accepts `musicPath, musicVolume, autoDuck` and does the `sidechaincompress` autoduck. `render.js` (Render + Timeline's captioned-video) and the Story Video render likewise.
- `resolveAssetPath` is **duplicated** in `render.js`, `jobs.js`, and `audio_advanced.js`; Story Video's render uses raw paths. So the `library:` hook lives in one shared module that each call site invokes (not a single shared resolver).
- `server/public` is emptied by `vite build` (`emptyOutDir`), so library audio must NOT live there. It lives in `server/assets/music/`.
- Static media is served before auth (e.g. `/outputs`); the music preview route follows that pattern.

## Architecture

### Backend

**`server/assets/music/`** — 10 placeholder MP3s, committed, named `01-<slug>.mp3` … `10-<slug>.mp3` (silent ~30s; valid MP3 so ffmpeg accepts them). A `README.md` in the folder explains "replace these 10 files with real gospel instrumentals; keep the filenames."

**`server/src/lib/musicLibrary.js`** (pure + path resolution):
- `MUSIC_LIBRARY` — 10 entries `{ id, label, mood, file, default? }`; exactly one has `default: true`.
- `listTracks()` → `[{ id, label, mood, previewUrl, default }]` where `previewUrl = "/music/<file>"` and `default` is the boolean from the manifest (true on exactly one).
- `resolveLibraryTrack(ref)` → if `ref` is a string starting `"library:"`, look up the id; return the absolute path to `server/assets/music/<file>` if it exists, else `null`. Non-`library:` input → `null` (so callers fall through to their normal resolution).
- `defaultTrackRef()` → `"library:<defaultId>"`.

**`server/src/routes/music.js`** — `GET /api/music/library` → `{ ok: true, tracks: listTracks() }`. Mounted with `requireAuth, withUserScope` like the other `/api` routes.

**Static serve** in `server/index.js`: `app.use("/music", express.static(<server/assets/music>, { ...cache headers }))`, mounted near `/outputs` (before the auth-gated routes) so `<audio src="/music/..">` previews work without a token.

**Hook the library resolver into each music resolver** so a `library:<id>` `musicPath` resolves everywhere:
- `render.js resolveAssetPath(dataDir, pathOrId)`: first `const lib = resolveLibraryTrack(pathOrId); if (lib) return lib;` then existing logic.
- `jobs.js resolveAssetPath(pathOrId)`: same prepend.
- `audio_advanced.js resolveAssetPath(dataDir, pathOrId)`: same prepend.
- Story Video render route (`routes/story.js` `/:id/render`): resolve `project.music?.path` through `resolveLibraryTrack` (falling back to the raw path) before passing `musicPath` to `runStoryRender`.

No renderer audio logic changes — they already mix + autoduck whatever `musicPath` resolves to.

### Frontend

**`client/src/lib/musicLibraryApi.ts`** + **`useMusicLibrary` hook** — `GET /api/music/library` → the track list (TanStack Query, cached; static data).

**`client/src/components/MusicPicker.tsx`** — a shared control (props: `value: { path: string | null; volume: number; autoDuck: boolean }`, `onChange`, `busy`). Renders:
- **☑ Use default audio** — sets `path = "library:<defaultId>"`. `GET /api/music/library` returns `default: true` on exactly one track; the picker uses that entry's id for this checkbox.
- **Choose from library** — a `<select>` of the 10 tracks; selecting sets `path = "library:<id>"`. A small ▶ button previews via `<audio src=previewUrl>`.
- **Upload** — the existing per-surface upload (audio file → server path).
- **Remove** — `path = null`.
- **Volume slider + Autoduck checkbox** (existing).

`MusicPicker` is adopted on **Story Video** (replacing the current `MusicControl`), **Render**, and **Timeline**, feeding each surface's existing music field/payload. A library `path` (`library:<id>`) and an uploaded path are interchangeable everywhere.

### Series & Auto-Publish

Series and Auto-Publish both render via the **`campaign_auto_post`** job, so the default is applied in **one place**: in the `campaign_auto_post` renderer (`jobs.js`), when `payload.musicPath` is falsy, use `defaultTrackRef()` (and default `autoDuck: true`, `musicVolume: 0.3` when unset). Result: every series item / auto-post gets the default gospel bed automatically, while any explicitly-chosen `musicPath` is left untouched. (A future per-series picker can set its own.)

## Data Flow

Pick library track (or "Use default") → `musicPath = "library:<id>"` stored in the surface's music field → render route/job calls its `resolveAssetPath`, which now returns the bundled file for `library:` refs → existing autoduck ffmpeg mixes it. Series/Auto-Publish: payload defaults `musicPath` to `defaultTrackRef()` when unset.

## Error Handling

- Unknown / malformed `library:` id → `resolveLibraryTrack` returns `null` → the renderer treats it as "no music" (existing behaviour) — graceful, no crash.
- Missing library file → same null → no music; the existing `musicPath not found` guards never fire for `library:` refs because the resolver only returns existing files.
- Placeholder files are valid (silent) MP3s, so every render succeeds out of the box; swapping real files later changes only the audio.
- `/api/music/library` failure (unlikely; static data) → picker shows upload + "use default" still works (default ref is a constant the client can also hardcode-mirror).

## Testing

**Backend (node:test):**
- `musicLibrary`: exactly 10 tracks; exactly one `default: true`; `listTracks()` shape incl. `previewUrl`; `resolveLibraryTrack("library:<id>")` → an existing absolute path; `resolveLibraryTrack("library:nope")` → null; `resolveLibraryTrack("/some/upload.mp3")` → null; `defaultTrackRef()` matches the default entry.
- `GET /api/music/library` → 10 tracks with `previewUrl`.
- Each resolver (`render.js`, `jobs.js`, `audio_advanced.js`): `resolveAssetPath(..., "library:<id>")` returns the bundled path (and a normal path still resolves as before).
- Series/Auto-Publish: a payload without `musicPath` is enriched with `defaultTrackRef()`; an explicit `musicPath` is left untouched.

**Frontend (vitest):**
- `MusicPicker`: "Use default audio" sets `path` to the default `library:` ref; selecting a library option sets the right ref; upload sets the uploaded path; remove clears; volume/autoduck propagate.
- `useMusicLibrary` returns the fetched list (mocked).

**Live verify:** render a Story Video (and one Render/Timeline) with a library track selected + autoduck on; confirm the bed plays under the voice. Trigger an Auto-Publish/Series render and confirm the default bed is applied.

## Deployment Note

Client changes → rebuild `server/public` + commit. The 10 placeholder MP3s + manifest are committed under `server/assets/music/` (not the vite-emptied `server/public`).
