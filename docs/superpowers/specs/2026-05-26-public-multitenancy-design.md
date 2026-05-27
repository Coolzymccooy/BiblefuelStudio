# Public Multi-Tenancy — Design

**Date:** 2026-05-26
**Branch:** `worktree-multitenant-public-launch`
**Status:** Draft (pending user review)
**Project:** 1 of 6 (Public Launch roadmap)
**Phase covered by this spec:** Phase 1 — Tenant Isolation (refactor-only)

---

## Goal

Refactor Biblefuel Studio from a single-tenant app into a multi-tenant foundation **without changing any user-visible behaviour for the super-admin (the current operator)**. Phase 1 ships the isolation seam, behind a feature flag, with no public signup. All later phases (signup, social per-user, billing) build on this seam.

## Non-Goals (this spec)

- Public signup UI
- Premium plan / billing wiring (only the *capability gates* land in Phase 1)
- Per-user social OAuth flow (scaffold only — actual UX is Phase 4)
- Gumroad multi-tenant support (deferred — gated off for non-super-admin until the business plan is written)
- ElevenLabs as a free-tier feature (gated to premium from day one)
- Database migration (stays on JSON files per user)

## Constraints

- **Backward compatibility is absolute.** Super-admin (`coolshegz@gmail.com`) must read/write the *exact same files* as today: `server/data/library.json`, `series.json`, `social.json`, `outputs/**`. Zero behaviour change.
- **Phase 1 ships behind `MULTITENANT=true` env flag.** With the flag off, runtime behaviour MUST be observationally identical to current master from a super-admin's perspective. (The refactor itself is unconditional — stores always take a `dataDir` parameter — but with the flag off, `dataDir` resolves to the existing global `DATA_DIR` for *every* request, so the legacy file paths are read/written exactly as today.) This is the rollback lever.
- Project is JavaScript ESM. No TS migration in this spec. JSDoc + Zod for boundary types.
- No new runtime deps in Phase 1.
- Builds must still respect [BiblefuelStudio build/deploy workflow](../../../memory/biblefuel_build_workflow.md) — client built locally, `server/public/**` committed before deploy.

---

## 1. Current State Audit (the review)

### What's solid

- **Auth backbone:** JWT + email/password (`server/src/auth.js`) and Firebase identity (`server/src/routes/firebase.js`, `upsertFirebaseUser`) are both wired. Identity itself is not the blocker.
- **Route hygiene:** Every feature is a router file (`scripts`, `tts`, `render`, `pexels`, `pixabay`, `library`, `social`, `series`, `bible`, `audio`, `jobs`). Clean seams to add middleware.
- **Working Zernio/Make.com auto-publish proof-of-concept** for TikTok (see [TikTok auto-publish via Zernio](../../../memory/zernio_tiktok_autopublish.md)).
- **Voice provider abstraction already shipped** ([prior spec](2026-05-20-tts-provider-interface-design.md)) — Edge/Chatterbox/ElevenLabs are pluggable.

### Single-tenant assumptions baked into the code

| # | File | Issue |
|---|------|-------|
| 1 | `server/src/auth.js:41` | New signups get `role: "owner"`. First-user-wins. No `user` vs `super_admin` distinction. |
| 2 | `server/src/lib/socialStore.js:30` | ONE shared `social.json` holds YouTube/TikTok/Instagram tokens, webhooks, schedules. A second user overwrites the first. |
| 3 | `server/src/lib/paths.js` | `DATA_DIR` / `OUTPUT_DIR` are global constants. Every store imports them directly. |
| 4 | `server/src/lib/library.js`, `series/seriesStore.js`, `store.js` | All stores read/write global JSON files; no `userId` parameter. |
| 5 | `server/index.js:65` | `cors({ origin: process.env.CORS_ORIGIN || "*" })` — `*` is dangerous once credentials cross the boundary. |
| 6 | `server/index.js` | All API keys (OpenAI/Gemini/ElevenLabs/Pexels/Pixabay/Chatterbox bridge) are env vars. Every public user would burn the operator's quota with no metering. |
| 7 | Zernio webhook URL in `socialStore.webhooks` | The webhook is **the operator's**. A public user clicking "auto-publish" today would post to `@Biblefuel`. |
| 8 | No quotas / rate limits beyond auth | FFmpeg render, TTS, image gen all unbounded. |

