# Secondary Typography Sharpening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all secondary/subtext across the app crisp and consistent by introducing a sharpened semantic type system (brighter, unified tokens + utility classes) and migrating ad-hoc grey text to it — keeping Inter Variable.

**Architecture:** A foundation layer (CSS variables + Tailwind semantic colours + `@layer components` utility classes) that also upgrades the existing `.field-help`/`.section-subtitle` for a free lift, followed by a page-by-page, text-only migration of ad-hoc `text-gray-400/500` secondary text to the new classes. No logic or layout changes.

**Tech Stack:** Vite + React + TypeScript, Tailwind CSS (config in `client/tailwind.config.js`, base/components in `client/src/index.css`). Verification is build + visual (CSS/markup only — no unit tests).

**Spec:** `docs/superpowers/specs/2026-06-05-secondary-typography-design.md`

---

## File Structure

- **Modify** `client/tailwind.config.js` — add `content.secondary` / `content.tertiary` semantic colours.
- **Modify** `client/src/index.css` — add CSS vars, new utility classes (`.text-help`, `.text-subtitle`, `.text-meta`, `.text-caption`), upgrade `.field-help` / `.section-subtitle`.
- **Modify (sweep, text-only)** shared primitives then pages:
  `components/ui/Field.tsx`, `Card.tsx`, `Badge.tsx`, `InfoTooltip.tsx`;
  then `pages/RenderPage.tsx`, `TimelinePage.tsx`, `BackgroundsPage.tsx`,
  `VoiceAudioPage.tsx` (+ `components/VoiceSynthesisPanel.tsx`),
  `SettingsPage.tsx`, `JobsPage.tsx`, `QueuePage.tsx`, `SeriesPage.tsx`,
  `HomePage.tsx`, `WizardPage.tsx`, `HelpPage.tsx`, and remaining cards/widgets.

## Migration mapping (used by every sweep task)

Replace ad-hoc secondary-text classes with semantic intent. Apply per element, with judgment:

| Existing pattern (secondary text) | Replace with |
|---|---|
| Block helper/description under a control or title — e.g. `text-xs text-gray-400`, `text-[0.75rem] text-gray-500`, `text-sm text-gray-400` (descriptive) | `text-help` |
| Subtitle line directly under a heading/title | `text-subtitle` |
| Timestamps, counts, durations, file sizes, `ID: …`, `vX.Y`, `N of M`, monospace metadata | `text-meta` |
| Tiny UPPERCASE eyebrow / chip label (`uppercase tracking-* text-gray-500`) | `text-caption` |

