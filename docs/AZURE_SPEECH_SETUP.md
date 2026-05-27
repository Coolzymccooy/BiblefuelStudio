# Azure Speech TTS — Setup

Azure Speech is BibleFuel Studio's **primary kinetic-caption / timestamp
provider**. It emits native **WordBoundary** events during synthesis, giving
reliable word-level timings that feed the kinetic typography renderer. It is
production-safe for commercial use and has a generous free tier.

It plugs into the existing voice engine (`server/src/lib/voice/`) as a
registered provider.

## Why Azure is the timestamp primary

The orchestrator ranks providers by timestamp capability when a render asks for
`withTimestamps`. **Word-level** timestamps (Azure) beat **char-level**
(ElevenLabs / Whisper forced-alignment), so caption renders auto-route to Azure
— while plain premium-voice renders still default to ElevenLabs. No caller
changes required; just request timestamps.

## 1. Create an Azure Speech resource

1. In the [Azure portal](https://portal.azure.com), create a **Speech service**
   resource (Cognitive Services → Speech).
2. Copy **Key 1** and the **Region** (e.g. `eastus`).

## 2. Install the SDK

Already added to `server/package.json`:

```bash
npm install microsoft-cognitiveservices-speech-sdk
```

(The provider imports it lazily — the app still boots without it; synthesis
just errors until it's installed.)

## 3. Configure environment

Add to `server/.env` (see `server/.env.example`):

```bash
AZURE_SPEECH_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=en-US-GuyNeural               # optional default voice
AZURE_SPEECH_OUTPUT_FORMAT=Audio24Khz48KBitRateMonoMp3  # optional
AZURE_SPEECH_TIMEOUT_MS=60000                    # optional
```

- The key is treated as **unset** if empty or a `your-...` placeholder, so the
  provider stays disabled until both key and region are present.
- Secrets stay server-side.

## 4. Usage

### Caption render (gets word timings)

```bash
curl -X POST http://localhost:PORT/api/tts/azure \
  -H "Authorization: Bearer <your-app-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "text": "For God so loved the world.", "voiceId": "en-US-GuyNeural", "withTimestamps": true }'
```

Response includes the normalized word-alignment contract:

```json
{
  "ok": true,
  "file": "/abs/path/outputs/tts-azure-<uuid>.mp3",
  "provider": "azure",
  "voice": "en-US-GuyNeural",
  "words": [
    { "text": "For", "startMs": 0,   "endMs": 180 },
    { "text": "God", "startMs": 180, "endMs": 420 }
  ]
}
```

### Programmatically (auto-routes to Azure for captions)

```js
import { synthesize, toAlignmentContract } from "../lib/voice/index.js";

const result = await synthesize({ text, withTimestamps: true }); // word-capable provider wins
const { audioPath, words } = toAlignmentContract(result);        // provider-agnostic captions
```

## The unified alignment contract

All providers normalize into one shape so the typography renderer is
provider-agnostic:

```ts
{ audioPath: string, words: Array<{ text: string, startMs: number, endMs: number }> }
```

Use `toAlignmentContract(result)` (exported from `voice/`) to get it from any
result: Azure's `words` pass through natively; ElevenLabs/Whisper char-level
alignment is grouped into words; providers without timings yield an empty
`words[]` (audio still renders, captions degrade gracefully).

## Capabilities

`wordTimestamps` ✓, `ssml` ✓, `emotionControls` ✓ (Azure SSML styles),
`multilingual` ✓. `voiceClone` ✗, `streaming` ✗ (in-memory buffer mode).

## Voices

Azure offers 400+ neural voices across 140+ locales. Browse with the
[Voice Gallery](https://speech.microsoft.com/portal/voicegallery) and set
`AZURE_SPEECH_VOICE` or pass `voiceId` per request (e.g. `en-US-GuyNeural`,
`en-US-JennyNeural`, `en-GB-RyanNeural`).

## Troubleshooting

| Error                                          | Cause / fix |
| ---------------------------------------------- | ----------- |
| `AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured` | Key/region missing or placeholder. |
| `microsoft-cognitiveservices-speech-sdk is not installed` | Run the npm install above. |
| `Azure synthesis failed: AuthenticationFailure` | Wrong key/region pairing. |
| `Azure synthesis timed out`                    | Raise `AZURE_SPEECH_TIMEOUT_MS` / check connectivity. |
| `Azure returned empty audio`                   | Voice name invalid for the region, or empty text. |