### Capability matrix (target state after roadmap completes)

| Feature | Super-admin | Free user | Premium user |
|---|---|---|---|
| Scripts (OpenAI/Gemini) | ✅ | ✅ — server keys, daily quota | ✅ — higher quota |
| TTS Edge-TTS | ✅ | ✅ | ✅ |
| TTS Chatterbox | ✅ | ✅ | ✅ |
| TTS ElevenLabs | ✅ | ❌ (gated) | ✅ |
| Voice cloning | ✅ | ❌ | ✅ |
| Render (FFmpeg) | ✅ | ✅ — quota | ✅ — higher quota |
| Bible / Series / Library | ✅ | ✅ (own data) | ✅ (own data) |
| Social connect + auto-post | ✅ | ✅ (own creds — Phase 4) | ✅ |
| Gumroad pack builder | ✅ | ❌ (deferred pending business plan) | ❌ |

Phase 1 ships the **gate plumbing** (`featureGate('tts.elevenlabs')`, `featureGate('gumroad')`). Plan tier resolution returns hard-coded `super_admin` for the operator and `free` for everyone else until Phase 5.

---

## 2. Roadmap (normie-first, 5 phases)

> Revised after user clarified target audience: **all users are normies / non-technical**. BYOK is dead — normies can't paste API keys. Billing moves earlier so the free tier is cost-bounded from day one.

| # | Phase | What ships | External dependencies |
|---|---|---|---|
| **1** | **Tenant isolation** (✅ shipped) | `withUserScope`, per-user JSON dir overlay, capability gates, feature flag | None |
| **2** | **Open public signup** | Default-to-signup UX, Firebase email verification enforcement, default-plan assignment, account deletion endpoint, "verify email" gate | Firebase email/password + magic-link providers enabled in Firebase Console (operator already has Firebase wired) |
| **3** | **Managed keys + quotas + Stripe billing** | Per-user plan record (`plan.json`), usage counters (`usage.json`), quota middleware on expensive ops, Stripe Checkout endpoint, webhook handler, Customer Portal link, "Upgrade" CTA in Settings | Stripe account (live + test keys), one monthly product/price, webhook URL configured in Stripe dashboard |
| **4** | **Postiz auto-publish** | Postiz REST adapter, "Connect TikTok / YouTube / Instagram" deep links, auto-publish hook on render completion, disconnect endpoint | Self-hosted Postiz instance (e.g. `postiz.tiwaton.co.uk`) with OAuth apps registered for each social platform |
| **5** | **Landing + pricing + onboarding** | Landing page (unauthenticated `/`), pricing page (`/pricing`), terms (`/terms`) + privacy (`/privacy`) placeholders, 3-step onboarding wizard for first-time users | Domain/DNS, marketing copy/imagery, legal review |

---

---

## 3. Phase 1 Architecture

### Request pipeline

```
HTTP request
   │
   ▼
requireAuth                    (existing — verifies JWT, sets req.user)
   │
   ▼
withUserScope                  (NEW — resolves dataDir, sets req.ctx)
   │
   ▼
featureGate(name)              (NEW — optional per-route, blocks if unauthorised)
   │
   ▼
route handler                  (UPDATED — passes req.ctx.dataDir into stores)
   │
   ▼
store(dataDir, ...)            (UPDATED — accepts dataDir as parameter)
```

### `req.ctx` shape

```js
/**
 * @typedef {Object} UserContext
 * @property {string}  userId        - JWT sub claim
 * @property {string}  email
 * @property {'super_admin'|'user'} role
 * @property {'super_admin'|'free'|'premium'} plan
 * @property {string}  dataDir       - per-user dir OR global DATA_DIR for super-admin
 * @property {string}  outputDir     - per-user outputs dir OR global OUTPUT_DIR for super-admin
 * @property {boolean} isSuperAdmin
 */
```

### Super-admin resolution (the critical correctness bit)

```js
// userScope.js (pseudocode)
function isSuperAdmin(user) {
  const adminEmail = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase().trim();
  const adminId    = (process.env.SUPER_ADMIN_USER_ID || "").trim();
  if (adminId && user.sub === adminId) return true;
  if (adminEmail && (user.email || "").toLowerCase() === adminEmail) return true;
  return false;
}

function resolveDataDir(user) {
  if (isSuperAdmin(user)) return DATA_DIR;           // EXISTING global path
  return path.join(DATA_DIR, "users", user.sub);     // new per-user namespace
}
```

