# Coolify deployment — persistence checklist

biblefuel-studio writes runtime state to `/app/data` and `/app/outputs` inside
the container. Without persistent volumes, **every redeploy wipes the Library,
job history, scripts dedup history, downloaded backgrounds, generated voice
audio, and rendered MP4s**. That's catastrophic for the auto-publish workflow.

This document is the one-time setup to make Coolify mount real disk to those
paths so everything survives container restarts and image rebuilds.

## What lives where

| Path inside container | What it holds | Lost if not persisted? |
|---|---|---|
| `/app/data/library.json` | All your Library backgrounds (Pexels downloads, local imports, with categories) | Yes — re-download everything |
| `/app/data/jobs.json` | Job history (renders, campaigns, statuses) | Yes — lose the dashboard |
| `/app/data/scripts_history.json` | Dedup keys so generated scripts don't repeat | Yes — script repeats restart |
| `/app/data/social.json` | Webhook + cron schedules + Direct API config | Yes — re-enter Make webhook |
| `/app/data/queue.json` | Queued scripts pending render | Yes |
| `/app/outputs/*.mp4` | Rendered videos | Yes — campaign-published TikToks become broken links |
| `/app/outputs/*.mp3` | Edge-TTS / ElevenLabs voice audio | Yes |
| `/app/outputs/pexels_*.mp4` | Downloaded Pexels backgrounds | Yes |
| `/app/outputs/*.jpg` | Library thumbnails | Yes — Library page shows blanks |

## Coolify volume setup

In the Coolify UI for the biblefuel-studio app:

1. **Configuration → Storages → Add storage**
2. Add **Volume Mount** #1:
   - Name: `biblefuel-data`
   - Mount Path: `/app/data`
3. Add **Volume Mount** #2:
   - Name: `biblefuel-outputs`
   - Mount Path: `/app/outputs`
4. **Redeploy** the application.

After the redeploy, Coolify creates the named volumes if they don't exist and
mounts them inside the container. The first boot will lazily recreate empty
`library.json`, `jobs.json`, etc. (they're absent on first mount — that's
normal).

## Migrating existing data (if you've been running without volumes)

If the app has been running without volumes, your Library and history are
inside the *current* container's writable layer and will be lost on the next
redeploy. Before adding the volumes:

```bash
# In Coolify → Application → Terminal
# (or wherever you can shell into the running container)
cd /app
ls data/        # confirm files exist
ls outputs/     # confirm files exist
```

If files exist and you want to keep them:

1. Copy them to a temporary host location via Coolify's file browser, **OR**
2. Add the volumes, redeploy (existing data is lost), then restore from a
   backup. There is no in-place migration path in stock Coolify — declare
   the volumes BEFORE the first deploy if possible.

For first-time deploys, just declare the volumes upfront and start fresh.

## Verifying persistence after setup

After redeploying with volumes mounted:

1. Open the app, save a background to your Library
2. **Redeploy** the app in Coolify (force a container rebuild)
3. After redeploy completes, the background should still be in your Library

If it's gone, the volumes aren't bound correctly — check the Coolify storage
settings again.

## Optional: customise the paths

If you want the volumes mounted somewhere else (e.g. `/data` and
`/var/outputs`), set these env vars in Coolify:

```
DATA_DIR=/data
OUTPUT_DIR=/var/outputs
```

…and mount the Coolify volumes to those paths instead. The server resolves
these at startup ([server/src/lib/paths.js](../server/src/lib/paths.js)).
