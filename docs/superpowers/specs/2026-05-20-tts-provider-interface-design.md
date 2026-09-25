# TTS Provider Interface — Design

**Date:** 2026-05-20
**Branch:** `feat/tts-provider-interface`
**Status:** Approved (user-delegated)
**Project:** 1 of 5 (Voice Synthesis Engine roadmap)

## Goal

Refactor the existing ElevenLabs → Edge-TTS fallback chain behind a formal `TTSProvider` interface and a registry. **No new user-facing features.** All existing callers keep working unchanged.

This is the structural foundation for upcoming projects (voice profiles, category mapping, forced alignment, Chatterbox, settings UI).

## Non-Goals

- AI tone detection
- Voice profile system
- Category→provider mapping
- Forced alignment / whisper integration
- Chatterbox provider
- UI changes
- New HTTP routes
- Voice cloning changes (keep existing routes untouched)

## Constraints

- **Backward compatibility is absolute.** `synthesizeTts({ text, voiceId, withTimestamps })` must return the exact same shape it does today, including `result.alignment.{characters,starts,ends}` for ElevenLabs. Two callers depend on it: `server/src/routes/jobs.js:600` (kineticCaptions render) and `server/src/routes/jobs.js:879` (campaign render).
- Project is JavaScript ESM (`"type": "module"`). No TS migration in this project. Use JSDoc `@typedef` + Zod for runtime validation.
- No new runtime deps. `zod` and `node-fetch` already present.
- Use Node's built-in `node:test` runner (no Jest/Vitest install).

## Architecture

```
server/src/lib/voice/
  ├─ types.js                        JSDoc typedefs (TTSProvider, SpeechRequest, SpeechResult, ProviderCapabilities)
  ├─ schemas.js                      Zod schemas for SpeechRequest/SpeechResult (boundary validation)
  ├─ providers/
  │   ├─ elevenLabsProvider.js       Implements TTSProvider, wraps existing elevenLabsTts.js
  │   └─ edgeProvider.js             Implements TTSProvider, wraps existing edgeTts.js
  ├─ registry.js                     Provider registry: register/get/list/listAvailable
  ├─ orchestrator.js                 New synthesize() — capability-aware routing + fallback
  └─ index.js                        Barrel export

server/src/lib/ttsOrchestrator.js    KEPT. Becomes a thin shim over voice/orchestrator.js
                                     that reshapes new SpeechResult → legacy shape.

server/test/voice/                   New test directory using node:test
  ├─ registry.test.js
  ├─ orchestrator.test.js
  └─ schemas.test.js
```

### The Interface

```js
/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} wordTimestamps      Provider returns word-level alignment natively
 * @property {boolean} charTimestamps      Provider returns character-level alignment natively
 * @property {boolean} emotionControls     Provider accepts emotion/style parameters
 * @property {boolean} ssml                Provider accepts SSML markup
 * @property {boolean} streaming           Provider supports streaming audio
 *
 * @typedef {Object} SpeechRequest
 * @property {string} text
 * @property {string} [voiceId]
 * @property {boolean} [withTimestamps]
 * @property {Object} [voiceSettings]
 * @property {string} [modelId]
 * @property {Object} [prosody]            { rate, pitch, volume } — provider may ignore
 *
 * @typedef {Object} CharAlignment
 * @property {string[]} characters
 * @property {number[]} starts
 * @property {number[]} ends
 *
 * @typedef {Object} SpeechResult
 * @property {true} ok
 * @property {string} file                 Forward-slashed absolute path
 * @property {string} provider             Provider id (e.g. 'elevenlabs', 'edge')
 * @property {string} voice                Voice identifier used
 * @property {CharAlignment} [alignment]   Present only when provider supports it AND withTimestamps requested
 *
 * @typedef {Object} TTSProvider
 * @property {string} id
 * @property {() => boolean} isAvailable
 * @property {() => ProviderCapabilities} capabilities
 * @property {(req: SpeechRequest) => Promise<SpeechResult>} synthesize
 */
```

### Registry

In-memory map keyed by provider id. Providers self-register at module load via `registry.register(provider)`. Consumers call `registry.listAvailable()` to get the ordered list of currently-usable providers (priority is the registration order: ElevenLabs registers first, Edge second).

This is intentionally small. No DI container, no plugin loader. Future providers (Chatterbox) just import the registry and call `register()`.

### Orchestrator routing

```
function synthesize(req):
  validate req with Zod
  candidates = registry.listAvailable()
  if req.withTimestamps:
    prefer candidates with capabilities().charTimestamps OR .wordTimestamps
  for provider in candidates:
    try return await provider.synthesize(req)
    catch err: collect, continue
  throw aggregated error
```

