import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { edgeSynthesize } from "./edgeTtsClient.js";
import { OUTPUT_DIR } from "./paths.js";
import { addMp3HeaderInPlace } from "./mp3Header.js";

const DEFAULT_EDGE_VOICE = "en-US-AriaNeural";
const EDGE_TTS_TIMEOUT_MS = 20_000;

const present = (value) => value !== undefined && value !== null && value !== "";

export function isEdgeTtsEnabled() {
  return (process.env.EDGE_TTS_ENABLED ?? "true").toLowerCase() !== "false";
}

export function defaultEdgeVoice() {
  const v = (process.env.EDGE_TTS_VOICE || DEFAULT_EDGE_VOICE).trim();
  return v.length > 0 ? v : DEFAULT_EDGE_VOICE;
}

/**
 * Generate a TTS MP3 via Microsoft Edge "Read Aloud" (see edgeTtsClient.js).
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

  const buffer = await edgeSynthesize({
    text: String(text),
    voice,
    rate: present(rate) ? rate : undefined,
    pitch: present(pitch) ? pitch : undefined,
    volume: present(volume) ? volume : undefined,
    timeoutMs: EDGE_TTS_TIMEOUT_MS,
  });
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
}
