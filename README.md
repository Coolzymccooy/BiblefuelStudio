# Biblefuel Studio (v2) — Dashboard + Video Pipeline + Gumroad Pack Builder

This local app helps you run your faceless TikTok theme page **@Biblefuel** faster, while staying on the safe side:
- ✅ Dashboard UI (no curl needed)
- ✅ Script generator (OpenAI or Gemini optional; includes fallback)
- ✅ Posting Queue (save items, export CSV)
- ✅ Background search + download via Pexels (optional)
- ✅ AI Voice via ElevenLabs (optional)
- ✅ Simple video render via FFmpeg (optional)
- ✅ Gumroad pack builder (Free lead magnet + Paid 30-day devotional as Markdown)

> Note: This does **not** auto-login or auto-post to TikTok. It prepares assets and exports, then you upload/schedule with TikTok's scheduler.

## Requirements
- Node.js 18+
- FFmpeg installed (optional)
- Optional keys:
  - OPENAI_API_KEY or GEMINI_API_KEY
  - PEXELS_API_KEY
  - ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID

## Run
```bash
cd biblefuel-studio-v2/server
cp .env.example .env
npm install
npm run dev
```
Open: http://localhost:5051

## Dashboard
- Generate scripts
- Add to queue
- Export CSV
- Search & download backgrounds
- Create TTS audio
- Render a video
- Build Gumroad packs

## Tips
- Start with **no keys** (fallback scripts) and validate the workflow.
- Then add keys for higher-quality scripts and optional voice/background.


## Voice/Media
v3 adds:
- Record voice in the browser (MediaRecorder) and save to `outputs/`
- Upload your own audio file and use it as the render audio track

Important:
- Use only voices and visuals you own or have explicit permission to use.
- This tool does not include impersonation (voice cloning of real people) or face-swapping.


## Waveform mode
Use the dashboard button **Render Waveform MP4** to create a faceless presenter style: background + captions + audio waveform.


## Audio treatment (mini-Audacity)
In the dashboard, record/upload audio, then use **Audio treatment** to denoise, gate, EQ, compress, remove silence, and normalize.


## v6 additions
- Presets + custom controls remain
- Patch/merge multiple audio clips (concat) with fades and optional de-ess
- Waveform preview image for the selected audio


## Timeline editor
v7 adds a simple timeline editor in the dashboard: add clips, reorder, optional trim per clip, then render into one MP3.


## v8 additions
- Timeline: snap-to grid, clip split, per-clip playback (best-effort), and server-side crossfades between clips.


## v9 additions
- Timeline: per-join crossfades, preview honoring trims, and click-to-split using waveform (requires ffprobe).


## v10 additions
- Timeline table: per-clip Gain(dB) and per-join fade inputs.
- Waveform click now instantly splits the selected clip.
- Timeline render applies per-clip gain (FFmpeg volume filter) and uses per-join fades from the table.


## v11 additions
- Timeline: visual join strips between clips (DAW feel), per-clip Pan and Gate override, and auto-select after split.


## Remote internet access (Auth + Jobs + PWA)
1) Set env vars: ADMIN_SETUP_KEY, JWT_SECRET, CORS_ORIGIN (your domain), FFMPEG_PATH/FFPROBE_PATH.
2) Start server.
3) Open the web UI, run One-time Setup (with X-Setup-Key), then Login.
4) Use /api/jobs/enqueue for background renders (waveform/video).


## Deploy to Render
See `DEPLOY_RENDER.md`.
