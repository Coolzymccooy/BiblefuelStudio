# Kinetic caption engine ("Studio effects") — design

Date: 2026-10-09 · Status: draft for review · Pieces 1 and 2 of 4

## Why

The operator makes songs with Gemini and liked the captions in Gemini's
music videos: chunky brush lettering, words popping in on the beat, phrases
scattered around the frame, a hook word slammed full-screen with sparks, a
line curving around the singer, a scrolling band of lyrics framing the
picture. Gemini draws those as pixels, so its words come out misspelt. A
10-second spike (2026-10-09) proved BibleFuel can draw the same effects from
real word timings with libass, spelled correctly.

The operator wants these effects **everywhere BibleFuel burns captions**, not
only in a lyric-video mode. Today every renderer uses ffmpeg `drawtext`,
which cannot rotate text, animate its size cleanly, or put letters on a
curve.

## Scope

**In:**
1. A shared caption engine that turns timed words (or timed lines) into an
   ASS subtitle file, rendered with ffmpeg's `ass` filter (libass).
2. Wiring it into every caption renderer as an extra choice. Existing styles
   are untouched.

**Out (each gets its own spec later):**
3. Transitions pack (zoom-push, flash, slide, blur).
4. Song / lyric-video mode (paste lyrics, forced alignment, timing editor,
   per-line effect override UI, Shuffle).

The engine must already accept what piece 4 needs (`seed`, per-phrase
`overrides`), so piece 4 is UI and alignment only.

**Not touched:** the waveform video, the legacy sync routes in `render.js`,
and the YouTube thumbnail. They draw fixed text, not captions.

## Concepts

- **Look**: fonts and palette. It is chosen in the caption-style picker,
  e.g. "Lagos Night" (yellow brush hits, white marker body), "Gospel Gold"
  (gold serif hits, cream body), "Clean White" (white marker only).
- **Energy**: how wild the effect mix is.
  - `calm`: pops and stacked blocks only. This is the default for sermons
    and Ambient.
  - `lively`: adds slams, quotes and curves. This is the default for Story
    and Script.
  - `wild`: adds frequent slams, the border frame and curves. This is meant
    for songs.
- **Phrase**: the unit an effect applies to, made of 1–7 words with a start
  and an end. Phrases come from `splitPhrases` when there are word timings,
  or from the caller's lines when there are not.
- **Effect**: how one phrase is drawn. See the catalogue below.
- **Director**: picks an effect for each phrase from the energy's mix. It is
  seeded and deterministic, so the same `seed` always gives the same video.

## Effect catalogue

