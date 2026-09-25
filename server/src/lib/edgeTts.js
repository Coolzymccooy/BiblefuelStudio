import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { OUTPUT_DIR } from "./paths.js";
import { addMp3HeaderInPlace } from "./mp3Header.js";

const DEFAULT_EDGE_VOICE = "en-US-AriaNeural";
const EDGE_TTS_TIMEOUT_MS = 20_000;

export function isEdgeTtsEnabled() {
  return (process.env.EDGE_TTS_ENABLED ?? "true").toLowerCase() !== "false";
}

export function defaultEdgeVoice() {
  const v = (process.env.EDGE_TTS_VOICE || DEFAULT_EDGE_VOICE).trim();
  return v.length > 0 ? v : DEFAULT_EDGE_VOICE;
}

export function collectStream(stream, timeoutMs = EDGE_TTS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      stream.removeAllListeners();
      reject(new Error(`edge-tts stream timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Generate a TTS MP3 via Microsoft Edge "Read Aloud" (msedge-tts).
 * Same return shape as the ElevenLabs route: { ok, file, provider, voice }.
 *
 * @param {{ text: string, voiceId?: string, rate?: string, pitch?: string, volume?: string }} opts
 * @returns {Promise<{ ok: true, file: string, provider: 'edge', voice: string }>}
 */
export async function synthesizeEdgeTts({ text, voiceId, rate, pitch, volume }) {
  if (!isEdgeTtsEnabled()) {
    throw new Error("Edge-TTS disabled (EDGE_TTS_ENABLED=false)");
  }
  if (!text || String(text).trim().length < 3) {
    throw new Error("text required (min 3 chars)");
  }
  const voice = String(voiceId || defaultEdgeVoice()).trim();

  const outDir = OUTPUT_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `tts-edge-${uuid()}.mp3`);

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const prosody = {};
    if (rate !== undefined && rate !== null && rate !== "") prosody.rate = rate;
    if (pitch !== undefined && pitch !== null && pitch !== "") prosody.pitch = pitch;
    if (volume !== undefined && volume !== null && volume !== "") prosody.volume = volume;

    const { audioStream } = Object.keys(prosody).length > 0
      ? tts.toStream(String(text), prosody)
      : tts.toStream(String(text));

    const buffer = await collectStream(audioStream, EDGE_TTS_TIMEOUT_MS);
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Edge-TTS returned empty audio");
    }
    fs.writeFileSync(outFile, buffer);
    const remuxed = addMp3HeaderInPlace(outFile);
    const finalSize = fs.existsSync(outFile) ? fs.statSync(outFile).size : buffer.byteLength;
    console.log(
      `[TTS] Edge MP3 saved to ${outFile} (${finalSize} bytes, voice=${voice}` +
      `${remuxed ? ", remuxed for duration header" : ""})`
    );
    return { ok: true, file: outFile.replace(/\\/g, "/"), provider: "edge", voice };
  } finally {
    try { tts.close(); } catch { /* best-effort */ }
  }
}
