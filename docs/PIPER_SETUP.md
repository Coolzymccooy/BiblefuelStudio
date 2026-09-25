# Piper TTS — Setup

[Piper](https://github.com/rhasspy/piper) is a fast neural CPU TTS by Rhasspy.
BibleFuel uses it as the **free local fallback** in the voice priority chain
(slot 4, after Azure / ElevenLabs / Fish). Zero per-character cost, zero
network dependency.

Piper itself is a CLI + ONNX library — not an HTTP service. The provider
speaks to whatever lightweight HTTP wrapper you run locally.

## How the provider sees Piper

| Env var            | Required | Default                      | Notes |
|--------------------|----------|------------------------------|-------|
| `PIPER_URL`        | ✅       | —                            | Full POST endpoint URL. Empty/unset → provider reports unavailable. |
| `PIPER_VOICE`      | ❌       | —                            | Default voice id (e.g. `en_US-amy-low`). Overridden per-request via `voiceId`. |
| `PIPER_TIMEOUT_MS` | ❌       | `30000`                      | Piper is fast (<1s typical). |

## Wrapper HTTP contract

Any wrapper matching this contract works:

```
POST {PIPER_URL}
Content-Type: application/json

{ "text": "Hello world", "voice": "en_US-amy-low" }
```

Response:

```
200 OK
Content-Type: audio/wav   (or audio/mpeg, audio/ogg)
<raw audio bytes>
```

Non-2xx responses surface the body in the error message.

## Reference wrapper (Python, ~25 lines)

Save as `tools/piper-server/server.py` (parallel to the chatterbox-server),
install Piper + Flask, point `voices/` at downloaded ONNX models, run.

```python
# requirements: piper-tts, flask
from flask import Flask, request, Response
from piper import PiperVoice
import io, wave, os

VOICES_DIR = os.environ.get("PIPER_VOICES_DIR", "./voices")
DEFAULT_VOICE = os.environ.get("PIPER_DEFAULT_VOICE", "en_US-amy-low")

# Lazy-load each voice once.
_voices: dict[str, PiperVoice] = {}
def load(voice_id: str) -> PiperVoice:
    if voice_id not in _voices:
        onnx = os.path.join(VOICES_DIR, f"{voice_id}.onnx")
        _voices[voice_id] = PiperVoice.load(onnx)
    return _voices[voice_id]

app = Flask(__name__)

@app.post("/tts")
def tts():
    body = request.get_json(force=True) or {}
    text = (body.get("text") or "").strip()
    voice_id = body.get("voice") or DEFAULT_VOICE
    if not text:
        return ("text required", 400)
    voice = load(voice_id)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        voice.synthesize(text, wav)
    return Response(buf.getvalue(), mimetype="audio/wav")

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050)
```

Run:

```bash
pip install piper-tts flask
mkdir voices && cd voices
# Download a voice + its config (see https://huggingface.co/rhasspy/piper-voices)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx.json
cd ..
python server.py
```

Then in `server/.env`:

```
PIPER_URL=http://127.0.0.1:5050/tts
PIPER_VOICE=en_US-amy-low
```

Hit `POST /api/tts/piper` (no auth changes — Piper is ungated since it
costs the operator nothing) or pick it in the Voice Lab compare panel.

## Capabilities

| Capability        | Piper | Notes |
|-------------------|-------|-------|
| Word timestamps   | ❌    | Caption sync uses orchestrator's forced-alignment fallback. |
| Char timestamps   | ❌    | |
| SSML              | ❌    | Plain text only. |
| Emotion controls  | ❌    | Voice quality varies per model. |
| Voice cloning     | ❌    | Fixed pre-trained voices. |
| Multilingual      | ✅    | 50+ voices across en, de, es, fr, it, nl, pl, pt, ru, sv, … |

## Voice picking

The 50+ official voices live at
[huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).
Each voice ships in 3 quality tiers — `low` / `medium` / `high`. `low` is
~22kHz mono and fast even on a Raspberry Pi; `high` is 22kHz with more
parameters and noticeably better prosody. For BibleFuel narration tracks,
`medium` is the usual sweet spot.

## Troubleshooting

- `PIPER_URL not configured` — the env var is empty/unset; provider's
  `isAvailable()` returns false so the orchestrator skips it cleanly.
- `Piper request failed: ECONNREFUSED` — the wrapper isn't running.
  Start it (`python server.py`) and curl `POST {url}` to confirm.
- `Piper returned empty audio` — wrapper accepted the request but
  returned a 0-byte body. Check the voice id matches a downloaded
  `.onnx` model.
- Slow first request — Piper lazy-loads the ONNX model on first synth
  per voice. Subsequent requests reuse the loaded model.
