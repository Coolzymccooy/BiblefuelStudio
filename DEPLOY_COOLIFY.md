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

### Agent access (MCP)
Agents connect to `https://biblefuel.tiwaton.co.uk/api/mcp` with a key made in
Settings (see `docs/mcp.md`). All of these are optional; defaults in brackets.
- `MCP_ALLOWED_HOSTS`: host names `/api/mcp` answers on, comma-separated.
  Unset: `localhost`, `127.0.0.1`, `[::1]`, `biblefuel.tiwaton.co.uk` and every
  host in `CORS_ORIGIN`. When set it replaces that list entirely.
- Daily ceilings per agent key, reset at midnight UTC, for every plan:
  `MCP_DAILY_RENDERS` (10), `MCP_DAILY_AI_VIDEO_USD` (2), `MCP_DAILY_IMAGES`
  (30), `MCP_DAILY_TTS` (30), `MCP_DAILY_PUBLISHES` (3), `MCP_DAILY_IMPORTS`
  (20; files stored from a URL). A user can lower a key's limits in Settings
  but never raise them above these.
- `IMPORT_URL_TIMEOUT_MS` (600000): overall deadline for one URL import.
- `MAX_INPUT_MB` (200): the largest render input, and also the cap on a URL
  import's download.

## Persistent storage
Generated media and user data must live on a **persistent volume** mounted into
the container (e.g. `OUTPUT_DIR` / `DATA_DIR`) — Coolify volumes survive
redeploys; the container filesystem does not.

## Notes
- Prod FFmpeg is **5.1** — use `-filter_complex_script` (not the 7.x-only
  `-/filter_complex`); validate any new filter flags against 5.1.
- Long synchronous requests are bounded by Cloudflare's ~100s edge timeout;
  very long transcriptions/renders need the async-job path.
