# Story TikTok and finite scheduling release

## Scope

- Reuse the existing TikTok action for completed Story exports.
- Add an independent, explicit one-off queue for uploaded original MP4s, with public YouTube/TikTok destinations, expected SHA-256/size checks and account-scoped reload reconciliation.
- Preserve durable claims after uncertain outcomes; distinguish provider acceptance, confirmed public publication, drafts and failures. No automatic replay or top-up.
- Protect immutable TikTok snapshots using seven-day signed media-read capabilities; block unsigned aliases through both public output mounts.
- Guard delayed authentication completions and API-client 401 invalidation by session generation.
- Preserve existing recurring schedules/webhooks and MCP publishing restrictions. This release creates no campaign entries or provider posts.

## Verification

All 20 implementation/test files matched the final reviewed SHA-256 manifest before packaging. No implementation files were changed during packaging.

Prior final-candidate verification: client TypeScript + Vite production build exited 0; focused client selection passed 76 tests across six files; combined server selection passed 129 tests. Synthetic actual-component browser checks covered 320, 390 and 1280px and reload reconciliation. These are not live-provider acceptance tests or a full-repository test run.

Packaging reran the four new client regression files: **42 passed**, exit 0. Packaging also reran the combined server selection: **129 passed**, zero failures, exit 0. An initial plain Node invocation could not load missing local server dependencies; the complete server selection was then rerun successfully using the existing read-only dependency resolver, checking imported package versions against the unchanged lockfile, with a loopback-only network guard. No shared dependency tree was modified. The earlier load failure is not a source-test failure or a passing run.

Portable commands after installing the locked dependencies in each package (Node, FFmpeg and FFprobe required):

```sh
npm --prefix client run build
npm --prefix client test -- src/components/__tests__/ScheduledVideosPanel.test.tsx src/pages/__tests__/StoryDonePanel.test.tsx src/hooks/__tests__/useAuth.generation.test.ts src/hooks/__tests__/useAuth.owner.test.ts
cd server
node --test --test-concurrency=1 src/routes/social.finitePosts.test.js src/routes/social.finiteUpload.test.js src/routes/social.finiteMediaAliases.test.js src/routes/social.tiktok.test.js src/routes/social.youtube.test.js src/routes/social.schedules.test.js src/routes/social.scheduleRules.test.js src/lib/socialStore.schedules.test.js
```

The optional provider-free browser harness accepts a Playwright module path and an evidence directory as arguments; it contains only synthetic account/provider fixtures. Run from `client`: `node scripts/verify-scheduled-videos.mjs <playwright-module-path> <evidence-dir>`.

Known build warnings: CSS minification, chunk size, stale Browserslist data and mixed static/dynamic import. Packaging whitespace check reports only pre-existing new blank lines at EOF in the auth-generation regression and finite queue module; reviewed source was preserved unchanged. No warning-free claim.

## Deployment boundary

`server/Dockerfile` currently builds the client from the repository root and copies fresh assets from its build stage. The older prebuilt-assets instructions in `DEPLOY_COOLIFY.md` are stale; no generated `server/public` changes belong in this release. Production build arguments and persistent volumes must remain intact.

Deployment and authenticated production verification are separate operator gates. Verify the exact deployed revision, new routes/assets, signing-secret availability and publicly reachable HTTPS capability delivery before enrolling approved jobs. Local mocks do not establish Google/Zernio public publication. Do not clear crash-held locks or repost uncertain outcomes automatically. No production configuration, jobs or account data are included here.