`SUPER_ADMIN_EMAIL` should be set in `server/.env` to `coolshegz@gmail.com`. `SUPER_ADMIN_USER_ID` is a fallback if the email ever changes.

### Feature flag (`MULTITENANT`)

```js
// userScope.js
export function withUserScope(req, res, next) {
  if (String(process.env.MULTITENANT || "").toLowerCase() !== "true") {
    // Legacy path — everyone uses global. Identical to current master.
    req.ctx = { userId: req.user.sub, email: req.user.email, role: "super_admin",
                plan: "super_admin", dataDir: DATA_DIR, outputDir: OUTPUT_DIR,
                isSuperAdmin: true };
    return next();
  }
  // Multi-tenant path
  const admin = isSuperAdmin(req.user);
  const dataDir = admin ? DATA_DIR : path.join(DATA_DIR, "users", req.user.sub);
  const outputDir = admin ? OUTPUT_DIR : path.join(dataDir, "outputs");
  if (!fs.existsSync(dataDir))   fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  req.ctx = {
    userId: req.user.sub,
    email: req.user.email,
    role: admin ? "super_admin" : "user",
    plan: admin ? "super_admin" : "free",
    dataDir, outputDir, isSuperAdmin: admin,
  };
  next();
}
```

With `MULTITENANT=false` the code path is structurally identical to today — the seam exists but is dormant. This is the rollback lever.

### Capability gates

```js
// featureGate.js
const PLAN_CAPABILITIES = {
  super_admin: new Set(["*"]),                                  // everything
  premium:     new Set(["tts.elevenlabs", "voice.clone",
                        "render", "scripts", "tts.edge",
                        "tts.chatterbox", "library", "series",
                        "bible", "social.connect"]),
  free:        new Set(["scripts", "tts.edge", "tts.chatterbox",
                        "render", "library", "series",
                        "bible", "social.connect"]),
};

export function featureGate(capability) {
  return (req, res, next) => {
    const caps = PLAN_CAPABILITIES[req.ctx.plan] || new Set();
    if (caps.has("*") || caps.has(capability)) return next();
    return res.status(403).json({
      ok: false, error: "FEATURE_LOCKED", capability, plan: req.ctx.plan,
    });
  };
}
```

Mounted per-route in `index.js` only where needed (NOT a blanket gate):

```js
app.use("/api/gumroad",  requireAuth, withUserScope, featureGate("gumroad"),         gumroadRouter);
app.use("/api/tts",      requireAuth, withUserScope,                                  ttsRouter);
//   ↑ ElevenLabs gate lives INSIDE the tts router, not at the route mount, because
//     the same /api/tts endpoint serves Edge + Chatterbox (free) and ElevenLabs (premium).
```

Inside `ttsRouter`, the ElevenLabs provider branch checks `req.ctx.plan` and returns 403 with `FEATURE_LOCKED` when free users hit it. Edge / Chatterbox branches don't check.

---

## 4. Files Touched

### New (5)

1. `server/src/middleware/userScope.js` — `withUserScope`, `isSuperAdmin`, `resolveDataDir`
2. `server/src/middleware/featureGate.js` — `featureGate(capability)` + `PLAN_CAPABILITIES`
3. `server/src/lib/userDir.js` — `ensureUserDir(dataDir)`, output path helpers
4. `server/src/lib/userPlan.js` — `getPlanForUser(user)` returns `'super_admin' | 'free' | 'premium'` (hard-coded for Phase 1; Phase 5 will read from a billing record)
5. `server/test/userScope.test.js` + `server/test/featureGate.test.js` — node:test unit tests

### Modified (~12)

