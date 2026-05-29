# Postiz selfhost — status handoff (2026-05-29)

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
