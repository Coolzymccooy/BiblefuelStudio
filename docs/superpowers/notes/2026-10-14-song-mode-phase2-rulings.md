# Song mode Phase 2: decisions made during the build

These decisions were all made during the build, without stopping to ask. Each one says what was decided and what it would cost if it turns out wrong.

## Plan corrections, made before building

- **P1** Where the plan's tests guessed values (font name, outline colour, position format), the tests were corrected to the real output. The checks themselves were never weakened. *If wrong:* a test could pin the wrong colour. The reviewers checked each correction.
- **P2** The test that tells a call apart from its echo looks at the visible text, not the raw caption line. The plan's version would have matched nothing. *If wrong:* the test has to be reworked.
- **P3** The plan described some tests only in comments. Every one became a real, asserting test. *If wrong:* nothing.

## Effects and layout

- **R1** On landscape frames the echo is sized from the frame's height (h × 0.105); on portrait frames, from the width. The spec's "10.5% of width" was measured on a portrait video, and the other effects size landscape frames the same way. *If wrong:* echoes look smaller on landscape renders; a one-line change.
- **R2** On a soft (handwritten) line, effects that draw the whole line as the key word (slam, title, echo, frame) use the look's bold font. Pop, stack, quote and curve write the line in Caveat. *If wrong:* a soft chorus slam isn't handwritten; switch those effects to the body font.
- **R3** On landscape, a call above an echo can shrink a lot (a slam from about 216 px to about 100 px), because the echo's spec position (0.72 h) leaves only that much room. *If wrong:* landscape calls look small; the landscape echo could be moved lower later.

## Laptop vocals and timing

- **R4** Kept the spec's 4-minute wait for the laptop. A full 3-minute song separated in 134 s on the laptop; the slower 20-second clip was mostly model start-up. *If wrong:* songs over about 5 minutes time out and waste laptop time; then skip vocals for long songs.
- **R5** After a server restart, a vocals job no longer has anyone waiting for it, so it is dropped when the queue loads. It is also cancelled on timeout, abort or error. *If wrong:* a user's vocal-removal slot stays blocked until a laptop clears it.
- **R6** Leftover `lyric-vocals-*.m4a` files are swept after 7 days, as a safety net beside delete-after-use. *If wrong:* nothing.
- **R7** **Timing from the vocals is opt-in (`LYRIC_VOCALS=1`), and off by default.**
  - Measured on My Time No Late: vocals 11 of 72 lines flagged, the full song 10. Median error 0.27 s vs 0.12 s. Vocals also took 7 speech calls instead of 2, plus a laptop separation.
  - The spec calls the vocal stem an accuracy boost. On this song it isn't one yet.
  - *If wrong:* the boost stays unused until you turn it on after comparing 3 or more songs.
- **R8** Two timing bugs that the vocals exposed were fixed for both paths:
  - a stretch of audio is trimmed at a backwards timestamp instead of being thrown away;
  - an implausible jump ahead is refused.
  The trim applies to those stretches only. The first full-song pass keeps the old reject-whole rule, because trimming it moved I Know the Driver from 33 to 56 flagged lines; with the rule kept it is 34. *If wrong:* a first pass with a late backwards step is still thrown away, as in Phase 1.

## Left for later (parked)

- **R9** Two crowd replies under 0.3 s apart overlap for up to a quarter of a second while the first fades. Follow-up: end the earlier echo just before the next one starts. *If wrong:* a brief double-draw on rapid chanted replies.
- **R10** The Look step's Phase 1 controls (look, energy, fit, background) still lose keyboard focus while saving. The new effect list does not. Saves are now done one at a time, so those controls can be fixed safely. *If wrong:* keyboard users lose focus on those controls, as in Phase 1.
- **R11** The server has no per-project write lock, so two open tabs can still overwrite each other. This was already true before Phase 2. *If wrong:* a rare lost edit across tabs.
