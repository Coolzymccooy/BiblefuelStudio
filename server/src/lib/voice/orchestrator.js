import { list, listAvailable, get as getProvider } from "./registry.js";
import { SpeechRequestSchema } from "./schemas.js";
import { alignAudioWithText, isForcedAlignmentAvailable } from "./alignment.js";

// Indirection so tests can substitute the alignment implementation without
// touching the public synthesize() signature. Production code path is
// unchanged — the default impl is the real Whisper-backed function.
let _alignImpl = alignAudioWithText;
let _isAlignmentAvailableImpl = isForcedAlignmentAvailable;

/** Test-only. */
export function _setAlignmentImpl(fn, isAvailableFn) {
  _alignImpl = typeof fn === "function" ? fn : alignAudioWithText;
  _isAlignmentAvailableImpl = typeof isAvailableFn === "function" ? isAvailableFn : isForcedAlignmentAvailable;
}

/** Test-only. */
export function _resetAlignmentImpl() {
  _alignImpl = alignAudioWithText;
  _isAlignmentAvailableImpl = isForcedAlignmentAvailable;
}

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

  // Partition rest by timestamp capability, preserving registration order
  // within each partition. Word-level boundaries beat char-level for kinetic
  // typography (cleaner per-word reveal), so word-capable providers (Azure)
  // rank ahead of char-only providers (ElevenLabs/Whisper), which in turn
  // rank ahead of providers with no native timestamps.
  const wordTimed = [];
  const charTimed = [];
  const untimed = [];
  for (const p of rest) {
    const caps = p.capabilities();
    if (caps.wordTimestamps) {
      wordTimed.push(p);
    } else if (caps.charTimestamps) {
      charTimed.push(p);
    } else {
      untimed.push(p);
    }
  }

  const ordered = [];
  if (preferredAvailable) ordered.push(preferredAvailable);
  ordered.push(...wordTimed, ...charTimed, ...untimed);
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

  /** @type {import("./types.js").SpeechResult | null} */
  let result = null;

  for (const provider of candidates) {
    try {
      result = await provider.synthesize(parsed);
      break;
    } catch (err) {
      const msg = String(err?.message || err);
      console.warn(`[TTS] ${provider.id} failed: ${msg}`);
      errors.push({ provider: provider.id, error: msg });
    }
  }

  if (!result) {
    const first = errors[0];
    throw new Error(
      `TTS pipeline failed. First failure (${first.provider}): ${first.error}`,
    );
  }

  // Forced-alignment post-processor. Opt-in via forcedAlignmentFallback.
  // Only runs when the caller wants timestamps AND the chosen provider
  // didn't supply any. Failure is non-fatal — audio still ships.
  if (parsed.withTimestamps && parsed.forcedAlignmentFallback && !result.alignment) {
    if (!_isAlignmentAvailableImpl()) {
      console.warn(
        `[TTS] forcedAlignmentFallback requested but OPENAI_API_KEY not configured — skipping`,
      );
    } else {
      const alignment = await _alignImpl(result.file, parsed.text);
      if (alignment) {
        result = { ...result, alignment, alignmentSource: "whisper" };
      }
    }
  }

  return result;
}

/**
 * Mirror of the legacy describeTtsProviders() — walks the registry and
 * reports `available` plus a `priority` derived from registration order.
 *
 * `available` here = "configured to attempt synthesis" (env vars set,
 * library installed). For self-hosted bridges that may be temporarily
 * unreachable, callers should use describeProvidersAsync() which awaits an
 * optional `isReachable()` per provider for a real liveness check.
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

/**
 * Like describeProviders(), but awaits each provider's optional
 * `isReachable()` so the UI can distinguish "configured" from "actually
 * responding right now". Providers without `isReachable()` fall through to
 * `isAvailable()` (same answer as describeProviders).
 *
 * Each provider's `isReachable()` is responsible for its own caching (a
 * cold HEAD/GET on every UI poll would amplify load on a self-hosted
 * bridge). The orchestrator just awaits whatever the provider returns.
 *
 * @returns {Promise<Record<string, { available: boolean, reachable?: boolean, priority: number }>>}
 */
export async function describeProvidersAsync() {
  const providers = list();
  const results = await Promise.all(providers.map(async (p) => {
    let available = false;
    try {
      available = Boolean(p.isAvailable());
    } catch {
      available = false;
    }
    let reachable;
    if (available && typeof p.isReachable === "function") {
      try {
        reachable = Boolean(await p.isReachable());
      } catch {
        reachable = false;
      }
    }
    return { id: p.id, available, reachable };
  }));
  const out = {};
  results.forEach((r, i) => {
    out[r.id] = {
      available: r.available,
      ...(r.reachable === undefined ? {} : { reachable: r.reachable }),
      priority: i + 1,
    };
  });
  return out;
}
