# Voice & Audio — industry-grade redesign (pilot)

**Date:** 2026-07-10
**Branch:** feat/mobile-redesign
**Status:** Design approved (visual companion), pending spec review

## Goal

Lift the Voice & Audio page (`client/src/pages/VoiceAudioPage.tsx`) to InVideo/CapCut-level
fit-and-finish **without changing any behavior, the colour palette, or the landing page**.
The chosen priority is **hierarchy & flow**: turn today's long wall of equal-weight control
cards into a clear **create → preview → use** workflow with one obvious primary action.

This is the **pilot**. Once validated, the same visual language propagates to the Create and
Studio hubs (separate tracks, separate specs).

## Constraints (hard)

- **Palette/tokens unchanged** — reuse existing `bf-gold` / `bf-cream` / `bf-card` / `rounded-bf`
  etc. No new colours; no landing-page changes.
- **Zero behaviour change** — every existing handler and API call stays: TTS generation and
  provider params, voice clone, voice presets, audio treatment (denoise/loudness/EQ), soundtrack
  library, record/upload, recent-audio "Use", caption animation, compare voices.
- **Mobile + desktop.** Mobile is the primary target (this is the mobile-redesign branch).
- **Do not deploy.** Implementation lands on the branch only; the operator tests before any push.

## Chosen direction

- **C · Create-first hero + reveal** — a single "Create a voice" hero is the first screen;
  everything else is calm, collapsed, revealed on demand.
- **Sticky player** — once a clip exists, a slim waveform player pins in view.
- **D2 · Two-pane desktop** — create/treat column + persistent Recent-Audio rail; collapses to
  the single mobile column below the breakpoint.
- **A) Tab bar removed** — the `All/Voice/Record/Treatment/Soundtrack` filter is replaced by the
  hero + reveal model (removes the redundant second navigation system).
- **B) Reveal sections collapsed by default** (except hero + player), with **per-section
  open/closed state remembered** in localStorage; the player is never auto-collapsed right after
  a generate.
- **C) Record/Upload lives inline in the hero** — a quiet "or record / upload" toggle expands the
  recorder in place, keeping all "get a voice into the workspace" actions together.

## Layout

### Mobile (single column, top → bottom)
1. **Sticky player** (`StickyAudioPlayer`) — hidden until Current Audio exists; then pinned under
   the app header, above the bottom nav. Shows waveform, play/scrub, elapsed/total, and the
   primary **Use in Render →** action (plus a shortcut into Audio treatment).
2. **Create-a-voice hero** (`CreateVoiceHero`) — text input with the existing helpers
   (*Use Latest Script*, *Format for Voice*, *Insert Template*), provider chips, a compact view of
   the key voice settings (Voice ID, Stability, Similarity + Load/Generate), the primary
   **Generate** button, and the **"or record / upload"** inline expander.
3. **Reveal sections** (`RevealSection`, reusable collapsible) in order:
   - Audio treatment
   - Soundtrack library
   - Recent audio
   - **Advanced** group: Voice clone · Voice presets · Compare voices · Caption animation

### Desktop (≥ lg): two-pane
- **Player** spans the top of the content area (sidebar nav unchanged).
- **Left pane:** hero → Audio treatment → Soundtrack library.
- **Right rail** (`RecentAudioRail`): Recent audio always visible for compare/reuse, plus quick
  access to Presets / Clone.
- Below `lg`, the rail content folds back into the mobile reveal-section order.

## Component decomposition

`VoiceAudioPage.tsx` is ~2,100 lines. Extract presentational units (page keeps all state and
handlers; pieces receive props/callbacks — no logic moves that changes behaviour):

| Component | Responsibility | Depends on |
|-----------|----------------|------------|
| `StickyAudioPlayer` | Sticky waveform/preview + Use-in-Render | current track, play state, onUseInRender |
| `CreateVoiceHero` | Text + provider + settings + Generate + record/upload expander | text, provider, settings, onGenerate, onRecordUpload |
| `RevealSection` | Reusable labeled collapsible with remembered open state | title, storageKey, children |
| `RecentAudioRail` | Recent-audio list (desktop rail / mobile section) | clips, onUse |

Files live under `client/src/components/voicelab/` (existing folder) or a new
`client/src/components/voice-audio/`. Target < 300 lines each.

## Out of scope (follow-up tracks)
- Applying the same visual language to the **Create** and **Studio** hubs (separate specs).
- Any new features, providers, or backend changes.

## Success criteria
- Every existing action still works (generate, clone, presets, treat, soundtrack, record/upload,
  recent "Use", caption animation, compare) — verified in the running app.
- First screen shows only the hero (+ player when a clip exists); no tab bar.
- Sticky player stays visible while scrolling/opening sections; **Use in Render →** always reachable.
- Desktop shows the two-pane layout with a persistent Recent-audio rail; mobile is a clean single
  column.
- Reveal sections remember open/closed state across reloads.
- No palette or landing-page changes; `tsc -b` clean; layout verified at 430px and desktop widths
  with a full (~30-item) recent-audio list.
