# BibleFuel Studio: product design system

**Status:** first draft, 2026-10-23, written from the tokens already in the client
(`client/tailwind.config.js`, `client/src/index.css`). The operator should confirm or correct it. Where
it disagrees with `DESIGN_QUALITY_STANDARD.md`, this file wins on product values and the standard wins
on principles.

## Identity

**Creative suite, quiet studio.** Warm near-black surfaces, cream text and one gold accent. The
creative output (videos, captions, thumbnails) is the brightest thing on screen; the chrome around it
stays calm. A Cormorant Garamond serif is reserved for screen titles; everything else is sans.

## Tokens (already defined, use these)

| Role | Token |
|---|---|
| Page ground | `bg-bf-bg`, `bg-bf-bg2` |
| Panels and cards | `bg-bf-card`, `bg-bf-card2`; editor chrome `bg-editor-panel` |
| Inputs | `bg-bf-input`, `bg-bf-input2` |
| Text | `text-bf-cream` (primary), `text-content-secondary` (help, subtitles), `text-bf-sub` (secondary), `text-bf-muted` (metadata) |
| Accent | `text-bf-gold`, `bg-accent-fill` with `text-accent-ink` (always as a pair) |
| Borders | `border-editor-line`; hover `border-editor-accent/50` |
| Semantic | `text-bf-success`, `text-bf-warn`, `text-bf-danger` (also `tone-success`, `tone-danger`) |
| Radius | `rounded-lg` for controls, `rounded-card` (16px) and `rounded-bf` (18px) for cards |

Themes switch through `data-theme` on the root; every token above resolves through a CSS variable, so
components must not hardcode hex values.

## Type

- UI and body: Instrument Sans. Titles: Cormorant Garamond via `ScreenHeader`. Data, ids, durations
  and money: JetBrains Mono or `tabular-nums`.
- Help text uses `.text-help`; section headings use `Section`.
- The gold `.bf-eyebrow` above a screen title is the one all-caps role per screen.

## Components to reuse

`ScreenHeader`, `Section`, `Field`, `Input`, `Textarea`, `Select`, `Button` (primary, secondary, ghost,
danger), `Badge`, `BusyBar`, `InfoTooltip`, `StartNewButton`. Icons come from `lucide-react` only.

## Colour meaning

- Gold is the accent and the primary action. It never means "warning".
- `bf-warn` is a warning (for example "above the $10 benchmark"); `bf-danger` is an error or a destructive
  action; `bf-success` is a finished step.

## Known debt (not fixed by new work)

- Several existing screens still use arbitrary `text-[Npx]` sizes and `white/…` opacity borders.
- `Badge` contains hardcoded colours.
- These are migrated progressively, never in a big-bang restyle.
