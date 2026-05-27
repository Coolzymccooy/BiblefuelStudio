/**
 * Voice synthesis engine — public barrel.
 *
 * Importing this module has a SIDE EFFECT: it registers the built-in
 * providers (ElevenLabs, Azure, Fish Audio, Edge, Chatterbox — in that order)
 * with the registry. Order matters — it sets default fallback priority.
 *
 * Consumers should import { synthesize, describeProviders } from here.
 * The TTSProvider interface and SpeechRequest/Result types are exposed
 * via JSDoc typedefs in ./types.js.
 */

import { register } from "./registry.js";
import { elevenLabsProvider } from "./providers/elevenLabsProvider.js";
import { azureSpeechProvider } from "./providers/azureSpeechProvider.js";
import { fishAudioProvider } from "./providers/fishAudioProvider.js";
import { edgeProvider } from "./providers/edgeProvider.js";
import { chatterboxProvider } from "./providers/chatterboxProvider.js";

// Registration order = default fallback priority. ElevenLabs (flagship premium)
// stays the default for plain renders; Azure (kinetic-caption / word-timestamp
// primary) is next, then Fish (premium alternative), then the free / self-hosted
// tail (Edge, Chatterbox). When withTimestamps is requested the orchestrator
// promotes word-timestamp providers (Azure) ahead of char-timestamp ones
// (ElevenLabs). Unavailable providers self-filter via isAvailable().
register(elevenLabsProvider);
register(azureSpeechProvider);
register(fishAudioProvider);
register(edgeProvider);
register(chatterboxProvider);

export { synthesize, describeProviders, describeProvidersAsync } from "./orchestrator.js";
export {
  register,
  get,
  list,
  listAvailable,
  _reset,
} from "./registry.js";
export {
  SpeechRequestSchema,
  SpeechResultSchema,
  ProviderCapabilitiesSchema,
  WordTimingSchema,
} from "./schemas.js";
export {
  charAlignmentToWords,
  toAlignmentContract,
} from "./alignmentContract.js";
export {
  PROFILES,
  DEFAULT_CATEGORY,
  listCategories,
  resolveProfile,
} from "./profiles.js";
export { synthesizeForCategory } from "./categorySynthesis.js";
export { prepareScriptureForSpeech, numberToWords } from "./scripture.js";
export {
  alignAudioWithText,
  isForcedAlignmentAvailable,
  wordsToCharAlignment,
} from "./alignment.js";
