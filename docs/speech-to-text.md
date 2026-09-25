# Speech to text: what runs, and why local Whisper doesn't

**Decision (2026-09-22): OpenAI `whisper-1` stays the transcriber for all
paths. Local Whisper remains available but is not the default.**

## The short version

`server/.env` sets `STT_PROVIDER=local-whisper` with a working local model, and
that setting is genuinely honoured — but only by two of the three transcription
paths. The one that matters most, Story Video, never consults it. Rather than
wire Story Video to a weaker model, we are standardising on OpenAI and keeping
local Whisper as a fallback that can be switched on deliberately.

## The three paths

| Path | Entry point | Transcriber | Honours `STT_PROVIDER`? |
|---|---|---|---|
| Story Video upload | `server/src/routes/story.js` → `transcribeStage` | `server/src/lib/voice/alignment.js` | **No** |
| Long-form voice note | `server/src/routes/longform.js` | `server/src/lib/stt/index.js` | Yes |
| `POST /api/transcribe` | `server/src/routes/transcribe.js` | `server/src/lib/stt/index.js` | Yes |

`lib/voice/alignment.js` calls OpenAI's `whisper-1` endpoint directly and never
reads `STT_PROVIDER`. It also owns the chunking and stitching that Story Video
depends on (`chunkAudioForTranscription`, `stitchTranscriptions`), which is why
that path grew its own transcriber rather than using the selector.

## Why we are not switching Story Video to local Whisper

1. **Accuracy is load-bearing here.** Story Video builds scenes from word
   timings: `sceneSegmenter` cuts scenes on word indices, and captions are
   drawn from the same words. Bad timings produce bad cuts — the 12-minute
   session that held one still image for ten minutes was a segmentation
   failure, and a weaker transcript makes that class of bug more likely.
2. **The configured model is the smallest one.** `Xenova/whisper-base` (q8) is
   the floor of the Whisper range. `whisper-small` would be the sensible
   minimum for sermon-length audio, and that is a bigger download and slower
   on CPU.
3. **The saving is small.** `whisper-1` is about $0.006/minute — roughly 7c for
   a 12-minute session. Image generation, not transcription, is the binding
   cost and quota constraint.
4. **CPU cost is real.** This box has no usable GPU for inference (the same
   reason Chatterbox TTS is slow here), so local Whisper competes with ffmpeg
   renders for the same cores.

Point 3 is the decisive one: we would be trading transcript quality — which
everything downstream depends on — for a few cents.

## If you do want local Whisper later

It works where it is wired in, and the model is present at
`C:/Users/segun/source/repos/lumina-presenter/models/Xenova/whisper-base`
(encoder + merged decoder, q8 — matching the `dtype: 'q8'` the code requests).

To make it govern Story Video too, `routes/story.js` would need to call the
selector in `lib/stt/index.js` instead of importing `transcribeAudio` from
`lib/voice/alignment.js`, keeping `chunkAudioForTranscription` and
`stitchTranscriptions` for the chunking either side of it. That is a deliberate
change with a quality trade-off, not a config flip.

Before doing it, raise the model: set
`LOCAL_WHISPER_MODEL_ID=Xenova/whisper-small` and download that model into the
same directory.

## Env files — a trap worth knowing

`server/index.js` loads **only** `server/.env`:

```js
dotenv.config({ path: path.join(__dirname, '.env') });
```

`server/.env.local` and the repo-root `.env.local` are **never read**. Both
currently hold copies of the same three STT settings, which is harmless only
because the values match `server/.env`. Edit those copies expecting an effect
and nothing will happen. Put real changes in `server/.env`.

## Defects fixed on 2026-09-22

The local provider had three faults that would have made it unreliable had it
been switched on:

1. **A silent hang.** `decodePcmFloat32` used `new Promise(async (resolve,
   reject) => …)`. An async executor swallows its own throw, so a failure
   before ffmpeg was wired up left the promise pending forever — the
   transcription hung instead of falling back. The dynamic import now happens
   outside the Promise.
2. **An empty result skipped the fallback.** `transcribeAudio` fell back to
   OpenAI only on a thrown error, so a model that produced zero words returned
   a null transcript that read as "this audio is silent". An empty result from
   a non-OpenAI provider is now treated the same as a failure.
3. **The model cache ignored its config.** A single module-level promise meant
   changing `LOCAL_WHISPER_MODEL_ID` had no effect until the process
   restarted. The cache is now keyed by model directory and model id, and a
   failed load is not cached.

Covered by `server/src/lib/stt/index.test.js` and
`server/src/lib/stt/localWhisper.test.js`.
