# Moments Showcase styles — design

Date: 2026-10-25 · Issue: #133 · Status: approved to build (the operator handed design and implementation over: "I leave it to you to figure out the design and implementation")

## 1. Intent

On 2026-10-25 a hand-made video for the LightHouse Parish Men Hangout was put together outside the product. It took 105 photos, several phone videos, a song (Emma OMG, "Jesu Daddy Mi") and Gospel Gold captions, and cut them on the beat through playful multi-photo templates: polaroid drops, a grid that pops in tile by tile, split screens, swipe cards, a triptych wipe, a spotlight iris, a scrolling film strip and full-frame push-ins. It was rendered with Remotion, at 9:16 for phones and 16:9 for the church cinema screen. The operator called it "absolutely blown away" and asked for "this exact feature" inside Moments, plus about three more styles that come with it. More styles will follow "bit by bit as inspiration comes", so adding a style must be cheap.

Reference implementation (throwaway, not in the repo): the session scratchpad Remotion project `mh/mh-video/src/{templates.tsx,wideTemplates.tsx,Composition.tsx,Wide.tsx}` and the planner `mh/bf/server/plan2.mjs`. The templates there are the visual source of truth for this build.

## 2. Goals

1. A new family of Moments styles, **Showcase**, that shows one or several photos per scene through rotating templates, cut on the song's beat.
2. Four Showcase styles at launch:
   - **Fellowship**: the Men Hangout look (warm grade, Gospel Gold captions, all eight templates, cream flashes at section changes).
   - **Scrapbook**: soft and personal (cream paper backdrop, taped prints and polaroids, gentle tilts).
   - **Party Pop**: bright and bouncy (colour-block backdrops, grid pops, swipes, spotlights, quicker scenes).
   - **Premiere**: cinematic event recap (dark, letterbox bars, film strip, spotlight, triptych, slow pushes, clean white captions).
3. More photos and longer Moments for Showcase styles: up to **100 photos** and lengths of **30, 60, 90, 120 and 180 s**.
4. A **shape** choice for Showcase styles: Portrait 9:16 (default) or Widescreen 16:9 (church screens, YouTube). Each template has a portrait and a widescreen layout. Photos are never cropped to fit a wide frame: they show whole on a blurred copy of themselves, or in cards.
5. An **invite end card**: when the occasion's details hold a date that can be read as a day and month, the closing scene shows a calendar card (month on a gold band, big day number) under the closing statement, e.g. "We meet again on 21st November".
6. Adding the next style is a data change (one entry in `styles.js` plus a preview video), not new code, as long as it reuses the templates.

## 3. Non-goals (this release)

- Video clips in Moments (the fast-forwarded "▶▶ ×10" clips and the roll call). Separate issue.
- Speaker highlight: transcribing a talk, picking the best 30 s, removing room noise (BS-Roformer runs on the laptop worker only) and word-timed captions. Separate issue.
- Any change to how the four classic styles look or render.
- Social posting changes, Timeline hand-off, image-to-video.

## 4. Anti-goals (a failure even if it works)

- A photo cropped so a face is cut off in the wide shape. Whole photos only on wide.
- A render that blocks other users for ages or takes prod down: it must run inside the existing heavy-job gate, one at a time, with bounded memory.
- Captions sitting on the busiest part of a multi-photo layout so they cannot be read.
- Breaking the classic styles, their previews, or existing saved projects.

## 5. Constraints

- **Prod ffmpeg is 5.1.9**: any filter used in the finish pass must be on `FFMPEG_51_FILTERS`. The picture work moves to Remotion, so this only touches the image prep and finish.
- **Prod has no swap** (15.6 GB RAM, 8 cores). Renders run inside `runExclusive`. Remotion concurrency stays at `REMOTION_CONCURRENCY` (default 2). Photos are staged at a bounded size (long side 1400 px) so Chrome never holds 100 full-size originals.
- **Remotion is already in prod**: `server/remotion/src` is bundled at image build time (`scripts/bundle-remotion.mjs`, `REMOTION_SERVE_URL`). A new composition registered in `Root.tsx` ships with the next image.
- **Cloudflare caps request bodies at 100 MB** (uploads only). Output is served from `media.tiwaton.co.uk`. Keep long outputs reasonable for social publishing: Showcase finishes over 60 s use a capped bitrate (see 7.6).
- **Bundled sample videos** load through `api.mediaBaseUrl`, never same-origin.
- **Design quality standard** (`docs/PRODUCT_DESIGN_SYSTEM.md`) applies to the operator chrome (the Style step), not to the video itself.

