# Deploying Biblefuel Studio (Coolify)

Production runs on **Coolify** (self-hosted), not Render. The app is served at
**https://biblefuel.tiwaton.co.uk** (behind Cloudflare).

## How the build works
Coolify builds **`server/Dockerfile`**, which installs FFmpeg/FFprobe and runs
the Node server. The Dockerfile does **not** build the client — the Vite client
outputs to `server/public/` (see `client/vite.config.ts`) and those built assets
are **committed to git**. The server serves whatever is in `server/public/` at
image-build time.

### Deploy checklist (after any `client/src/**` change)
1. `npm --prefix client run build`  → writes hashed bundles into `server/public/`
2. Commit **both** the source change and the regenerated `server/public/**`
3. `git push origin master`
4. Trigger the Coolify deploy (auto-deploy may also be wired to the push):

```bash
curl -X POST \
  "https://coolify.tiwaton.co.uk/api/v1/deploy?uuid=z40cwk8wsko0g84gsg0csok8" \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN"
```

The Coolify app UUID is `z40cwk8wsko0g84gsg0csok8`. The API token lives in the
local `.env.local` (`COOLIFY_API_TOKEN`) — it is **not** committed.

## Environment variables (set in the Coolify dashboard)
Required (secrets): `ADMIN_SETUP_KEY`, `JWT_SECRET`, `OPENAI_API_KEY`.
Recommended: `CORS_ORIGIN` (your domain), `JWT_EXPIRES_IN=7d`,
`OUTPUT_DIR`, `DATA_DIR`, `FFMPEG_PATH=ffmpeg`, `FFPROBE_PATH=ffprobe`.

## Persistent storage
Generated media and user data must live on a **persistent volume** mounted into
the container (e.g. `OUTPUT_DIR` / `DATA_DIR`) — Coolify volumes survive
redeploys; the container filesystem does not.

## Notes
- Prod FFmpeg is **5.1** — use `-filter_complex_script` (not the 7.x-only
  `-/filter_complex`); validate any new filter flags against 5.1.
- Long synchronous requests are bounded by Cloudflare's ~100s edge timeout;
  very long transcriptions/renders need the async-job path.
