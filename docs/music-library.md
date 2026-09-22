# Per-tenant music library: what the operator can upload and reuse

**Phase 1 (2026-09-22): Operator uploads are stored, tagged with metadata, and reusable across projects. The licence gate (refusing to assemble an audio bed from uncleared tracks) belongs to Phase 2 when bed assembly exists.**

## The short version

The operator can upload an audio track through any Story Video project's music picker. The track is stored in the operator's own media folder, indexed in `<dataDir>/musicLibrary.json`, and becomes selectable in every Story Video project from that point on. The index tracks the `licence` status (defaulting to `"unknown"`) — a badge warns about uncleared music but does not prevent its use.

## Two track classes and why they differ

| Prefix | Where stored | Resolves with… | Can delete? |
|---|---|---|---|
| `library:<id>` | `server/assets/music/` (bundled) | No tenant context needed | No: 403 `Forbidden` |
| `mylib:<id>` | `<dataDir>/media/audio/` (operator upload) | `dataDir` required | Yes: removes index entry, keeps file |

**Why the split?** `library:` tracks come bundled with the app and the code resolves them by reading `server/assets/music/` directly, independent of any tenant configuration. `mylib:` tracks are tenant-owned and live under the operator's media folder; they cannot resolve without knowing where the dataDir is. Spelling them differently (`mylib:` vs `library:`) makes the resolution path explicit at callsites (`jobs.js`, `render.js`, `audio_advanced.js`, `story.js`), so a code review catches a reference to a track that should not be there.

## The index: `<dataDir>/musicLibrary.json`

```json
{
  "<track-id>": {
    "filename": "conversation-2026-09-22-1234.m4a",
    "uploadedAt": "2026-09-22T18:30:00.000Z",
    "durationSec": 42.5,
    "licence": "unknown",
    "source": "story-upload"
  }
}
```

When the app reads the library:
1. It loads the operator's index from `musicLibrary.json`.
2. It merges in the bundled `library:` tracks (read from `server/assets/music/`, never written to the index).
3. Both sets are available in the music picker and storage paths.

Bundled tracks appear in the list with the same structure, but they are read-only — a `DELETE` on a `library:` track returns 403.

## Licence metadata

The `licence` field defaults to the string `"unknown"` and is displayed as a badge in the UI (`licence?`). It does not prevent the operator from using the track.

**Why no `"cleared"`?** On a long, music-led video a Content ID claim by the copyright holder takes the revenue for the *entire video*, not just the segment with the music. Repeat Content ID strikes on a channel can lead to demonetization or channel termination. The `unknown` badge and the default value are honest warnings: the operator decides whether to clear or risk it. The licence *gate* — refusing to assemble an audio bed from uncleared tracks without explicit acknowledgement — belongs to Phase 2 when bed assembly is built; Phase 1 stores the badge and warns.

## Forgetting a track

`DELETE /api/music/<id>` on a `mylib:` track removes the entry from `musicLibrary.json` but **never deletes the audio file**. The file remains in `<dataDir>/media/audio/`. To fully remove a track, delete both the index entry and the file.

`DELETE` on a `library:` track returns 403.

## Uploading

`POST /api/music/upload` does not receive audio bytes. Instead:

1. The operator uploads audio via `POST /api/media/upload-audio` (or the resumable session pair for files over Cloudflare's 100 MB body cap).
2. The operator calls `POST /api/music/upload` with the file path, e.g. `{ "path": "conversation-2026-09-22-1234.m4a" }`.
3. The route validates the path:
   - Refuses any path outside the caller's own media folder with 403 `Forbidden`.
   - Returns 400 `Bad Request` if the file does not exist.
   - Canonicalizes with `realpath()` so a symlink cannot escape the folder.
4. It records the track in the index with metadata, including a probe of the audio duration.

The probe (`probeAudioDurationSec`) uses ffmpeg; if it times out or fails, the track is recorded with `durationSec: null` and no probe failure blocks the save.

## Where the tracks are resolved

- **`server/src/routes/jobs.js`**: Resolves tracks when building a queue job.
- **`server/src/routes/render.js`**: Resolves tracks during video render.
- **`server/src/lib/audio_advanced.js`**: Resolves tracks in the audio advanced workflow.
- **`server/src/routes/story.js`** (Story render path): Resolves tracks in the final story render.

All four paths check the prefix and look up the track accordingly.

## Verifying it yourself

The automated tests cover:
- Upload path validation (refusing paths outside the media folder, missing files, symlink escape).
- Index persistence (tracks survive a reload).
- Cross-project reuse (a track uploaded in one project is selectable in another).
- Resolution at render time (music plays when the track is included in a render).

To verify end-to-end in the app:

1. Open a Story Video project in the running dev app.
2. Open the music picker and upload an audio file.
3. Confirm it appears in the list with a `licence?` badge.
4. Reload the page and confirm it is still listed.
5. Open a different Story Video project and confirm the same track is selectable in its music picker.
6. Render a short video that includes the track.
7. Play the rendered video and confirm the music is present.

This GUI walkthrough is the one part not covered by automated tests; the rest is covered by `server/test/**/*.test.js` and `client/src/**/*.test.ts`.

---

**Next phases:** Phase 2 will add the licence gate (refusing to build a bed from uncleared tracks) when bed assembly is implemented. See `docs/superpowers/specs/2026-09-22-ambient-scripture-video-design.md`.
