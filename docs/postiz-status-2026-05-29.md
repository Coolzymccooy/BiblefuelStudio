# Postiz selfhost — status handoff (2026-05-29)

> ⚠️ **SUPERSEDED — read the [Update (2026-05-29, later)](#update-2026-05-29-later--research-findings--decision-parked) section at the bottom first.**
> Research after this handoff found the original resume plan is **not achievable as written**:
> the self-hosted Postiz public API is single-org (no per-user isolation), the integration
> client targets endpoints that don't exist, and the suggested `:v1.18.0` tag is the wrong
> major version. **Decision: PARKED.** The sections below are kept for history only — do not
> follow the TL;DR prompt.

## TL;DR (paste this prompt to resume work)

> I want to finish setting up Postiz selfhost for Biblefuel. Read
> `docs/postiz-status-2026-05-29.md` for the full state. We left it
> reverted to its original (broken) compose because the `latest` image
> wouldn't bind port 5000 despite Temporal + DBs being healthy. Pick up
> by pinning Postiz to a known-good tag (try `:v1.18.0` first), force
> redeploy via the Coolify API, and tail the postiz container logs from
> the Coolify UI until backend + frontend both report
> "successfully started". Then resume the original plan:
> create admin in the Postiz UI → grab API key → set `POSTIZ_URL` +
> `POSTIZ_API_KEY` in Biblefuel's Coolify env → redeploy biblefuel →
> verify `/api/postiz/status` returns connected.

## Where we are right now

- **Coolify service `postiz`** (UUID `q7o8e8gdc94gzgq4x8m6kh6w`) at
  `https://postiz.tiwaton.co.uk` is **deployed but unhealthy**.
- **`docker_compose_raw` is reverted to the original** (Temporal 1.22,
  no env tweaks) — same state as the day it was first added to Coolify.
- **Public HTTP returns 503** from Traefik because Postiz never bound
  port 5000 in any of the deploy attempts tried tonight.
- **Postgres + Redis are functional** (came up healthy when allowed to
  start).
- **Temporal is fundamentally working** — we proved this by the
  orchestrator log showing all platform task queues
  (`tiktok`, `youtube`, `instagram`, …) reaching `RUNNING` state after
  bumping the image to `:1.27`. The orchestrator's NestJS process
  reported "Nest application successfully started".
- **Biblefuel does NOT have `POSTIZ_URL` or `POSTIZ_API_KEY` set** in
  Coolify, so `isPostizConfigured()` returns false in production. The
  PostizConnectCard is rendered but inert. This is fine for now.

## What we tried (and what we learned)

| Attempt | Change | Result |
|---|---|---|
| 1 | Restart service | Both `postiz` + `postiz-temporal` containers exited immediately |
| 2 | Force-deploy from scratch | Same — Temporal container exited, Postiz couldn't connect to it (`ECONNREFUSED ::1:7233`) |
| 3 | Bumped Temporal image `:1.22` → `:1.27`, added `ENABLE_ES=false` | Containers stayed running for 5+ min, orchestrator successfully registered all platform workers → Temporal works |
| 4 | Restart + probe | HTTP still 503 — backend/frontend processes inside postiz container never bound port 5000 |
| 5 | Stop → Start sequence | Broke Coolify orchestration; all containers showed "exited" and didn't recreate |
| 6 | Restored original compose + force deploy | Returned to baseline (still 503, same as starting state) |

## Root cause hypothesis (untested)

The `ghcr.io/gitroomhq/postiz-app:latest` image probably has a recent
breaking change that affects port binding. Even when Temporal IS
reachable, the backend (`1|backend`) or frontend (`1|frontend`)
processes managed by pm2 inside the container don't successfully bind
port 5000. We saw the backend successfully map all routes (`[Nest]
[RouterExplorer] Mapped ...`) before crashing with a Temporal
connection error — but after fixing Temporal, we never got a fresh
log confirming the backend retried successfully.

**Most likely fix on next attempt:** pin Postiz to a known-good tagged
release rather than `:latest`. Candidates worth trying (newest first):

- `ghcr.io/gitroomhq/postiz-app:v1.18.0`
- `ghcr.io/gitroomhq/postiz-app:v1.17.0`

If a pinned tag also fails, the next thing to try is **mounting
Coolify's log endpoint properly** — log into the Coolify UI directly
and tail `postiz` container logs in real time while doing a deploy.
The Coolify v1 API does not expose service container logs, confirmed
across 8+ endpoint permutations.

## Why we paused

Each deploy cycle is ~5 min (image pull + container spin-up +
healthcheck wait). Each "fix" without backend logs is a blind guess.
Continuing to blindly iterate without log access would burn another
hour with low probability of success. The user's actual goal — letting
non-super-admin users post to TikTok — was achieved instead via the
per-user Make webhook flow (Path C, shipped same session).

## Files / commits relevant to this work

- `docs/postiz-status-2026-05-29.md` (this file)
- No code changes were made to Biblefuel for Postiz this session. The
  existing `PostizConnectCard` and `/api/postiz/*` endpoints from
  earlier sessions remain in place but inert until `POSTIZ_URL` +
  `POSTIZ_API_KEY` are set in Coolify env.

## When you resume

1. **Decide if Postiz is still the right path.** The Make webhook ships
   the same end-user value with less ops overhead. If you want Postiz
   anyway (for the in-app "Connect TikTok" experience without forcing
   Make on users), continue. Otherwise delete the service.
2. **Pin to a tagged image, not `:latest`.** Edit
   `docker_compose_raw` via `PATCH /api/v1/services/{uuid}` (body must
   be base64-encoded — the Coolify API quirk).
3. **Watch logs in the Coolify UI in real time**, not via API. Have the
   logs page open BEFORE you deploy.
4. **First-time admin signup happens at** `https://postiz.tiwaton.co.uk/`.
   `DISABLE_REGISTRATION=false` is already set, so the first user to
   hit signup becomes admin.
5. **API key** is generated in Postiz settings under "API Keys" by the
   admin user.
6. **Wire Biblefuel:** set `POSTIZ_URL=https://postiz.tiwaton.co.uk`
   and `POSTIZ_API_KEY=<key>` in Coolify for app
   `z40cwk8wsko0g84gsg0csok8`, redeploy. Then `/api/postiz/status`
   should return `{ configured: true }`.

---

## Update (2026-05-29, later) — research findings & decision (PARKED)

Before resuming the ops work above, we researched the real Postiz API and image
line. The findings invalidate the original plan. **No infrastructure was
re-created; the integration is parked.**

### Finding 1 — the suggested image tag is the wrong era

Postiz is now on the **v2.x** line. As of this writing `:latest` = **v2.21.8**,
previous stable = **v2.21.7** (~1 month soak, 135k pulls). The handoff's
`:v1.18.0` / `:v1.17.0` candidates are from a different major version and would
pair an ancient app with the current Temporal/compose scaffolding. If Postiz is
ever stood up, pin **`ghcr.io/gitroomhq/postiz-app:v2.21.7`**, not v1.x.

### Finding 2 — the integration client targets endpoints that don't exist

Real self-hosted Postiz public API (`docs.postiz.com/public-api`):

- **Base path:** `/public/v1` (self-hosted: `https://{POSTIZ_URL}/public/v1`)
- **Auth header:** `Authorization: <apiKey>` — **raw key, NO `Bearer` prefix**
- **Endpoints:** `GET /public/v1/integrations`, `POST /public/v1/posts`,
  `POST /public/v1/upload`, `POST /public/v1/upload-from-url`, find-slot
- **The API key is scoped to ONE organization.**

`server/src/lib/postizClient.js` assumes a fictional per-user admin API:
`POST /api/users/upsert` (`ensurePostizUser`), `POST /api/integrations/connect`,
`GET /api/users/:id/integrations`, and `Bearer`-prefixed auth. **None of these
exist.** Even the bits that "work" are misleading: `isPostizConfigured()` only
checks that the two env vars are present, so `/api/postiz/status` returns
`{ configured: true }` the instant they're set — while every real call 404s.
`configured:true` is **necessary but not sufficient**; it is not proof of a
working integration.

### Finding 3 — self-hosted Postiz can't do per-user isolation with an API key

The whole Biblefuel design (1 Biblefuel user ↔ 1 Postiz user via
`ensurePostizUser`) requires per-user isolation. The public API key model gives
a **single shared org** — every Biblefuel user would see and post from every
other user's connected channels. Unacceptable for the multi-tenant public
launch.

Per-user isolation exists only via Postiz's **OAuth 2.0 "direct integration"**
(Settings → Developers → Apps → `client_id`/`client_secret`, standard Auth Code
flow, token scoped to each user's org). But:

- It's an OAuth flow + per-user token store, **not** a static `POSTIZ_API_KEY`
  — a full rewrite of `postizClient.js`, not an endpoint remap.
- Self-hosted support is **unproven**: docs describe cloud only, and
  [issue #975](https://github.com/gitroomhq/postiz-app/issues/975)
  ("Multi-Tenant Token Management & External OAuth Integration") notes
  hard-coded Docker secrets → effectively single-tenant on self-host.

### Decision

**PARKED.** The per-user end-user goal (non-admins posting to TikTok) is already
shipped via the per-user Make webhook (Path C). Standing up a 4-container Postiz
stack to re-solve it — for, at best, a single-org operator convenience — isn't
worth the ops burden right now. Biblefuel's Postiz code/endpoints remain in
place but **inert** (`POSTIZ_URL` / `POSTIZ_API_KEY` unset). The Coolify
`postiz` service was deleted; a future re-create gets a **new** UUID (the old
`q7o8e8gdc94gzgq4x8m6kh6w` is stale).

### Recommended better direction (when revisited)

Stop routing through social aggregators (Postiz / Make / Zernio) and standardize
on **direct per-platform OAuth** — the pattern already shipped for YouTube
(commit `25c4dd7`, one-click per-user YouTube OAuth). It gives true per-user
isolation, the best in-app "Connect" UX, no middleman, and no extra infra.

- **YouTube** — done (direct OAuth).
- **TikTok** — TikTok **Content Posting API** (`developers.tiktok.com`): OAuth 2.0
  PKCE, scopes `video.upload` / `video.publish`, `PULL_FROM_URL` source (we
  already host rendered MP4s). Cost: app audit (~5–10 business days in 2026);
  until audited, posts are restricted to private visibility. This replaces the
  Zernio dependency for TikTok.
- **Instagram / Facebook** — Meta Graph API (direct OAuth) when needed.

If the per-platform app-review work is too much to own, the purpose-built
managed alternative is **Ayrshare** (per-user "Profile Keys", handles OAuth +
platforms behind one API) — but multi-user pricing starts at **$599/mo** for 30
profiles + per-profile fees, likely premature at current scale.

If per-user in-app Connect is ever wanted with *minimal* build, **Postiz Cloud**
(`api.postiz.com`) + OAuth supports per-user orgs — trading self-host ops for a
paid SaaS dep. Self-hosted Postiz is the one option that does **not** cleanly
serve the multi-tenant goal.
