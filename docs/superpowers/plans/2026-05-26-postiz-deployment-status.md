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

## Next step (~30 seconds)

1. Open the Coolify service page: https://coolify.tiwaton.co.uk/project/vos8co8cow8w8wgcwkkwg4w8/environment/yo0kcwsg04gkk4ko4ok488c8/service/q7o8e8gdc94gzgq4x8m6kh6w
2. Click **Deploy** (top right)
3. Wait 60-90 seconds (initial container pulls + DB migrations + Let's Encrypt cert issuance)
4. Watch the logs on the `postiz` sub-app — first deploy may briefly show ECONNREFUSED to postgres before the healthcheck passes; that's fine
5. Verify:
   ```bash
   curl -I https://postiz.tiwaton.co.uk/
   # Expect HTTP/2 200 or 302 to /auth/login
   ```

If the post-deploy logs show actual errors (vs. the temporary DB race), the usual culprits are:
- **ECONNREFUSED postiz-postgres:5432** — retry once Postgres healthcheck passes (~30s after first start)
- **JWT_SECRET malformed** — unlikely (96 random hex chars), but cross-check Coolify env tab
- **TEMPORAL_ADDRESS required** — would mean `IS_GENERAL=true` isn't being honoured; add temporal back to the compose

If the public URL 404s or 502s after Deploy completes, only then revert FQDN to `:5000` as a fallback (and update `POSTIZ_URL` accordingly in Biblefuel's env).

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