**DO NOT touch** (leave exactly as-is):
- Icon colours (`<Icon className="text-gray-500" />`), chevrons, spinners.
- Accent/status colours: `text-primary-*`, `text-emerald-*`, `text-red-*`, `text-amber-*`, `text-yellow-*`.
- `placeholder-gray-*`, `disabled:` states, hover/focus `*:text-*`.
- Primary body copy already at `text-gray-100/200/300` that isn't "secondary".
- Any class controlling layout/spacing/size that would shift the layout — only swap the **colour + (when it's the size the table implies) size/leading**; if a size change would visibly reflow a row, keep the original size and change colour only.

When unsure whether something is "secondary text" vs an accent/structural colour, leave it unchanged and note it.

---

## Task 1: Foundation — tokens, utilities, upgraded classes

**Files:**
- Modify: `client/tailwind.config.js`
- Modify: `client/src/index.css`

- [ ] **Step 1: Add semantic colours to Tailwind**

In `client/tailwind.config.js`, inside `theme.extend.colors`, add a `content` group immediately after the `primary` block (keep all existing colours):

```js
        content: {
          secondary: 'var(--content-secondary)',
          tertiary: 'var(--content-tertiary)',
        },
```

- [ ] **Step 2: Add the CSS variables**

In `client/src/index.css`, inside the existing `@layer base { ... }`, add a `:root` block at the top of the layer (before the `html` rule):

```css
  :root {
    --content-secondary: #A8B0BC; /* ~71% lum on dark-950 — descriptions, help, subtitles */
    --content-tertiary:  #8A929E; /* ~58% lum — meta, timestamps, counts, hints */
  }
```

- [ ] **Step 3: Add the utility classes + upgrade existing classes**

In `client/src/index.css`, inside `@layer components { ... }`, REPLACE the existing `.field-help`, `.section-title`, `.section-subtitle` block:

```css
  .field-help {
    @apply mt-1.5 text-[0.75rem] leading-relaxed text-gray-500;
  }

  .section-title {
    @apply text-[0.9375rem] font-semibold text-white tracking-tight;
  }

  .section-subtitle {
    @apply text-[0.8125rem] font-normal text-gray-500 mt-0.5;
  }
```

with:

```css
  .field-help {
    @apply mt-1.5 text-[0.75rem] leading-relaxed text-content-secondary;
  }

  .section-title {
    @apply text-[0.9375rem] font-semibold text-white tracking-tight;
  }

  .section-subtitle {
    @apply text-[0.8125rem] font-normal text-content-secondary mt-0.5;
  }

  /* Sharpened secondary-text system — see
     docs/superpowers/specs/2026-06-05-secondary-typography-design.md */
  .text-help {
    @apply text-[0.8125rem] leading-relaxed text-content-secondary;
    letter-spacing: -0.005em;
  }

  .text-subtitle {
    @apply text-[0.8125rem] text-content-secondary;
    letter-spacing: -0.005em;
  }

  .text-meta {
    @apply text-[0.75rem] text-content-tertiary;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }

  .text-caption {
    @apply text-[0.6875rem] uppercase text-content-tertiary;
    letter-spacing: 0.04em;
  }
```

- [ ] **Step 4: Verify build is green**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0; `../server/public` rebuilt; no Tailwind "class does not exist" errors. (If Tailwind warns that `text-content-secondary` is unknown, the colour group in Step 1 is misplaced — fix and rebuild.)

- [ ] **Step 5: Sanity-check the classes resolve**

Run: `cd client && grep -n "content-secondary\|content-tertiary" tailwind.config.js src/index.css`
Expected: the colour group, the two CSS vars, and their use in `.field-help`/`.section-subtitle`/`.text-*` all present.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/tailwind.config.js client/src/index.css && git commit -m "feat(ui): sharpened secondary-text tokens + utility classes; upgrade field-help/section-subtitle"
```

---

## Task 2: Shared UI primitives sweep

**Files:**
- Modify: `client/src/components/ui/Field.tsx`
- Modify: `client/src/components/ui/Card.tsx`
- Modify: `client/src/components/ui/Badge.tsx`
- Modify: `client/src/components/ui/InfoTooltip.tsx`

These are the highest-leverage call sites (used everywhere). Apply the mapping table; text-only.

- [ ] **Step 1: Field.tsx — badge slot uses meta token**

In `client/src/components/ui/Field.tsx`, the badge slot is:

```tsx
                    {badge && <div className="text-[0.6875rem] text-gray-500 shrink-0">{badge}</div>}
```

Replace with:

```tsx
                    {badge && <div className="text-[0.6875rem] text-content-tertiary shrink-0">{badge}</div>}
```

(Badge text is sentence-case like "Optional" / "Required for waveform" — keep its 11px size, just lift the dim grey to the brighter tertiary token. Do NOT use `.text-caption` here, since that forces uppercase.)

- [ ] **Step 2: Card.tsx — read it, map any secondary text**

Run: `cd client && grep -n "text-gray-\(400\|500\)\|text-\[1[01]px\]\|text-xs" src/components/ui/Card.tsx`
For each MATCH that is descriptive/subtitle text (e.g. a card description/subtitle line), change the colour to `text-content-secondary` (descriptions) or swap to `text-help`/`text-subtitle` per the mapping table. Leave icon colours and structural greys. If Card.tsx has no secondary text, make no change and note it.

- [ ] **Step 3: Badge.tsx + InfoTooltip.tsx — read and map**

Run: `cd client && grep -n "text-gray-\(400\|500\)\|text-\[1[01]px\]\|uppercase" src/components/ui/Badge.tsx src/components/ui/InfoTooltip.tsx`
- Badge: if it renders small uppercase label text in grey, switch that grey to `text-content-tertiary` (keep its existing size/tracking). Coloured badge variants (primary/emerald/red) stay.
- InfoTooltip: the tooltip body copy, if grey, → `text-content-secondary`. Leave the trigger icon colour.

- [ ] **Step 4: Verify build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/components/ui && git commit -m "style(ui): migrate shared primitives to sharpened secondary-text classes"
```

---

## Task 3: RenderPage + TimelinePage sweep

**Files:**
- Modify: `client/src/pages/RenderPage.tsx`
- Modify: `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: List the candidates**

Run: `cd client && grep -nE "text-gray-(400|500)" src/pages/RenderPage.tsx`
Run: `cd client && grep -nE "text-gray-(400|500)" src/pages/TimelinePage.tsx`
Read each line in context (open the file). Classify each as: helper/description, subtitle, meta (counts/IDs/durations/sizes/timestamps), caption (uppercase eyebrow), or NON-secondary (icon/accent/placeholder/structural).

- [ ] **Step 2: Apply the mapping (text-only)**

For each secondary-text match, apply the mapping table. Representative real examples in these files:
- RenderPage Soundtrack helper `mp3, wav, m4a … Up to {MAX_UPLOAD_MB} MB.` and similar `<p className="... text-gray-500">` → `text-help`.
- Render/Timeline `ID: {item.id}` overlays, `{Math.round(durationSec)}s`, `{backgroundItems.length} of {MAX_BACKGROUNDS} selected …`, render-history timestamps → `text-meta`.
- Uppercase eyebrows like `text-xs uppercase tracking-wider text-gray-500` (e.g. ShareSheet-style "Share link") → `text-caption`.
- The "click to toggle, order = render sequence" subtitle under the modal title → `text-subtitle` (keep its existing `text-[11px]`/`text-xs` size if changing it would reflow the header — colour-only otherwise).

Leave: lucide icon `text-gray-500`, chevrons, `placeholder-gray-*`, accent colours.

- [ ] **Step 3: Verify build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/pages/RenderPage.tsx client/src/pages/TimelinePage.tsx && git commit -m "style(render,timeline): migrate secondary text to sharpened classes"
```

---

## Task 4: Backgrounds + Voice & Audio sweep

**Files:**
- Modify: `client/src/pages/BackgroundsPage.tsx`
- Modify: `client/src/pages/VoiceAudioPage.tsx`
- Modify: `client/src/components/VoiceSynthesisPanel.tsx`

- [ ] **Step 1: List candidates**

Run: `cd client && grep -nE "text-gray-(400|500)" src/pages/BackgroundsPage.tsx src/pages/VoiceAudioPage.tsx src/components/VoiceSynthesisPanel.tsx`
Read each in context and classify per the mapping table.

- [ ] **Step 2: Apply the mapping (text-only)**

- Backgrounds: result counts ("Results (N)"), per-tile `ID:`/resolution/category metadata → `text-meta`; the page intro/description lines → `text-help`; uppercase section eyebrows → `text-caption`. Leave thumbnails' overlay accent colours and icons.
- Voice & Audio / VoiceSynthesisPanel: field descriptions/help → `text-help`; voice metadata (provider, duration, sample rate) → `text-meta`; section subtitles → `text-subtitle`. Leave the provider-status accent colours.

- [ ] **Step 3: Verify build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/pages/BackgroundsPage.tsx client/src/pages/VoiceAudioPage.tsx client/src/components/VoiceSynthesisPanel.tsx && git commit -m "style(backgrounds,voice): migrate secondary text to sharpened classes"
```

---

## Task 5: Settings + Jobs + Queue + Series sweep

**Files:**
- Modify: `client/src/pages/SettingsPage.tsx`
- Modify: `client/src/pages/JobsPage.tsx`
- Modify: `client/src/pages/QueuePage.tsx`
- Modify: `client/src/pages/SeriesPage.tsx`

- [ ] **Step 1: List candidates**

Run: `cd client && grep -nE "text-gray-(400|500)" src/pages/SettingsPage.tsx src/pages/JobsPage.tsx src/pages/QueuePage.tsx src/pages/SeriesPage.tsx`
Read each in context and classify.

- [ ] **Step 2: Apply the mapping (text-only)**

- Settings: setting descriptions/help → `text-help`; plan/usage numbers, "vX.Y" → `text-meta`. Leave connect-card status accents.
- Jobs/Queue: job descriptions → `text-help`; job IDs, timestamps, durations, "N of M", progress counts → `text-meta`; status pills keep their accent colours.
- Series: part descriptions → `text-help`; counts/dates → `text-meta`; uppercase labels → `text-caption`.

- [ ] **Step 3: Verify build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/pages/SettingsPage.tsx client/src/pages/JobsPage.tsx client/src/pages/QueuePage.tsx client/src/pages/SeriesPage.tsx && git commit -m "style(settings,jobs,queue,series): migrate secondary text to sharpened classes"
```

---

## Task 6: Home + Wizard + Help + landing sweep

**Files:**
- Modify: `client/src/pages/HomePage.tsx`
- Modify: `client/src/pages/WizardPage.tsx`
- Modify: `client/src/pages/HelpPage.tsx`
- Modify: `client/src/components/landing/*` (only files containing secondary grey text)

- [ ] **Step 1: List candidates**

Run: `cd client && grep -rnE "text-gray-(400|500)" src/pages/HomePage.tsx src/pages/WizardPage.tsx src/pages/HelpPage.tsx src/components/landing`
Read each in context and classify. NOTE: the landing page is marketing copy — only migrate genuine secondary/helper text; preserve its hero/marketing hierarchy and any editorial serif styling.

- [ ] **Step 2: Apply the mapping (text-only)**

- Home: card descriptions, step explanations → `text-help`; metadata/counts → `text-meta`.
- Wizard: step helper text → `text-help`.
- Help: answer/body copy that's secondary grey → `text-help`; section eyebrows → `text-caption`.
- Landing: sub-headlines/feature descriptions that are grey body → `text-content-secondary` (keep their larger sizes; colour-only), footnotes → `text-meta`. Do NOT shrink marketing text to 13px — change colour only where it's a dim grey, preserving size.

- [ ] **Step 3: Verify build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/pages/HomePage.tsx client/src/pages/WizardPage.tsx client/src/pages/HelpPage.tsx client/src/components/landing && git commit -m "style(home,wizard,help,landing): migrate secondary text to sharpened classes"
```

---

## Task 7: Remaining components sweep

**Files:**
- Modify: `client/src/components/Layout.tsx`, `NotificationsBell.tsx`, `ReportIssueWidget.tsx`, `PlanAndUsageCard.tsx`, `WebhookConnectCard.tsx`, `YouTubeConnectCard.tsx`, `PostizConnectCard.tsx`, `AutoPublishCard.tsx`, `ShareSheet.tsx`, `RenderProgressOverlay.tsx`, `MediaTrimmer.tsx`, `BibleVerseLookup.tsx`, `AdminPage.tsx`, `voicelab/*`, `lib/errors.tsx`.

- [ ] **Step 1: List candidates**

Run: `cd client && grep -rlnE "text-gray-(400|500)" src/components src/pages/AdminPage.tsx src/lib/errors.tsx`
Then for each file: `grep -nE "text-gray-(400|500)" <file>` and read in context.

- [ ] **Step 2: Apply the mapping (text-only), file by file**

Apply the mapping table to each. Common in these: connect-card descriptions → `text-help`; the "Share link"/eyebrow labels in ShareSheet → `text-caption`; usage counts in PlanAndUsageCard → `text-meta`; AdminPage table metadata → `text-meta`. Leave all status/accent colours, icons, and the notifications bell badge accent.

- [ ] **Step 3: Verify build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/components src/pages/AdminPage.tsx 2>/dev/null; cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src && git commit -m "style(components): migrate remaining secondary text to sharpened classes"
```

---

## Task 8: Final verification

- [ ] **Step 1: Confirm the sweep is materially complete**

Run: `cd client && grep -rcE "text-gray-500" src --include="*.tsx" | grep -vE ":0$" | sort -t: -k2 -rn | head -20`
Review remaining `text-gray-500` usages — each should now be a deliberate icon/accent/placeholder/structural use, NOT secondary body text. Note any intentional leftovers; they're acceptable.

- [ ] **Step 2: Full build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0; `../server/public` rebuilt.

- [ ] **Step 3: Visual check (before/after)**

Start dev (`npm run dev` at repo root) or use the live deploy, and visually confirm on Render, Timeline, and Settings at desktop + a ~390px mobile width:
- Secondary/help text is noticeably brighter and uniform.
- Counts/timestamps/IDs render tabular-aligned (`text-meta`).
- No layout reflow, no accent/status colour lost, no icon dimmed unintentionally.

- [ ] **Step 4: Commit rebuilt bundle (if not already committed in a prior task)**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/public && git commit -m "build(client): rebuild bundle with sharpened secondary typography" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** tokens + scale + contrast → Task 1; upgrade existing classes → Task 1 Step 3; micro-typography (tabular-nums, relaxed tracking) → `.text-meta`/`.text-help` in Task 1; migration sweep app-wide → Tasks 2–7 (shared primitives first, then every page/component group); verification (build + visual, no unit tests) → Task 8 + per-task build steps.
- **No new typeface / no heading changes / text-only:** enforced by the mapping table's "DO NOT touch" list in every sweep task.
- **Type/name consistency:** the four classes (`.text-help`, `.text-subtitle`, `.text-meta`, `.text-caption`) and two colours (`content-secondary`, `content-tertiary`) are defined in Task 1 and used verbatim in Tasks 2–7.
- **Known judgement risk:** the sweep is per-element judgement, not blind replace; the rules + "DO NOT touch" list bound it, and every task ends in a build gate + the final visual check catches regressions.
