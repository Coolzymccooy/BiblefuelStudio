import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { OUTPUT_DIR } from "./paths.js";

export function getElevenLabsApiKey() {
  const rawKey = process.env.ELEVENLABS_API_KEY || "";
  return rawKey.replace(/['"]/g, "").trim();
}

export function isElevenLabsConfigured() {
  const key = getElevenLabsApiKey();
  return Boolean(key) && !key.startsWith("your-");
}

export function defaultElevenLabsVoiceId() {
  return String(process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL").trim();
}

/**
 * Synthesize speech via ElevenLabs. Throws on any failure (caller is expected
 * to catch and decide whether to fall back to another provider).
 *
 * @param {{ text: string, voiceId?: string, voiceSettings?: { stability?: number, similarity_boost?: number }, modelId?: string }} opts
 * @returns {Promise<{ ok: true, file: string, provider: 'elevenlabs', voice: string }>}
 */
export async function synthesizeElevenLabs({ text, voiceId, voiceSettings, modelId } = {}) {
  if (!isElevenLabsConfigured()) {
    throw new Error("ELEVENLABS_API_KEY missing or invalid");
  }
  if (!text || String(text).trim().length < 3) {
    throw new Error("text required (min 3 chars)");
  }
  const apiKey = getElevenLabsApiKey();
  const resolvedVoiceId = String(voiceId || defaultElevenLabsVoiceId()).trim();
  if (!resolvedVoiceId) throw new Error("voiceId missing");

  const outDir = OUTPUT_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `tts-${uuid()}.mp3`);

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId || "eleven_multilingual_v2",
      voice_settings: {
        stability: voiceSettings?.stability ?? 0.5,
        similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs error: ${resp.status} ${errText.slice(0, 500)}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("ElevenLabs returned empty audio");
  }
  fs.writeFileSync(outFile, buffer);
  console.log(`[TTS] ElevenLabs MP3 saved to ${outFile} (${buffer.byteLength} bytes)`);
  return {
    ok: true,
    file: outFile.replace(/\\/g, "/"),
    provider: "elevenlabs",
    voice: resolvedVoiceId,
  };
}
