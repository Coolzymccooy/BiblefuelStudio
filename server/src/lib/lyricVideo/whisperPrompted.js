// server/src/lib/lyricVideo/whisperPrompted.js
import fs from "node:fs";
import path from "node:path";

const URL_ = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 120_000;
const PROMPT_MAX = 900;

/** A word time, or NaN when Whisper sent something that is not one (null and "" would otherwise read as 0). */
const toTime = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

const envKey =() => (process.env.OPENAI_API_KEY || "").replace(/['"]/g, "").trim();

/** Whisper with a lyric prompt and word timestamps. Throws on failure, so the timing job can say why. */
export async function transcribePrompted(audioPath, prompt, { fetchImpl = fetch, apiKey = envKey() } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set on the server");
  const form = new FormData();
  form.set("file", new File([fs.readFileSync(audioPath)], path.basename(audioPath), { type: "audio/mp4" }));
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.set("language", "en");
  form.set("temperature", "0");
  form.set("prompt", String(prompt || "").slice(0, PROMPT_MAX));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchImpl(URL_, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
    if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    const j = await resp.json();
    const words = (Array.isArray(j.words) ? j.words : [])
      .map((w) => ({ word: String(w?.word ?? ""), start: toTime(w?.start), end: toTime(w?.end) }))
      .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
    return { words };
  } finally {
    clearTimeout(timer);
  }
}
