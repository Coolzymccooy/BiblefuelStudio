import { list, listAvailable, get as getProvider } from "./registry.js";
import { SpeechRequestSchema } from "./schemas.js";

/**
 * Capability-aware provider selection.
 *
 * Ordering rules:
 *   1. If req.preferredProvider names an available provider, it goes first.
 *   2. If req.withTimestamps, providers whose capabilities expose char or word
 *      timestamps go before those that don't.
 *   3. Otherwise, registration order is preserved.
 *
 * @param {import("./types.js").SpeechRequest} req
 * @returns {import("./types.js").TTSProvider[]}
 */
function orderCandidates(req) {
  const available = listAvailable();
  if (available.length === 0) return [];

  const wantsTimestamps = Boolean(req.withTimestamps);
  const preferred = req.preferredProvider
    ? getProvider(req.preferredProvider)
    : undefined;
  const preferredAvailable = preferred && available.includes(preferred) ? preferred : null;

  const rest = available.filter((p) => p !== preferredAvailable);

  if (!wantsTimestamps) {
    return preferredAvailable ? [preferredAvailable, ...rest] : rest;
  }

  // Partition rest into timestamp-capable vs not, preserving registration order
  // within each partition.
  const timed = [];
  const untimed = [];
  for (const p of rest) {
    const caps = p.capabilities();
    if (caps.charTimestamps || caps.wordTimestamps) {
      timed.push(p);
    } else {
      untimed.push(p);
    }
  }

  const ordered = [];
  if (preferredAvailable) ordered.push(preferredAvailable);
  ordered.push(...timed, ...untimed);
  return ordered;
}

/**
 * Synthesize speech against the registered provider set, with automatic
 * fallback on provider error.
 *
 * @param {import("./types.js").SpeechRequest} req
 * @returns {Promise<import("./types.js").SpeechResult>}
 */
export async function synthesize(req) {
  const parsed = SpeechRequestSchema.parse(req);
  const candidates = orderCandidates(parsed);

  if (candidates.length === 0) {
    throw new Error(
      "No TTS provider available — set ELEVENLABS_API_KEY or enable Edge-TTS (EDGE_TTS_ENABLED=true)",
    );
  }

  /** @type {Array<{ provider: string, error: string }>} */
  const errors = [];

  for (const provider of candidates) {
    try {
      return await provider.synthesize(parsed);
    } catch (err) {
      const msg = String(err?.message || err);
      console.warn(`[TTS] ${provider.id} failed: ${msg}`);
      errors.push({ provider: provider.id, error: msg });
    }
  }

  const first = errors[0];
  throw new Error(
    `TTS pipeline failed. First failure (${first.provider}): ${first.error}`,
  );
}

/**
 * Mirror of the legacy describeTtsProviders() — walks the registry and
 * reports `available` plus a `priority` derived from registration order.
 *
 * @returns {Record<string, { available: boolean, priority: number }>}
 */
export function describeProviders() {
  const out = {};
  list().forEach((p, i) => {
    out[p.id] = {
      available: (() => {
        try {
          return Boolean(p.isAvailable());
        } catch {
          return false;
        }
      })(),
      priority: i + 1,
    };
  });
  return out;
}