- `server/index.js` — mount `withUserScope` after `requireAuth` on all `/api/*` routes; mount `featureGate("gumroad")` on Gumroad
- `server/src/lib/paths.js` — keep `DATA_DIR`/`OUTPUT_DIR` exports for super-admin; add `dataDirFor(user)` helper
- `server/src/lib/socialStore.js` — `readSocialStore(dataDir)` / `writeSocialStore(dataDir, next)`
- `server/src/lib/library.js` — every read/write takes `dataDir`
- `server/src/lib/series/seriesStore.js` — `dataDir` param
- `server/src/lib/store.js` — `dataDir` param
- `server/src/routes/social.js` — pass `req.ctx.dataDir` to store calls; per-user cron schedule keying
- `server/src/routes/library.js` — pass `req.ctx.dataDir`
- `server/src/routes/series.js` — pass `req.ctx.dataDir`
- `server/src/routes/queue.js` — pass `req.ctx.dataDir`
- `server/src/routes/tts.js` — inline ElevenLabs capability check
- `server/src/routes/render.js` — write outputs to `req.ctx.outputDir`

### Not modified

- Any business logic: script generation, voice synthesis algorithms, FFmpeg pipeline, Bible reference resolution, image generation. Mechanical change only.

### CI guard against future regressions

Add a lint rule (`eslint --rule no-restricted-imports`) forbidding direct import of `DATA_DIR` / `OUTPUT_DIR` from `paths.js` in any file under `server/src/routes/**` or `server/src/lib/**store*.js`. Stores and routes must go through `req.ctx`.

---

## 5. Data Layout

```
server/data/
├─ users.json                  (existing — superadmin + future users)
├─ library.json                (existing — super-admin's library)
├─ series.json                 (existing — super-admin's series)
├─ social.json                 (existing — super-admin's social config)
├─ jobs.json                   (existing — super-admin's jobs)
├─ bibleCache/                 (shared, read-only cache — no per-user split needed)
└─ users/
   └─ <userId>/                (created lazily on first write)
      ├─ library.json
      ├─ series.json
      ├─ social.json
      ├─ jobs.json
      └─ outputs/
         └─ ...
```

**Why super-admin keeps the legacy path:** zero migration risk, instantly reversible, no file moves. The existing tooling and backup scripts keep working untouched.

---

## 6. Cron / Schedule Isolation

`server/src/routes/social.js:12` keeps schedules in `scheduleTasks = new Map()` indexed by `schedule.id`. After refactor:

- Map key becomes `${userId}::${schedule.id}` to prevent collisions across users.
- On server start, walk every user dir's `social.json` and re-register schedules (current code walks one).
- When a user is deleted (Phase 5+), `scheduleTasks` entries for that user are stopped and removed.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Missed call site reads/writes global file as a regular user | Medium | **CRITICAL** — data leak across tenants | (a) `eslint --no-restricted-imports` CI rule; (b) `grep -r "DATA_DIR\|OUTPUT_DIR" server/src/routes server/src/lib/*store*` must return zero hits post-refactor; (c) integration test logs in as fake user and asserts they see empty data |
| Super-admin email changes; global data orphaned | Low | High | `SUPER_ADMIN_USER_ID` fallback env var |
| `MULTITENANT=true` deployed before all routes refactored | Medium | High | Phase 1 lands as ONE PR; CI runs the no-restricted-imports check; deploy gate requires both checks green |
| Cron schedules collide across users | Low | High | Map key includes `userId` (see §6) |
| Output dir disk usage explodes | Low (Phase 1 — no public users yet) | Medium | Deferred to Phase 5 (quotas). Phase 1 just establishes the per-user path. |
| FFmpeg burning CPU for non-super-admin in Phase 1 | None | n/a | No non-super-admin users exist in Phase 1. |

---

## 8. Testing & Verification

### Unit (node:test)

- `userScope.test.js`
  - super-admin email → `dataDir === DATA_DIR`, `isSuperAdmin === true`, `plan === 'super_admin'`
  - super-admin user_id (no email match) → still resolves as super-admin
  - regular user → `dataDir === DATA_DIR/users/<id>`, `isSuperAdmin === false`, `plan === 'free'`
  - `MULTITENANT=false` → always returns legacy ctx regardless of email
- `featureGate.test.js`
  - super-admin → all capabilities pass
  - free user + `tts.elevenlabs` → 403 with `FEATURE_LOCKED`
  - free user + `gumroad` → 403
  - free user + `tts.edge` → next() called

### Integration

- Boot server with `MULTITENANT=true`, log in as super-admin → `GET /api/library/items` returns existing library
- Boot server, log in as a fresh second user (created by hand for the test) → `GET /api/library/items` returns `[]`; verify `server/data/users/<id>/library.json` was created
- Same flow for `/api/series`, `/api/social/config`

