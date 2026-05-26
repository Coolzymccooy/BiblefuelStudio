# Public Landing Page — Design

**Date:** 2026-05-26
**Status:** Draft (pending user review)
**Project:** Standalone, but aligned with Phase 6 of the [Public Multi-Tenancy roadmap](../../.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md)
**Audience:** Churches, ministries, teachers, individual faithful creators

---

## Goal

Ship a public, aesthetically distinctive landing page at `https://biblefuel.tiwaton.co.uk/` so churches and individual ministry creators who hear about Biblefuel Studio land on a page that explains what it is, shows what it produces (kinetic typography proof, live), and lets them request access. Submissions trigger an email to the operator so access can be granted manually.

The page is also Biblefuel Studio's first real piece of marketing surface — voice, palette, and the reusable `KineticVerse` component established here become the brand foundation for the rest of the public launch.

## Non-Goals

- Public signup UI (deferred — that's [multitenancy Phase 2](../../.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md#2-roadmap-6-phases))
- Pricing page (Phase 5/6 of multitenancy)
- Legal pages (Phase 6 of multitenancy)
- Account / dashboard changes (only the root route `/` is touched; the existing dashboard moves to `/app` with a redirect for authed users)
- Analytics / cookie banner (add later when there's a privacy policy to link to)
- "Who it's for" or "From the maker" sections (deferred — can add later if response justifies them)
- Persisting access requests to a real database (Phase 1: JSON file is enough)

## Constraints

- **Builds must respect the [BiblefuelStudio build/deploy workflow](../../memory/biblefuel_build_workflow.md)** — client must be `npm run build`'d locally and `server/public/**` committed before deploy.
- **No collision with [multitenant refactor](../../.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md)** — the landing page lives at unauthenticated routes (`GET /`, `POST /api/access-requests`). These routes must NOT pass through `withUserScope` / `featureGate` middleware.
- **Resend email is shared infrastructure** — port the transport pattern from `lumina-presenter`'s `server/services/email/transport.js` (pure `fetch`, stub fallback when key absent, never throws). Re-use the `tiwaton.co.uk` Resend-verified domain.
- **Accessibility:** all animations must respect `prefers-reduced-motion`. Form must be keyboard-navigable and screen-reader-readable. Colour contrast ≥ WCAG AA (cream `#faf6ee` on dark ink `#1a1610` ≈ 14:1 — passes).
- **Performance budget:** total landing page (HTML + JS + fonts) ≤ 200 KB gzipped. Framer Motion is ~50 KB gz; that's the only meaningful addition.
- **No new server dependencies.** Resend transport is `fetch`-only, matching the lumina pattern.

---

## 1. Visual & Editorial Direction

Brand direction is **Editorial & Reverent** — chosen during brainstorming over Cinematic and Modern alternatives:

| Token | Value |
|---|---|
| Background (paper) | `#faf6ee` → `#f1e9d6` (gradient on hero & form) |
| Dark band background | `#2a2620` |
| Dark canvas (kinetic) | `#0e0a06` |
| Primary ink | `#1a1610` |
| Body ink | `#4a4239` |
| Muted ink | `#5a5147` |
| Gold accent | `#a08760` |
| Deep gold (italic emphasis) | `#6b4f1f` |
| Light gold (on dark) | `#d4af6e` |
| Cream-on-dark text | `#f4ead8` |
| Hairline | `#e8ddc4`, `#d8ccb0` |

| Type | Use |
|---|---|
| **Cormorant Garamond** (display, weights 400/500, italic 400) | Headlines, wordmark, italic emphasis. Loaded from Google Fonts. |
| **Georgia** (system) | Body paragraphs, form input text. No network load. |
| **Inter** (sans, weights 400/500/600) | All-caps labels, nav, CTA button, kicker text, footer. Already used elsewhere in the project. |

**Voice:** V1 — *"For those who carry the Word"* / *"A quiet studio for louder witness."* — chosen during brainstorming. Inclusive of ministries, churches, individual teachers, and faithful makers without ever using the phrase "local church."

The visual identity is **deliberately distinct from the existing app** (which is dark navy + gold). Rationale: the dashboard at `/app` is a working studio for authenticated users; `/` is editorial marketing. Two contexts, two looks. The shared thread is gold accents and serif emphasis — strong enough to feel like one brand, distinct enough that visitors know they've transitioned.

## 2. Page Structure (Medium depth — 5 sections)

```
┌─ Header ────────────────────────────────────────┐
│  Biblefuel (italic serif)    STUDIO · WHO · ↗   │
├─ Hero (paper gradient) ─────────────────────────┤
│  — FOR THOSE WHO CARRY THE WORD                 │
│                                                 │
│  A quiet studio        ┌─────────────────────┐  │
│  for *louder*          │  KineticVerse       │  │
│  witness.              │  (dark cinematic)   │  │
│                        │  John 1:1 ▸ Ps 119  │  │
│  Sub paragraph.        │  word-by-word reveal│  │
│  [REQUEST ACCESS →]    └─────────────────────┘  │
│                                                 │
├─ ✦  ✦  ✦  (ornamental divider) ────────────────┤
├─ What's inside the studio. (paper) ─────────────┤
│  i. Scripts   ii. Voice   iii. Kinetic Video    │
├─ From a verse to the world (dark band) ─────────┤
│  I · WRITE    II · SPEAK    III · PUBLISH       │
├─ Request access. (paper gradient) ──────────────┤
│  Name / Email / Ministry / Pitch / [SUBMIT]     │
├─ Footer (paper) ────────────────────────────────┤
│  © BIBLEFUEL · A STUDIO BY TIWATON   P · T · C  │
└─────────────────────────────────────────────────┘
```

### Section copy (final, approved)

**Header nav:** `STUDIO` · `WHO IT'S FOR` · `REQUEST ACCESS` (anchor links to in-page sections, no separate pages).

**Hero**
- Audience kicker: `— FOR THOSE WHO CARRY THE WORD`
- Headline: *"A quiet studio for **louder** witness."* (the word *louder* renders as italic gold)
- Sub: *"For ministries, teachers, and faithful makers — write, voice, and publish stories worthy of the gospel."*
- Primary CTA: `REQUEST ACCESS →` (scrolls to form)
- Secondary link: `See the studio` (opens `/app` in a new tab — preview-only for unauthed; passes through to existing flow)

**Section 1 — What's inside the studio**
Lead: *"Three crafts, one tab. No agencies, no installs — just the tools the work actually needs."*

| Roman | Title | Body |
|---|---|---|
| i. | **Scripts** | Generate sermon clips, devotionals, and series outlines from Scripture. Edit them like a writer would, not a chatbot. |
| ii. | **Voice** | Turn any script into spoken word — your voice (cloned with consent) or a chosen library voice. Clean, warm, ready to publish. |
| iii. | **Kinetic Video** | Render captioned, kinetic-typography videos of any verse — the same engine you saw above. Post to TikTok, YouTube, Instagram. |

**Section 2 — From a verse to the world, in three movements** *(dark band, `#2a2620`)*
Lead: *"The studio was built around a simple liturgy of making."*

| Step | Heading | Body |
|---|---|---|
| I · WRITE | Begin with the Word. | Pick a passage or topic. The studio drafts a script in your voice. Refine until it sings. |
| II · SPEAK | Give it a voice. | Record yours or use a voice you trust. Clean the audio. Add music. Listen back. |
| III · PUBLISH | Send it out. | Render, caption, and schedule. The Word goes where the next generation already is. |

**Section 3 — Request access**
Heading: *"Request access."*
Lead: *"The studio is opening in waves to a small number of ministries and creators. Tell us a little about your work — we'll be in touch."*

Form fields:
- `name` — required, 1-120 chars
- `email` — required, RFC-valid
- `org` — *Ministry, church, or channel name* — required, 1-200 chars
- `pitch` — *A sentence about what you're making* — required, 1-500 chars
- `hp_url` — **honeypot**, hidden via CSS off-screen, must be empty on submit (bots fill all inputs)

Submit button: `SUBMIT REQUEST →`. After successful submit, the form area swaps to a thank-you panel: *"Received. We'll be in touch soon — usually within a few days."*

**Footer**
- Left: `© BIBLEFUEL · A STUDIO BY TIWATON`
- Right links: `PRIVACY` · `TERMS` · `CONTACT` (each `href="mailto:hello@tiwaton.co.uk"` until proper pages exist — placeholder spec'd in §6)

---

## 3. Kinetic Bible Typography Component (`<KineticVerse />`)

The hero canvas is the single most distinctive element on the page. It is also a **reusable component** that will later be invoked by the studio's video renderer — landing-page demo and production output share one source of truth.

### Behaviour

```
On mount:
  1. Pick verse[0] from the rotation
  2. Animate each word: opacity 0→1, translateY 8→0px, scale 0.98→1, 700ms each, 200ms stagger
  3. Anchor word(s) render italic + #d4af6e
  4. After full reveal, hold 4500ms
  5. Crossfade out (600ms), advance to verse[i+1 mod N], repeat

Progress pips (bottom-right) advance with each verse. Reference label (bottom-left) updates.

prefers-reduced-motion: render only verse[0], all words opacity 1, no animation, no cycling.
```

### Rotation (initial 4 verses)

```js
[
  { ref: 'JOHN 1:1',      lines: [['In', 'the', 'beginning', '*was', '*the', '*Word,'],
                                  ['and', 'the', 'Word', 'was', '*with', '*God.']] },
  { ref: 'PSALM 119:105', lines: [['Your', 'word', 'is', 'a', '*lamp', 'to', 'my', 'feet'],
                                  ['and', 'a', '*light', 'to', 'my', 'path.']] },
  { ref: 'ISAIAH 40:8',   lines: [['The', 'grass', 'withers,', 'the', 'flower', 'fades,'],
                                  ['but', 'the', 'word', 'of', 'our', 'God', '*stands', '*forever.']] },
  { ref: 'HEBREWS 4:12',  lines: [['The', 'word', 'of', 'God', 'is', '*living', 'and', '*active'],
                                  ['sharper', 'than', 'any', 'two-edged', '*sword.']] },
]
// Asterisk prefix = italic gold (anchor) word.
```

### Visual layer

- Background `#0e0a06`
- Radial overlay: `radial-gradient(circle at 30% 20%, rgba(212,175,110,0.10), transparent 55%), radial-gradient(circle at 80% 80%, rgba(160,80,40,0.08), transparent 55%)`
- SVG film grain at 18% opacity, `mix-blend-mode: overlay` — adds organic texture without weight
- Kicker top-left: `RENDERED LIVE · NO INSTALLS` (Inter 9px, gold, `letter-spacing: 2.5px`)
- Reference bottom-left: `JOHN 1:1` (Inter 10px, gold, `letter-spacing: 2px`)
- Progress pips bottom-right: 4 × `22×2px`; active = `#d4af6e`, inactive = `rgba(212,175,110,0.25)`
- Verse type: Cormorant Garamond 400, 30px desktop / 22px mobile, line-height 1.18, letter-spacing −0.3px, color `#f4ead8`

### Public API

```tsx
type KineticVerseProps = {
  verses?: Array<{ ref: string; lines: string[][] }>;  // defaults to bundled rotation
  cycle?: boolean;          // default true; false = render only first verse
  holdMs?: number;          // default 4500 — pause between reveal & crossfade
  staggerMs?: number;       // default 200
  wordDurationMs?: number;  // default 700
  className?: string;
};
```

### Engine choice

Framer Motion is the only animation engine. Words are mapped to `<motion.span>` with a `variants` cascade. Crossfade is a `mode="wait"` `<AnimatePresence>` keyed on `verseIndex`. This same engine drives scroll-in animations on the rest of the page (see §4) — one dependency, one mental model.

---

## 4. Scroll-In Animations

Reverent, never bouncy. **Editorial curve everywhere:** `cubic-bezier(0.2, 0.7, 0.2, 1)`. Durations 0.6 – 0.9s.

| Element | Trigger | Animation |
|---|---|---|
| Header wordmark | First paint | Fade in (`opacity 0→1`, `translateY 8→0`), 0.6s, `delay: 0.1s` |
| Hero kicker + headline | First paint | Word-stagger reveal (same engine as KineticVerse — extracted util), 200ms stagger |
| Hero sub + CTA | First paint | Fade + lift, 0.7s, `delay: 0.9s` (after headline completes) |
| Ornamental divider | `whileInView` (30%, once) | `opacity 0→1, letter-spacing 4→12px`, 1.0s |
| "What's inside" lead + cards | `whileInView` (30%, once) | Cards stagger 150ms apart, fade + lift 20px, 0.8s each |
| "How it works" steps | `whileInView` (30%, once) | Three steps cascade 250ms apart, fade + lift 24px, 0.9s each |
| Form section heading | `whileInView` (40%, once) | Fade + lift, 0.7s |
| Footer | None (static) | — |

All `whileInView` animations use `viewport={{ once: true, amount: 0.3 }}`. Single-shot — content stays visible once revealed.

**`prefers-reduced-motion`:** every motion variant has a parallel "reduced" variant that is `{ opacity: 1 }` only. Use `useReducedMotion()` from Framer Motion. The KineticVerse cycling is fully disabled and renders verse[0] as a still.

---

## 5. Backend — Access Requests + Email

### New files

```
server/services/email/
  transport.js           # Resend HTTP wrapper, port of lumina-presenter pattern
  templates/
    accessRequest.js     # renders { subject, html, text, preview } for one submission
  send.js                # thin dispatcher; for now only handles { kind: 'access-request' }

server/src/lib/
  accessRequestsStore.js # read/append to server/data/access-requests.json with file-lock

server/src/routes/
  accessRequests.js      # POST /api/access-requests
```

### Resend transport (ported verbatim from lumina-presenter)

```js
// server/services/email/transport.js
// Pure-fetch Resend wrapper. Stub fallback when RESEND_API_KEY is unset.
// Never throws — returns { ok, id?, error?, transport }.
// See server/services/email/transport.test.js for invariants.
```

Same signature as lumina's `createEmailTransport({ apiKey, from, replyTo, log, fetchImpl })`. No SDK dep, no Electron-bundle concerns, just `fetch`. Stub behaviour preserved for offline/dev.

### Env vars (new)

```
RESEND_API_KEY=re_...          # tiwaton shared Resend key
MAIL_FROM="Biblefuel <hello@tiwaton.co.uk>"   # must be a verified domain in Resend
MAIL_REPLY_TO=coolshegz@gmail.com
ACCESS_REQUEST_NOTIFY_TO=coolshegz@gmail.com  # where the notification email lands
```

Documented in `server/.env.example`.

### `POST /api/access-requests`

Behaviour:

```
1. Method: POST. CORS: same-origin only (no preflight needed; the form is on the same domain).
2. Body parse (JSON, max 4KB).
3. Validate with Zod (already a dep in the project — confirm during impl):
     - name:  string, 1-120
     - email: string, RFC 5322
     - org:   string, 1-200
     - pitch: string, 1-500
     - hp_url: string, MUST be empty
     - turnstile? (deferred — for v1 the honeypot is the only bot defence)
4. If hp_url non-empty → 200 OK { ok: true } (silent drop — bot must not learn it was filtered).
5. Rate-limit: 3 submissions per IP per hour via the project's existing
    `express-rate-limit` middleware (already a dep). 429 with Retry-After when exceeded.
    Single-instance, in-memory store — acceptable for current scale.
6. Append to server/data/access-requests.json (array). Format:
     { id, createdAt, ip, userAgent, name, email, org, pitch }
   Concurrency: a single in-module write queue (Promise chain) serialises all writes in this process.
   Single-instance deploys are safe; sufficient for foreseeable load (tens of submissions/day at peak).
   No external lockfile dep — we already serialise within the only Node process serving the route.
7. Fire-and-forget email via Resend transport — never blocks the response. If it fails,
    log + continue. The submission is recorded regardless.
8. Respond 200 { ok: true }.
9. On validation failure: 400 { ok: false, error: 'VALIDATION', issues: [...] }.
10. On parse / server error: 500 { ok: false, error: 'SERVER' }.
```

### Mount

`POST /api/access-requests` is mounted in `server/index.js` **BEFORE** any auth-guarded API route, and uses **none** of the multitenancy middleware. It is a fully public endpoint.

### Email content (operator notification)

Subject: `New access request — {{name}} ({{org}})`

HTML (minimal — table layout for client compatibility, no rich design needed since it's internal):

```
New access request from biblefuel.tiwaton.co.uk

Name:     {{name}}
Email:    {{email}}
Org:      {{org}}
Pitch:    {{pitch}}

IP:       {{ip}}
Received: {{createdAt}}

Reply: clicking the email Reply button replies to the requester directly
       (Reply-To header is set to the requester's email).
```

`replyTo` header set to the requester's `email` so the operator can hit Reply in their mail client and the response goes straight back.

### Future graduation (Phase 6 of multitenancy roadmap)

When [multitenancy Phase 2](../../.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md#2-roadmap-6-phases) ships (public signup gated by invite codes), the access-request endpoint evolves:

- Add an `/admin/access-requests` page where the operator approves/declines.
- Approving generates an invite code, emails it to the requester, and marks the request `approved`.
- Declining sends a polite decline and marks the request `declined`.

Phase 1 (this spec) ships just the inbox-style storage + notification email. The operator approves manually by replying.

---

## 6. Frontend — Files & Routing

### New files

```
client/src/pages/
  LandingPage.tsx              # composes Header → Hero → WhatsInside → HowItWorks → AccessForm → Footer

client/src/components/landing/
  Header.tsx
  Hero.tsx
  WhatsInside.tsx
  HowItWorks.tsx
  AccessForm.tsx
  Footer.tsx
  KineticVerse.tsx             # reusable kinetic-typography canvas (see §3)
  motion.ts                    # shared editorial-curve variants + useEditorialMotion() hook

client/tailwind.config.js       # EXTEND with `editorial` color palette + font families
                                # (see §1 colour & type tokens). Existing dashboard config preserved.
client/src/styles/landing.css   # ONLY for: kinetic-canvas SVG-grain background and the
                                # `@keyframes` Framer Motion can't express. All section
                                # layout/colour/typography uses Tailwind utility classes
                                # referencing the new `editorial.*` palette tokens.
```

### Tailwind palette extension (illustrative)

```js
// tailwind.config.js (excerpt — merge into existing config)
theme: {
  extend: {
    colors: {
      editorial: {
        paper:    '#faf6ee',
        parchment:'#f1e9d6',
        dark:     '#2a2620',
        canvas:   '#0e0a06',
        ink:      '#1a1610',
        body:     '#4a4239',
        muted:    '#5a5147',
        gold:     '#a08760',
        goldDeep: '#6b4f1f',
        goldLite: '#d4af6e',
        cream:    '#f4ead8',
        hairline: '#e8ddc4',
      },
    },
    fontFamily: {
      display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      body:    ['Georgia', 'serif'],
      sans:    ['Inter', 'system-ui', 'sans-serif'],
    },
  },
}
```

### Router

In whatever router file holds the routes today (`client/src/App.tsx` likely):

```tsx
<Route path="/" element={<UnauthedOnly redirect="/app"><LandingPage /></UnauthedOnly>} />
<Route path="/app/*" element={<DashboardRoutes />} />
// existing dashboard routes move under /app/* — every <Link> and useNavigate() updated
// to point to /app instead of root. One PR-wide rename.
```

`<UnauthedOnly>` is a new tiny wrapper: if a valid JWT is in localStorage, redirect; else render children. Mirror of the existing `<Protected>` (or whatever the auth guard is called — confirm during impl). This means: **logged-in users never see the landing page; they go straight to the dashboard**. Sharing the link with churches still shows them the landing.

### Dependencies

```jsonc
// client/package.json
{
  "dependencies": {
    "framer-motion": "^11"   // NEW
  }
}
```

No other additions. Fonts via Google Fonts `<link>` in `client/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
```

### Mobile

Breakpoint at 768px:

| Section | Mobile change |
|---|---|
| Header | Wordmark stays; nav collapses to single `REQUEST ACCESS` link aligned right |
| Hero | Stacks vertically; KineticVerse renders above the text block (aspect-ratio shifts to 4/5 → 9/16 for visual weight); headline 36px |
| What's inside | 1 column |
| How it works | 1 column |
| Form | Full-width inputs, no max-width cap |
| Footer | Stacks; left & right links centre-align |

No layout-shift on font load — `font-display: swap` plus reserved heights for headlines.

---

## 7. Testing

### Server (node:test)

- `accessRequestsStore.test.js`
  - Appends one record → file contains one entry with correct shape
  - Concurrent writes (10 parallel) → all 10 land, no corruption (lockfile holds)
- `accessRequests.test.js` (integration with supertest)
  - Happy path → 200 `{ ok: true }`, file appended, email transport invoked once
  - Honeypot non-empty → 200 silent drop, file NOT appended, email NOT invoked
  - Validation failures (missing field, oversize pitch, malformed email) → 400 with issues array
  - 4 rapid submissions from same IP → 4th returns 429
  - Resend transport stub mode → handler still returns 200 even though no real email sent
- `transport.test.js` — port lumina-presenter's existing tests verbatim; adjust import paths only
- `templates/accessRequest.test.js`
  - Renders with all-required fields
  - Escapes HTML in user-supplied fields (`org: "<script>"`) — body contains escaped form

### Client (vitest)

- `KineticVerse.test.tsx`
  - Renders all words from verse[0] on mount
  - Auto-advances after `holdMs + crossfadeMs` (use vi.useFakeTimers)
  - `cycle={false}` → only verse[0] ever renders
  - `prefers-reduced-motion: reduce` → renders verse[0] as static; no timer scheduled
- `AccessForm.test.tsx`
  - Valid submission → POST hit with correct body, thank-you panel renders
  - Server 400 → error message shown next to relevant field
  - Server 500 / network error → toast / inline retry shown
  - Honeypot field is `aria-hidden`, off-screen, and submitted as part of the form

### E2E (Playwright — single happy path)

- Visit `/` while unauthenticated → landing renders, KineticVerse animates John 1:1
- Click `REQUEST ACCESS →` → scrolls to form
- Fill all required fields → submit → thank-you panel
- Visit `/` while authenticated (cookie set) → redirects to `/app`
- `axe-core` accessibility scan → no violations
- Lighthouse (mobile profile) targets: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95

### Manual smoke

- Phone test (the original Firebase bug) → landing renders; access form submits; thank-you panel shows. Confirms phone parity is restored independently of any auth path.
- Reduced-motion macOS / iOS setting → animations off, content static, no broken layout.
- Email arrives at `ACCESS_REQUEST_NOTIFY_TO` with correct Reply-To.

---

## 8. Build & Deploy

Per the [BiblefuelStudio build/deploy workflow](../../memory/biblefuel_build_workflow.md):

1. `cd client && npm install` (Framer Motion is the new dep)
2. `cd client && npm run build` — emits `client/dist/**`
3. The existing build script copies into `server/public/**`
4. Commit `server/public/**` along with the source changes
5. Deploy to `biblefuel.tiwaton.co.uk`

Add a CI guard (or pre-commit hook) that fails if `client/src/pages/LandingPage.tsx` is newer than `server/public/index.html` — prevents "I forgot to rebuild" deploys. Implementation detail; not blocking.

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Existing dashboard `<Link>` paths break when root moves to `/app` | Medium | High | One PR-wide rename of internal links; smoke-check every dashboard nav after PR; the change is mechanical and greppable |
| Framer Motion bumps client bundle past budget | Low | Low | Code-split landing route (`React.lazy`) so the dashboard bundle stays unchanged. Verify final gz sizes during impl. |
| Operator forgets `MAIL_FROM` is a Resend-verified domain → all sends 422 | Low | Medium | Health endpoint warns at startup if `RESEND_API_KEY` set but `MAIL_FROM` missing; transport falls back to stub on send if domain unverified (Resend returns 422 — we log + persist the request anyway) |
| Bot spam fills access-requests.json | Medium | Medium | Honeypot + per-IP rate limit (3/hr). If abuse appears, add Cloudflare Turnstile as a follow-up — out of scope for v1. |
| `client/.env` Firebase keys still missing → mobile Firebase banner shows over the new landing | Medium | Low | **Out of scope for this spec** — tracked separately as the Firebase mobile-login fix. Landing page is unaffected (it doesn't auth). |
| Page indexed before launch | Low | Low | Ship with `<meta name="robots" content="noindex">` if operator chooses; remove when ready to be discoverable. Decision deferred to user. |

---

## 10. Open Questions

These do NOT block implementation; flag in the implementation plan as decisions to confirm during build:

1. Should the landing page be `noindex` until the operator says "go public"? *(Recommend: yes — flip to indexable in a tiny follow-up commit when ready.)*
2. `See the studio` secondary link — should it actually deep-link to `/app` (which will bounce to login), or open a screenshot lightbox? *(Recommend: deep-link to `/app`. It costs nothing and is honest.)*
3. Should the form persist drafts locally (`localStorage`) so a half-typed submission survives a refresh? *(Recommend: no for v1; revisit only if users complain.)*
4. Privacy / Terms / Contact links — placeholder mailto for now, or block the launch until proper pages exist? *(Recommend: mailto for v1, proper pages with [multitenancy Phase 6](../../.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md#2-roadmap-6-phases).)*

---

## Approval

Design is ready for review.

**The implementation plan will NOT be written, and no code will be touched, until the user explicitly approves this design.**

Once approved, the next step is to invoke the `writing-plans` skill to produce a detailed implementation plan (file-by-file changes, test order, build sequence).
