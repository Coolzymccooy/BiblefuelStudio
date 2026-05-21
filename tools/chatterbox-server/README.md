# Chatterbox HTTP Bridge

A tiny FastAPI server that wraps [Chatterbox TTS](https://github.com/resemble-ai/chatterbox) so the BibleFuel Studio voice engine can call it as a remote provider.

The biblefuel `chatterbox` provider expects the wire contract this server exposes — `POST /tts` with JSON `{ text, audio_prompt_path?, exaggeration?, cfg_weight?, output_format }`, response body is raw audio bytes.

## Why a separate server?

Chatterbox is Python + PyTorch. The biblefuel server is Node.js. Running them in one process would mean Python embedded in Node, which is fragile. Treating Chatterbox as a side service is simpler and survives version drift on either side.

## Requirements

- **Python 3.10–3.13.** Not 3.14 (PyTorch wheels lag).
- **~3 GB disk** (torch + model checkpoint).
- **NVIDIA GPU recommended.** CPU works but is *slow* — expect 60–120 s for a short sentence on a modern CPU. On CUDA, ~3–5 s.

## Setup

```bash
cd tools/chatterbox-server
# Use whichever Python 3.12 binary you have. On Windows w/ chocolatey:
C:/Python312/python.exe -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

First import of Chatterbox downloads the model (~1.5 GB) into the HuggingFace cache.

## Run

```bash
# Foreground
.venv\Scripts\python.exe server.py

# Or pick a non-default port
set CHATTERBOX_PORT=8000
set CHATTERBOX_HOST=127.0.0.1
.venv\Scripts\python.exe server.py
```

On boot you'll see `Loading Chatterbox model on device=<cpu|cuda|mps>...` — wait for `Chatterbox model ready.` before sending requests. Model load takes 30–90 s.

## Wire it into BibleFuel Studio

Add to `server/.env`:

```
CHATTERBOX_URL=http://127.0.0.1:8000
```

Restart the Node server. `GET /api/tts/providers` should now report `chatterbox: { available: true }`.

## Health check

```
curl http://127.0.0.1:8000/health
```

## Tuning knobs

The provider forwards three Chatterbox-specific controls:

| Source field                    | Chatterbox arg     | Default |
|---------------------------------|--------------------|---------|
| `voiceSettings.style`           | `exaggeration`     | 0.5     |
| `voiceSettings.cfg_weight`      | `cfg_weight`       | 0.5     |
| `voiceIds.chatterbox` (path)    | `audio_prompt_path`| none    |

`audio_prompt_path` is an absolute path **on the machine running this server**, not the biblefuel server. Mount or copy the reference WAV accordingly.

## Why this is not in the main biblefuel server

The Node provider in [`server/src/lib/voice/providers/chatterboxProvider.js`](../../server/src/lib/voice/providers/chatterboxProvider.js) does the talking. If you swap this Python bridge for a different one (HF Spaces, RunPod, Replicate-with-shim), the Node side doesn't change.
