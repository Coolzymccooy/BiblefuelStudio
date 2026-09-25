import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import fetch from "node-fetch";

import { OUTPUT_DIR } from "../../paths.js";
import { addMp3HeaderInPlace } from "../../mp3Header.js";

/**
 * Fish Audio TTS provider.
 *
 * Fish Audio (fish.audio) is a premium cloud TTS — expressive, multilingual,
 * supports voice cloning via reference models. Positioned as the premium
 * alternative to ElevenLabs for BibleFuel's cinematic narration.
 *
 * HTTP contract (verified against docs.fish.audio):
 *   POST {FISH_API_BASE_URL}/v1/tts
 *   headers: Authorization: Bearer <key>, model: s1|s2-pro, Content-Type: application/json
 *   body:    { text, reference_id?, format, mp3_bitrate, prosody?: { speed } }
 *   200:     audio stream (mp3 here)   401: auth   402: payment   422: validation
 *
 * The /v1/tts endpoint accepts plain JSON — msgpack is only required for
 * inline zero-shot cloning (raw audio bytes in `references`), which we don't
 * use. Voice selection is by `reference_id` (a Fish voice-model id), NOT a
 * free-form voice name.
 *
 * Environment:
 *   FISH_API_KEY              required. Bearer token. Treated as unset if it's
 *                             empty or a "your-..." placeholder.
 *   FISH_API_BASE_URL         optional. Default https://api.fish.audio
 *   FISH_DEFAULT_MODEL        optional. Default "s1". Sent as the `model` header.
 *   FISH_DEFAULT_REFERENCE_ID optional. Fallback voice-model id when the caller
 *                             doesn't supply one.
 *   FISH_TIMEOUT_MS           optional. Default 60s.
 *
 * Capabilities: expressive (emotionControls), multilingual, voiceClone,
 * streaming. No native timestamps — caption sync rides the orchestrator's
 * forced-alignment fallback.
 *
 * @type {import("../types.js").TTSProvider}
 */

const DEFAULT_BASE_URL = "https://api.fish.audio";
const DEFAULT_MODEL = "s1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MP3_BITRATE = 128;

function getApiKey() {
  return (process.env.FISH_API_KEY || "").replace(/['"]/g, "").trim();
}

/** Empty or an obvious placeholder counts as "not configured". */
function isKeyConfigured(key) {
  return key.length > 0 && !key.startsWith("your-");
}

function getBaseUrl() {
  const raw = (process.env.FISH_API_BASE_URL || DEFAULT_BASE_URL).trim();
  return (raw || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getDefaultModel() {
  const raw = (process.env.FISH_DEFAULT_MODEL || "").trim();
  return raw || DEFAULT_MODEL;
}

function getDefaultReferenceId() {
  return (process.env.FISH_DEFAULT_REFERENCE_ID || "").trim() || undefined;
}

function getTimeoutMs() {
  const n = Number(process.env.FISH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

export const fishAudioProvider = {
  id: "fish",

  isAvailable() {
    return isKeyConfigured(getApiKey());
  },

  /**
   * Diagnostic reason for the UI when isAvailable() returns false. For
   * self-hosted Fish setups (FISH_API_BASE_URL pointing at a local
   * instance), the local server may not require a real API key — but
   * isAvailable() still gates on FISH_API_KEY because the bearer header
   * is always sent. Setting FISH_API_KEY to any non-placeholder string
   * (e.g. "local") satisfies the check.
   */
  whyUnavailable() {
    const key = getApiKey();
    if (!key) {
      const base = getBaseUrl();
      const isLocal = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/i.test(base);
      return isLocal
        ? `FISH_API_KEY env var not set (local instance at ${base} — set FISH_API_KEY to any value, e.g. "local", to enable)`
        : "FISH_API_KEY env var not set";
    }
    if (key.startsWith("your-")) return "FISH_API_KEY still has the placeholder value (starts with 'your-')";
    return null;
  },

  capabilities() {
    return {
      wordTimestamps: false,
      charTimestamps: false,
      emotionControls: true,
      ssml: false,
      streaming: true,
      voiceClone: true,
      multilingual: true,
    };
  },

  async synthesize(req) {
    const text = String(req?.text || "").trim();
    if (text.length < 3) throw new Error("text required (min 3 chars)");

    const apiKey = getApiKey();
    if (!isKeyConfigured(apiKey)) throw new Error("FISH_API_KEY not configured");

    const referenceId = req.voiceIds?.fish ?? req.voiceId ?? getDefaultReferenceId();
    const model = (req.modelId && String(req.modelId).trim()) || getDefaultModel();
    const speed =
      typeof req.voiceSettings?.speed === "number" ? req.voiceSettings.speed : undefined;

    const body = {
      text,
      format: "mp3",
      mp3_bitrate: DEFAULT_MP3_BITRATE,
      ...(referenceId ? { reference_id: referenceId } : {}),
      ...(speed !== undefined ? { prosody: { speed } } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());
    let resp;
    try {
      resp = await fetch(`${getBaseUrl()}/v1/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          model,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Fish Audio request timed out after ${getTimeoutMs()}ms`);
      }
      throw new Error(`Fish Audio request failed: ${err?.message || err}`);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401) {
        throw new Error("Fish Audio authentication failed (401) — check FISH_API_KEY");
      }
      if (resp.status === 402) {
        throw new Error("Fish Audio payment required (402) — out of credits/quota");
      }
      if (resp.status === 429) {
        throw new Error("Fish Audio rate limited (429) — retry later");
      }
      if (resp.status === 422) {
        throw new Error(
          `Fish Audio rejected the request (422) — check voice/model: ${errText.slice(0, 200)}`,
        );
      }
      throw new Error(`Fish Audio error: ${resp.status} ${errText.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Fish Audio returned empty audio");
    }

    const outDir = OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `tts-fish-${uuid()}.mp3`);
    fs.writeFileSync(outFile, buffer);

    // Some MP3 streams arrive without a Xing/Info header, which makes the
    // HTML5 <audio> element report 0:00 duration. Remux in place (no-op if
    // ffmpeg is missing). WAV would skip this; Fish here always emits mp3.
    addMp3HeaderInPlace(outFile);

    return {
      ok: true,
      file: outFile.replace(/\\/g, "/"),
      provider: "fish",
      voice: referenceId || "default",
    };
  },
};
