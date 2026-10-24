import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { downloadPublicUrl } from "../lib/safeDownload.js";
import { MAX_INPUT_MB } from "../lib/backgroundLimits.js";
import { hasDiskHeadroomForUpload } from "../lib/diskHeadroom.js";

/**
 * POST /api/media/import-url — pull a file from a public URL into outputDir and
 * answer exactly like the matching upload route. Mounted by media.js, which
 * injects its helpers (so this file never imports media.js).
 */

const KINDS = new Set(["audio", "video", "image"]);
const MAX_URL_LENGTH = 2048;
const MAX_FILENAME_LENGTH = 200;
const IMAGE_EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Overall deadline for one import; a 200 MB file needs minutes, not the lib's 60 s default.
const DEFAULT_IMPORT_TIMEOUT_MS = 10 * 60_000;

/** IMPORT_URL_TIMEOUT_MS when it is a finite positive number, else the default. */
export function importTimeoutMs(raw = process.env.IMPORT_URL_TIMEOUT_MS) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_IMPORT_TIMEOUT_MS;
}
const IMPORT_TIMEOUT_MS = importTimeoutMs();

const GUARD_STATUS = { URL_SCHEME: 400, URL_PRIVATE: 400, URL_REDIRECTS: 400, URL_TOO_LARGE: 413, URL_TIMEOUT: 504 };
const GUARD_MESSAGE = {
  URL_SCHEME: "Only http and https URLs can be imported.",
  URL_PRIVATE: "That address is not a public internet host, so it cannot be imported.",
  URL_REDIRECTS: "That URL redirected too many times.",
  URL_TOO_LARGE: `That file is larger than the ${MAX_INPUT_MB}MB import limit.`,
  URL_TIMEOUT: "download timed out",
};

// Extensions an import may land under, per kind. Anything else (an .html hint
// with an audio content type, say) is refused: /outputs serves these files.
const ALLOWED_EXT = {
  audio: new Set(["mp3", "wav", "m4a", "aac", "ogg", "webm", "flac", "opus"]),
  video: new Set(["mp4", "mov", "webm", "mkv", "m4v"]),
  image: new Set(["jpg", "png", "webp", "gif"]),
};

// At most this many imports may be downloading at once for one user.
const MAX_IN_FLIGHT_PER_USER = 2;
const inFlight = new Map();

let downloader = downloadPublicUrl;
/** Test seam: replace the network download. */
export function _setDownloader(fn) { downloader = fn; }
export function _resetDownloader() { downloader = downloadPublicUrl; }

let headroomCheck = hasDiskHeadroomForUpload;
/** Test seam: replace the free-disk check. */
export function _setHeadroomCheck(fn) { headroomCheck = fn; }
export function _resetHeadroomCheck() { headroomCheck = hasDiskHeadroomForUpload; }

function acquireSlot(userId) {
  const used = inFlight.get(userId) || 0;
  if (used >= MAX_IN_FLIGHT_PER_USER) return false;
  inFlight.set(userId, used + 1);
  return true;
}

function releaseSlot(userId) {
  const left = (inFlight.get(userId) || 1) - 1;
  if (left > 0) inFlight.set(userId, left);
  else inFlight.delete(userId);
}

const sendDiskFull = (res, headroom) => res.status(507).json({
  ok: false,
  error: "DISK_FULL",
  message: headroom?.error || "Not enough disk space to import this file.",
});

const sendUnsupported = (res, kind) => res.status(400).json({
  ok: false,
  error: "UNSUPPORTED_TYPE",
  message: `That file is not a supported ${kind} format.`,
});

