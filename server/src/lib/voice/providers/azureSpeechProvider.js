import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

import { OUTPUT_DIR } from "../../paths.js";
import { addMp3HeaderInPlace } from "../../mp3Header.js";
import { synthesizeWithBoundaries as defaultSynthImpl } from "./azureSpeechClient.js";

/**
 * Azure Speech TTS provider — the primary kinetic-caption / timestamp engine.
 *
 * Azure emits WordBoundary events during synthesis, giving reliable, native
 * word-level timings. The orchestrator ranks word-timestamp providers ahead of
 * char-timestamp ones when withTimestamps is requested, so caption renders
 * route here; plain premium-voice renders still default to ElevenLabs.
 * Production-safe for commercial use.
 *
 * The actual SDK call lives behind an injectable seam (_setSynthImpl) so the
 * tick→ms mapping and word filtering are unit-tested without the SDK/network.
 *
 * Environment:
 *   AZURE_SPEECH_KEY            required. Treated as unset if empty/"your-...".
 *   AZURE_SPEECH_REGION         required, e.g. "eastus".
 *   AZURE_SPEECH_VOICE          optional default voice, e.g. "en-US-GuyNeural".
 *   AZURE_SPEECH_OUTPUT_FORMAT  optional (see azureSpeechClient.js).
 *   AZURE_SPEECH_TIMEOUT_MS     optional.
 *
 * @type {import("../types.js").TTSProvider}
 */

const DEFAULT_VOICE = "en-US-GuyNeural";

// Dependency seam — production uses the real SDK client; tests inject a fake.
let _synthImpl = defaultSynthImpl;

/** Test-only. Substitute the synth implementation. */
export function _setSynthImpl(fn) {
  _synthImpl = typeof fn === "function" ? fn : defaultSynthImpl;
}

/** Test-only. Restore the real synth implementation. */
export function _resetSynthImpl() {
  _synthImpl = defaultSynthImpl;
}

function getKey() {
  return (process.env.AZURE_SPEECH_KEY || "").replace(/['"]/g, "").trim();
}

function getRegion() {
  return (process.env.AZURE_SPEECH_REGION || "").trim();
}

function isKeyConfigured(key) {
  return key.length > 0 && !key.startsWith("your-");
}

function getDefaultVoice() {
  return (process.env.AZURE_SPEECH_VOICE || "").trim() || DEFAULT_VOICE;
}

/** 100ns ticks → milliseconds (10,000 ticks = 1ms). */
function ticksToMs(ticks) {
  return Math.round(Number(ticks || 0) / 10_000);
}

export const azureSpeechProvider = {
  id: "azure",

  isAvailable() {
    return isKeyConfigured(getKey()) && getRegion().length > 0;
  },

  capabilities() {
    return {
      wordTimestamps: true,
      charTimestamps: false,
      emotionControls: true,
      ssml: true,
      streaming: false,
      voiceClone: false,
      multilingual: true,
    };
  },

  async synthesize(req) {
    const text = String(req?.text || "").trim();
    if (text.length < 3) throw new Error("text required (min 3 chars)");

    if (!isKeyConfigured(getKey()) || !getRegion()) {
      throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured");
    }

    const voice = req.voiceIds?.azure ?? req.voiceId ?? getDefaultVoice();

    const { audio, boundaries } = await _synthImpl({ text, voice });
    if (!audio || audio.byteLength === 0) {
      throw new Error("Azure returned empty audio");
    }

    // Native word boundaries → normalized millisecond word timings. We keep
    // only Word boundaries (punctuation/sentence markers aren't spoken words).
    const words = (Array.isArray(boundaries) ? boundaries : [])
      .filter((b) => String(b?.boundaryType) === "Word")
      .map((b) => {
        const startMs = ticksToMs(b.audioOffsetTicks);
        return {
          text: String(b.text || ""),
          startMs,
          endMs: startMs + ticksToMs(b.durationTicks),
        };
      });

    const outDir = OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `tts-azure-${uuid()}.mp3`);
    fs.writeFileSync(outFile, audio);
    addMp3HeaderInPlace(outFile);

    return {
      ok: true,
      file: outFile.replace(/\\/g, "/"),
      provider: "azure",
      voice,
      words,
    };
  },
};