Every effect works with word timings, revealing word by word. Without word
timings (Timeline, Ambient, long-form's even spread), the phrase appears as a
whole, or its words are spread evenly across the phrase. All motion is
eased, and nothing moves for longer than 200 ms after landing.

| id | What it does | Used by |
|---|---|---|
| `pop` | Words pop in (scale 135%→100%, 130 ms) on one or two lines in the safe band | all energies |
| `stack` | Phrase broken into 1–3-word lines, stacked and tilted ±4°, at a rotating anchor slot. Each line pops when its first word is sung, and later words fade in on their beat | all energies |
| `slam` | Short phrase (≤4 words) huge in the hit font, centred, scaling 150%→100%, with a spark burst on the last word | lively, wild; hooks first |
| `quote` | Phrase in quotation marks with a hand-drawn underline that draws itself left to right | lively, wild |
| `curve` | Phrase set letter by letter along an arc in the upper half, each letter rotated to the tangent | lively (rare), wild |
| `frame` | Phrase repeated round all four edges as a scrolling band (top and bottom scroll opposite ways), with the phrase stacked in the centre | wild, chorus/hook only |
| `title` | Full-screen two-line brush title for the first phrase, or a given title | wild; and as an opt-in intro on any look |

## Director rules

- **Hooks**: a phrase whose normalised text (lower-case, punctuation
  stripped) appears two or more times is a hook. Hooks get `slam` or
  `frame`, while ordinary lines get `pop`, `stack`, `quote` or `curve`.
- **No repeats**: never the same effect twice in a row, except `pop`.
- **Rationing**:
  - `frame`: at most once per 30 s of video;
  - `curve`: at most once per 20 s;
  - `slam`: never within 4 s of another slam.
- **Long phrases**: more than 5 words, or a phrase that won't fit, falls
  back to `stack` (or `pop` under calm).
- **Overrides**: `overrides[phraseIndex] = effectId` wins over every rule.
- **Randomness**: it comes only from a seeded PRNG (mulberry32 on `seed`).

## Layout

- **Screen shapes**: 16:9 (1280×720 and up) and 9:16 (720×1280 and up),
  sized as fractions of the frame.
- **Safe area**: 6% side margins. On 9:16, the bottom 18% and the right 12%
  are kept clear for TikTok/Reels controls.
- **Slots**:
  - 16:9 rotates upper-left → right-mid → lower-centre → upper-right →
    left-mid;
  - 9:16 rotates top band → upper-middle → lower band.

  Consecutive phrases never share a slot.
- **Measuring and fitting**: text is measured with the existing HarfBuzz
  `measureText` (fontMetrics.js), using a per-font factor from ASS font size
  to pixels that is calibrated once by a test. A line that won't fit is
  shrunk, then wrapped. A `curve` that won't fit becomes `stack`.
- **Missing letters**: if the look's font has no glyph for a character
  (Yoruba ẹ ọ ṣ, accented letters), that phrase uses the look's fallback
  font (DejaVu Sans), never a silent system substitute.

## Fonts

The engine uses the repo fonts: Permanent Marker, Drybrush, Anton, Caveat
Bold and Playfair. It adds one all-caps brush font under the OFL (candidate:
**Knewave**), because Drybrush mixes cases ("i STiLL"). The licence file is
committed next to it, as for the existing fonts. Font family names are read
from the files, and `fontsdir` points at `server/assets/fonts`.

## Module shape (server)

`server/src/lib/kinetic/`:

- `looks.js`: `LOOKS` (id, label, fonts, colours, outline and shadow) and
  `listStudioLooks()`.
- `director.js`: `planPhrases({ phrases, energy, seed, overrides, durationSec, aspect })`
  returns `[{ phrase, effect, slot }]`. Pure.
- `effects/*.js`: one file per effect, each returning ASS `Dialogue` lines
  for one planned phrase. Pure.
- `ass.js`: `buildAss({ words?, lines?, w, h, look, energy, seed, overrides, title })`
  returns the ASS text. Pure; this is the unit that is tested.
- `filter.js`: `studioCaptionFilter({ ...buildAss opts, workDir })` writes
  `captions.ass` into the render's work dir and returns
  `{ filter, files }`, where `filter` is
  `ass=filename='<escaped>':fontsdir='<escaped>'` (escaped like
  `escapeFontPath`).
- `capability.js`: `hasLibass()` checks `ffmpeg -filters` once and caches
  the answer. Its result is shown on `/api/health` as `capabilities.libass`.

**Fallback**: if `hasLibass()` is false, every Studio look renders with its
`fallbackPreset` (an existing drawtext preset). The render never fails
because of the engine.

ASS handles thousands of events cheaply, so the Studio path needs no word
caps. drawtext needed them because of its per-frame filter cost.

## Wiring (piece 2)

Studio looks join the shared catalogue as `KINETIC_ANIMATIONS` entries with
`engine: "studio"`, ids `studio-<look>`, and `presetId` set to the fallback.
They then appear automatically in every picker fed by `GET /api/tts/animations`.
That endpoint also returns `energies` and `capabilities.libass`. When the
chosen style id resolves to a Studio look, each renderer calls
`studioCaptionFilter` instead of drawtext:

| Renderer | Where | Timing source | Default energy |
|---|---|---|---|
| Story video and long-form | `storyRender.js` `buildStoryCaptions` | Whisper words; long-form even spread | lively |
| Script/Wizard (also Series and social) | `jobs.js` `renderVideoCore` / `renderAdvancedVideo` | TTS or Whisper words, else lines | lively |
| Sermon clip (captioned video) | `render.js` `/captioned-video` | Whisper words | calm |
| Timeline editor render | `proofRenderer.js` | caption clips (lines) | calm |
| Ambient scripture video | `ambientRender.js` `captionFilters` | verse drops (lines) | calm |

**Per-project settings** add two fields where the project already stores
caption settings:
- `captionEnergy`: `calm`, `lively` or `wild`;
- `captionSeed`: an integer, random at creation.

The fields go on the Story project (`projectStore.normaliseCaptionSettings`),
the render payload (Script), the Timeline project's `renderSettings`, and
the Ambient project. Unknown values are normalised to the defaults.

**Client** (the same three pickers that already read the shared list, plus
Ambient):
- `StoryCaptionsPanel`, `RenderCaptionsPanel` and `CaptionStylePanel` (via
  `AnimationPicker`) show a **"Studio effects"** group.
- `AmbientCaptionsPanel` gets a Studio look choice next to its fixed serif.
- Picking a Studio look reveals an **Energy** control (Calm / Lively / Wild)
  and a **Shuffle** button, which sets a new `captionSeed`.
- The drawtext-only controls (motion, stagger, highlight, depth) are hidden
  for Studio looks, because the director owns those decisions.
- If `capabilities.libass` is false, the group shows "Studio effects
  unavailable on this server" and is disabled.

**Preview**: the Timeline live preview and `CaptionPreview.tsx` draw in the
browser and cannot show ASS. Each Studio look gets a 6-second sample clip
(about 300 KB, rendered by a script in `server/scripts/` and committed under
`client/public/studio-looks/`). It plays in the picker when the look is
focused. In the Timeline live preview, Studio looks show the plain caption
text and a badge reading "Studio effects appear in the render".

## Prod constraints

- Prod runs ffmpeg 5.1.9 from Debian bookworm. Filter graphs go through
  `-filter_complex_script`, as they do now. The `ass` filter's options are
  the same in 5.1 and 8.x.
- **First build step**: confirm prod has libass. Ship `capabilities.libass`
  on `/api/health` and check it on prod. If it's false, the Dockerfile gains
  `libass9`, or the fallback keeps renders working while that is fixed.
- On Windows dev, paths in the `ass` filter need the drive colon escaped.
  This reuses the `escapeFontPath` approach, and a unit test covers it.

## Errors

- **Empty input**: no words and no lines gives an empty filter. This matches
  today's builders.
- **Bad options**: an unknown look falls back to "Clean White", and an
  unknown energy or override id is ignored. Invalid input never throws.
- **File write failure**: if writing `captions.ass` fails, the render falls
  back to the look's drawtext preset and logs `[CAPTIONS] studio fallback:
  <reason>`.

## Testing

- **Unit (pure)**:
  - `buildAss` output: event count, timings and colour tags.
  - Director: same seed gives the same plan; different seeds give different
    plans; overrides win; rationing and no-repeat rules hold; hooks are
    detected.
  - Fallback to `stack` when text won't fit; the glyph-coverage fallback;
    9:16 safe-area bounds for every slot.
- **Calibration**: render one word per font through real ffmpeg and assert
  that the measured bounding box matches `measureText × factor` within ±4%.
- **Golden render**: a 4-second clip per effect through real ffmpeg. Assert
  the yellow and white pixels land in the planned slot at the planned
  times, and that a frame before the first word is clean.
- **Wiring**: for each renderer, a Studio look produces a filter containing
  `ass=`, and a drawtext look produces the same output as before. A false
  `hasLibass()` gives the fallback preset.
- **Client**: the pickers list Studio looks, the Energy and Shuffle controls
  appear for them, drawtext-only controls hide, and the disabled state shows
  when libass is missing.
- **Manual check**: render the "I Still Dey" opening on Story, on 16:9 and
  9:16, and confirm it on prod after deploy.

## Build order

1. Engine core (looks, director, `pop` / `stack` / `slam`, `ass.js`,
   `filter.js`, capability, calibration), wired into **Story** and checked
   end to end on prod (`capabilities.libass`).
2. `quote`, `curve`, `frame`, `title` effects and the sample preview clips.
3. Script/Wizard (with Series and social), then Sermon clip.
4. Timeline render and Ambient.

Each step is its own PR, reviewed by Codex.
