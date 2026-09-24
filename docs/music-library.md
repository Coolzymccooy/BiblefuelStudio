# Per-tenant music library: what the operator can upload and reuse

**Phase 1 (2026-09-22): Operator uploads are stored, tagged with metadata, and reusable across projects. The licence gate (refusing to assemble an audio bed from uncleared tracks) belongs to Phase 2 when bed assembly exists.**

## The short version

The operator can upload an audio track through any Story Video project's music picker. The track is recorded in the operator's own tenant index at `<dataDir>/musicLibrary.json` and becomes selectable in every Story Video project from that point on. The index tracks a `licence` status (defaulting to `"unknown"`) — a badge warns about uncleared music. Clicking the badge marks that track's licence `"cleared"`; it does not otherwise prevent the track's use.

## Two track classes and why they differ

| Prefix | Where stored | Resolves with… | Can delete? |
|---|---|---|---|
| `library:<id>` | `server/assets/music/` (bundled, 23 tracks) | No tenant context needed | No: `DELETE` returns 400 `Bundled tracks ship with the app` |
| `mylib:<id>` | wherever the operator's upload already landed under their own `outputDir` (`DATA_DIR/users/<sub>/outputs`, super-admin: the global `OUTPUT_DIR`) | `dataDir` required | Yes: removes the index entry, keeps the file |

**Why the split?** `library:` tracks come bundled with the app and are resolved by reading `server/assets/music/` directly (`server/src/lib/musicLibrary.js`), independent of any tenant. `mylib:` tracks are tenant-owned and live wherever the operator's own upload already sat on disk; they cannot resolve without knowing the tenant's `dataDir`. Spelling them differently (`mylib:` vs `library:`) makes the resolution path explicit at callsites, so a code review catches a reference to a track that should not be there.

**mylib: does not move the file.** `POST /api/music/upload` doesn't receive bytes and doesn't copy anything — it records the path of a file the operator already uploaded via `POST /api/media/upload-audio` (or the resumable pair), wherever that route put it inside their `outputDir`. There is no dedicated `media/audio/` subfolder; the index just points at whatever the real path was, canonicalized.

## The index: `<dataDir>/musicLibrary.json`

```json
{
  "items": [
    {
      "id": "b3f2b6b0-...-uuid",
      "label": "My Bed",
      "mood": "calm",
      "file": "C:\\...\\users\\<sub>\\outputs\\conversation-2026-09-22-1234.m4a",
      "durationSec": 42.5,
      "source": "upload",
      "licence": "unknown",
      "addedAt": 1758562200000
    }
  ]
}
```

