import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { downloadPublicUrl } from "../lib/safeDownload.js";
import { MAX_INPUT_MB } from "../lib/backgroundLimits.js";

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
const IMPORT_TIMEOUT_MS = Number(process.env.IMPORT_URL_TIMEOUT_MS || 10 * 60_000);

const GUARD_STATUS = { URL_SCHEME: 400, URL_PRIVATE: 400, URL_REDIRECTS: 400, URL_TOO_LARGE: 413, URL_TIMEOUT: 504 };
const GUARD_MESSAGE = {
  URL_SCHEME: "Only http and https URLs can be imported.",
  URL_PRIVATE: "That address is not a public internet host, so it cannot be imported.",
  URL_REDIRECTS: "That URL redirected too many times.",
  URL_TOO_LARGE: `That file is larger than the ${MAX_INPUT_MB}MB import limit.`,
  URL_TIMEOUT: "download timed out",
};

let downloader = downloadPublicUrl;
/** Test seam: replace the network download. */
export function _setDownloader(fn) { downloader = fn; }
export function _resetDownloader() { downloader = downloadPublicUrl; }

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
 * }} deps
 */
export function createImportUrlHandler(deps) {
  const { processReceivedAudio, audioMimeToExt, videoMimeToExt, startVideoProxyGeneration, finaliseImageFile } = deps;

  const extensionFor = (kind, contentType, hint) => {
    if (kind === "audio") return audioMimeToExt(contentType, hint);
    if (kind === "video") return videoMimeToExt(contentType, hint);
    return IMAGE_EXT_BY_MIME[contentType] || hint || "jpg";
  };

  return async function importUrl(req, res) {
    let partFile = "";
    let outFile = "";
    try {
      const input = validateInput(req.body);
      if (input.error) return res.status(400).json({ ok: false, error: input.error, message: input.message });

      const outDir = req.ctx.outputDir;
      fs.mkdirSync(outDir, { recursive: true });
      partFile = path.join(outDir, `import-url-${uuid()}.part`);

      let download;
      try {
        download = await downloader(input.url, partFile, {
          maxBytes: MAX_INPUT_MB * 1024 * 1024,
          timeoutMs: IMPORT_TIMEOUT_MS,
        });
      } catch (err) {
        removeQuietly(partFile);
        return sendDownloadError(res, err, input.url);
      }

      // The extension depends on the response's content type, which is only
      // known now, so the file is renamed from its .part name to its final one.
      const { kind } = input;
      const ext = extensionFor(kind, download.contentType, input.extHint);
      const prefix = { audio: "user-audio", video: "source-video", image: "bg-image" }[kind];
      outFile = path.join(outDir, `${prefix}-${uuid()}.${ext}`);
      fs.renameSync(partFile, outFile);

      if (kind === "audio") {
        const mime = download.contentType.startsWith("audio/") ? download.contentType : `audio/${ext}`;
        return processReceivedAudio(outFile, ext, mime, res);
      }
      if (kind === "video") {
        const mime = download.contentType.startsWith("video/") ? download.contentType : `video/${ext}`;
        const proxy = startVideoProxyGeneration(outFile);
        return res.json({ ok: true, file: slashed(outFile), mime, proxyPath: proxy.proxyPath, proxyStatus: proxy.status });
      }
      const image = await finaliseImageFile(outFile);
      if (!image.ok) {
        removeQuietly(outFile);
        return res.status(400).json({ ok: false, error: image.error });
      }
      return res.json({ ok: true, file: slashed(image.file), mime: image.mime, kind: "image" });
    } catch (err) {
      // Express 4 does not catch a rejected handler promise, so nothing may escape.
      if (partFile) removeQuietly(partFile);
      if (outFile) removeQuietly(outFile);
      if (res.headersSent) return undefined;
      return res.status(500).json({ ok: false, error: "IMPORT_FAILED", message: String(err?.message || err) });
    }
  };
}
