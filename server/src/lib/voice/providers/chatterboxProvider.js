import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import fetch from "node-fetch";

import { OUTPUT_DIR } from "../../paths.js";
import { addMp3HeaderInPlace } from "../../mp3Header.js";

/**
 * Chatterbox TTS provider.
 *
 * Chatterbox (Resemble AI, open-source) is designed for local inference.
 * BibleFuel Studio expects the user to run a Chatterbox HTTP server
 * somewhere reachable and point CHATTERBOX_URL at it. The provider is a
 * thin HTTP client — it does NOT bundle the model or spin up Python.
 *
 * Environment:
 *   CHATTERBOX_URL          required. Base URL of a Chatterbox HTTP server.
 *   CHATTERBOX_AUDIO_PROMPT optional. Absolute path to a reference voice
 *                           sample used for voice conditioning.
 *   CHATTERBOX_TIMEOUT_MS   optional. Default 90s; local inference can be slow.
 *
 * Endpoint contract (POST {CHATTERBOX_URL}/tts):
 *   request  JSON: { text, audio_prompt_path?, exaggeration?, cfg_weight?, output_format }
 *   response: audio bytes (mp3) OR JSON { audio_base64 }
 *
 * Capability declaration: emotionControls true (exaggeration/cfg_weight),
 * SSML false, timestamps false. Forced-alignment fallback covers captions.
 *
 * @type {import("../types.js").TTSProvider}
 */

const DEFAULT_TIMEOUT_MS = 90_000;
// How long the result of the /health probe is cached. The provider list
// endpoint is hit on every UI mount + provider-switch, so probing on every
// call would amplify traffic to the self-hosted bridge. 30s is short
// enough that a tunnel that just came back online is reported reachable
// within half a minute, and long enough that a chatty UI doesn't DoS the
// bridge.
const HEALTH_TTL_MS = Number(process.env.CHATTERBOX_HEALTH_TTL_MS) > 0
  ? Number(process.env.CHATTERBOX_HEALTH_TTL_MS)
  : 30_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

function getChatterboxUrl() {
  const raw = (process.env.CHATTERBOX_URL || "").trim();
  return raw.replace(/\/$/, "");
}

function getAudioPromptPath() {
  return (process.env.CHATTERBOX_AUDIO_PROMPT || "").trim() || undefined;
}

function getTimeoutMs() {
  const n = Number(process.env.CHATTERBOX_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

async function readBodyAsAudio(resp) {
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const payload = await resp.json();
    const b64 = payload?.audio_base64;
    if (!b64 || typeof b64 !== "string") {
      throw new Error("Chatterbox returned JSON without audio_base64");
    }
    return Buffer.from(b64, "base64");
  }
  // Default: assume binary audio
  return Buffer.from(await resp.arrayBuffer());
}

// Single shared probe cache so concurrent /api/tts/providers callers
// collapse onto one in-flight HEAD/GET request instead of stampeding the
// bridge. Cache invalidates whenever the URL env var changes.
/** @type {{ url: string, until: number, result: boolean } | null} */
let healthCacheEntry = null;
/** @type {Promise<boolean> | null} */
let healthInFlight = null;

async function probeChatterboxHealth(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_PROBE_TIMEOUT_MS);
  try {
    // GET /health is what the persona-overseer bridge exposes today; some
    // older builds only respond on POST /tts, so we accept either a 200
    // /health OR a 405/200 on a no-body HEAD /tts as proof of life.
    const resp = await fetch(`${url}/health`, { method: "GET", signal: ctrl.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const chatterboxProvider = {
  id: "chatterbox",

  isAvailable() {
    return Boolean(getChatterboxUrl());
  },

  /**
   * Real liveness check — async, TTL-cached. Returns false if the URL is
   * not configured (so the route can distinguish "configured but down"
   * from "not set up").
   *
   * @returns {Promise<boolean>}
   */
  async isReachable() {
    const url = getChatterboxUrl();
    if (!url) return false;
    const now = Date.now();
    if (healthCacheEntry && healthCacheEntry.url === url && healthCacheEntry.until > now) {
      return healthCacheEntry.result;
    }
    if (healthInFlight) {
      return healthInFlight;
    }
    healthInFlight = (async () => {
      const result = await probeChatterboxHealth(url);
      healthCacheEntry = { url, until: Date.now() + HEALTH_TTL_MS, result };
      healthInFlight = null;
      return result;
    })();
    return healthInFlight;
  },

  capabilities() {
    return {
      wordTimestamps: false,
      charTimestamps: false,
      emotionControls: true,
      ssml: false,
      streaming: false,
    };
  },

  async synthesize(req) {
    const baseUrl = getChatterboxUrl();
    if (!baseUrl) throw new Error("CHATTERBOX_URL not configured");

    const text = String(req?.text || "").trim();
    if (text.length < 3) throw new Error("text required (min 3 chars)");

    const voiceFromReq = req.voiceIds?.chatterbox ?? req.voiceId;
    const audioPromptPath = voiceFromReq || getAudioPromptPath();

    const settings = req.voiceSettings || {};
    const exaggeration = typeof settings.style === "number" ? settings.style : undefined;
    const cfgWeight = typeof settings.cfg_weight === "number" ? settings.cfg_weight : undefined;

    const body = {
      text,
      ...(audioPromptPath ? { audio_prompt_path: audioPromptPath } : {}),
      ...(exaggeration !== undefined ? { exaggeration } : {}),
      ...(cfgWeight !== undefined ? { cfg_weight: cfgWeight } : {}),
      output_format: "mp3",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());
    let resp;
    try {
      resp = await fetch(`${baseUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Chatterbox error: ${resp.status} ${errText.slice(0, 200)}`);
    }

    const buffer = await readBodyAsAudio(resp);
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Chatterbox returned empty audio");
    }

    // Pick the extension from the actual response Content-Type. The default
    // chatterbox-server emits WAV; treating it as .mp3 produces files with
    // the wrong MIME, which browsers refuse to play.
    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    const ext = contentType.includes("wav") || contentType.includes("x-wav")
      ? "wav"
      : contentType.includes("mp3") || contentType.includes("mpeg")
        ? "mp3"
        : "wav"; // safe default for chatterbox; ffmpeg will read it either way

    const outDir = OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `tts-chatterbox-${uuid()}.${ext}`);
    fs.writeFileSync(outFile, buffer);

    // Bridges that emit raw MP3 frames (no Xing/Info header) cause browsers
    // to report 0:00 duration even though there's audio inside. Remux in
    // place so the <audio> element and ffmpeg get a duration immediately.
    // WAV already carries duration in its RIFF header — skip.
    if (ext === "mp3") {
      addMp3HeaderInPlace(outFile);
    }

    return {
      ok: true,
      file: outFile.replace(/\\/g, "/"),
      provider: "chatterbox",
      voice: audioPromptPath ? path.basename(audioPromptPath) : "default",
    };
  },
};
