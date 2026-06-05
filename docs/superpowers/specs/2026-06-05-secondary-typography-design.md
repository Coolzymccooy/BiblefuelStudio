# Secondary Typography — Sharpening Pass — Design

**Date:** 2026-06-05
**Status:** Approved (design); pending implementation plan
**Scope:** App-wide, client only (`client/`)

## Problem

Secondary/subtext across the app reads dim and uneven. Two causes:

1. **Low contrast.** Most secondary text is `text-gray-500` (~50% luminance on
   the near-black `dark-950` background) — too faint to feel crisp.
2. **Inconsistency.** Pages apply secondary text ad-hoc
   (`text-xs text-gray-400`, `text-[10px] text-gray-500`,
   `text-[0.6875rem] text-gray-500`, …) instead of the existing
   `.field-help` / `.section-subtitle` component classes, so size, colour, and
   tracking vary screen to screen.

Goal: one sharpened, consistent secondary-text system (Linear/Vercel-grade),
applied to **all** secondary text app-wide. Keep Inter Variable — this is a
refinement of contrast, scale, and consistency, not a font swap.

## Non-goals

- No new typeface / webfont (Inter Variable stays).
- No change to headings (`h1–h6`) or primary body size.
- No layout or logic changes — text styling only.
- No dark/light theming work; the app is dark-only.

## Current state (reference)

`client/src/index.css`:
- Body: `text-gray-200`, `letter-spacing: -0.01em`, `line-height: 1.5`,
  `font-feature-settings: 'cv11','ss01','ss03'`, `-webkit-font-smoothing: antialiased`.
- `.field-label`: 13px, `font-medium`, `text-gray-300`.
- `.field-help`: 12px, `leading-relaxed`, `text-gray-500`.
- `.section-subtitle`: 13px, `text-gray-500`.

`client/tailwind.config.js`: `fontFamily.sans` / `.display` both Inter Variable.

## The system

Semantic scale (luminance measured on the `dark-950` background):

| Token | Use | Size / line-height | Colour | Tracking |
|------|-----|-----|-----|-----|
| `content-primary` | body copy | 15px / 1.5 | `#E5E7EB` (gray-200, ~85%) | -0.01em |
| `content-secondary` | descriptions, field help, subtitles, card body | 13px / 1.5 | `#A8B0BC` (~71%) | -0.005em |
| `content-tertiary` | meta, timestamps, counts, IDs, hints | 12px / 1.4 | `#8A929E` (~58%) | 0 |
| `content-caption` | badges, tiny uppercase labels | 11px / 1.4 | tertiary or accent | +0.04em |

Micro-typography:
- Keep `-webkit-font-smoothing: antialiased` and Inter's `cv11/ss01/ss03`.
- Add `font-variant-numeric: tabular-nums` to meta/number text so counts,
  timestamps, and IDs align.
- Relax small-text tracking from the global `-0.01em` (small text at tight
  tracking reads cramped): secondary `-0.005em`, tertiary `0`.

The brightness lift on `content-secondary` (~50% → ~71%) is the primary
"sharper" win.

## Implementation

### 1. Tokens (`tailwind.config.js` + `index.css`)

Add CSS variables in `index.css` `@layer base` and reference them as Tailwind
colours so they're usable as `text-content-secondary` etc.:

```css
:root {
  --content-secondary: #A8B0BC;
  --content-tertiary:  #8A929E;
}
```

```js
// tailwind.config.js -> theme.extend.colors
content: {
  secondary: 'var(--content-secondary)',
  tertiary:  'var(--content-tertiary)',
},
```

Captions reuse `content-tertiary`; colour-accented captions (e.g. amber
eyebrows) keep their existing `text-primary-*` / status colours.

### 2. Utility classes (`index.css` `@layer components`)

Encode the full recipe so call sites use intent, not raw utilities:

```css
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

### 3. Upgrade existing classes (zero-migration win)

Repoint `.field-help` and `.section-subtitle` at the new tokens so every
component already using them sharpens automatically:

```css
.field-help     { @apply mt-1.5 text-[0.75rem] leading-relaxed text-content-secondary; }
.section-subtitle { @apply text-[0.8125rem] font-normal text-content-secondary mt-0.5; }
```

### 4. Migration sweep (page-by-page)

Replace ad-hoc secondary-text patterns with the semantic classes. Mechanical
mapping:

| Ad-hoc pattern | New class |
|---|---|
| helper/description: `text-xs/text-[0.75rem] text-gray-400/500` | `text-help` (block hints) or `text-content-secondary` (inline) |
| subtitle under a title: `text-sm text-gray-500` | `text-subtitle` |
| timestamps, counts, sizes, `ID: …`, durations | `text-meta` |
| uppercase chip/eyebrow labels | `text-caption` |

Order (one reviewable diff per file): shared UI primitives (`components/ui/*`,
`Field`, `Section`, `Card`) → Render → Timeline → Backgrounds → Voice & Audio →
Settings → Jobs/Queue/Series → Home/Wizard → landing components.

Rules: text styling only — never touch layout, spacing that affects layout, or
logic. Preserve existing semantic colours that aren't "secondary grey" (e.g.
`text-emerald-300` status, `text-red-400` errors, `text-primary-*` accents).

## Verification

CSS/markup only — verification is build + visual:
- `npx tsc -p tsconfig.app.json --noEmit` and `npm run build` stay green.
- Before/after screenshots of Render, Timeline, and Settings at desktop and
  mobile widths confirm the contrast lift and no layout regressions.
- Spot-check that meta numbers (counts/timestamps) render tabular-aligned.

No unit tests (no logic changes).

## Files (anticipated)

- Edit: `client/src/index.css` (tokens, utilities, upgraded classes).
- Edit: `client/tailwind.config.js` (semantic colours).
- Edit (sweep, text-only): `client/src/components/ui/*`, `Field.tsx`,
  `Section.tsx`, `Card.tsx`, and the page files listed above.
