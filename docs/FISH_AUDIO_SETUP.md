# Fish Audio TTS — Setup

Fish Audio is a premium cloud text-to-speech provider, positioned in BibleFuel
Studio as the **premium alternative to ElevenLabs** for cinematic scripture
narration. It is expressive, multilingual, and supports voice cloning via
reference voice models.

It plugs into the existing voice synthesis engine
(`server/src/lib/voice/`) as a registered provider — no separate service to run.

## 1. Get an API key

1. Create an account at <https://fish.audio>.
2. Open the developer dashboard and create an API key.
3. (Optional) Find or create a **voice model** and copy its `reference_id` —
   this is how you select a voice. Fish does not use free-form voice names.

## 2. Configure environment

Add to `server/.env` (see `server/.env.example`):

```bash
FISH_API_KEY=fk_live_xxxxxxxxxxxxxxxx
FISH_API_BASE_URL=https://api.fish.audio   # default; override only for a proxy
FISH_DEFAULT_MODEL=s1                       # s1 (default) or s2-pro
FISH_DEFAULT_REFERENCE_ID=                  # optional fallback voice-model id
FISH_TIMEOUT_MS=60000                       # optional request timeout
```

- The key is treated as **unset** if it's empty or a `your-...` placeholder, so
  the provider stays disabled until a real key is present.
- Secrets stay server-side. The key is never sent to the frontend.

## 3. Plan gating

Fish costs credits, so it's gated like ElevenLabs: only `premium` and
`super_admin` plans may call it. Free users get a `403 FEATURE_LOCKED` and
should use Edge-TTS or Chatterbox. (See `server/src/routes/tts.js`.)

## 4. Usage

### Via the API

```bash
curl -X POST http://localhost:PORT/api/tts/fish \
  -H "Authorization: Bearer <your-app-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
        "text": "Be still, and know that I am God.",
        "voiceId": "<fish-reference-id>",
        "speed": 0.9
      }'
```

Response (shared shape across all providers):

```json
{ "ok": true, "file": "/abs/path/outputs/tts-fish-<uuid>.mp3", "provider": "fish", "voice": "<fish-reference-id>" }
```

- `voiceId` → Fish `reference_id`. Omit it to use `FISH_DEFAULT_REFERENCE_ID`.
- `speed` (0.5–2.0) → Fish `prosody.speed`.
- `modelId` → overrides the `model` header (`s1` / `s2-pro`).
- If Fish fails or is unavailable, the orchestrator transparently falls back to
  the next available provider; `result.provider` reports what actually ran.

### Programmatically

```js
import { synthesize } from "../lib/voice/index.js";

const result = await synthesize({
  text: "For God so loved the world...",
  voiceIds: { fish: "<reference-id>" },
  preferredProvider: "fish",
});
```

## How it maps to the engine

| Engine field            | Fish `/v1/tts`        |
| ----------------------- | --------------------- |
| `text`                  | `text`                |
| `voiceIds.fish`/`voiceId` | `reference_id`      |
| `modelId` / `FISH_DEFAULT_MODEL` | `model` header |
| `voiceSettings.speed`   | `prosody.speed`       |
| (always)                | `format: "mp3"`, `mp3_bitrate: 128` |

**Capabilities:** `emotionControls`, `streaming`, `multilingual`, `voiceClone`
all true; native timestamps false (caption sync uses the orchestrator's
Whisper forced-alignment fallback).

## API reference

The provider targets `POST https://api.fish.audio/v1/tts` with
`Authorization: Bearer`, a `model` header, and a JSON body. The `/v1/tts`
endpoint accepts `application/json`; MessagePack is only required for inline
zero-shot cloning (raw audio bytes), which this provider does not use.

- Docs: <https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech>

## Troubleshooting

| Error                                             | Cause / fix |
| ------------------------------------------------- | ----------- |
| `FISH_API_KEY not configured`                     | Key missing or still a `your-...` placeholder. |
| `Fish Audio authentication failed (401)`          | Bad/revoked key. |
| `Fish Audio payment required (402)`               | Out of credits — top up your Fish account. |
| `Fish Audio rate limited (429)`                   | Too many requests — retry with backoff. |
| `Fish Audio rejected the request (422)`           | Invalid `reference_id` / model / params. |
| `403 FEATURE_LOCKED`                              | Plan isn't premium/super_admin. |
| `Fish Audio request timed out`                    | Raise `FISH_TIMEOUT_MS` or check connectivity. |