## 6. What the user sees

### 6.1 Style step
- The style cards stay one grid. Showcase cards come after the classic four, under a small heading "Showcase · many photos at once" (sentence case). Each card plays its preview, as today.
- **Shape** (Showcase styles only): a two-segment control "Portrait 9:16" / "Widescreen 16:9" beside Length. Classic styles do not show it.
- **Length** shows the lengths of the picked style's family: classic 15/30/60, Showcase 30/60/90/120/180.
- Picking a classic style while the length or shape only suits Showcase moves them back to the nearest classic value (60 s, 9:16). The server does the same clamp, so an old client can't save an impossible pair.

### 6.2 Photos step
- The cap shown and enforced becomes 100 (`meta.limits.maxPhotos`). Classic styles still use at most what fits their length, and the existing "N photos didn't fit" note covers the rest.

### 6.3 Words step
- Statement limits grow with the new lengths: 90 s → 10, 120 s → 12, 180 s → 16 (15/30/60 keep 3/5/8). The AI writer and the occasion templates are unchanged; they simply may produce more.

### 6.4 Result
- The player respects the shape (16:9 shows wide). History entries are unchanged.

## 7. How it works

### 7.1 Styles registry (`server/src/lib/motion/styles.js`)
Each entry gains `family: "classic" | "showcase"` (the existing four are `"classic"`). A Showcase entry carries:

```js
fellowship: {
  id, family: "showcase", energy, label, description,
  look: "studio-gospel-gold",          // caption look
  grade: "…",                          // finish-pass grade, ffmpeg 5.1 filters only
  templates: { single: 3, polaroids: 2, split: 2, grid: 2, swipe: 2, triptych: 2, spotlight: 1, filmstrip: 1 }, // weights
  palette: { backdrop: "blur" | "paper" | "colour" | "dark", card: "#F7F1E3", accent: "#E8B04B", ink: "#1A1208", blocks?: [...] },
  flashes: true,                       // cream flash on section changes
  letterbox: false,
}
```
`STYLE_IDS` keeps listing every style. New exports: `SHOWCASE_IDS`, `isShowcase(id)`, `lengthsFor(id)`, `familyOf(id)`.

### 7.2 Showcase director (`server/src/lib/showcase/director.js`, pure)
Input: photo shapes (`tall`/`wide`), the beat grid (same `songGrid`/`voiceGrid`/`pulseGrid` the classic path uses), title, statements, style, Energy, length, seed, shape, details (for the invite date). Output: a **showcase plan**.

