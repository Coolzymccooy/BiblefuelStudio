# Postiz Deployment Status (Phase 4 infra)

**Date:** 2026-05-26 (updated 2026-05-27 after FQDN fix)
**Branch:** `worktree-multitenant-public-launch`

## Live state

| Resource | Value |
|---|---|
| Coolify service UUID | `q7o8e8gdc94gzgq4x8m6kh6w` |
| Coolify project | Biblefuel (`vos8co8cow8w8wgcwkkwg4w8`) |
| Coolify server | localhost / 167.235.141.118 |
| Public FQDN | `https://postiz.tiwaton.co.uk` — **set via UI, no port** ✅ |
| Cloudflare DNS record | CNAME `postiz` → `coolify.tiwaton.co.uk` (DNS-only) — verified live |
| Postiz containers | **never deployed yet** — Docker has no record of them (`No such container` in logs). Earlier diagnosis of "crash-loop" was wrong — service was configured but Deploy was never pressed. |
| Postgres, Redis | also never deployed (same as above) |

## What's been done

1. ✅ Cloudflare CNAME `postiz` → `coolify.tiwaton.co.uk` (grey-cloud, so Coolify can issue Let's Encrypt)
2. ✅ Coolify service created via API with base64-encoded compose (Postiz + Postgres 17 + Redis 7)
3. ✅ Auto-generated secrets baked in (JWT_SECRET, POSTGRES_PASSWORD — visible in Coolify env tab)
4. ✅ Sub-app FQDN bound to `https://postiz.tiwaton.co.uk` (no port) via Coolify UI — Coolify popped a "Remove Required Port?" CYA dialog; confirming was correct
5. ⏳ **Pending:** click **Deploy** in Coolify UI to actually start the containers for the first time

## ⚠️ Coolify v4 API limit (for future reference)

Sub-application FQDN binding can NOT be set via the public REST API on service sub-applications. The `SERVICE_FQDN_<NAME>_<PORT>` env var only seeds the value at service-*creation* time and doesn't propagate to the sub-app's stored fqdn afterwards. The only way to change it later is the UI. This is what cost the previous session ~2 hours of API attempts before I documented it.

## The "Remove Required Port?" dialog (gotcha)

When you set the FQDN to `https://postiz.tiwaton.co.uk` (no `:5000`), Coolify shows a stern warning saying the service "may become unreachable". **Ignore it.** That warning refers to the container's *internal* port — Traefik handles the 443→5000 mapping silently. Putting `:5000` in the public URL would have made the URL ugly and broken Let's Encrypt (which prefers standard 443).

## Gotcha #2 — Bare-hostname URL bug (post-first-deploy)

After the first successful Deploy on 2026-05-27, the Postiz container crash-looped with:

```
TypeError: Invalid URL
  at new URL (node:internal/url:825:25)
  at startMcp (/app/.../start.mcp.js:47:23)
  base: "postiz.tiwaton.co.uk:5000/api"
```

**Root cause:** the magic env vars `SERVICE_FQDN_POSTIZ` and `SERVICE_FQDN_POSTIZ_5000` are auto-populated by Coolify based on the sub-app FQDN, but they store the value **without the `https://` prefix**. The compose interpolates them directly into `MAIN_URL` / `FRONTEND_URL` / `NEXT_PUBLIC_BACKEND_URL`, so those container env vars end up as bare hostnames like `postiz.tiwaton.co.uk:5000` — which Node's `URL` constructor rejects.

**Fix (already applied via API):**
```
SERVICE_FQDN_POSTIZ      = https://postiz.tiwaton.co.uk
SERVICE_FQDN_POSTIZ_5000 = https://postiz.tiwaton.co.uk
```

PATCHed both via `PATCH /api/v1/services/{uuid}/envs` then `POST /restart`. The Coolify-managed flag on those vars meant a manual UI edit would have worked too; the API path saved a click.

## Gotcha #3 — Postiz needs Temporal (parked)

Logs after the URL-fix deploy showed:

```
ERROR Backend failed to start on port 3000
Error: 14 UNAVAILABLE: No connection established.
  Last error: Error: connect ECONNREFUSED ::1:7233.
  at TemporalRegister.onModuleInit (temporal.register.js:17:71)
```

`IS_GENERAL=true` was supposed to skip Temporal but doesn't — Postiz still calls `TemporalRegister.onModuleInit` unconditionally. The compose was patched to add a `postiz-temporal` service (`temporalio/auto-setup:1.22` with `DB=postgres12` pointing at the shared postiz-postgres). Even after that, the public URL stayed at 503 — likely Temporal first-boot DB migration takes 5+ min and we ran out of patience.

## Status: parked

**Containers left running in Coolify**, no further deploy attempts. The compose currently in place is the v5 with Temporal added (`c:/tmp/postiz-compose-v5.yml`).

**Biblefuel side:** `POSTIZ_URL` is unset in `server/.env`, so `/api/postiz/status` returns 503, the Postiz/AutoPublish cards in Settings render `null`, and the ShareSheet hides the per-platform buttons. Users still get Download / Copy / Web Share / intent URLs — zero impact on the app.

**Why we stopped:** even if Postiz were fully up, none of the OAuth apps (TikTok / Meta / X / LinkedIn / YouTube) are registered yet. Without those, the Postiz connect buttons return `oauth_app_not_configured`. The OAuth audits take days-to-weeks of paperwork; revisit when there's energy for that.

## To resume later

1. Check container status in Coolify UI — is `postiz-temporal` showing "Running (healthy)"?
2. If yes: hit the public URL; if still 503, grab fresh `postiz` (main app) logs
3. If Temporal is the blocker, easiest path is to delete the service and recreate from Postiz's official compose at https://github.com/gitroomhq/postiz-app/blob/main/var/docker/docker-compose.dev.yaml — that one is known-good with their current backend
4. Once URL loads, follow the original "first-time setup" flow: sign up admin → generate API key → add `POSTIZ_URL=https://postiz.tiwaton.co.uk` + `POSTIZ_API_KEY=<key>` to `server/.env` → restart Biblefuel

## After the manual step — Postiz first-time setup

Once the URL is live:

1. Visit https://postiz.tiwaton.co.uk in your browser
2. Sign up the **first** Postiz admin account (this is YOU, the operator)
3. Verify your email if prompted
4. Navigate to **Settings** → **API** → **Generate API key**
5. Copy the API key
6. In `server/.env.local`, set:
   ```
   POSTIZ_URL=https://postiz.tiwaton.co.uk
   POSTIZ_API_KEY=<the key from step 5>
   ```
7. Restart Biblefuel. The `PostizConnectCard` in Settings will go live for all users.

## Then — register OAuth apps with each social platform

This is the part nobody can automate. Each platform has its own developer flow:

| Platform | Where | Time |
|---|---|---|
| TikTok | https://developers.tiktok.com → Manage apps → Content Posting API → submit for audit | days–weeks |
| YouTube | https://console.cloud.google.com → APIs → OAuth client → consent screen | 1–3 days |
| Instagram + Facebook | https://developers.facebook.com → Business app → Instagram Graph API | 1–2 weeks |
| LinkedIn | https://www.linkedin.com/developers → app → marketing permissions | 2–5 days |
| X | https://developer.twitter.com → app → Basic tier ($100/mo to post) | 1 hour, recurring cost |

After each app is approved, paste the client ID + secret into Postiz: **Settings → Integrations → <platform>**.

## Secrets reference (these were generated, NOT committed)

The compose was deployed with auto-generated secrets. They're inside Coolify's database — to retrieve them:

- **JWT_SECRET / DATABASE_URL / POSTGRES_PASSWORD**: Open the Coolify service detail → Environment Variables tab. They're visible there.
- The same values were temporarily written to `c:/tmp/postiz-compose.yml` during deploy; that file is on the operator's local machine, not in git.

## Rollback (if needed)

To tear everything down:

```bash
# In Coolify UI: Biblefuel → production → postiz → Settings → Delete service
# OR via API:
TOKEN=<coolify token>
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  https://coolify.tiwaton.co.uk/api/v1/services/vdzunubvmpdzlj67sls6tjut

# Delete DNS record:
CF=<cloudflare token>
curl -X DELETE -H "Authorization: Bearer $CF" \
  https://api.cloudflare.com/client/v4/zones/4e7b060668aa6d72209efa56099962fb/dns_records/c8a81e3ba86cdfb72605edb0eb52190b
```

Biblefuel server code already 503s gracefully when Postiz isn't configured, so tearing this down has zero impact on Biblefuel.
