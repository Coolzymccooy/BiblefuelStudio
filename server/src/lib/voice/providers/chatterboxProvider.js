import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import fetch from "node-fetch";

import { OUTPUT_DIR } from "../../paths.js";

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

export const chatterboxProvider = {
  id: "chatterbox",

  isAvailable() {
    return Boolean(getChatterboxUrl());
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

    return {
      ok: true,
      file: outFile.replace(/\\/g, "/"),
      provider: "chatterbox",
      voice: audioPromptPath ? path.basename(audioPromptPath) : "default",
    };
  },
};
