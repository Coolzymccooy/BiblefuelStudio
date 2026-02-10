# Deploying Biblefuel Studio to Render (Docker)

## Why Docker?
Render's native Node environment may not include FFmpeg by default. Using Docker ensures `ffmpeg` and `ffprobe` are installed and available. citeturn0search19

## Create the Render Web Service
1. Push this repo to GitHub.
2. Render Dashboard → New → Web Service
3. Connect your repo.
4. Environment: Docker citeturn0search19
5. Root Directory: `server`
6. Health Check Path: `/api/health` citeturn0search2

## Environment variables (Render → Environment)
Required (secrets)
- ADMIN_SETUP_KEY
- JWT_SECRET

Recommended
- CORS_ORIGIN = your frontend domain (use `*` only for quick testing)
- JWT_EXPIRES_IN = 7d
- OUTPUT_DIR = /var/outputs
- DATA_DIR = /var/data
- FFMPEG_PATH = ffmpeg
- FFPROBE_PATH = ffprobe

## Persistent storage (important)
Render services have an ephemeral filesystem by default. Attach a Persistent Disk to preserve generated files and users. citeturn0search1

Disk mount path example: `/var` (mount paths are absolute). citeturn0search4

Then set:
- OUTPUT_DIR=/var/outputs
- DATA_DIR=/var/data

## First-time owner setup
Open the app → Auth / Remote Access → enter email/password + setup key → One-time Setup.