This is functionally identical to today's fallback chain, except:
- Capability-aware ordering (when `withTimestamps` is requested, alignment-capable providers go first regardless of registration order — today this is implicit because ElevenLabs happens to be first).
- Pluggable: adding Chatterbox later is a single `register()` call.

### Backward-compatibility shim

`server/src/lib/ttsOrchestrator.js` keeps its public surface:

```js
export async function synthesizeTts(opts) { ... }
export function describeTtsProviders() { ... }
```

`synthesizeTts` translates the legacy options shape (`elevenLabsVoiceId`, `edgeVoiceId`, etc.) into a `SpeechRequest`, delegates to `voice/orchestrator.synthesize`, and returns the result as-is. Since the new `SpeechResult` schema is a strict superset of the legacy shape, no reshape is needed. The shim's job is purely the *input* mapping and exporting the legacy function names.

`describeTtsProviders` rebuilds its output by walking the registry, preserving the `{ elevenlabs: { available, priority }, edge: { ... } }` shape.

## Data Flow

```
caller (jobs.js, tts.js routes)
       │  legacy opts: { text, voiceId, elevenLabsVoiceId, withTimestamps, ... }
       ▼
ttsOrchestrator.js (shim)
       │  SpeechRequest
       ▼
voice/orchestrator.synthesize
       │  consults registry, picks candidate, calls provider.synthesize
       ▼
voice/providers/{elevenLabsProvider,edgeProvider}.synthesize
       │  delegates to existing synthesizeElevenLabs / synthesizeEdgeTts
       ▼
existing lib/elevenLabsTts.js or lib/edgeTts.js (unchanged)
       │  legacy result: { ok, file, provider, voice, alignment? }
       ▲
       │  passed back up
caller receives identical shape it gets today
```

## Error Handling

- Zod validation failure at `synthesize()` entry → throw with field path.
- Provider failure → log warning, try next provider, identical to today.
- All providers exhausted → throw aggregated error (`first failure (provider): msg`), identical to today.
- Unknown options passed to legacy shim → silently ignored (matches current behavior).

## Testing

Using `node:test` (built into Node 18+). No new dev dep.

`server/test/voice/registry.test.js`
- registers a fake provider, `get`/`list`/`listAvailable` work
- `listAvailable` filters out unavailable providers
- duplicate registration replaces existing entry

`server/test/voice/orchestrator.test.js`
- two fake providers, both available — first one wins
- first fails, second succeeds — returns second
- both fail — throws with first error
- `withTimestamps:true` — alignment-capable provider is preferred over earlier-registered non-capable one
- no providers available — throws clear error

`server/test/voice/schemas.test.js`
- SpeechRequest accepts minimal input
- SpeechRequest rejects empty text
- SpeechResult requires file + provider + voice

Real providers (ElevenLabs/Edge) are NOT tested here — they require live API keys / network. The existing manual smoke routes (`/api/tts/elevenlabs`, `/api/tts/edge`, `/api/tts/auto`) cover that.

Test script added to `server/package.json`:
```json
"test": "node --test test/voice/**/*.test.js"
```

## Migration Steps

1. Add `server/src/lib/voice/types.js` (JSDoc only, no runtime impact)
2. Add `server/src/lib/voice/schemas.js` (Zod)
3. Add `server/src/lib/voice/registry.js`
4. Add `server/src/lib/voice/providers/elevenLabsProvider.js`
5. Add `server/src/lib/voice/providers/edgeProvider.js`
6. Add `server/src/lib/voice/orchestrator.js`
7. Add `server/src/lib/voice/index.js` (barrel)
8. Rewrite body of `server/src/lib/ttsOrchestrator.js` to delegate (keep exports)
9. Add tests
10. Run tests, verify green
11. Commit

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Break `jobs.js` render pipeline | Shim preserves exact return shape; tested by orchestrator unit tests + existing manual smoke. |
| Provider registration order ambiguity | Order is explicit at registration site (`elevenLabsProvider` registers before `edgeProvider`). Tested. |
| Zod throws on legitimate inputs | Schema is permissive — only `text` is required; everything else optional. |
| Future Chatterbox plug-in friction | Interface is intentionally small; capability flags cover what's known to vary. |

## What Project 2+ Will Need (so we don't paint ourselves into a corner)

- A `VoiceProfile` concept that maps to provider-specific settings — interface already accepts `voiceSettings` and `prosody` as opaque objects, so profiles can be a higher layer.
- Forced alignment fallback — will be a post-processor that takes a `SpeechResult` lacking alignment and adds it. The capability flags + optional `alignment` field already support this.
- Provider selection by category — will be a layer above `orchestrator.synthesize` that picks a profile and a target provider before calling. Doesn't require changes to this project.

This is the minimum scaffolding that makes the next 4 projects additive rather than re-architecting.
