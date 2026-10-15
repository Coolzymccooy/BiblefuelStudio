import fs from "fs";
import path from "path";

/**
 * BytePlus ModelArk "Dreamina Seedance" video generation.
 *
 * A clip is made in three steps, kept apart so a server restart can collect a
 * paid-for task by its id instead of ordering it again:
 *   submitSeedanceTask    -> task id
 *   waitForSeedanceTask   -> the finished clip's URL and the tokens billed
 *   downloadSeedanceVideo -> the MP4 on disk (BytePlus links expire after 24 h)
 *
 * The API key never leaves this module: every message goes through redact().
 */

export const SEEDANCE_DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const SEEDANCE_MODELS = Object.freeze({
  mini: "dreamina-seedance-2-0-mini-260615",
  standard: "dreamina-seedance-2-0-260128",
});
// Measured 2026-10-16: 2 s and 16 s are refused, 4 s and 12 s accepted.
export const SEEDANCE_MIN_SEC = 4;
export const SEEDANCE_MAX_SEC = 12;
export const NO_TEXT_LINE = "No text, no captions, no logos.";

const RATIOS = Object.freeze({ portrait: "9:16", landscape: "16:9", square: "1:1" });
const IMAGE_MIME = Object.freeze({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" });
// BytePlus refuses a start frame that "may contain real person"; the scene
// is then made from its prompt alone.
const PERSON_REFUSAL = /^InputImageSensitiveContentDetected/;
const SENSITIVE = /SensitiveContent/;
const FAILED_STATES = new Set(["failed", "cancelled", "expired"]);
const MAX_FIRST_FRAME_BYTES = 10 * 1024 * 1024;

function apiKey() {
  return String(process.env.BYTEPLUS_ARK_API_KEY || "").trim();
}

function tasksUrl() {
  const base = String(process.env.BYTEPLUS_ARK_BASE_URL || SEEDANCE_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return `${base}/contents/generations/tasks`;
}

function headers() {
  return { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", Accept: "application/json" };
}

function redact(text) {
  const key = apiKey();
  const s = String(text ?? "");
  return key ? s.split(key).join("[redacted]") : s;
}

export function isSeedanceConfigured() {
  return apiKey() !== "";
}

export function seedanceRatio(aspect) {
  return RATIOS[aspect] || RATIOS.portrait;
}

export function clampSeedanceDuration(sec) {
  const whole = Math.ceil(Number(sec) || 0);
  return Math.min(SEEDANCE_MAX_SEC, Math.max(SEEDANCE_MIN_SEC, whole));
}

export function withNoText(prompt) {
  const p = String(prompt || "").trim();
  return p.includes(NO_TEXT_LINE) ? p : `${p} ${NO_TEXT_LINE}`.trim();
}

/** The scene's picture as a first-frame item, or null when it can't be sent. */
function firstFrameItem(file) {
  if (!file) return null;
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) return null;
  try {
    if (fs.statSync(file).size > MAX_FIRST_FRAME_BYTES) return null;
    const bytes = fs.readFileSync(file);
    return { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` }, role: "first_frame" };
  } catch {
    return null;
  }
}

/** BytePlus sends errors as { error: { code, message } } or flat { code, message }. */
function errorOf(json, status) {
  const e = json?.error && typeof json.error === "object" ? json.error : json || {};
  return { code: String(e.code || `HTTP_${status}`), message: redact(e.message || `Seedance HTTP ${status}`) };
}

function refusal(err) {
  if (SENSITIVE.test(err.code)) {
    return { ok: false, code: "REFUSED", error: "BytePlus declined this scene's prompt. Edit the prompt and try again." };
  }
  return { ok: false, code: err.code, error: err.message };
}

async function postTask(body, fetcher) {
  const res = await fetcher(tasksUrl(), { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && Boolean(json?.id), status: res.status, json };
}

export async function submitSeedanceTask({
  prompt, firstFramePath = null, aspect = "portrait", durationSec = 5,
  model = SEEDANCE_MODELS.mini, resolution = "720p", fetchImpl,
} = {}) {
  if (!isSeedanceConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", error: "AI video is not set up on this server (BYTEPLUS_ARK_API_KEY)." };
  }
  const text = withNoText(prompt);
  if (text === NO_TEXT_LINE) return { ok: false, code: "BAD_REQUEST", error: "A prompt is required." };
  const fetcher = fetchImpl || fetch;
  const base = {
    model, ratio: seedanceRatio(aspect), resolution, duration: clampSeedanceDuration(durationSec),
    generate_audio: false, watermark: false,
  };
  try {
    const frame = firstFrameItem(firstFramePath);
    if (frame) {
      const first = await postTask({ ...base, content: [{ type: "text", text }, frame] }, fetcher);
      if (first.ok) return { ok: true, taskId: first.json.id, mode: "image" };
      const err = errorOf(first.json, first.status);
      if (!PERSON_REFUSAL.test(err.code)) return refusal(err);
    }
    const plain = await postTask({ ...base, content: [{ type: "text", text }] }, fetcher);
    if (plain.ok) return { ok: true, taskId: plain.json.id, mode: "text" };
    return refusal(errorOf(plain.json, plain.status));
  } catch (e) {
    return { ok: false, code: "REQUEST_FAILED", error: redact(e?.message || e) };
  }
}

export async function getSeedanceTask(taskId, { fetchImpl } = {}) {
  const fetcher = fetchImpl || fetch;
  const res = await fetcher(`${tasksUrl()}/${encodeURIComponent(taskId)}`, { headers: headers() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = errorOf(json, res.status);
    return { status: "unknown", httpStatus: res.status, error: err.message };
  }
  return {
    status: String(json.status || "unknown"),
    videoUrl: json.content?.video_url || null,
    tokens: Number(json.usage?.completion_tokens) || 0,
    error: json.error ? redact(json.error.message || json.error.code || "failed") : null,
  };
}

export async function waitForSeedanceTask(taskId, {
  fetchImpl, pollMs = 10_000, timeoutMs = 15 * 60_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
} = {}) {
  const start = now();
  for (;;) {
    let task;
    try {
      task = await getSeedanceTask(taskId, { fetchImpl });
    } catch (e) {
      // A network blip is not a failed clip: keep polling until the limit.
      task = { status: "unknown", error: redact(e?.message || e) };
    }
    if (task.status === "succeeded") {
      if (!task.videoUrl) return { ok: false, code: "NO_VIDEO", error: "BytePlus finished the clip but sent no video." };
      return { ok: true, videoUrl: task.videoUrl, tokens: task.tokens };
    }
    if (FAILED_STATES.has(task.status)) {
      return { ok: false, code: "FAILED", error: task.error || `BytePlus reported the clip as ${task.status}.` };
    }
    if (task.httpStatus === 404) return { ok: false, code: "NOT_FOUND", error: "BytePlus no longer has this clip." };
    if (now() - start >= timeoutMs) return { ok: false, code: "TIMEOUT", error: "BytePlus took too long to make the clip." };
    await sleep(pollMs);
  }
}

export async function downloadSeedanceVideo(url, destFile, { fetchImpl } = {}) {
  const fetcher = fetchImpl || fetch;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Downloading the clip failed (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("The clip BytePlus sent was empty.");
  const tmp = `${destFile}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, destFile);
  return buf.length;
}
