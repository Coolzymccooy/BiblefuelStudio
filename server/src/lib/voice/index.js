/**
 * Voice synthesis engine — public barrel.
 *
 * Importing this module has a SIDE EFFECT: it registers the built-in
 * providers (ElevenLabs first, Edge second) with the registry. Order
 * matters — it sets default priority.
 *
 * Consumers should import { synthesize, describeProviders } from here.
 * The TTSProvider interface and SpeechRequest/Result types are exposed
 * via JSDoc typedefs in ./types.js.
 */

import { register } from "./registry.js";
import { elevenLabsProvider } from "./providers/elevenLabsProvider.js";
import { edgeProvider } from "./providers/edgeProvider.js";
import { chatterboxProvider } from "./providers/chatterboxProvider.js";

register(elevenLabsProvider);
register(edgeProvider);
register(chatterboxProvider);

export { synthesize, describeProviders } from "./orchestrator.js";
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
} from "./schemas.js";
export {
  PROFILES,
  DEFAULT_CATEGORY,
  listCategories,
  resolveProfile,
} from "./profiles.js";
export { synthesizeForCategory } from "./categorySynthesis.js";
export {
  alignAudioWithText,
  isForcedAlignmentAvailable,
  wordsToCharAlignment,
} from "./alignment.js";
