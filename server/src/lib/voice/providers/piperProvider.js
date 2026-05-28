import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

import { OUTPUT_DIR } from "../../paths.js";
import { synthesizeWithPiper as defaultSynthImpl } from "./piperClient.js";

/**
 * Piper TTS provider — fast local neural TTS (rhasspy/piper), positioned as
 * the free local fallback in the priority chain (slot 4, after Azure /
 * ElevenLabs / Fish). No API key, no per-character cost; the operator runs
 * a tiny HTTP wrapper around the Piper CLI/ONNX library and points
 * PIPER_URL at it. See docs/PIPER_SETUP.md for the wrapper contract and a
 * reference implementation.
 *
 * Capabilities are intentionally minimal — Piper is bare TTS, no native
 * timestamps, no SSML, no emotion controls. Word-level kinetic captions
 * over Piper audio ride the orchestrator's forced-alignment fallback
 * (alignAudioWithText) when withTimestamps is requested.
 *
 * The HTTP call lives behind an injectable seam (_setSynthImpl) so the
 * format-detection / file-write / SpeechResult mapping is unit-tested
 * without a running Piper service.
 *
 * Environment:
 *   PIPER_URL          required for isAvailable. Full POST endpoint URL.
 *   PIPER_VOICE        optional default voice id, e.g. "en_US-amy-low".
 *   PIPER_TIMEOUT_MS   optional, see piperClient.js.
 *
 * @type {import("../types.js").TTSProvider}
 */

let _synthImpl = defaultSynthImpl;

/** Test-only. Substitute the synth implementation. */
export function _setSynthImpl(fn) {
  _synthImpl = typeof fn === "function" ? fn : defaultSynthImpl;
}

/** Test-only. Restore the real synth implementation. */
export function _resetSynthImpl() {
  _synthImpl = defaultSynthImpl;
}

function getUrl() {
  return (process.env.PIPER_URL || "").trim();
}

function getDefaultVoice() {
  const v = (process.env.PIPER_VOICE || "").trim();
  return v.length > 0 ? v : undefined;
}

/** Map response Content-Type to an audio extension. Falls back to .wav. */
function extFromContentType(ct) {
  const c = String(ct || "").toLowerCase();
  if (c.includes("wav")) return ".wav";
  if (c.includes("mpeg") || c.includes("mp3")) return ".mp3";
  if (c.includes("ogg") || c.includes("opus")) return ".ogg";
  return ".wav";
}

export const piperProvider = {
  id: "piper",

  isAvailable() {
    return getUrl().length > 0;
  },

  capabilities() {
    return {
      wordTimestamps: false,
      charTimestamps: false,
      emotionControls: false,
      ssml: false,
      streaming: false,
      voiceClone: false,
      multilingual: true,
    };
  },

  async synthesize(req) {
    const text = String(req?.text || "").trim();
    if (text.length < 3) throw new Error("text required (min 3 chars)");
    if (!getUrl()) throw new Error("PIPER_URL not configured");

    const voice = req.voiceIds?.piper ?? req.voiceId ?? getDefaultVoice();

    const { audio, contentType } = await _synthImpl({ text, voice });
    if (!audio || audio.byteLength === 0) {
      throw new Error("Piper returned empty audio");
    }

    // OUTPUT_DIR is read each call so tests can override via env before import.
    const outDir = process.env.OUTPUT_DIR || OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const ext = extFromContentType(contentType);
    const outFile = path.join(outDir, `tts-piper-${uuid()}${ext}`);
    fs.writeFileSync(outFile, audio);

    return {
      ok: true,
      file: outFile.replace(/\\/g, "/"),
      provider: "piper",
      voice: voice || "default",
    };
  },
};
