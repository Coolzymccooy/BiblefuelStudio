# Product Design Quality Standard

**Applies to:** every product built under Tiwaton Ltd (Lumina Presenter, AetherCast, BibleFuel Studio,
ConnectAI, SeltonOS, LHP, TiwaGold, Kadiz and any new project), existing and future.
**Canonical copy:** `~/.claude/standards/DESIGN_QUALITY_STANDARD.md`. Each repository keeps a copy at
`docs/DESIGN_QUALITY_STANDARD.md` plus its own `docs/PRODUCT_DESIGN_SYSTEM.md`. When they disagree, the
repo's PRODUCT_DESIGN_SYSTEM wins on product-specific values and this file wins on principles.

## Objective

Design like a mature commercial software company, not an AI interface generator. Reference products
(Microsoft 365, Linear, Stripe, Notion, Figma, Apple apps, and for broadcast tools ProPresenter, OBS,
DaVinci Resolve) are references for **discipline**, not templates to copy.

A functional interface is not automatically a production-quality interface.

## 1. Typography

- Typography is a primary design element. Pick families for the product's personality, platform and
  licence; candidates include Inter, Instrument Sans, Segoe UI, SF Pro and system UI stacks. A product
  may reject a common family deliberately (Lumina dropped Inter because it reads as generated UI).
- One type scale, defined as tokens. No arbitrary `text-[Npx]` outside the token file.
- **Base size depends on the surface:**
  - Reading and content surfaces (marketing, documents, forms, settings, mobile): 16px body,
    14–15px secondary.
  - Dense operator tools (broadcast consoles, editors, data grids): 13px body, 11px minimum for labels
    and metadata. Nothing below 11px in the interface.
- At most three weights per product, normally 400/500/600. Weights 800–900 are for display type only.
- Labels are sentence case. All-caps with wide tracking is allowed only for at most one deliberate role
  per screen, never as the default label recipe.
- Tabular numerals (`font-variant-numeric: tabular-nums`) for timers, counts, money and aligned data.
- Decorative or serif families only in roles the product doc names (for example titles).

**Gate:** every screen has a readable hierarchy in which one thing leads and nothing competes at the
same volume.

## 2. Colour

Never default to purple, violet, electric blue, neon or rainbow gradients. Every product defines, as
tokens: brand primary/secondary, a neutral scale, text (primary, secondary, muted, disabled, inverse),
surfaces (ground, pane, elevated), borders, semantic colours (success, warning, danger, info) and
interaction states (hover, active, selected, focus, disabled).

- WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text and essential UI boundaries/graphics.
- No faint grey text on grey surfaces for looks. Muted text still passes 4.5:1 where it carries
  information.
- A colour means one thing everywhere in a product (for example red = on air, never "delete" too).
- Accent colour only where neutral styling would communicate worse.
- Choose light or dark for real operating conditions (dark control rooms vs office daylight), not
  fashion.
- No hardcoded hex/rgb in components; use tokens.

## 3. Surfaces and restraint

Not allowed as defaults: gratuitous gradients, glassmorphism, backdrop blur, glowing borders and neon
outlines, coloured glow shadows, oversized drop shadows, cards inside cards, decorative blobs and
abstract shapes, heavily rounded containers, many coloured panels.

Do instead: plain intentional backgrounds; depth by small value steps, hairline borders and sparing
shadow; one radius scale as tokens (for example 4/6/8, pill only for chips); clear grouping. Every
effect needs a functional or brand reason. **At most one glow per product, reserved for one state**
(for example live/on-air).

**Exception:** content that is the product's creative output (slides, motion backgrounds, video, lyric
renders, kinetic text, thumbnails) may be as dramatic as the work requires. The rule governs the
operator chrome around it.

## 4. Layout and density

- 4px spacing scale. Predictable alignment between headings, controls, tables and panels.
- Design for real workflows, not screenshots: no oversized headers, buttons or padded cards without a
  reason. Desktop uses the space; mobile is designed, not shrunk.