const safeExt = (value) => {
  const ext = path.extname(String(value || "")).slice(1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "";
};

/** Last path segment only: the filename is an extension hint, never a path. */
const baseName = (value) => String(value || "").split(/[\\/]/).pop();

function urlExtension(url) {
  try { return safeExt(new URL(url).pathname); } catch { return ""; }
}

function validateInput(body) {
  const { url, filename } = body || {};
  const kind = body?.kind === undefined ? "audio" : body.kind;
  if (typeof url !== "string" || !url.trim() || url.length > MAX_URL_LENGTH) {
    return { error: "INVALID_URL", message: `url must be a non-empty string up to ${MAX_URL_LENGTH} characters.` };
  }
  if (!KINDS.has(kind)) {
    return { error: "INVALID_KIND", message: "kind must be audio, video or image." };
  }
  if (filename !== undefined && (typeof filename !== "string" || filename.length > MAX_FILENAME_LENGTH)) {
    return { error: "INVALID_FILENAME", message: `filename must be a string up to ${MAX_FILENAME_LENGTH} characters.` };
  }
  return { url: url.trim(), kind, extHint: safeExt(baseName(filename)) || urlExtension(url.trim()) };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function sendDownloadError(res, err, url) {
  const code = String(err?.message || "");
  if (GUARD_STATUS[code]) {
    return res.status(GUARD_STATUS[code]).json({ ok: false, error: code, message: GUARD_MESSAGE[code] });
  }
  // The raw network error stays server-side: echoing it would let a caller probe internal ports.
  console.warn("[media] import-url failed", { host: hostOf(url), code: err?.code || code.slice(0, 80) });
  return res.status(502).json({ ok: false, error: "DOWNLOAD_FAILED", message: "could not download the file" });
}

const removeQuietly = (file) => { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } };
const slashed = (file) => file.replace(/\\/g, "/");

/**
 * @param {{
 *   processReceivedAudio: (file: string, ext: string, mime: string, res: object) => unknown,
 *   audioMimeToExt: (mime: string, hint: string) => string,
 *   videoMimeToExt: (mime: string, hint: string) => string,
 *   startVideoProxyGeneration: (file: string) => { proxyPath: string, status: string },
 *   finaliseImageFile: (file: string) => Promise<{ ok: boolean, file?: string, mime?: string, error?: string }>,
 *   isPlayableVideo: (file: string) => boolean,
 * }} deps
 */
export function createImportUrlHandler(deps) {
  const {
    processReceivedAudio, audioMimeToExt, videoMimeToExt, startVideoProxyGeneration, finaliseImageFile, isPlayableVideo,
  } = deps;

  const extensionFor = (kind, contentType, hint) => {
    if (kind === "audio") return audioMimeToExt(contentType, hint);
    if (kind === "video") return videoMimeToExt(contentType, hint);
    const ext = IMAGE_EXT_BY_MIME[contentType] || hint || "jpg";
    return ext === "jpeg" ? "jpg" : ext;
  };

  /** Hand the renamed file to the kind's own finishing step and answer. */
  async function finish(kind, outFile, ext, contentType, res) {
    if (kind === "audio") {
      const mime = contentType.startsWith("audio/") ? contentType : `audio/${ext}`;
      return processReceivedAudio(outFile, ext, mime, res);
    }
    if (kind === "video") {
      if (!isPlayableVideo(outFile)) {
        removeQuietly(outFile);
        return sendUnsupported(res, kind);
      }
      const mime = contentType.startsWith("video/") ? contentType : `video/${ext}`;
      const proxy = startVideoProxyGeneration(outFile);
      return res.json({ ok: true, file: slashed(outFile), mime, proxyPath: proxy.proxyPath, proxyStatus: proxy.status });
    }
    const image = await finaliseImageFile(outFile);
    if (!image.ok) {
      removeQuietly(outFile);
      return res.status(400).json({ ok: false, error: image.error });
    }
    return res.json({ ok: true, file: slashed(image.file), mime: image.mime, kind: "image" });
  }

  async function runImport(input, outDir, res, files) {
    const before = headroomCheck(outDir, MAX_INPUT_MB * 1024 * 1024);
    if (!before.ok) return sendDiskFull(res, before);

    files.part = path.join(outDir, `import-url-${uuid()}.part`);
    let download;
    try {
      download = await downloader(input.url, files.part, {
        maxBytes: MAX_INPUT_MB * 1024 * 1024,
        timeoutMs: IMPORT_TIMEOUT_MS,
      });
    } catch (err) {
      removeQuietly(files.part);
      return sendDownloadError(res, err, input.url);
    }

    // The extension depends on the response's content type, which is only
    // known now, so the file is renamed from its .part name to its final one.
    const { kind } = input;
    const ext = extensionFor(kind, download.contentType, input.extHint);
    if (!ALLOWED_EXT[kind].has(ext)) {
      removeQuietly(files.part);
      return sendUnsupported(res, kind);
    }
    // Other writes may have landed while this one downloaded.
    const after = headroomCheck(outDir, download.bytes);
    if (!after.ok) {
      removeQuietly(files.part);
      return sendDiskFull(res, after);
    }
    const prefix = { audio: "user-audio", video: "source-video", image: "bg-image" }[kind];
    files.out = path.join(outDir, `${prefix}-${uuid()}.${ext}`);
    fs.renameSync(files.part, files.out);
    return finish(kind, files.out, ext, download.contentType, res);
  }

  return async function importUrl(req, res) {
    const files = { part: "", out: "" };
    const input = validateInput(req.body);
    if (input.error) return res.status(400).json({ ok: false, error: input.error, message: input.message });

    const userId = String(req.ctx?.userId || "");
    if (!acquireSlot(userId)) {
      return res.status(429).json({
        ok: false,
        error: "IMPORT_BUSY",
        message: "two imports are already running; wait for one to finish",
      });
    }
    try {
      const outDir = req.ctx.outputDir;
      fs.mkdirSync(outDir, { recursive: true });
      return await runImport(input, outDir, res, files);
    } catch (err) {
      // Express 4 does not catch a rejected handler promise, so nothing may escape.
      if (files.part) removeQuietly(files.part);
      if (files.out) removeQuietly(files.out);
      if (res.headersSent) return undefined;
      return res.status(500).json({ ok: false, error: "IMPORT_FAILED", message: String(err?.message || err) });
    } finally {
      releaseSlot(userId);
    }
  };
}