### Manual smoke (super-admin's live workflow)

Before any deploy:

1. Deploy with `MULTITENANT=false` first. Verify nothing regressed across these flows:
   - Log in
   - Generate a script
   - Render Edge-TTS audio
   - Render Chatterbox audio
   - Render ElevenLabs audio
   - Render FFmpeg video
   - Auto-publish to TikTok via existing Zernio webhook (see [Zernio TikTok flow](../../../memory/zernio_tiktok_autopublish.md))
   - Open `/api/library`, `/api/series`, `/api/social/config`
2. If all green, flip `MULTITENANT=true` and re-run the same checklist. Super-admin behaviour MUST be identical.

### Verification command

After implementation, this must return zero matches (i.e. no direct global-path imports outside `paths.js` itself and `userScope.js`):

```bash
grep -rn "DATA_DIR\|OUTPUT_DIR" server/src/routes server/src/lib \
  | grep -v "server/src/lib/paths.js" \
  | grep -v "server/src/middleware/userScope.js" \
  | grep -v "//"
```

Every other hit is a refactor miss.

---

## 9. Open Questions

These do NOT block Phase 1 but should be answered before Phase 2:

1. Will email verification use Firebase's built-in flow or a custom magic-link path? (Firebase is cheaper to wire.)
2. Invite-code source — admin-only `/admin/invites` page, or pre-seeded JSON file?
3. Should the operator's existing `users.json` migrate so each entry gets a default `plan` field? (Phase 5 work, but might be cleaner to add a no-op `plan: 'super_admin'` field now.)

---

## Appendix A — Social Auto-Trigger Research (for Phase 4)

The user's request: *"make it very easy for external users to connect their social media and auto-post."* Phase 1 only preserves the seam; Phase 4 will deliver the actual UX. This appendix surveys the landscape so the Phase 4 spec starts from data.

### The fundamental problem

