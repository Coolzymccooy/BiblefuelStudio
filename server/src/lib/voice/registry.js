import { ProviderCapabilitiesSchema } from "./schemas.js";

/**
 * Provider registry — ordered map keyed by provider id.
 *
 * Order matters: it's the default priority when the orchestrator picks a
 * candidate. ElevenLabs registers first (premium), Edge registers second
 * (fallback). Future providers (Chatterbox) decide where they slot in at
 * their own registration call site.
 *
 * In-memory only. No persistence. The registry is created at module load
 * and providers register themselves via voice/index.js side-effects.
 */

/** @type {Map<string, import("./types.js").TTSProvider>} */
const providers = new Map();

/**
 * @param {import("./types.js").TTSProvider} provider
 */
export function register(provider) {
  if (!provider || typeof provider !== "object") {
    throw new Error("registry.register: provider must be an object");
  }
  if (typeof provider.id !== "string" || provider.id.length === 0) {
    throw new Error("registry.register: provider.id required");
  }
  if (typeof provider.isAvailable !== "function") {
    throw new Error(`registry.register(${provider.id}): isAvailable() required`);
  }
  if (typeof provider.capabilities !== "function") {
    throw new Error(`registry.register(${provider.id}): capabilities() required`);
  }
  if (typeof provider.synthesize !== "function") {
    throw new Error(`registry.register(${provider.id}): synthesize() required`);
  }

  // Validate the capabilities shape up-front so misconfigured providers fail
  // at registration rather than mid-render.
  try {
    ProviderCapabilitiesSchema.parse(provider.capabilities());
  } catch (err) {
    throw new Error(
      `registry.register(${provider.id}): invalid capabilities — ${err?.message || err}`,
    );
  }

  providers.set(provider.id, provider);
}

/**
 * @param {string} id
 * @returns {import("./types.js").TTSProvider | undefined}
 */
export function get(id) {
  return providers.get(id);
}

/**
 * @returns {import("./types.js").TTSProvider[]} in registration order
 */
export function list() {
  return Array.from(providers.values());
}

/**
 * @returns {import("./types.js").TTSProvider[]} only providers whose isAvailable() returns true, in registration order
 */
export function listAvailable() {
  return list().filter((p) => {
    try {
      return Boolean(p.isAvailable());
    } catch {
      return false;
    }
  });
}

/** Test-only. Drops all registrations. */
export function _reset() {
  providers.clear();
}
