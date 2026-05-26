# Postiz Deployment Status (Phase 4 infra)

**Date:** 2026-05-26
**Branch:** `worktree-multitenant-public-launch`

## Live state

| Resource | Value |
|---|---|
| Coolify service UUID | `vdzunubvmpdzlj67sls6tjut` |
| Coolify project | Biblefuel (`vos8co8cow8w8wgcwkkwg4w8`) |
| Coolify server | localhost / 167.235.141.118 |
| Postiz sub-application UUID | `bglneammjl04tze1b1qsmgbd` |
| Postgres UUID | `s86oool20m52tlwbiaym08kx` |
| Redis UUID | `f1mx9z135gpopwqzky3cyap2` |
| Public FQDN | `postiz.tiwaton.co.uk` |
| Cloudflare DNS record | `c8a81e3ba86cdfb72605edb0eb52190b` (CNAME → coolify.tiwaton.co.uk, DNS-only) |
| Container status | postiz=running, postiz-postgres=healthy, postiz-redis=healthy |
| Public HTTP status | **503 — Traefik has no healthy backend** (FQDN not bound to sub-app) |

## What's been done automatically

1. ✅ Cloudflare CNAME `postiz` → `coolify.tiwaton.co.uk` (grey-cloud, so Coolify can issue Let's Encrypt)
2. ✅ Coolify service created via `POST /api/v1/services` with base64-encoded compose
3. ✅ Three containers deployed (Postiz app + Postgres 17 + Redis 7), all running
4. ✅ `SERVICE_FQDN_POSTIZ_5000=https://postiz.tiwaton.co.uk` env var set
5. ❌ The Postiz sub-application's `fqdn` field is `null` — Coolify v4's **public REST API does not expose FQDN binding on service sub-applications**. This must be done in the UI.

## ⚠️ Manual step required (30 seconds)

1. Open https://coolify.tiwaton.co.uk
2. Navigate: **Biblefuel project** → **production** → **postiz** service
3. In the service detail view, click the **postiz** sub-application card
4. In the **Domains** field, paste: `https://postiz.tiwaton.co.uk`
5. Click **Save**
6. Click **Restart** on the service (top-right). Wait ~90s for Let's Encrypt to issue the cert.
7. Verify: `curl -I https://postiz.tiwaton.co.uk/` should return `HTTP/2 200` (or a 302 redirect).

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
