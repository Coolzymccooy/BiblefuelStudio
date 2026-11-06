# Caption reliability release candidate

## Scope

- Shared timing validation and provenance; prefer usable native boundaries and reject malformed/incomplete mappings.
- Story imports preserve script coverage; segmentation preserves ordered words and bounds scene pacing. Estimated timing requires explicit Story export acknowledgment.
- Voice & Audio avoids timing metadata from stale/different takes.
- Timeline maintains timings across transforms, invalidates timings after text changes, and preserves compound punctuation without inventing lexical matches.
- Series/short rendering preserves native timing handoff. Narration over the unchanged 30-second cap is refused using probed media duration, rather than silently cut. Shorten input or supply an explicitly prepared trim.
- Scene Scripts preserve trusted anchors, expose timing provenance, and enforce bounded Remotion caption handoffs.
- Lyrics distinguish acoustic timing evidence from display holds and expose provenance.

## Verification performed locally

- TypeScript and production build passed.
- Client suite: 975 passing tests.
- Server serial suite: 1,454 passing tests, zero failures/skips. Initial concurrent run failed four tests (two omitted snapshot fixtures and two Lyrics upload tests). Fixtures were restored and serial rerun passed. Serial success does not establish the earlier Lyrics failures' cause.
- Real exports for the short-cap, compound-punctuation and Scene Script overlap cases decoded successfully.
- Real local MCP HTTP chain exercised whoami, Story import/settings/readback, render, jobs_wait and final readback against the candidate. Job completed with a 57.466667-second 720x1280 H.264/AAC devotional export. Independent full decode passed. This did not exercise the deployed app, live user account or fresh provider generation.
- For PR portability, two regression fixtures were reduced to the data used by their tests and placed under `server/test/fixtures/caption-acceptance/`. The affected Timeline tests (24) and Remotion schedule tests (7) were rerun successfully after this test-only packaging change. Production source was not changed by this packaging step.
- `git diff --check` passed.

Raw local renders, account records, transcripts, machine-specific evidence, generated logs and credentials are intentionally not included in this PR. The two small committed fixtures contain caption text/timestamps, not narration media or machine paths.

## Known limits / not a release sign-off

- Independent acoustic accuracy is not established across every workflow; sung-lyrics acceptance still requires a suitable song/lyric sample.
- Diagnostic ASR comparison on earlier real narration measured P95 starts 173.866ms and ends 304.151ms; the proposed separate 250ms end-boundary target was not met. ASR is not human ground truth.
- Estimated-timing export acknowledgment is enforced for Story, not universally for every export path.
- Full browser/user-journey QA and production configuration/deployment compatibility remain open.
- The MCP devotional contains existing narration and images, without music. It is not a completed creative/pacing polish pass.
- The reproduced Scene Script overlap was fixed; its exact production reachability was not established.
- Story still uses FFmpeg; this PR does not add a Story Remotion renderer.

No deployment, production mutation or public publishing is authorized by this document. Merge/deploy require separate approval.