Rules:
- **Templates and their photo counts**: single 1, spotlight 1, split 2, polaroids 3, swipe 3, triptych 3, grid 4, filmstrip 5. Base beats on screen: single 3, spotlight 3, split 4, polaroids 5, swipe 5, triptych 4, grid 5, filmstrip 8.
- **Energy** scales the beats: calm (< 0.34) × 1.5, lively × 1, hype (> 0.66) × 0.75, rounded to whole beats, at least 2.
- Scenes start and end on beats from the grid. The first scene starts at 0, the last ends at `durationSec` exactly (the final scene stretches or shrinks to land there).
- **Every photo once, in the user's order**, hero first. If all photos do not fit the length, scenes switch to the more photo-dense templates first (grid, filmstrip, polaroids), then extra photos are dropped from the end and reported with the existing `droppedNote`. If there are too few photos for the length, the sequence cycles from the start (as classic does).
- Template choice: weighted by the style's `templates`, deterministic by seed (`mulberry32`), never the same template twice in a row, and only templates whose photo count fits the photos left. Wide photos are fine everywhere (cards use cover inside their own frame; single and spotlight show the photo whole on its blur).
- **Opening scene**: always `single` on the hero photo (the title sits on it). **Closing scene**: `finale` (the hero photo, slow pull-out, fade) or `invite` when an invite date was read (7.4). Both last at least 3 s.
- **Captions** reuse `placeCaptions` from the classic director by passing the scenes as cuts (with `downbeat` from the grid), so title, body statements and the closing statement are timed exactly as today. The statement limit uses `statementLimit(lengthSec)` with the new 90/120/180 entries.
- Output fields: `{ version: 1, kind: "showcase", w, h, fps: 30, durationSec, seed, style, energy, shape: "tall"|"wide", scenes: [{ template, photos: [i…], start, end }], captions, invite: { month, day, label } | null, flashes: [seconds…] }`. `w×h` is 1080×1920 for portrait, 1920×1080 for widescreen.

### 7.3 Plan validation (`server/src/lib/showcase/plan.js`)
A zod schema like `motion/plan.js`: `durationSec ≤ 181`, `scenes 1..400`, `captions ≤ 20`, contiguous scenes from 0 to `durationSec`, every photo index in range, each template's photo count exact, `style` in `SHOWCASE_IDS`. Classic `validatePlan` is untouched.

### 7.4 Invite date
`readInviteDate(text)` parses common forms of `details.date`: "21 November", "21st Nov", "November 21", "21/11", "2026-11-21", "Sat 21 Nov 2026". Day/month numbers are read day-first for slashes (UK). Anything unreadable gives `null`, and the closing scene is a plain `finale`. The card shows a three-letter upper-case month and the day number; the closing statement carries the words.

### 7.5 Composition (`server/remotion/src/showcase/`)
- `MomentShowcase` composition registered in `Root.tsx` (with `calculateMetadata` like the others).
- One file per template (`Single`, `Polaroids`, `Split`, `Grid`, `Swipe`, `Triptych`, `Spotlight`, `Filmstrip`, `Finale`, `Invite`), each drawing a portrait or a widescreen layout from the plan's shape, ported from the reference implementation. Style differences come only from `palette`, `letterbox` and `flashes` props, so a new style needs no new component.
- Backdrops: `blur` (the scene's first photo, tiny and blurred, dimmed), `paper` (warm cream with soft vignette and subtle grain drawn in CSS), `colour` (the palette's blocks, one per scene, cycling), `dark` (near-black).
- Warm soft-light tint and vignette as in the reference, from palette values.
- The composition is silent. Animation is driven by `useCurrentFrame` and `spring`/`interpolate` only (no CSS transitions).
- Fonts: Anton for the calendar card, loaded with `@remotion/fonts` from the asset server.

### 7.6 Render path
`momentRenderStage` stays the single entry. After photos, sound and timing are resolved:
- classic style: unchanged (`directMoment` → `validatePlan` → `renderPlan`).
- Showcase style: `directShowcase` → `validateShowcasePlan` → `renderShowcase` (new, `server/src/lib/showcase/render.js`, injectable through `_setEngineForTest`):
  1. **Stage photos**: for each usable photo, one ffmpeg run makes `card-i.jpg` (upright from EXIF the same way `prepare.js` does, long side ≤ 1400, aspect kept) and `blur-i.jpg` (216×384 or 384×216 cover, boxblur, slightly darkened). Filters must be on the 5.1 allow-list.
  2. **Picture**: `startAssetServer` with the staged images and fonts, then `remotionRender` (from `render/lifecycle.js`) of `MomentShowcase` to `body.mp4`. Remotion progress maps to the `shots` stage (20–75 %).
  3. **Finish**: the existing `finishArgs` with a small adapter plan (`durationSec`, `fps`, `w`, `h`, `style`, `energy`, `seed`, `captions`, and one synthetic `{ role: "end", start: closingSceneStart, overlays: [] }` shot so `closingScrim` darkens the closing card). Statements go through `statementsAss`, so captions use the style's look and the kinetic engine's wide layout on 16:9. The song window, voiceover ducking and loudness are exactly as for classic Moments.
  4. **Colour**: the body must reach the finish tagged as `CLIP_TAGS` expects (tv range, BT.601). Render with Remotion's default colour handling and confirm in a test render; if Remotion tags BT.709, convert in the finish with a 5.1-safe filter rather than retagging.
  5. **Size**: Showcase finishes over 60 s use `-crf 21 -maxrate 8M -bufsize 16M` (about 180 MB at most for 180 s); 60 s and under keep the classic settings.