Each social platform requires per-user OAuth (so we post to *the user's* account, not yours). For each platform we either:

- **(A)** Provision an OAuth app ourselves and ship the connect flow (high control, high compliance overhead — TikTok requires audit)
- **(B)** Pay a SaaS aggregator that already has OAuth apps approved (low effort, recurring per-profile cost)
- **(C)** Self-host an OS aggregator (medium effort, no per-user cost, retains control)
- **(D)** Tell each user to provision their own Zernio/Make.com workflow (lowest effort for us, terrible UX for users)

### Landscape (verified May 2026)

| Option | Type | Pricing | Platforms | Notes |
|---|---|---|---|---|
| **Postiz** ([self-hosted, OSS](https://github.com/gitroomhq/postiz-app)) | C | **Free** (self-host) | 18+ incl. TikTok, IG, YT, X, LinkedIn, Bluesky, Threads | OSS, MIT, Docker deploy. Users OAuth directly with the platform — **no API keys proxied through us**. Already integrates with n8n + Make.com. Public API. **Best match for Biblefuel's architecture.** |
| [Upload-Post](https://www.upload-post.com/) | B | Free 10 uploads/mo; paid from **$16/mo** | TikTok, IG, YT, LinkedIn, X, FB, Pinterest, Threads, Reddit, Bluesky | Unified REST API, AI auto-captions, auto-resize per platform. Cheapest aggregator. |
| [Blotato](https://www.blotato.com/) | B | $29 Starter, $97 Creator, **$499 Agency** (API may be Agency-only) | X, LinkedIn, TikTok, YT, IG + 4 more | MCP-ready (works with Claude Code). Costlier than Upload-Post. |
| [Ayrshare](https://www.ayrshare.com/) | B | **$599/mo** for 30 profiles, then $8.99/profile | 11 platforms | Enterprise pricing. Multi-user "business plan" exists but cost rules out free tier. |
| **TikTok Content Posting API direct** ([docs](https://developers.tiktok.com/products/content-posting-api/)) | A | **Free** (API itself) | TikTok only | Unaudited app = max 5 users / 24h, posts forced to `SELF_ONLY` (private). **Audit required for public posts** — multi-week process. |
| Existing **Zernio + Make.com** | D | Free (current setup) | TikTok via webhook | Works for *you* but each user would need their own Zernio account + Make scenario. Terrible onboarding for a public user. |

### Recommendation for Phase 4

**Deploy Postiz alongside Biblefuel Studio as a self-hosted bridge.** Biblefuel pushes rendered videos to the Postiz API; Postiz owns the per-user OAuth flow and the platform-specific posting. The user's "Connect TikTok / YouTube / Instagram" buttons in Biblefuel deep-link into Postiz's OAuth flow.

Why this wins:

- **Zero per-user SaaS cost** — Postiz is OSS and self-hostable.
- **Avoids the TikTok audit burden** for Biblefuel itself — Postiz can be the API client, and audit is per-app not per-host.
- **Architecturally consistent** with how we run Chatterbox (self-hosted bridge at `chatterbox.tiwaton.co.uk`).
- **Privacy story is clean** — Postiz never proxies API keys (its docs explicitly state this); each user authenticates with the platform directly.
- **Fallback exists** — if Postiz fits poorly mid-Phase-4, switching to Upload-Post is a single-adapter swap (~$16/mo + per-user metering).

**Fallback if self-hosting Postiz is too operationally heavy:** Upload-Post is the cheapest hosted aggregator at $16/mo flat — single API key, all users go through it. Trade-off is per-platform compliance becomes Upload-Post's problem, not ours, but we lose direct OAuth control.

**Anti-recommendation:** Ayrshare and Blotato are priced for agencies, not for a faceless-creator app with a free tier. Skip.

Phase 4 spec will pick one and design the integration in detail.

---

## Phase 1 Implementation Status (post-merge note)

Shipped in `worktree-multitenant-public-launch`:

- ✅ `withUserScope` middleware + `featureGate` middleware (with tests, all 89 tests pass)
- ✅ `userPlan.js` super-admin detection + `paths.js` per-user dir helpers
- ✅ Stores accept `dataDir` parameter: `library.js`, `store.js` (queue), `seriesStore.js`, `socialStore.js`
- ✅ Routes pass `req.ctx.dataDir` and write to `req.ctx.outputDir`: library, queue, series, social, render, audio, media, audio_advanced, pexels, pixabay
- ✅ Jobs worker captures `req.ctx` into `job.ctx` and restores it during execution via module-level `currentJobCtx` (worker is serialized — safe by inspection)
- ✅ ElevenLabs + voice cloning gated to super-admin/premium; Gumroad gated to super-admin via `featureGate("gumroad")`
- ✅ CORS tightened for credentialed multi-tenant safety
- ✅ `MULTITENANT` + `SUPER_ADMIN_EMAIL` documented in `.env.example`

**Intentionally deferred to Phase 2** (these are documented with inline comments referencing this spec):

- Deep TTS-library writes (`edgeTts.js`, `elevenLabsTts.js`, `chatterboxProvider.js`): still write to global `OUTPUT_DIR`. For Phase 1 super-admin (or `MULTITENANT=false`) this is correct. With `MULTITENANT=true` and a non-super-admin user the file would land in the global dir — a Phase 2 concern when per-user output serving is built.
- Search-and-download utilities (`pexels.js`, `pixabay.js`) and `imageGen/index.js`: same — global writes.
- `mediaThumb.js` URL-alias resolution (`/outputs/...` → file path): always resolves against global `OUTPUT_DIR`. Phase 2 will add per-user URL-routing (`/outputs/<userId>/...`).
- `social.js` cron rehydration: walks ONLY super-admin's `DATA_DIR/social.json`. Per-user schedule rehydration is Phase 4 work.
- `jobs.json` queue: stays global (one queue per server). Each job's `ctx` carries the user's `dataDir`/`outputDir` so the worker writes to the right place. Splitting the queue per user is Phase 5 (quotas/billing) territory.
- `bibleCache/`: intentionally shared (read-only cache, no PII).
- `scripts_history.json`: still global (super-admin only).

**Verification commands** (for the operator before deploying):

```bash
cd server
npm test                                    # 89 tests pass
MULTITENANT=false npm start                 # legacy behaviour — super-admin paths only
MULTITENANT=true SUPER_ADMIN_EMAIL=coolshegz@gmail.com npm start
# log in as the operator → see existing library/series/social
```

Rollback: set `MULTITENANT=false` (or unset). The middleware short-circuits to legacy ctx and every store call resolves to `DATA_DIR` / `OUTPUT_DIR`.
