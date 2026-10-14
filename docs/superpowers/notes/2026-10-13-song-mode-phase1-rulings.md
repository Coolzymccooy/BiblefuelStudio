# Song mode Phase 1 — decisions made during the build

Every decision below was made while building, without stopping to ask. Each line says what was decided, and what it costs if the decision turns out wrong.

## Timing engine (server)

- **R1** Task 9's test uses a realistic fake speech service (window cuts hear nothing, the full song hears the words). *If wrong:* the job test covers one fewer case.
- **R6** A line wholly in brackets becomes a crowd response only in chorus or final sections; elsewhere it is skipped as a stage note. *If wrong:* a deliberate verse echo is skipped and must be re-added.
- **R7** Headings with emoji in front ("🎤 [CHORUS]") are recognised, because Gemini lyric sheets use them. *If wrong:* a little extra parsing code.
- **R8** Lines moved by hand are fixed points; start times always go forward and stay inside the song. *If wrong:* nothing — these are spec rules.
- **R9** When a phrase repeats, the timing prefers its earliest copy. *If wrong:* a song that skips its first chorus could be placed one chorus early.
- **R10** The placement code is split into named steps with a whole-song check in tests. *If wrong:* some extra churn in one file.
- **R11** The accuracy test matches words by sequence, not position, because the reference file is missing one response. *If wrong:* the test is slightly looser than planned.
- **R12** The "empty first pass" test checks the song is still timed from 71 s on, where the saved audio starts. *If wrong:* the test covers less of the song.
- **R13** Unheard crowd responses don't count as "uncertain lines" when deciding where the reliable part ends. *If wrong:* timing stops trusting a little later than ideal.
- **R14** Speech-service use is capped at 3× the song length, and words with broken times are dropped. *If wrong:* a very hard song gets fewer listening passes.
- **R15** A heard word counts only if it is an uncommon lyric word, or forms a pair with the word before it. *If wrong:* some noisy windows are accepted or rejected wrongly.
- **R16** Each listening window is matched against the next few lines, not the whole song. *If wrong:* a window could match a later repeat of a chorus.
- **R17** Beat detection returns "no beat" for silence, noise or unaccompanied singing. *If wrong:* a very soft track gets no beat pulse.
- **R19, R21** Every save re-reads the latest project file, so hand edits and deletions made during timing are never overwritten. If the lyrics change during timing, the run asks to be repeated. *If wrong:* one extra helper.
- **R22** Audio cuts are re-encoded for exact start points, not copied. *If wrong:* slightly bigger uploads per window.
- **R23, R24** If the speech service fails part-way, what was already heard is kept. Cut files are deleted as soon as they're used. *If wrong:* minor.
- **R44** If a *second* timing run fails, the earlier good timing is kept and a notice is shown. *If wrong:* you briefly see older timing after a failed run.

## Rendering and layout

- **R18** Curved text is narrowed so it never enters the right 12% of a Short, where the buttons are. *If wrong:* curves are slightly less wide.
- **R25** The render is built for prod's older ffmpeg (5.1.9) and avoids the known end-of-song sound cut-off. *If wrong:* nothing visible.
- **R42** The "Calm" energy really calms the video: slams, frames and curves become pops and stacks. *If wrong:* a small policy tweak in Phase 2.
- **R45** The render takes only the song's first sound track. The cover option says "song's picture or a plain dark background". *If wrong:* copy only.

## Server routes and safety

- **R4** The caption-font route arrives with the lyric video routes. *If wrong:* nothing.
- **R26** Only "time the lyrics" and "render" count toward the daily allowance; page refreshes don't. *If wrong:* free users could time lyrics more often.
- **R27** Timing that stopped because the server restarted is shown as "stopped — run it again", not a spinner forever. *If wrong:* nothing.
- **R28** One lyric render per person, at most two at once on the server, and a disk-space check first. *If wrong:* a short wait at busy times.
- **R29** Render file names are random, one timing run per person at a time, songs capped at 15 minutes, and file paths are checked strictly. *If wrong:* a song over 15 minutes is refused.
- **R30** The project still returns full file paths, as Story does, but only to its owner. *If wrong:* a small path leak to the owner only.
- **R43** A render's progress is saved on the project, so leaving the page and coming back picks it up. *If wrong:* a little extra saved state.

## Live preview (browser)

- **R2** The preview library was tested on its own page first. The live security-header check is still due in the browser pass. *If wrong:* the preview could be blocked on the live site (the review found the header already allows it).
- **R3** The preview loads every caption font the looks use, not just six. *If wrong:* one extra font entry.
- **R5** The preview library pulls in a GPL-3.0 helper. It is swapped for an empty stub, so no GPL code ships. *If wrong:* very old Firefox may stutter in the preview.
- **R33** The preview hides a video song's own picture and frames the background exactly like the render. *If wrong:* a little extra preview code.
- **R41** An "Open-source credits" page lists the preview's libraries (fribidi LGPL, FreeType credit). *If wrong:* a doc page to adjust.

## Page and steps (browser)

- **R31** Uploads get 60 seconds before timing out. The page stops checking a project that failed to load. *If wrong:* nothing.
- **R32** Nudge and "Start here" buttons show only on lines that have a time. *If wrong:* nothing.
- **R34** Title and artist are asked for on the start screen and can't be renamed later in Phase 1. *If wrong:* a typo in the title means a new project.
- **R35** The song picker accepts the same file list as Story, so iPhone Files songs can be picked. *If wrong:* nothing.
- **R36, R37** The page stops a finished render's sound when you leave that step. Reopening a project doesn't skip the review. Timing again asks first ("counts toward today's render allowance; lines you moved by hand stay"). "Start here" waits for the preview. *If wrong:* minor.
- **R40** A new song clears old timing. MP3/WAV songs are saved as audio. Re-reading unchanged lyrics keeps the timing. Lyrics can't change while timing runs. *If wrong:* small rework.

## Process

- **R20** Re-pasted lyrics keep their timing by matching lines in order, so locks don't jump between repeated choruses. *If wrong:* about 20 more lines of code.
- **R38, R39** The smoke script and bundle are separate commits, and the controller checked them instead of a separate reviewer. Extra songs and the signed-in browser pass are handed to you. *If wrong:* those checks happen before the PR.
