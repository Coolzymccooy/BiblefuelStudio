/**
 * Thin Azure Speech SDK client — the unavoidable, network-coupled edge of the
 * Azure provider. Kept separate (and injected via the provider's _setSynthImpl
 * seam in tests) so the provider's mapping logic stays unit-testable without
 * the SDK installed or a network round-trip.
 *
 * The SDK is imported dynamically so this module loads even when
 * `microsoft-cognitiveservices-speech-sdk` isn't installed — the import only
 * fires when synthesis actually runs in production.
 *
 * Returns raw tick-based boundaries; the provider converts them to the
 * normalized millisecond word contract.
 *
 * Environment:
 *   AZURE_SPEECH_KEY            required (read by the provider's isAvailable too)
 *   AZURE_SPEECH_REGION         required, e.g. "eastus"
 *   AZURE_SPEECH_OUTPUT_FORMAT  optional SpeechSynthesisOutputFormat key,
 *                               default "Audio24Khz48KBitRateMonoMp3"
 *   AZURE_SPEECH_TIMEOUT_MS     optional, default 60000
 */

const DEFAULT_OUTPUT_FORMAT = "Audio24Khz48KBitRateMonoMp3";
const DEFAULT_TIMEOUT_MS = 60_000;

function getTimeoutMs() {
  const n = Number(process.env.AZURE_SPEECH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Normalize the SDK's numeric boundaryType enum to a stable string.
 * SpeechSynthesisBoundaryType: Word=0, Punctuation=1, Sentence=2.
 */
function normalizeBoundaryType(sdk, raw) {
  const T = sdk.SpeechSynthesisBoundaryType || {};
  if (raw === T.Word || raw === "Word" || raw === 0) return "Word";
  if (raw === T.Punctuation || raw === "Punctuation" || raw === 1) return "Punctuation";
  if (raw === T.Sentence || raw === "Sentence" || raw === 2) return "Sentence";
  return "Unknown";
}

/** Some SDK builds expose duration as a number of ticks, others as an object. */
function toTicks(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if (typeof v.ticks === "number") return v.ticks;
    if (typeof v.value === "number") return v.value;
  }
  return Number(v) || 0;
}

/**
 * @param {{ text: string, voice: string }} args
 * @returns {Promise<{ audio: Buffer, boundaries: Array<{ text: string, audioOffsetTicks: number, durationTicks: number, boundaryType: string }> }>}
 */
export async function synthesizeWithBoundaries({ text, voice }) {
  const key = (process.env.AZURE_SPEECH_KEY || "").replace(/['"]/g, "").trim();
  const region = (process.env.AZURE_SPEECH_REGION || "").trim();
  if (!key || !region) {
    throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured");
  }

  let sdk;
  try {
    sdk = await import("microsoft-cognitiveservices-speech-sdk");
  } catch {
    throw new Error(
      "microsoft-cognitiveservices-speech-sdk is not installed — run `npm i microsoft-cognitiveservices-speech-sdk`",
    );
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  const formatKey = (process.env.AZURE_SPEECH_OUTPUT_FORMAT || "").trim() || DEFAULT_OUTPUT_FORMAT;
  const format = sdk.SpeechSynthesisOutputFormat[formatKey];
  if (format !== undefined) speechConfig.speechSynthesisOutputFormat = format;
  if (voice) speechConfig.speechSynthesisVoiceName = voice;
  // Ask for sentence boundaries too; we filter to Word in the provider.
  speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestSentenceBoundary, "true");

  // null AudioConfig → keep audio in memory (result.audioData) instead of a speaker.
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

  /** @type {Array<{ text: string, audioOffsetTicks: number, durationTicks: number, boundaryType: string }>} */
  const boundaries = [];
  synthesizer.wordBoundary = (_s, e) => {
    boundaries.push({
      text: e.text,
      audioOffsetTicks: toTicks(e.audioOffset),
      durationTicks: toTicks(e.duration),
      boundaryType: normalizeBoundaryType(sdk, e.boundaryType),
    });
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { synthesizer.close(); } catch { /* best-effort */ }
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`Azure synthesis timed out after ${getTimeoutMs()}ms`))),
      getTimeoutMs(),
    );

    synthesizer.speakTextAsync(
      text,
      (result) => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          const audio = Buffer.from(result.audioData);
          finish(() => resolve({ audio, boundaries }));
        } else {
          const detail = result.errorDetails || `reason ${result.reason}`;
          finish(() => reject(new Error(`Azure synthesis failed: ${detail}`)));
        }
      },
      (err) => finish(() => reject(new Error(`Azure synthesis error: ${err}`))),
    );
  });
}
