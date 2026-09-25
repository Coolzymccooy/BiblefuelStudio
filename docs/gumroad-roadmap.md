# Gumroad — Roadmap & TODO

Living checklist for the Gumroad Pack Builder. Pick up outstanding items from here.
Last updated: 2026-06-08.

## ✅ Shipped (on `master`)

- **Send to Timeline** — narrate the free devotional via existing TTS → seed the Timeline editor → land render-ready.
  Spec: `docs/superpowers/specs/2026-06-07-...` / `2026-06-08-gumroad-send-to-timeline-design.md`.
- **Per-day Send to Timeline** — one Send button per day (Day 1…7), each narrates just that day. Single all-in-one button removed.
- **Server-backed history** — every generation persisted per-account (`server/src/lib/gumroadStore.js`); History panel to Open/Delete. *This is the first slice of Moat #4 (catalog).*
- **Trim-output reuse (Timeline)** — uploaded/trimmed audio recorded into Recent Audio; "Use as Music Bed" / "Use as Source" cross-slot actions.
  Spec: `docs/superpowers/specs/2026-06-08-gumroad-timeline-refinements-design.md`
  Plan: `docs/superpowers/plans/2026-06-08-gumroad-timeline-refinements.md`

Key code:
- Client parser/bridge: `client/src/lib/gumroadToTimeline.ts` (`parseFreeDevotional`, `parseFreeDevotionalDays`, `extractTranscript`).
- Page: `client/src/pages/GumroadPage.tsx`.
- Generation engine (still static templates): `server/src/lib/gumroadPacks.js`.
- Routes: `server/src/routes/gumroad.js`. Store: `server/src/lib/gumroadStore.js`.

## 🟡 Known limitation (the real unlock)

The generator is **pure static template** — hardcoded 7 verses + 30 theme labels; the paid product's verses are `(Add your chosen verse here)` placeholders. Everything below gets dramatically better once generation is real (Moat #1).

## 🚀 Outstanding moat features (each = its own spec → plan → implement)

### Moat #1 — Real AI generation + live verse resolution  ⭐ build first (foundational)
Replace the static template with LLM-generated, niche-targeted packs that pull **real verse text** per translation.
- Reuse the **Series** verse lookup + YouVersion deep links (`server/src/routes/series.js`, `seriesStore.js`) for real scripture.
- Emit structured days `{ ref, verseText, reflection, prayer }` so paid product is no longer placeholders.
- Inputs: niche/topic, audience, tone, translation, day count.
- *Why first:* real verses narrate, bundle, and sell better — every other moat depends on it.

### Moat #2 — One input → omni-format bundle
From one devotional, auto-produce: designed PDF, audio devotional (TTS), per-day video shorts (Series), social caption pack, and Gumroad sales copy. One click → a full sellable catalog.
- Reuses: TTS pipeline, Series (per-day video), existing render. New: PDF generator + sales-copy prompt.

### Moat #3 — Auto cover + product mockups
Branded Gumroad cover image + 3D product mockups via the existing image-gen (`server/src/lib/imageGen/`). Conversion lever.
- Note: image-gen env var alias gotcha — see memory `biblefuel-cloudflare-imagegen-env`.

### Moat #4 — Persistent product catalog + versioning  (history already shipped as slice 1)
Extend the history store into a real catalog: reopen, **duplicate**, A/B-test titles, tag/track which packs shipped/sold. Build on `gumroadStore.js`.

### Moat #5 — Lead-magnet → paid funnel + email drip
Auto-generate the nurture email sequence that sells the paid pack off the free one.
- Reuses existing email templates (`lumina-presenter/server/services/email/templates`).

## 🔧 Smaller follow-ups / deferred
- Trim-output reuse on **Render** and **Story Video** pages (this pass did Timeline only).
- "Save to history" explicit button (currently auto-saves on every generate; upsert by title avoids dupes).
- Per-day → optionally auto-create a **Series** (7 queued videos) instead of one-at-a-time Timeline.
- History pagination if a user exceeds the 50-pack cap.

## Suggested order
Moat #1 → #2 → #3, then #4 polish + #5. (#1 unblocks the quality of all of them.)