(`server/src/lib/musicLibraryStore.js`.) `file` is the canonicalized (`realpath`'d) absolute path on disk. Bundled `library:` tracks are never written here — they come from the static `MUSIC_LIBRARY` array in `musicLibrary.js` and are merged in only at read time (`GET /api/music/library`, `server/src/routes/music.js`).

A missing or corrupt index reads as an empty library (`{ items: [] }`) rather than throwing — a music picker with nothing in it is recoverable, a request that 500s mid-listing is not. Because of that, hand-editing this file into some other shape (e.g. the old keyed-by-id example this doc used to show) silently loses the whole library with no error. The write itself is atomic (temp file + rename in the same directory), so a crash mid-write can no longer produce that corrupt/truncated file in the first place — but a bad hand-edit that parses as valid JSON without an `items` array still reads back empty.

Bundled tracks appear in the merged `GET /api/music/library` list with the same shape (`ref`, `label`, `mood`, `licence`, …), but they are read-only — `DELETE` on a `library:` id returns 400, not 403 (403 is reserved for "you tried to register a file outside your own media folder").

## Licence metadata

The `licence` field defaults to the string `"unknown"` and is shown as a `licence?` badge in the UI. It does not by itself prevent the operator from using the track — **but the badge is now clickable**: clicking it calls `PATCH /api/music/:id` (`updateTrack`) to set `licence: "cleared"`, and only uploads can be badged/clicked — bundled tracks are always `licence: "pixabay-cleared"` and are never shown with a badge.

**Why default to `"unknown"` rather than `"cleared"`?** On a long, music-led video a Content ID claim by the copyright holder takes the revenue for the *entire video*, not just the segment with the music. Repeat Content ID strikes on a channel can lead to demonetization or channel termination. The `unknown` badge and default are honest warnings: the operator decides whether to clear or risk it. A licence *gate* — refusing to assemble an audio bed from uncleared tracks without explicit acknowledgement — belongs to Phase 2 when bed assembly is built; Phase 1 stores the badge, warns, and lets the operator dismiss the warning once they've made that call.

## Forgetting a track

`DELETE /api/music/<id>` on a `mylib:` track removes the entry from `musicLibrary.json` but **never deletes the audio file** — it may still be referenced by a project this route can't see. The file stays exactly where it was.

`DELETE` on a `library:` id returns 400 (`Bundled tracks ship with the app`).

## Uploading

`POST /api/music/upload` does not receive audio bytes. Instead:

1. The operator uploads audio via `POST /api/media/upload-audio` (or the resumable session pair for files over Cloudflare's 100 MB body cap), landing somewhere inside their own `outputDir`.
2. The client calls `POST /api/music/upload` with the **absolute** path the upload returned, e.g. `{ "file": "C:\\...\\outputs\\conversation-2026-09-22-1234.m4a", "label": "My Bed" }`. A bare filename resolves against the server's working directory, not the tenant's folder, and will 403 — the path must be the absolute path the upload step returned.
3. The route validates it (`server/src/routes/music.js`):
   - Refuses any path outside the caller's own `outputDir` with 403 `That file is outside your media folder`. Note the condition is `file !== root && !file.startsWith(root + path.sep)`, which deliberately *permits* `file === root` — posting the `outputDir` path itself gets past this check and is stopped by the regular-file check below, with a 400.
   - Returns 400 `That file is no longer there` if it doesn't exist.
   - Canonicalizes both the file and the root with `fs.realpathSync()` so a symlink cannot escape the folder, and re-checks the boundary against the canonical paths.
   - Requires the (canonicalized) target to be a regular file (`fs.statSync(...).isFile()`) — 400 `That path is not a file` otherwise. This is what stops `outputDir` itself being registered as a track, and any other non-file target — a symlinked directory, or a device file.
4. It records the track with metadata, including a probe of the audio duration, storing the **canonicalized realpath** (not the path as posted) so a symlink swapped in after registration can't silently redirect a saved track later.

The probe (`probeAudioDurationSec` in `server/src/lib/story/storyRender.js`) shells out to **ffprobe** (not ffmpeg) to read the container's duration metadata. It is bounded by a timeout (20s default) so a hung or corrupt-input probe can't block the request forever; on timeout or any other failure the track is still recorded, with `durationSec: null`. The client's own request timeout for this call is also raised above the app's normal 15s default (`MUSIC_SAVE_TIMEOUT_MS` in `client/src/lib/api.ts`) so a legitimately slow round trip doesn't abort client-side while the server is still finishing the save.

If the save request fails for any reason, the MusicPicker still keeps the upload usable in the current project (it falls back to the raw uploaded path) and now tells the operator the save itself didn't happen — a warning toast, not a silently-successful "Music added".

## Where the tracks are resolved

- **`server/src/routes/jobs.js`** (`resolveAssetPath`): resolves tracks for the background render queue. This one has no per-request `dataDir` to hand around — every internal caller invokes it with a single argument and it falls back to a module-level `currentJobCtx.dataDir`, set synchronously around enqueue/validation and around job execution. An unresolved `library:`/`mylib:` ref (or any other id) fails validation with a 400 rather than being handed to ffmpeg.
- **`server/src/routes/render.js`** and **`server/src/routes/audio_advanced.js`** (each has its own local `resolveAssetPath(dataDir, pathOrId)`): synchronous HTTP handlers, so `dataDir` always comes from `req.ctx.dataDir` directly. Same behaviour — an unresolved ref is rejected before ffmpeg runs.
- **`server/src/routes/story.js`** (Story render path): resolves `project.music.path` for the final render. Unlike the three routes above, a Story render is fire-and-forget from the HTTP handler's point of view, so there's no request to 400 by the time ffmpeg would fail. A `library:`/`mylib:` ref that fails to resolve (forgotten track, deleted file, stale project) degrades to **no music** rather than being passed through as a literal string — `buildStoryFfmpegArgs` (`server/src/lib/story/storyRender.js`) also independently drops a `musicPath` that isn't an existing local file or a remote URL, as a second line of defence, so a bad music reference never takes down the whole render.

All four resolvers check the ref prefix the same way and look the track up accordingly; only the fallback behaviour for an unresolved ref differs (reject the request vs. degrade to silence), matching how each callsite can and can't report failure to the operator.

## Credits

Any track — uploaded or bundled — can carry an optional credit line, up to 200
characters. It's set with the "credit" button next to a track in the music picker
(`PATCH /api/music/:id`, stored as `credit` on the track's index entry). A credit is
free text — a name, a licence line, a link — whatever the source asks for.

Bundled `library:` tracks all read `"Music from Pixabay"` by default.

When an Ambient session's bed is built, each distinct credit (or the track's label, if
it has no credit) is collected into the **"Music credits:"** block at the end of the
YouTube description — see Track order below for how the bed's track list is captured.

## Instrumentals

"Make instrumental" (see `docs/vocal-removal.md`) creates a new track in the library
rather than modifying the original. The new track's `derivedFrom` field holds the
source track's ref, and it **inherits the source track's `licence` and `credit`** — an
instrumental doesn't get its own licence status; it's tied to whatever the original was
cleared (or not cleared) for.

An instrumental the operator doesn't keep, and the `stems-work/<jobId>` working folder
each separation used, are swept automatically: anything older than 7 days is deleted
the next time a separation job starts. Kept instrumentals (referenced by the music
index) are never swept.

## Track order

In the Ambient Sound step, **Shuffle** (the default) plays tracks in a shuffled order
that reshuffles on every full pass, so repeats spread out rather than looping the same
sequence. **Keep my order** plays the tracks in the order the operator arranged them
(reorder with the ↑/↓ controls); once a full pass finishes, playback repeats from the
top. Either way, the same track never plays twice in a row unless only one track is
selected.

When the bed is built, the actual timed track list that was used — track, start time,
duration — is saved as `bed.builtOrder` on the Ambient project. For a music-only
session this becomes the video's YouTube chapters, and it's also what the "Music
credits:" block in the description is built from.

## Verifying it yourself

The automated tests cover:
- Upload path validation (refusing paths outside the media folder, missing files, non-regular-file targets, symlink escape) — `server/src/routes/music.test.js`.
- Index persistence and atomic writes, cross-tenant isolation, and immutable updates — `server/src/lib/musicLibraryStore.test.js`.
- Resolution of `mylib:`/`library:` refs the way each production callsite actually invokes it, including the background job queue's `currentJobCtx` fallback and the cross-tenant case — `server/src/routes/musicRefs.test.js`.
- `buildStoryFfmpegArgs` wiring a music input in when the file exists, and dropping it (no `-i`, no `amix`) when it doesn't — `server/src/lib/story/storyRender.test.js`.
- The Story render route resolving a project's `music.path` to `null`, rather than crashing the render, when the stored ref no longer resolves — `server/src/routes/story.test.js`.
- Client-side: the picker's licence badge (present only for an uploaded, unrecorded-licence track, clickable to clear it), forget/upload flows, and the upload-then-save fallback (both the success and failure paths, including the failure now warning instead of staying silent) — `client/src/components/__tests__/MusicPicker.test.tsx`.

None of the above renders an actual video and plays back the result — that stays a manual step. To verify end-to-end in the app:

1. Open a Story Video project in the running dev app.
2. Open the music picker and upload an audio file.
3. Confirm it appears in the list with a `licence?` badge, and that clicking the badge clears it.
4. Reload the page and confirm it is still listed.
5. Open a different Story Video project and confirm the same track is selectable in its music picker.
6. Render a short video that includes the track.
7. Play the rendered video and confirm the music is present.
8. Forget the track (or delete the underlying file) from a project that still references it, and confirm that project still renders — silently, without music — instead of failing.

This GUI walkthrough, and actually hearing music in a rendered file, is the part automated tests do not cover; the rest is covered by `server/src/**/*.test.js` and `client/src/**/*.test.tsx`.

---

**Next phases:** Phase 2 will add the licence gate (refusing to build a bed from uncleared tracks) when bed assembly is implemented. See `docs/superpowers/specs/2026-09-22-ambient-scripture-video-design.md`.
