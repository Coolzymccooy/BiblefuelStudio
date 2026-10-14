# Song mode: kinetic lyric videos for your own songs — design

**Status:** design approved in chat 2026-10-12/13 (flow, timing engine, direction/backgrounds/branding/preview/publish, four phases). Awaiting review of this written spec.
**Tracker:** Coolzymccooy/BiblefuelStudio#51
**Reference build:** "My Time No Late" by Sthill Waters, hand-made on 2026-10-12 (https://www.youtube.com/watch?v=xjCPYSlKsec). Its scripts, lyric sheet, Whisper passes and hand-checked timings are the fixtures for this feature's tests.

## 1. Goal

A BibleFuel user uploads a finished song (for example a Gemini track), pastes its lyric sheet and gets a kinetic lyric video in the Studio caption looks: every line timed to the singing, effects chosen per section, crowd echoes, backgrounds cut at the song's sections, their logo and a "Song by …" credit, published to YouTube with the lyrics in the description. About 10 minutes of the user's time for a 3-minute song.

**Control model (chosen):** automatic, then tweak. BibleFuel does everything; the user previews, fixes the few flagged lines and swaps any effect, then renders.

**Audience (chosen):** every plan. Counts against the normal render allowance.

### Non-goals

- Writing or generating the song or lyrics.
- Karaoke-style per-syllable highlighting.
- A waveform timeline editor (the "full control" option was declined).
- Video generation of backgrounds (users bring clips, use the library or the song's cover art).
- Languages other than English, Nigerian Pidgin and Yoruba lines inside them (Whisper is run with `language=en`; other languages are a later extension).

## 2. Why this is not "Timeline + Whisper"

Measured on the reference song:

- Whisper `whisper-1` on the whole mix with no prompt returned only `♪♪`.
- With the full lyric sheet as the prompt it timed the first 70 s well, then looped ("Who talk say" ×40).
- On the isolated vocal stem it degraded after 52 s into "smoke smoke smoke…".
- 30-second windows, each prompted with the lyric lines expected in that window, recovered every section. The isolated stem gave nearly the same word times as the mix in those windows.
- Sequence-matching the user's sheet against the heard words placed 49 of 60 lines automatically; 11 words were interpolated and 9 lines (the crowd echoes, two bridge lines, one chorus line) needed hand timing.

Today BibleFuel sends no prompt to Whisper (`server/src/lib/alignment.js` ~196-204), ignores typed lyrics in kinetic Render (`alignAudioWithText` `_text` is unused), has no per-word timing editor, no per-line effect choice, cuts multi-clip backgrounds on speech pauses, and has no end card. Song mode fills exactly those gaps.

## 3. User flow

New card **Lyric video** on the Studio hub (`client/src/pages/StudioHubPage.tsx`), route `/app/lyric-video` (lazy-loaded like `StoryVideoPage` in `client/src/App.tsx`). A project list, then a stepped page:

1. **Song** — upload audio, or a video (a Gemini export: audio is extracted; a still from it is offered as a background). Large files use the existing resumable upload (`/api/media/upload-session` → GCS → `/upload-finalize`). Fields: **title**, **artist** (remembered per user, e.g. "Sthill Waters").
2. **Lyrics** — paste the sheet; see it parsed (sections, lines, echoes, skipped notes) and correct it.
3. **Timing** — the song plays with the captions drawn live; lines below the confidence bar carry "check this line". Per line: nudge −0.1 s / +0.1 s, "set start here" while playing, play from this line. A changed line is locked.
4. **Look** — Studio look + energy (existing `StudioEffectsControls`, now with Shuffle feedback). Effects come from the section policy (§6); each line has an effect menu: Auto, Pop, Stack, Slam, Quote, Curve, Frame, Echo. Shuffle re-rolls Auto lines only.
5. **Backgrounds** — add clips (upload, library, the song's cover still); auto-assigned to sections, re-assignable; per clip **Fill / Zoom / Show whole**; chorus beat pulse on/off.
6. **Branding** — logo from Settings → Branding (`server/src/lib/branding.js`), artist wordmark, intro credit, end card; each can be switched off.
7. **Render & publish** — output frame (9:16 / 16:9 / 1:1), quality (720p default, 1080p), Shorts trim offer, render as a background job, then the existing YouTube publish with a prefilled draft (§10).

Steps unlock in order on first pass; afterwards any step can be revisited. Leaving and returning restores the project.

## 4. Data model

One JSON file per project under the user's data dir: `lyric-projects/<projectId>.json` (same pattern and atomic write as `server/src/lib/story/projectStore.js`). Media files live in the user's output dir.

```jsonc
{
  "projectId": "lv_…", "version": 1, "createdAt": "…", "updatedAt": "…",
  "title": "My Time No Late", "artist": "Sthill Waters",
  "song": { "file": "<outputDir>/lyric-song-<uuid>.m4a", "durationSec": 181.27, "coverStill": "<outputDir>/…jpg|null" },
  "sheet": { "raw": "…as pasted…", "parsedAt": "…" },
  "sections": [ { "id": "s1", "kind": "intro|verse|pre|chorus|bridge|final|outro|other", "label": "INTRO", "start": 0.0 } ],
  "lines": [ {
      "id": "l12", "sectionId": "s4", "kind": "lead|response|soft",
      "text": "Who talk say I no go shine?",
      "words": [ { "text": "Who", "start": 71.18, "end": 71.6 } ],
      "start": 71.18, "end": 73.68,
      "confidence": 1.0,            // share of words heard; responses capped (see §5)
      "flag": null,                 // "check" when below the bar
      "locked": false,              // true once the user moved it
      "effect": "auto"              // or pop|stack|slam|quote|curve|frame|echo
  } ],
  "timing": { "status": "idle|running|done|error", "jobId": null, "beats": { "bpm": 107.7, "times": [0.16, 0.74, …] }, "usedVocalStem": false },
  "look": { "id": "studio-lagos-night", "energy": "wild", "seed": 2026 },
  "backgrounds": [ { "id": "b1", "file": "…mp4|jpg", "kind": "video|image", "fit": "auto|fill|zoom|whole", "sections": ["s1","s3"] } ],
  "pulse": true,
  "branding": { "logo": true, "wordmark": true, "introCredit": true, "endCard": true },
  "renders": [ { "jobId": "…", "aspect": "portrait", "quality": "720p", "file": "…mp4", "durationSec": 179.0, "at": "…" } ]
}
```

Everything that changes the picture is in the project, so re-rendering the same project gives the same video; a tweak changes only what it touches.

## 5. Lyric timing engine

`server/src/lib/lyricVideo/` holds the pure parts; a job wires them up.

### 5.1 Sheet parser — `sheetParser.js`

Input: the pasted sheet. Output: `{ sections, lines, skipped }`.

- **Section headings:** a line that is wholly `[ … ]` (or `**…**`, or `VERSE 1:`-style). The text before any `—`/`-` is the label; kind from keywords: intro, verse, pre-chorus/pre, chorus/hook/refrain, final chorus → `final`, bridge, outro/ending; else `other`.
- **Stage notes skipped:** a line wholly in `( … )` that comes right after a heading or contains no sung words in an otherwise lyric section, e.g. `(Talking drum, soft guitar, male vocal)`. Shown in "skipped" so the user can restore one.
- **Responses:** a parenthesised part *within or after* a sung line, `… (WHO TALK SAY?!)`, or a line that is wholly parenthesised *inside* a chorus/final section between sung lines → a separate `response` line following its call.
- **Cleanup:** strip leading emoji/bullets (`🎵 💬 🔥 ✨ 💃 🎉 •`), smart quotes kept, Unicode NFC (Yoruba tone marks kept exactly as typed).
- **Long lines:** a lead line over 5 words or 28 characters splits at a comma or `!`/`?` nearest the middle; never mid-word; both halves keep the section.
- `soft` kind: lines in `bridge` sections, and any line containing letters the look's marker fonts lack (ẹ ọ ṣ and combining marks), use the soft style (§6.3).

### 5.2 Audio preparation

- Extract mono 16 kHz AAC with ffmpeg for transcription; keep the original for render.
- **Vocal stem (opt-in, off by default):** only when the server sets `LYRIC_VOCALS=1` and `laptopOnline()` is true, enqueue a laptop stems job asking for the **Vocals** stem (`stem: "vocals"` on the job). Wait up to 4 minutes; otherwise continue on the mix. Recorded as `timing.usedVocalStem`. Measured on the reference songs it gave no gain (11 lines flagged against 10, median error 0.27 s against 0.12 s), so it stays off. Its runs exposed two window fixes that now apply to every song: `trimLoops` keeps a window's words before its first backwards timestamp (never in pass 0, which is still rejected whole), and a window may not move the frontier more than 3× the song's average pace since the last anchor.

### 5.3 Windowed transcription — `transcribeWindows.js`

Whisper `whisper-1`, `verbose_json`, word timestamps, `language=en`, `temperature=0`, through the existing OpenAI key handling. Prompts are capped at 900 characters (measured: longer prompts are truncated by the API).

1. **Pass 0:** whole song, prompt = the sheet's lines in order.
2. Align (§5.4). Find the **reliable prefix**: the last line before the first run of 3 lines with confidence < 0.5, or before a detected loop (§5.3.1).
3. **Windows:** from that point, 30 s windows with 5 s overlap; each prompt = the next ~8 unplaced lines (including responses). After each window, align the cumulative word set; the next window starts 2 s before the last confidently placed line ends.
4. Stop when every line is placed or the song ends. Lines still unplaced are interpolated (§5.4) and flagged.
5. A window is retried once, narrower (15 s), if it is rejected.

#### 5.3.1 Rejection rules

A pass or window is rejected (its words discarded) when any holds: a single word or 3-gram repeats ≥ 6 times consecutively; "♪"-only text; known hallucinations ("thanks for watching", "subscribe", "smoke" runs); fewer than 20% of its words match any expected line; word times not increasing.

### 5.4 Alignment — `align.js`

- Normalise words: NFD, strip combining marks, lower-case, keep `[a-z0-9']`; hyphenated sheet words match as parts ("Eh-yeah" ↔ "Eh" "yeah").
- Global sequence alignment (Needleman–Wunsch style, match +2, mismatch −1, gap −1) of the sheet's word stream against the heard stream; equal-length mismatched runs keep the heard time (a mishearing, e.g. "dey"→"de").
- **Times:** a matched word takes the heard start; unmatched words are spread evenly between matched neighbours; a word lasts until the next word starts (min 0.08 s); starts are strictly increasing.
- **Locked lines** are fixed anchors: alignment only fills between them.
- **Line confidence** = matched words / words. **Responses** are rarely transcribed: an unmatched response is placed 0.2 s after its call's last word, lasting 0.25 s per word (min 0.7 s), confidence 0.
- **Flag** a line "check" when confidence < 0.6, or when it was interpolated across a gap > 3 s, or it overlaps its neighbour after placement.
- **Section starts** = start of the section's first line minus half a beat (snapped to the beat grid, §5.5).

Acceptance bar on the reference song (fixture: the saved Whisper passes): ≥ 85% of lead lines within 0.3 s of the hand-checked `lines.json` starts; every line the hand pass marked "manual" is either within 0.3 s or flagged.

### 5.5 Beat grid — `beats.js`

Pure JS on ffmpeg-decoded mono 11 025 Hz PCM: onset envelope from positive energy flux in short frames (hop 256), tempo by autocorrelation over 70–180 BPM (prefer the octave nearest 100–130 when two peaks tie), phase by comb-filter alignment, beat times to the end. Used for the chorus pulse and to snap background cuts. Reference: librosa found 107.67 BPM on the reference song; the JS result must be within 1 BPM, and the median distance from its beat times to librosa's beat times (both from that song) must be under 40 ms.

### 5.6 The timing job

`POST /api/lyric-video/:id/align` starts a job (status persisted in the project; progress: preparing, listening 1/n…, matching, beats). Typical: 1–2 minutes for 3 minutes of audio. Cost ≈ $0.04 per 3-minute song (Whisper $0.006/min; overlapping windows ≈ 2× audio). One job per project at a time; re-running keeps locked lines.

## 6. Direction: which effect each line gets

### 6.1 Section policy — `director.js` (lyric-video), feeding the engine's existing per-phrase `overrides` (`kinetic/director.js` `planPhrases({ overrides })`)

| Section | Policy (energy *wild*; *lively* and *calm* step down as the engine's MIX does) |
|---|---|
| intro | first line `title`; short exclamations (≤ 2 words, ends `!`) `slam`; rest `stack`/`pop` alternating |
| verse | `stack` / `pop` alternating; a line with a quotation or a `soft` line → `quote` |
| pre | `stack`; at most one `curve` per section, on the line ≤ 5 words nearest the middle |
| chorus / final | lines ≤ 4 words `slam`; the **title line** (contains the song title, or the most repeated line) `frame` once per section; long lines `pop` |
| bridge | `soft` style; `quote` for the first line, then `stack`/`pop` |
| outro | `curve` on the first short line, `slam` on the last |
| any | `response` lines → `echo` |

The engine's existing guards (no slam within 4 s, frame ≥ 30 s apart, curve ≥ 20 s apart) still apply; the policy picks the first allowed choice. A line's own menu choice (not "auto") always wins. Shuffle changes the seed, which re-rolls only Auto choices where the policy allows alternatives.

### 6.2 New engine effect: `echo` — `server/src/lib/kinetic/effects/echo.js`

Built from the reference: the response in the look's **hit** font, body colour, outlined in the hit colour, sized at 0.105 × frame width on tall and Shorts frames and 0.105 × frame height on wide ones, tilted +6°, pop 175%, placed in the lower band under the call (tall: y = 0.645 h; wide: y = 0.72 h), sparks on the last word. Added to `EFFECT_IDS`; the call before an echo holds until the next *lead* line, so call and response share the screen. This holds only when the call is not itself an echo and every reply after it is drawn as an echo; then the call and the last echo hold, and an earlier echo leaves when the next one comes. Otherwise each line leaves when the next starts. A held call keeps its ink at least 0.02 h above its echoes' ink: it moves up first, then shrinks. Available to every caption feature, not only Song mode.

### 6.3 Soft style

Each Studio look gains a `soft` companion pairing: handwritten body **Caveat Bold** (covers ẹ ọ ṣ and combining marks; already in `server/assets/fonts`) at scale 1.35 with the look's hit font/colour for the key word. Used for `soft` lines in place of the generic DejaVu fallback.

### 6.4 Layout for Shorts and TikTok

Measured from the operator's YouTube Shorts screenshots: the top ~11% (status bar, back/search) and the bottom ~25% (channel, title, Share) are covered, plus the right ~12% (buttons). The engine's tall layout keeps the right 12% and bottom 18% clear today. Song mode renders with a **Shorts-safe** tall layout: bottom bound 0.75 h, top bound 0.11 h (`clampBlockY`, `frameBox`, `LOWER`, `ARC` parameterised by a safe-area object rather than constants). Default stays as today for other features.

## 7. Backgrounds

- **Assignment:** clips in the order added are assigned round-robin to sections, choruses sharing one clip so they read as a refrain; the user can drag a clip onto sections. A section with no clip continues the previous one. The cover still is a valid "clip".
- **Fit modes** (per clip; `auto` resolves by measured shape with `sceneFraming.js` `probeMediaSize`):
  - `fill` — scale to cover and centre-crop (default when the clip is within 15% of the frame's shape),
  - `zoom` — show-whole-over-blur scaled up so the picture covers 55% of the frame height (centred on 0.5 h, so the caption slots at 0.40 h and 0.62 h land on it), cropping about 40% of a 16:9 clip's width (default for landscape in portrait),
  - `whole` — today's contain-over-blur (`storyRender.js` `sceneFrameFilter`).
- **Montage** — `montage.js` builds the per-section segments (loop shorter clips with `-stream_loop`, slow drift ±1.2% via `overlay` with `sin(t)`, vignette), joins them with `xfade` of 0.6 s at section starts snapped to the nearest beat: `fadewhite` into chorus/final, `fadeblack` into bridge, `fade` otherwise. Chorus/final pulse when enabled: `eq` brightness `0.10·max(0,cos(2π(t+φ)/period))^10` from the beat grid.
- Must work on prod FFmpeg 5.1 (no filters newer than 5.1; xfade, eq eval=frame, boxblur, vignette all exist there; scripts via `-filter_complex_script`).

## 8. Branding

All drawn as a second ASS layer plus image overlays, from `readBranding(dataDir)`:

- **Logo + wordmark:** logo (Settings → Branding) at top-left inside the safe area (tall: top 11.5% h, left 4% w; height 5.5% h), artist name beside it in the look's body font colour gold-on-dark (`#E6C47A`); fades out during `frame` effects (their bands use the frame edge) and during the end card.
- **Intro credit:** "♪ {title} — song by {artist}", 0.8–7.4 s, under the logo.
- **End card:** last 4 s: frame dims to ~87% black, logo large and centred, title, "Song by {artist}". If the song has under 3 s of tail after the last line, the render extends by 3 s with the music faded (`apad` + `afade`).
- **Shorts trim:** for 9:16 renders of songs 180–190 s long, offer "Trim to 2:59 so it counts as a Short" (fade the last 3 s); disabled when the trim would cut a lyric line.

## 9. Preview

- **Background proxy:** once backgrounds are set, a job renders the montage at 360×640 (or 640×360 / 480×480), CRF 30, no captions — about 30–60 s for 3 minutes on prod. Rebuilt only when backgrounds, fits, pulse or frame change.
- **Live captions:** the browser plays the proxy with the song and draws the captions with **JASSUB** (libass compiled to WebAssembly, MIT) from `GET /api/lyric-video/:id/captions.ass?w=&h=` — the same ASS the render uses — with the Studio fonts served from the app. Edits (timing, effect, look, shuffle) refetch the ASS (~100 ms) and swap it without reloading the video.
- **Feasibility spike first (plan task 1):** JASSUB in this Vite app without cross-origin isolation, fonts loading, a 3-minute ASS with ~200 events at 30 fps on a mid phone. **Fallback** if it fails: "Preview 30 s" renders a low-res clip around the selected line on the server (~30–60 s each).

## 10. Render and publish

- `POST /api/lyric-video/:id/render { aspect, quality, shortsTrim }` → existing render job registry (`server/src/lib/renderJobs.js`: progress, cancel, persisted, notification). Pipeline: full-res montage → captions ASS + branding ASS + logo overlays → audio (trim/extend/fade) → H.264 high, AAC 256k, `+faststart`. One render per user at a time. Expected ~6–10 min for 3 min at 1080p on prod (8 cores, no GPU); 720p default.
- **Publish:** the existing YouTube publish panel opened with a draft from `GET /:id/publish-draft`:
  - title "{title} — {artist} (Official Lyric Video)" (≤ 100 chars),
  - description: "🎵 Song by {artist}", one-line hook (the title line), credits, the full lyrics from the sheet with section labels, channel link if connected, hashtags from title/artist/genre words,
  - category Music, not made for kids,
  - a one-line plain-English note about YouTube's "Altered or synthetic content" setting with how to set it in Studio (the API cannot set it).

## 11. API

All under `/api/lyric-video`, behind the existing auth + `withUserScope`; capability `lyric.video` added to free and premium in `featureGate.js`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list projects |
| POST | `/` | create `{ title, artist }` |
| GET | `/:id` | project |
| DELETE | `/:id` | delete project and its media |
| POST | `/:id/song` | attach an uploaded file (path from upload-finalize, confined to the user's output dir); extracts audio/cover still |
| PUT | `/:id/sheet` | save + parse the sheet → sections/lines |
| POST | `/:id/align` | start timing job; `GET /:id/align/:jobId` status |
| PATCH | `/:id/lines/:lineId` | `{ start?, end?, effect? }` → locks timing changes |
| PUT | `/:id/look`, `/:id/backgrounds`, `/:id/branding` | step settings |
| POST | `/:id/preview-bg` | start proxy job |
| GET | `/:id/captions.ass` | ASS for preview at `w×h` |
| POST | `/:id/render` | start render job |
| GET | `/:id/publish-draft` | title/description/tags |

Inputs are validated at the boundary (sheet ≤ 20 000 chars, ≤ 400 lines; title/artist ≤ 100; times within song duration; enums checked); file paths are confined to the user's dirs (`confineToDir`).

## 12. Errors

- Upload not audio/video, or no audio stream → clear message on step 1.
- Sheet with no sung lines → "Paste the lyrics, one line per line".
- Whisper/API failure → the job errors with the reason; user can retry; partially placed lines kept.
- Under 50% of lines placed → timing step opens with a banner: "Most lines could not be heard — check the sheet matches the song".
- Laptop stem not ready in 4 min → carry on with the mix, silently noted.
- Render failure → job error with the ffmpeg reason summarised; inputs kept.
- Disk headroom checked before upload and render (`hasDiskHeadroomForUpload`).

## 13. Testing

- **Unit (server, node:test):** sheet parser (the reference sheet incl. emojis, stage notes, responses, Yoruba); alignment (fixtures: the reference song's saved Whisper passes → acceptance bar in §5.4; locked anchors; interpolation; monotonic); rejection rules; beat grid (synthetic click track at 100/120 BPM exact; reference song within 1 BPM); section policy table; echo effect geometry and safe-area bounds; montage filter builder (string tests + one real ffmpeg render of two tiny clips checking a white flash frame); branding layer timing; publish draft; route validation and confinement.
- **Client (vitest + Testing Library):** each step's component; timing nudge/lock; effect menu; background assignment; preview swapping ASS (JASSUB mocked).
- **E2E (Playwright):** create → upload a 20 s fixture song → paste sheet → timing (Whisper stubbed) → render 720p → publish draft shown.
- Coverage ≥ 80% on new modules.

## 14. Phases (each its own PR with Codex review)

1. **Core:** project store, routes, page shell + Studio hub card, Song + Lyrics + Timing steps, sheet parser, windowed transcription + alignment + flags, beat grid, JASSUB spike → live preview over a single background (or cover still), render with automatic section policy and one background, Shorts-safe layout. *Usable end to end.*
2. **Direction:** per-line effect menu, `echo` effect, soft style, full section policy, Shuffle on Auto lines, vocal-stem boost via the laptop worker.
3. **Backgrounds:** multi-clip sections, fit modes, beat-snapped transitions, chorus pulse, proxy rebuilds.
4. **Branding & publish:** logo/wordmark in the safe area, intro credit, end card + tail extension, Shorts trim, publish draft.

## 15. Risks and open points

- **JASSUB feasibility** (§9) — decided by the Phase 1 spike; fallback defined.
- **Alignment on other songs** — the acceptance bar is tuned on one song; Phase 1 also runs the engine on two more of the operator's Gemini tracks before merge and reports flag counts.
- **Prod render time** — 1080p may take ~10 min; 720p default, job runs in background.
- **Whisper drift or price change** — transcription goes through the existing STT provider layer; the prompt-window logic is provider-agnostic where the provider accepts a prompt.
- **ffmpeg 5.1 on prod** — every filter used is checked against 5.1; montage tests run against the local ffmpeg but avoid post-5.1 features.
