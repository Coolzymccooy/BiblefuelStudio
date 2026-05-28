/**
 * Thin HTTP client for a local Piper TTS wrapper.
 *
 * Piper (https://github.com/rhasspy/piper) is a fast neural TTS shipped as
 * a CLI / ONNX library — not an HTTP service. The provider therefore speaks
 * to whatever lightweight HTTP wrapper the operator runs locally; we ship
 * docs (docs/PIPER_SETUP.md) describing the expected contract and a
 * reference Python wrapper.
 *
 * Wrapper contract:
 *   POST {PIPER_URL}
 *   headers: Content-Type: application/json
 *   body:    { "text": "...", "voice": "en_US-amy-low" (optional) }
 *
 *   200 OK
 *   Content-Type: audio/wav | audio/mpeg | audio/ogg
 *   body:        raw audio bytes (mono PCM wav is Piper's native output)
 *
 *   non-2xx → text body is surfaced in the thrown error.
 *
 * The provider preserves whatever format the wrapper returns — wav by
 * default. Caption rendering / playback handle both wav and mp3 natively.
 *
 * Environment:
 *   PIPER_URL          required. Full POST endpoint URL (no trailing slash
 *                      normalisation — pass the exact path).
 *   PIPER_TIMEOUT_MS   optional. Default 30s. Piper is fast (<1s typical
 *                      for a short sentence on modern CPUs).
 */
import fetch from "node-fetch";

const DEFAULT_TIMEOUT_MS = 30_000;

function getTimeoutMs() {
  const n = Number(process.env.PIPER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * @param {{ text: string, voice?: string }} args
 * @returns {Promise<{ audio: Buffer, contentType: string }>}
 */
export async function synthesizeWithPiper({ text, voice }) {
  const url = (process.env.PIPER_URL || "").trim();
  if (!url) throw new Error("PIPER_URL not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Piper request timed out after ${getTimeoutMs()}ms`);
    }
    throw new Error(`Piper request failed: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Piper error: ${resp.status} ${errText.slice(0, 200)}`);
  }

  const contentType = (resp.headers.get("content-type") || "audio/wav").toLowerCase();
  const audio = Buffer.from(await resp.arrayBuffer());
  if (!audio || audio.byteLength === 0) {
    throw new Error("Piper returned empty audio");
  }
  return { audio, contentType };
}
