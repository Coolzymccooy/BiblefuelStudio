# Biblefuel Studio - Run Guide

## Prerequisites

- **Node.js** 18+ 
- **FFmpeg** installed (optional for render features)
- Environment variables in `server/.env`:
  - `ADMIN_SETUP_KEY` - One-time setup key
  - `JWT_SECRET` - Secret for JWT tokens
  - Optional: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PEXELS_API_KEY`, `ELEVENLABS_API_KEY`

## Local Development

### First-Time Setup

```bash
# Install root dependencies
npm install

# Install client and server dependencies
cd server && npm install
cd ../client && npm install
cd ..
```

Or use the shortcut:
```bash
npm run install:all
```

### Run Development Servers

```bash
# From project root - runs both servers concurrently
npm run dev
```

This starts:
- **Backend**: `http://localhost:5051` (Express + APIs)
- **Frontend**: `http://localhost:5173` (Vite dev server with HMR)

The Vite dev server proxies `/api` and `/outputs` requests to the backend automatically.

### Access the Application

Open `http://localhost:5173` in your browser.

**First-time authentication:**
1. Enter your `ADMIN_SETUP_KEY` from the `.env` file
2. Create an admin account (email + password)
3. Login with your credentials

All subsequent API calls will automatically include your JWT token.

## Production Build

### Build the React App

```bash
npm run build
```

This:
1. Builds the React app with Vite
2. Outputs the built files to `server/public`
3. Express will serve these files in production

### Run Production Server

```bash
npm start
```

The application will be available at `http://localhost:5051` (or the PORT specified in `.env`).

## Deployment to Render

The existing `Dockerfile` and deployment setup still work. The built React app is served from `server/public`.

### Docker Build

```bash
docker build -t biblefuel-studio .
docker run -p 5051:5051 --env-file server/.env biblefuel-studio
```

### Render Deployment

1. Push your code to GitHub
2. Connect the repository to Render
3. Use the existing `render.yaml` configuration
4. Set environment variables in Render dashboard:
   - `ADMIN_SETUP_KEY`
   - `JWT_SECRET`
   - `CORS_ORIGIN` (your Render URL)
   - Optional: API keys for  OpenAI, Gemini, Pexels, ElevenLabs
   - Optional: `FFMPEG_PATH`, `FFPROBE_PATH` if custom paths needed

## Features

### 1. Scripts Generation
Generate AI-powered Bible-themed scripts for TikTok content.

### 2. Queue Management
Add generated scripts to a queue, refresh, and export as CSV.

### 3. Background Jobs
Track status of async render jobs (queued/running/done/failed).

### 4. Backgrounds
Search and download background videos from Pexels.

### 5. Voice & Audio
- TTS generation via ElevenLabs
- Record audio in browser
- Upload audio files
- Audio treatment (denoise, EQ, compress, normalize)

### 6. Timeline Editor
DAW-like timeline for editing audio clips with per-clip controls (gain, pan, gate) and per-join crossfades.

### 7. Render
- Render MP4 videos with FFmpeg
- Render waveform videos (background + captions + audio waveform)
- Option to render in background using Jobs queue

### 8. Gumroad Pack Builder
Generate Markdown and ZIP files for Gumroad lead magnets and paid products.

## Troubleshooting

### Port Already in Use

If port 5051 or 5173 is in use:
- Backend: Set `PORT` in `server/.env`
- Frontend: Update `server.port` in `client/vite.config.ts`

### CORS Issues

If deploying separately (e.g., Vercel for frontend, Render for backend):
- Set `CORS_ORIGIN` in backend `.env` to your frontend URL
- Update `proxy` in `client/vite.config.ts` to point to backend URL

### API Errors

- Ensure backend is running on port 5051
- Check that JWT token is stored in localStorage (`BF_TOKEN`)
- Verify authentication by checking the top bar auth indicator

## Scripts Reference

```json
{
  "dev": "Run both frontend and backend in development mode",
  "build": "Build the React frontend for production",
  "start": "Run the production server",
  "install:all": "Install dependencies for both client and server"
}
```

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS
- **Backend**: Node.js + Express + JWT auth
- **State Management**: Zustand + React Query
- **UI Components**: Custom design system with Lucide icons
- **Notifications**: react-hot-toast
