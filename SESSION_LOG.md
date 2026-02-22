# Session Log

## 2026-02-22 (Handoff Checkpoint)

### What was done
- Started local services for testing:
  - Frontend: `http://localhost:5173`
  - Backend: `http://localhost:5051`
- Investigated production queue issue where jobs stay `running` and disappear after refresh.
- Implemented background job reliability fixes in `server/src/routes/jobs.js`:
  - Added FFmpeg execution timeout via `JOB_EXEC_TIMEOUT_SEC` (default `600`).
  - Added FFmpeg spawn error handling.
  - Added stale running-job recovery on boot via `STALE_RUNNING_JOB_MINUTES` (default `45`).
  - Improved in-memory fallback (`liveStore` + `lastGoodStore`) to avoid empty job lists during transient file read failures.
- Implemented YouTube credential fallback in `server/src/lib/socialStore.js`:
  - Reads from env when `social.json` is empty:
    - `YOUTUBE_CLIENT_ID` (or `SOCIAL_YOUTUBE_CLIENT_ID`)
    - `YOUTUBE_CLIENT_SECRET` (or `SOCIAL_YOUTUBE_CLIENT_SECRET`)
    - `YOUTUBE_REFRESH_TOKEN` (or `SOCIAL_YOUTUBE_REFRESH_TOKEN`)
- Improved UI resilience in `client/src/pages/JobsPage.tsx`:
  - If backend briefly returns zero jobs while active jobs exist, UI now keeps current list instead of clearing.
- Updated docs:
  - `server/.env.example`
  - `RUN.md`

### Verified locally
- `node --check` passed for:
  - `server/src/routes/jobs.js`
  - `server/src/lib/socialStore.js`
  - `server/src/routes/social.js`
- `npm run build --prefix client` passed.
- Confirmed env fallback works by test-loading `readSocialStore()` with temporary YouTube env vars.

### Current blocker in production
- Production behavior remains unchanged until these code changes are deployed.
- Local `server/data/social.json` still has empty `direct.youtube` keys, but env fallback now supports this once env vars are set.

### Required production env vars (set in Render)
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
- `JOB_EXEC_TIMEOUT_SEC=300` (recommended)
- `STALE_RUNNING_JOB_MINUTES=20` (recommended)

### Resume steps next session
1. Deploy latest code to production.
2. Set the 5 env vars above in Render and redeploy/restart.
3. Trigger one `render_video` background job and watch `/api/jobs` until terminal state (`done` or `failed`).
4. Trigger one YouTube share (`destination: youtube`) and confirm API response includes `videoId` and `videoUrl`.
5. If still failing, capture production logs around `/api/jobs` and `/api/social/post` for exact error text.

