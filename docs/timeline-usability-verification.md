# Timeline usability: scope and verification

## Changes

- Compact phone-first Timeline lanes, proportional ruler/zoom and contextual controls; desktop layout retained.
- Mobile Timeline Editor mode reclaims global bottom-navigation space. Accessible Home/app-navigation sheet provides existing destinations; Classic/route departure restore standard navigation.
- Touch lane actions expire after three idle seconds with a short fade, dismiss on outside/action/lane change, and preserve keyboard operation.
- Empty mobile B-roll lane is opt-in; workspace collapse does not change render-hidden flags or delete populated clips.
- Explicit numeric move/trim for eligible clips, preserving source-clock bounds and source words; sidecar-owned timings remain read-only.
- Source insertion uses measured duration and original display dimensions, preserves full source metadata, respects bounds and stale async identity, and uses current proxy readiness.
- Empty projects may adopt the source aspect; existing populated compositions retain their chosen aspect and target duration.
- Original-video geometry is available from the scoped audio-advanced info route, including rotation/sample aspect handling, without relying on browser codec support.

No new renderer, project reset, provider generation, schema migration or blanket undo/drag implementation.

## Final frozen gate

Validation ran on the implementation and tests submitted in this PR; subsequent packaging adds only this document.

- Full client selection: **217/217 files; 2,069/2,069 assertions passed**. Zero skipped/missing files, duplicate file results, worker errors, failed client invocations or retries in the final run.
- TypeScript project check: exit 0.
- Production Vite build: exit 0, run separately after tests.
- Relevant server selection: **23 files; 324 passed**, zero failed/cancelled/skipped. Covers Timeline, caption timing, scoping/ownership, media upload, audio info and MCP Timeline. This is not the entire server suite.
- Browser checks on the actual built page at 390x844, 320x740 and 1440x900: Render hit targets, mobile Add/tool reopening, navigation/focus restoration, Classic mute persistence, timing save/reload and unchanged source-word metadata.
- Original media fixture retained duration 61.466667 seconds and 480x854 portrait geometry; an existing 16:9 composition remained 16:9.
- Real ProRes source metadata insertion exercised; its fixture bytes were forwarded explicitly by Playwright. This does not certify untouched native browser upload transport for ProRes.
- Source manifest: 1,782 files, zero worktree/tested-snapshot differences after verification. Raw local manifest digest: `5cb5e965263d8cf281665e166e0816dba7c9cb5cf441b2a4b0cd66a5f8330844`.

Earlier unsuccessful harness attempts are retained locally: missing server SDK resolution, a network guard incompatible with fetch(URL), and browser harness attempts. The full server selection passed after scratch-only harness corrections, without implementation edits. Earlier client worker startup timeouts are not counted as passes; the final run completed without them.

## Evidence and boundaries

The isolated browser harness used synthetic authentication/account fixtures and local project/media routes, not production identities or provider calls. Existing demo projects were fingerprinted and preserved; owned verifier records/uploads were removed. Physical phone upload was confirmed separately by Segun during local acceptance.

Raw screenshots, videos, machine-specific paths, synthetic account records, scratch runners, build artifacts and credential/environment files are intentionally excluded. Regression fixtures used by the committed tests are self-contained; no retained local media is required for the client suite.

Build warnings remain for stale Browserslist data, an existing CSS minifier warning and large chunks. This gate establishes scoped PR readiness, not deployment approval or perfect preview/render parity. Previously saved incorrect 30-second clips are not rewritten automatically; users must reinsert the source. Backend metadata changes require the normal backend release alongside the frontend.

## Reproduction

Use the repository's locked client dependencies, run `tsc -b`, the configured Vite production build and all collected Vitest files. The recorded full client run used two workers, batches of 18 collected files and a 240-second per-batch timeout, asserting exact file coverage and no unhandled worker errors. Run the relevant Node server selections with local synthetic data, protocol guards and required locked SDK dependencies; do not point tests at production data or credentials.

Merge and deployment require separate approval.
