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
// Errors that will not clear by waiting (bad key, forbidden, malformed request).
const PERMANENT_HTTP = new Set([400, 401, 403]);
const MAX_FIRST_FRAME_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCES = 4;
const MAX_SEED = 2147483647;
const BAD_REFERENCE = Object.freeze({
  ok: false, code: "BAD_REFERENCE", error: "A character picture could not be read. Make the portrait again.",
});
const BAD_FIRST_FRAME = Object.freeze({
  ok: false, code: "BAD_FIRST_FRAME", error: "The starting picture for this shot could not be read. Make the shot before it again.",
});
const PERSON_REFUSED = Object.freeze({
  ok: false, code: "PERSON_REFUSED", error: "BytePlus thinks this picture shows a real person. Make a new picture for this shot.",
});

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

/** A picture as an image item with the given role, or null when it can't be sent. */
function imageItem(file, role) {
  if (!file) return null;
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) return null;
  try {
    if (fs.statSync(file).size > MAX_FIRST_FRAME_BYTES) return null;
    const bytes = fs.readFileSync(file);
    return { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` }, role };
  } catch {
    return null;
  }
}

/** The scene's picture as a first-frame item, or null when it can't be sent. */
function firstFrameItem(file) {
  return imageItem(file, "first_frame");
}

/** Every reference picture as an item, or null when any one can't be sent (never drop a face quietly). */
function referenceItems(files) {
  const items = [];
  for (const file of (Array.isArray(files) ? files : []).slice(0, MAX_REFERENCES)) {
    const item = imageItem(file, "reference_image");
    if (!item) return null;
    items.push(item);
  }
  return items;
}

/** A seed BytePlus will take, or null so the key is left out. */
function validSeed(seed) {
  return Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED ? seed : null;
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

/**
 * framePrompt, when given, is what goes with the first frame instead of
 * prompt. Describing a picture again makes Seedance "correct" it to match the
 * words (hands clasped behind a man's back, drawn through his body), so the
 * picture gets motion-only words. prompt still drives the text-only fallback.
 *
 * Cartoon options, each sent only when used so every other caller's request
 * body stays as it was:
 *   generateAudio        the clip speaks the quoted lines
 *   referenceImagePaths  up to 4 character pictures sent as reference_image
 *                        items (after the first frame, if any); one that
 *                        can't be read is BAD_REFERENCE, never dropped
 *   seed                 an integer 1..2147483647, else ignored
 *   allowTextFallback    false: a "real person" refusal of the first frame or
 *                        the references is PERSON_REFUSED after one POST,
 *                        instead of a text-only clip with a different face;
 *                        an unreadable firstFramePath is then BAD_FIRST_FRAME
 *                        (no POST) rather than a quiet text-only request
 */
export async function submitSeedanceTask({
  prompt, framePrompt = null, firstFramePath = null, aspect = "portrait", durationSec = 5,
  model = SEEDANCE_MODELS.mini, resolution = "720p", fetchImpl,
  generateAudio = false, allowTextFallback = true, referenceImagePaths = [], seed = null,
} = {}) {
  if (!isSeedanceConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", error: "AI video is not set up on this server (BYTEPLUS_ARK_API_KEY)." };
  }
  const text = withNoText(prompt);
  if (text === NO_TEXT_LINE) return { ok: false, code: "BAD_REQUEST", error: "A prompt is required." };
  const frameText = String(framePrompt || "").trim() ? withNoText(framePrompt) : text;
  const fetcher = fetchImpl || fetch;
  const base = {
    model, ratio: seedanceRatio(aspect), resolution, duration: clampSeedanceDuration(durationSec),
    generate_audio: generateAudio === true, watermark: false,
    ...(validSeed(seed) === null ? {} : { seed: validSeed(seed) }),
  };
  try {
    const refs = referenceItems(referenceImagePaths);
    if (refs === null) return { ...BAD_REFERENCE };
    const frame = firstFrameItem(firstFramePath);
    if (!frame && firstFramePath && !allowTextFallback) return { ...BAD_FIRST_FRAME };
    const pictures = [...(frame ? [frame] : []), ...refs];
    if (pictures.length > 0) {
      const withPictures = [{ type: "text", text: frame ? frameText : text }, ...pictures];
      const first = await postTask({ ...base, content: withPictures }, fetcher);
      if (first.ok) return { ok: true, taskId: first.json.id, mode: "image" };
      const err = errorOf(first.json, first.status);
      if (!PERSON_REFUSAL.test(err.code)) return refusal(err);
      if (!allowTextFallback) return { ...PERSON_REFUSED };
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
  let res;
  try {
    res = await fetcher(`${tasksUrl()}/${encodeURIComponent(taskId)}`, { headers: headers() });
  } catch (e) {
    return { status: "unknown", error: redact(e?.message || e) };
  }
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
  let lastError = "";
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
    if (PERMANENT_HTTP.has(task.httpStatus)) {
      return { ok: false, code: `HTTP_${task.httpStatus}`, error: task.error || `BytePlus refused the request (HTTP ${task.httpStatus}).` };
    }
    if (task.error) lastError = task.error;
    if (now() - start >= timeoutMs) {
      const detail = lastError ? ` (last error: ${lastError})` : "";
      return { ok: false, code: "TIMEOUT", error: `BytePlus took too long to make the clip.${detail}` };
    }
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
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, destFile);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return buf.length;
}
