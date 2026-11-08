# Timeline usability: scope and verification

## Changes

- Compact phone-first Timeline lanes, proportional ruler/zoom and contextual controls; desktop layout retained.
- Mobile Timeline Editor mode reclaims global bottom-navigation space. Accessible Home/app-navigation sheet provides existing destinations; Classic/route departure restore standard navigation.
- Touch lane actions expire after three idle seconds with a short fade, dismiss on outside/action/lane change, and preserve keyboard operation.
- Empty mobile B-roll lane is opt-in; workspace collapse does not change render-hidden flags or delete populated clips.
- Explicit numeric move/trim for Voice-over clips only, preserving source-clock bounds and source words; sidecar-owned timings remain read-only. Other tracks show an export-capability reason and cannot apply numeric timing.
- Source insertion uses measured duration and original display dimensions, preserves full source metadata, respects bounds and stale async identity, and uses current proxy readiness.
- Empty projects may adopt the source aspect; existing populated compositions retain their chosen aspect and target duration.
- Original-video geometry is available from the scoped audio-advanced info route, including rotation/sample aspect handling, without relying on browser codec support.

No new renderer, project reset, provider generation, schema migration or blanket undo/drag implementation.

## Historical full frozen gate (before the PR137 capability fix)

This full gate validated the implementation before the capability-gating fix below. Its totals are historical evidence, not a claim that the full suite or browser acceptance was rerun after that fix.

- Full client selection: **217/217 files; 2,069/2,069 assertions passed**. Zero skipped/missing files, duplicate file results, worker errors, failed client invocations or retries in the final run.
- TypeScript project check: exit 0.
- Production Vite build: exit 0, run separately after tests.
- Relevant server selection: **23 files; 324 passed**, zero failed/cancelled/skipped. Covers Timeline, caption timing, scoping/ownership, media upload, audio info and MCP Timeline. This is not the entire server suite.
- Browser checks on the actual built page at 390x844, 320x740 and 1440x900: Render hit targets, mobile Add/tool reopening, navigation/focus restoration, Classic mute persistence, timing save/reload and unchanged source-word metadata.
- Original media fixture retained duration 61.466667 seconds and 480x854 portrait geometry; an existing 16:9 composition remained 16:9.
- Real ProRes source metadata insertion exercised; its fixture bytes were forwarded explicitly by Playwright. This does not certify untouched native browser upload transport for ProRes.
- Source manifest: 1,782 files, zero worktree/tested-snapshot differences after verification. Raw local manifest digest: `5cb5e965263d8cf281665e166e0816dba7c9cb5cf441b2a4b0cd66a5f8330844`.

Earlier unsuccessful harness attempts are retained locally: missing server SDK resolution, a network guard incompatible with fetch(URL), and browser harness attempts. The full server selection passed after scratch-only harness corrections, without implementation edits. Earlier client worker startup timeouts are not counted as passes; the final run completed without them.

## PR137 Codex P2: numeric timing export-capability gate

The review correctly identified that preview timing edits were broader than proof-export support. The shared helper and timing UI now allow the atomic Start / Source in / Duration edit only on Voice-over. Unsupported lanes remain selectable and inspectable, show the reason, and retain their existing controls; direct helper calls and programmatic form submission cannot bypass the gate. Existing locked/hidden and sidecar restrictions remain enforced.

Renderer audit: main footage is input zero without clip source trim or composition offset. B-roll uses an overlay enable window but does not trim its source or rebase its timestamps, and the first B-roll can become the main input. Music takes the first bed and loops from source zero without clip delay/trim. Captions/effects do not implement the complete three-field source-media editing contract. Conservatively none of those tracks is exposed through this atomic numeric editor. Voice-over already uses `clipClock` with `atrim`, `asetpts` and `adelay`; no renderer implementation changed. The independent Classic audio assembly/trim path and shared EditorShell consumers are unchanged by this repair.

Post-fix frozen verification, run in an isolated source snapshot with read-only locked dependencies:

- Affected client selection: **23/23 files, 269/269 tests passed**, no missing files, failures, skips or unhandled worker errors; two workers, exit 0. This includes every Timeline component test plus clock preservation, compound punctuation, track synchronization, source insertion and the numeric helper regressions.
- New regressions reject each unsupported lane's numeric clocks in the helper without mutation; the actual Timeline UI disables all three fields and Apply with an explanation, refuses programmatic submit, and retains selection/mute. Voice-over edits still work; project/source bounds, immutable words, locks, hidden lanes and sidecar ownership remain covered.
- TypeScript project build check (`tsc -b --force`): exit 0. Production Vite build: exit 0, separate from tests, with output outside the checkout. Existing Browserslist, CSS-minifier and chunk-size warnings remain.
- Scoped server clock/renderer selection: **6 files, 111/111 tests passed**, zero failures/cancellations/skips. A new provider-free fixture passes nonzero source in, composition start and duration through the actual render planner and proof-command builder and asserts `atrim=start=2:duration=3`, timestamp rebasing and `adelay=20250|20250`, retaining source words. This is command/filtergraph evidence, not a new FFmpeg acoustic-render or provider-generation acceptance run.
- Source hashes matched the tested snapshot after checks, with zero differences. Only this verification document was updated afterward to record the results; implementation/test sources remained unchanged. The untracked local review document and existing preview listener were left untouched.

The full 217-file client suite and prior browser acceptance were **not rerun** for this bounded repair; the new focused totals overlap the historical full gate and must not be added to it. Raw commands, dependency checks, reports and source manifest are retained locally under `Videos/BibleFuel/timeline-usability-review/codex-pr137-fix`, outside Git. No commit, push, review-thread mutation, merge or deployment was performed by this repair task.

## Evidence and boundaries

The isolated browser harness used synthetic authentication/account fixtures and local project/media routes, not production identities or provider calls. Existing demo projects were fingerprinted and preserved; owned verifier records/uploads were removed. Physical phone upload was confirmed separately by Segun during local acceptance.

Raw screenshots, videos, machine-specific paths, synthetic account records, scratch runners, build artifacts and credential/environment files are intentionally excluded. Regression fixtures used by the committed tests are self-contained; no retained local media is required for the client suite.

Build warnings remain for stale Browserslist data, an existing CSS minifier warning and large chunks. This gate establishes scoped PR readiness, not deployment approval or perfect preview/render parity. Previously saved incorrect 30-second clips are not rewritten automatically; users must reinsert the source. Backend metadata changes require the normal backend release alongside the frontend.

## Reproduction

Use the repository's locked client dependencies, run `tsc -b`, the configured Vite production build and all collected Vitest files. The recorded full client run used two workers, batches of 18 collected files and a 240-second per-batch timeout, asserting exact file coverage and no unhandled worker errors. Run the relevant Node server selections with local synthetic data, protocol guards and required locked SDK dependencies; do not point tests at production data or credentials.

Merge and deployment require separate approval.