- Hit targets: 24×24px minimum on desktop (WCAG 2.5.8), 44×44px on touch.

**Gate:** balanced and usable at the mobile, tablet, desktop and large-display sizes the product
actually supports.

## 5. Components

Reusable, documented components with variants and states for buttons, inputs, selects, tables, tabs,
navigation, dialogs, panels, tooltips, alerts/toasts, loading/skeleton/empty/error states, icons,
badges and status chips.

- Do not invent a new button style when one exists. One icon family, one stroke width, fixed sizes.
- Consistent heights, radii and padding per variant. No decorative elements without a job.

## 6. Product identity

One standard, distinct personalities. Each repo's `PRODUCT_DESIGN_SYSTEM.md` records its direction:

| Product | Direction |
|---|---|
| Lumina Presenter | Quiet broadcast console: restrained warm-charcoal surfaces, precise type, the words on screen are the loudest thing, red reserved for live |
| AetherCast | Production studio: disciplined panels, readable meters, controls and timelines |
| BibleFuel Studio | Creative suite: expressive media canvas, clean editing controls |
| ConnectAI | Microsoft 365 / Linear clarity: approachable enterprise colour, impeccable type |
| SeltonOS | Financial enterprise: trustworthy, strong data hierarchy, serious |
| LHP, TiwaGold, Kadiz, others | Define in the repo's doc the first time UI work touches it |

Professional does not mean everything is white or grey. It means deliberate, consistent and
recognisable.

## 7. Accessibility

WCAG 2.2 AA is a release requirement: keyboard navigation, visible `:focus-visible` indicators,
accessible names on icon-only controls, state never conveyed by colour alone, actionable error
messages, `prefers-reduced-motion` respected, usable at 200% zoom.

## 8. Motion and feedback

Ordinary UI motion: 120–240ms, ease-out, transform/opacity only. No bounce, pulse or glow loops in
chrome. Loading states reflect real work. No layout shift or flicker. Immediate feedback on every
action. Never trade runtime performance for cosmetics (this matters most on live-production machines).

## 9. Engineering

- One token source per product (CSS variables and/or Tailwind theme) for type, colour, spacing,
  radius, elevation and motion. Components consume tokens only.
- No new UI dependency, heavy animation library or large asset without demonstrated value.
- Preserve functionality, business logic, integrations and performance budgets. Restyling never
  changes behaviour.

## 10. Working on an existing app

Do not indiscriminately redesign working interfaces. Audit first (measured counts, severity), fix
shared foundations (tokens) before screens, migrate the highest-impact surfaces progressively in
small PRs, keep successful interaction patterns, capture before/after screenshots, verify nothing
functional changed.

## 11. UI delivery gate

A UI change is not production-ready until each item is checked, and anything not verified is
**reported as unverified**, never claimed:

- [ ] Matches the product's identity in `PRODUCT_DESIGN_SYSTEM.md`
- [ ] Type uses the scale; one thing leads; no shouting labels; nothing under the size floor
- [ ] Colour from tokens only; meaning consistent; no default purple/blue/neon/gradient
- [ ] Text and essential UI contrast pass AA (state the ratio for any new colour pair)
- [ ] No unjustified gradient, glow, blur, heavy shadow or decorative shape
- [ ] Spacing on the 4px scale; alignment and density right for the workflow
- [ ] Existing components and variants reused
- [ ] Hover, focus, active, disabled, loading, empty and error states present
- [ ] Keyboard and screen-reader usable; reduced motion respected
- [ ] Checked in the real running app at the supported sizes, with a screenshot
- [ ] No rendering or runtime performance regression
- [ ] Existing workflows still work

## Operating principle

Every colour has a purpose. Every font serves readability. Every background supports the content.
Every interaction serves the user. Every component belongs to one system. Every effect justifies its
cost.
