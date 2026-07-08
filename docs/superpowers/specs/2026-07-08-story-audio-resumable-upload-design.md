# Story-audio resumable upload (bypass Cloudflare 100 MB cap; survive mobile drops)

**Date:** 2026-07-08
**Scope:** Story Video audio upload only; large files only (> 90 MB). Additive — no change to existing pipeline.

## Problem
Prod is behind Cloudflare, which hard-caps request bodies at **100 MB** (verified: 105 MB → `413` from Cloudflare). A one-shot POST also can't survive a mobile connection drop, and long uploads can exceed Cloudflare's ~100 s edge timeout. Result: large Story-audio uploads on mobile stall / fail.

## Approach
The app authenticates with its **own JWT** (not Firebase Auth), so the browser can't use the Firebase Storage SDK. Instead the server mints a **resumable GCS upload session** (authorized by the existing JWT); the browser uploads directly to GCS (bypassing Cloudflare) in resumable chunks; the server then downloads the finished object to local disk so the **render pipeline is unchanged** (still receives a local file path).

## Flow
1. `POST /api/media/upload-session {filename, contentType, size}` → `bucket.file("uploads/<userId>/<uuid>-<name>").createResumableUpload({metadata:{contentType}, origin})` → `{ sessionUrl, objectPath }`.
2. Browser → GCS: chunked `PUT`s to `sessionUrl` (8 MB chunks, `Content-Range`; on a dropped chunk it queries the committed offset via `bytes */total` → 308 + `Range` and resumes). Progress reported per chunk.
3. `POST /api/media/upload-finalize {objectPath, filename}` → validate `objectPath` is under `uploads/<userId>/` (per-user jail), size ≤ 400 MB, download to `req.ctx.outputDir/user-audio-<uuid>.<ext>` with **crc32c integrity check**, run the **same** `isPlayableAudio` + native/transcode logic `/upload-audio` uses (shared helper), delete the GCS object, return `{ file: <localPath>, mime }` — identical shape to `uploadAudio` today.
4. Client sets `pendingAudio = localPath` → existing trim/process/transcribe/segment/render pipeline runs unchanged.

## Branch / limits
- `size ≤ 90 MB` **or** Firebase not configured (local dev) → existing one-shot `uploadRaw` → `/api/media/upload-audio` (unchanged).
- `90 MB < size ≤ 400 MB` → resumable path.
- `size > 400 MB` → rejected client-side with a clear message.

## Components
- **server/src/lib/firebaseAdmin.js** (extend): `createResumableUploadSession`, `downloadUploadToLocal`, `deleteUploadObject`, per-user objectPath + prefix validation.
- **server/src/routes/media.js**: extract `processReceivedAudio(rawFile, ext, mime, res)` (shared by `/upload-audio` and finalize — behavior-preserving); add `POST /upload-session`, `POST /upload-finalize`.
- **client/src/lib/resumableUpload.ts**: GCS resumable uploader (chunked PUT, resume-on-drop, progress, abort).
- **client/src/lib/storyApi.ts**: `uploadAudio` size-branch + 400 MB guard + fallback.

## Security
- `objectPath` from the client is validated to start with `uploads/<userId>/` before download — a user can only finalize their own upload.
- Session objectPath is server-generated with the caller's userId; short random uuid names.
- Size cap (400 MB) enforced client-side and re-checked on finalize.

## Prerequisite (ops)
The GCS bucket needs **CORS** allowing browser `PUT`/`POST` from `https://biblefuel.tiwaton.co.uk` (+ resumable headers). Applied once via `bucket.setCorsConfiguration(...)` with the service account.

## Error handling / cleanup
- `upload-session` returns 501 if Firebase isn't configured → client surfaces "large uploads unavailable" (no silent wrong path).
- Chunk failures retry with backoff; session-expiry → restart.
- Finalize deletes the GCS object after a successful local download (local copy is the source of truth, same as today's uploads). Orphaned sessions (uploaded, never finalized) handled by a Storage lifecycle rule on the `uploads/` prefix (ops note).

## Testing
- Server unit: prefix-validation rejects foreign objectPath; session returns 501 when disabled; finalize path shape. Client unit: chunking/offset math + resume on simulated 308/failure. Prod: real > 90 MB resumable upload end-to-end after deploy.