- Progress shares for Showcase: prepare 0–10, analyse 10–20, picture 20–80, finish 80–100.
- Cancel works as today (the abort signal reaches ffmpeg and Remotion's cancel signal). The work folder is always removed.

### 7.7 Project model and API
- `project.shape`: `"tall" | "wide"`, default `"tall"`; `applyUpdate` accepts it only for Showcase styles (a classic style forces `"tall"`).
- `lengthSec` is validated against `lengthsFor(style)`; changing style clamps length and shape (6.1).
- `MAX_PHOTOS` = 100; `MIN_PHOTOS` stays 3.
- `GET /meta` adds `family` to each style, `lengthsByFamily`, and `shapes`. Old clients that ignore them still work.
- `MAX_STATEMENTS` = 16; `STATEMENT_LIMITS` gains 90: 10, 120: 12, 180: 16.
- MCP (`momentsView.js`, `tools/moments.js`): list the new style ids, `shape`, and the new lengths in the tool descriptions.

### 7.8 Previews
`server/scripts/make-moment-previews.mjs` learns Showcase styles: the same synthetic stills, a fake beat grid, `directShowcase`, then the Remotion render at 360×640, crf 30, no audio, ≤ 600 KB, written to `client/public/moments/previews/<id>.mp4` (and the server copy). The previews are generated once and committed.

## 8. Decided here (the builder's calls, recorded for the operator to check)

- Remotion for the Showcase picture, reusing the existing finish pass for grade, captions and audio.
- The family name "Showcase" and the four style names and looks above.
- 100 photos and 30–180 s for Showcase; classic limits unchanged except the shared photo cap.
- Wide shape only for Showcase styles.
- The invite card shows a calendar only (no sport ball or other icons); the closing statement says what the event is.

## 9. Left to the builder

Exact template beat counts per style, palette colours for Scrapbook, Party Pop and Premiere, the paper texture, preview content, and the code split inside `server/src/lib/showcase/` and `server/remotion/src/showcase/`.

## 10. Tests

- **Director**: deterministic for a seed; scenes contiguous from 0 to `durationSec` on beats; every photo used once when they fit, in order, hero first; dense templates chosen before dropping; dropped count correct; never the same template twice running; opening `single`, closing `finale`/`invite`; Energy changes scene lengths; captions valid under `validateShowcasePlan`.
- **Invite date parser**: each listed format, ambiguous and junk input.
- **Plan validation**: rejects gaps, overlaps, wrong photo counts, out-of-range indices, classic style ids.
- **Styles**: every Showcase entry names only known templates and a real caption look; classic entries unchanged; `lengthsFor`.
- **Project store / routes**: shape only for Showcase; style change clamps length and shape; 100-photo cap; meta shape.
- **Render stage**: a Showcase project calls `renderShowcase` (injected), a classic one still calls `renderPlan`; the finish adapter passes the captions and the closing time; cancel and failure paths record as today.
- **Showcase render**: staging args (rotation, sizes) and the 5.1 filter allow-list; finish args for > 60 s carry the bitrate cap.
- **Client**: Style step shows Shape only for Showcase, the right lengths per family, and clamps on switching; Photos step uses the new cap; Result plays 16:9.
- **MCP**: the new ids and fields.
- **One real render** of each Showcase style at 30 s in both shapes on the dev machine, checked frame by frame, before the PR.
