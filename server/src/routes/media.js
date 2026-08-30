import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn, spawnSync } from "child_process";
import { validateTrimRequest } from "../lib/trimValidate.js";
import { generateVideoThumbnail } from "../lib/mediaThumb.js";
import {
  isFirebaseAdminEnabled,
  createResumableUploadSession,
  downloadUploadToLocal,
  deleteUploadObject,
  getUploadObjectSize,
  isOwnUploadPath,
} from "../lib/firebaseAdmin.js";

const router = Router();
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"]);
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function parseDataUrlPayload(dataUrl) {
  const value = String(dataUrl || "");
  if (!value) return { ok: false, error: "Invalid dataUrl" };

  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0) return { ok: false, error: "Invalid dataUrl" };

    const meta = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const isBase64 = /;base64/i.test(meta);
    const mime = (meta.split(";")[0] || "application/octet-stream").trim() || "application/octet-stream";

    if (isBase64) {
      return { ok: true, mime, b64: payload.replace(/\s+/g, "") };
    }

    try {
      const decoded = decodeURIComponent(payload);
      return { ok: true, mime, b64: Buffer.from(decoded, "utf8").toString("base64") };
    } catch {
      return { ok: false, error: "Invalid dataUrl" };
    }
  }

  if (value.startsWith("base64,")) {
    return { ok: true, mime: "application/octet-stream", b64: value.slice("base64,".length).replace(/\s+/g, "") };
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 0) {
    return { ok: true, mime: "application/octet-stream", b64: value.replace(/\s+/g, "") };
  }

  return { ok: false, error: "Invalid dataUrl" };
}

function probeDurationSec(filePath) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const result = spawnSync(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { encoding: "utf8" });

  if (result.status !== 0) return null;
  const value = Number(String(result.stdout || "").trim());
  return Number.isFinite(value) ? value : null;
}

function isPlayableAudio(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.size || stat.size < 1024) return false;
    const dur = probeDurationSec(filePath);
    if (dur == null) return false;
    return dur > 0.15;
  } catch {
    return false;
  }
}

const MB = 1024 * 1024;

function parsePositiveIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getUploadLimits() {
  const directMaxMb = parsePositiveIntEnv("DIRECT_UPLOAD_MAX_MB", 200);
  const directClientMaxMb = parsePositiveIntEnv("DIRECT_CLIENT_UPLOAD_MAX_MB", 90);
  const resumableMaxMb = parsePositiveIntEnv("RESUMABLE_UPLOAD_MAX_MB", 1024);
  const minFreeAfterUploadMb = parsePositiveIntEnv("MIN_FREE_AFTER_UPLOAD_MB", 1024);
  const directMaxBytes = directMaxMb * MB;
  const directClientMaxBytes = Math.min(directClientMaxMb, directMaxMb) * MB;
  const resumableMaxBytes = resumableMaxMb * MB;
  return {
    directMaxMb,
    directMaxBytes,
    directClientMaxMb: Math.floor(directClientMaxBytes / MB),
    directClientMaxBytes,
    resumableMaxMb,
    resumableMaxBytes,
    minFreeAfterUploadMb,
    minFreeAfterUploadBytes: minFreeAfterUploadMb * MB,
    allowsLargeFileBytes: (bytes) => Number(bytes) > 0 && Number(bytes) <= resumableMaxBytes,
  };
}

// Mirror the client-side fast path cap. Belt-and-braces: the raw stream
// path enforces it byte-by-byte and the base64 path checks the decoded length,
// so an oversized upload can never fill the disk regardless of transport.
const MAX_UPLOAD_BYTES = getUploadLimits().directMaxBytes;

// Ceiling for the resumable direct-to-GCS path. Defaults to 1GB so a 700MB
// source video can use the large-upload path when storage is configured.
const RESUMABLE_MAX_BYTES = getUploadLimits().resumableMaxBytes;

export function hasDiskHeadroomForUpload(outputDir, incomingBytes, opts = {}) {
  const size = Number(incomingBytes || 0);
  if (!Number.isFinite(size) || size <= 0) return { ok: true, availableBytes: null };
  const minFreeAfterBytes = opts.minFreeAfterBytes ?? getUploadLimits().minFreeAfterUploadBytes;
  const statfs = opts.statfs || fs.statfsSync?.bind(fs);
  if (!statfs) return { ok: true, availableBytes: null, warning: "Disk headroom check unavailable" };
  try {
    const probeDir = fs.existsSync(outputDir) ? outputDir : path.dirname(outputDir);
    const stat = statfs(probeDir);
    const availableBytes = Number(stat.bavail ?? stat.f_bavail ?? 0) * Number(stat.bsize ?? stat.f_bsize ?? 0);
    if (availableBytes > 0 && availableBytes - size < minFreeAfterBytes) {
      return {
        ok: false,
        availableBytes,
        requiredBytes: size + minFreeAfterBytes,
        error: `Not enough disk space to finalize this upload. Free ${(availableBytes / MB).toFixed(0)} MB; need at least ${((size + minFreeAfterBytes) / MB).toFixed(0)} MB including safety reserve.`,
      };
    }
    return { ok: true, availableBytes };
  } catch {
    return { ok: true, availableBytes: null, warning: "Disk headroom check failed" };
  }
}

// Audio container/codec → file extension. Pulled out of the route so the raw
// streaming path (mime from the request's Content-Type header) and the legacy
// base64 path (mime from the data-URL prefix) share one mapping.
export const audioMimeToExt = (mime, hint) => {
  const m = String(mime || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("wav") || m.includes("x-wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("x-m4a")) return "m4a";
  return hint || "bin";
};

/**
 * Land an uploaded payload on disk via either transport:
 *   - Raw binary body (Content-Type: application/octet-stream or any non-JSON):
 *     piped straight to disk → flat memory, no base64 inflation. This is the
 *     path the current client uses.
 *   - Legacy base64 JSON ({ dataUrl }): decoded in memory. Kept so an older
 *     cached bundle (or any not-yet-migrated caller) still works.
 *
 * Returns { ok, mime, bytes } or { ok:false, status, error }. On any failure
 * the partial file is removed so a rejected upload never leaves a stub behind.
 *
 * @param {import('express').Request} req
 * @param {string} destPath
 * @param {{ b64?: string|null, mime?: string }} [opts]
 */
export async function receiveUploadToFile(req, destPath, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  // Legacy base64 JSON path — express.json already populated req.body.
  if (opts.b64 != null) {
    const buf = Buffer.from(opts.b64 || "", "base64");
    if (buf.length > maxBytes) {
      return { ok: false, status: 413, error: "File exceeds the upload limit" };
    }
    if (!buf.length || buf.length < 128) {
      return { ok: false, status: 400, error: "Upload payload is empty or too small" };
    }
    try {
      fs.writeFileSync(destPath, buf);
    } catch (e) {
      return { ok: false, status: 500, error: `Failed to write upload: ${e?.message || e}` };
    }
    return { ok: true, mime: opts.mime || "application/octet-stream", bytes: buf.length };
  }

  // Raw streaming path.
  return await new Promise((resolve) => {
    let bytes = 0;
    let settled = false;
    const ws = fs.createWriteStream(destPath);

    const succeed = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // On failure the partial file must be removed AFTER the writer releases its
    // handle — unlinking while a piped chunk is still flushing would let the
    // write re-create the file. So tear down the stream, then unlink on close.
    const fail = (result) => {
      if (settled) return;
      settled = true;
      const cleanup = () => { try { fs.unlinkSync(destPath); } catch {} resolve(result); };
      if (ws.destroyed) return cleanup();
      ws.once("close", cleanup);
      ws.destroy();
    };

    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        try { req.unpipe(ws); } catch {}
        try { req.destroy(); } catch {}
        fail({ ok: false, status: 413, error: "File exceeds the upload limit" });
      }
    });
    req.on("error", () => fail({ ok: false, status: 400, error: "Upload stream error" }));
    ws.on("error", (e) => fail({ ok: false, status: 500, error: `Failed to write upload: ${e?.message || e}` }));
    ws.on("finish", () => {
      if (bytes < 128) {
        return fail({ ok: false, status: 400, error: "Upload payload is empty or too small" });
      }
      succeed({ ok: true, mime: String(req.headers["content-type"] || opts.mime || "application/octet-stream"), bytes });
    });
    req.pipe(ws);
  });
}

/**
 * Resolve the uploaded mime + base64 (legacy) for a request up front, so the
 * route can name the destination file with the right extension BEFORE writing.
 * For raw uploads the mime comes from the Content-Type header; for base64 from
 * the data-URL prefix.
 * @returns {{ ok:true, mime:string, b64:string|null } | { ok:false, error:string }}
 */
function resolveUploadMeta(req) {
  if (req.body && typeof req.body.dataUrl === "string" && req.body.dataUrl) {
    const parsed = parseDataUrlPayload(req.body.dataUrl);
    if (!parsed.ok) return { ok: false, error: parsed.error || "Invalid dataUrl" };
    return { ok: true, mime: parsed.mime || "application/octet-stream", b64: parsed.b64 || "" };
  }
  return { ok: true, mime: String(req.headers["content-type"] || "application/octet-stream"), b64: null };
}

function videoProxyPathFor(sourcePath) {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}-proxy.mp4`).replace(/\\/g, "/");
}

export function getVideoProxyStatus(proxyPath) {
  try {
    const stat = fs.statSync(proxyPath);
    if (stat.isFile() && stat.size > 1024) return { proxyPath: String(proxyPath).replace(/\\/g, "/"), status: "ready", size: stat.size };
  } catch {}
  return { proxyPath: String(proxyPath || '').replace(/\\/g, "/"), status: "pending" };
}

export function startVideoProxyGeneration(sourcePath, opts = {}) {
  const proxyPath = opts.proxyPath || videoProxyPathFor(sourcePath);
  const ffmpeg = opts.ffmpeg || process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const spawnImpl = opts.spawnImpl || spawn;
  const args = [
    "-y",
    "-i", sourcePath,
    "-vf", "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-r", "24",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "32",
    "-an",
    "-movflags", "+faststart",
    proxyPath,
  ];
  try {
    const proc = spawnImpl(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    proc.stderr?.on?.("data", (d) => { if (stderr.length < 4000) stderr += d.toString(); });
    proc.on?.("close", (code) => {
      if (code !== 0) console.warn(`[media] proxy generation failed for ${sourcePath}: ${stderr.slice(-500)}`);
    });
    proc.on?.("error", (err) => console.warn(`[media] proxy generation launch failed: ${err?.message || err}`));
    return { proxyPath, status: "pending" };
  } catch (error) {
    return { proxyPath, status: "failed", error: String(error?.message || error) };
  }
}

// Shared post-receive audio handling for BOTH the direct one-shot upload
// (/upload-audio) and the resumable path (/upload-finalize). Extracted verbatim
// so the two transports produce identical results: validate playability, return
// native formats as-is, transcode exotic containers to mp3. Writes the HTTP
// response (res.json) — the file it names is what the Story pipeline consumes.
function processReceivedAudio(rawFile, ext, mime, res) {
  if (!isPlayableAudio(rawFile)) {
    try { fs.unlinkSync(rawFile); } catch {}
    return res.status(400).json({ ok: false, error: "Uploaded audio is invalid or too short" });
  }

  // PART 2 — no up-front transcode for formats that are already both
  // browser-playable AND natively read by FFmpeg. Every downstream step
  // (transcribe, master, render, waveform) feeds the file through FFmpeg,
  // and <audio> plays these directly, so converting on upload only delayed
  // the response — a 25 MB m4a sermon spent that whole wait in libmp3lame.
  // We return immediately; conversion is no longer on the critical path.
  // (Exotic/uncommon containers below still convert so playback never fails.)
  const NATIVE_OK = new Set(["mp3", "wav", "m4a", "aac", "ogg", "webm"]);
  if (NATIVE_OK.has(ext)) {
    return res.json({ ok: true, file: rawFile.replace(/\\/g, "/"), mime });
  }

  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const mp3File = rawFile.replace(/\.[^.]+$/, ".mp3");
  const args = ["-y", "-i", rawFile, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "2", mp3File];

  const proc = spawn(ffmpeg, args);
  let stderr = "";
  proc.stderr.on("data", d => stderr += d.toString());
  proc.on("error", () => {
    if (res.headersSent) return;
    if (isPlayableAudio(rawFile)) {
      return res.json({
        ok: true,
        file: rawFile.replace(/\\/g, "/"),
        mime,
        warning: "ffmpeg unavailable; using raw file",
      });
    }
    return res.status(400).json({ ok: false, error: "Failed to convert/upload audio" });
  });

  proc.on("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0) {
      if (isPlayableAudio(rawFile)) {
        return res.json({
          ok: true,
          file: rawFile.replace(/\\/g, "/"),
          mime,
          warning: "ffmpeg conversion failed; using raw file",
          details: stderr.slice(-800),
        });
      }
      return res.status(400).json({
        ok: false,
        error: "Audio conversion failed and raw file is not playable",
        details: stderr.slice(-800),
      });
    }

    if (!isPlayableAudio(mp3File)) {
      if (isPlayableAudio(rawFile)) {
        return res.json({
          ok: true,
          file: rawFile.replace(/\\/g, "/"),
          mime,
          warning: "Converted file invalid; using raw audio",
        });
      }
      return res.status(400).json({ ok: false, error: "Converted audio is invalid" });
    }

    try { fs.unlinkSync(rawFile); } catch {}
    return res.json({ ok: true, file: mp3File.replace(/\\/g, "/"), mime: "audio/mpeg" });
  });
}

router.post("/upload-audio", async (req, res) => {
  try {
    const fileNameHint = String(req.query?.filename || req.body?.filename || "").trim();
    const meta = resolveUploadMeta(req);
    if (!meta.ok) return res.status(400).json({ ok: false, error: meta.error });

    const extFromName = fileNameHint ? path.extname(fileNameHint).replace(".", "").toLowerCase() : "";
    const ext = audioMimeToExt(meta.mime, extFromName);
    const mime = meta.mime;

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const rawFile = path.join(outDir, `user-audio-${uuid()}.${ext}`);
    const recv = await receiveUploadToFile(req, rawFile, { b64: meta.b64, mime });
    if (!recv.ok) return res.status(recv.status || 400).json({ ok: false, error: recv.error });

    return processReceivedAudio(rawFile, ext, mime, res);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Lets the client learn, before it starts, whether the resumable large-upload
// path exists on this server (Firebase configured) and the size ceiling — so it
// can branch and show accurate limits instead of attempting a doomed upload.
router.get("/upload-config", (req, res) => {
  const limits = getUploadLimits();
  res.json({
    ok: true,
    resumable: isFirebaseAdminEnabled(),
    directMaxMb: limits.directClientMaxMb,
    directMaxBytes: limits.directClientMaxBytes,
    maxMb: limits.resumableMaxMb,
    maxBytes: limits.resumableMaxBytes,
    minFreeAfterUploadMb: limits.minFreeAfterUploadMb,
  });
});

router.get("/proxy-status", (req, res) => {
  const proxyPath = String(req.query?.proxyPath || "").trim();
  if (!proxyPath) return res.status(400).json({ ok: false, error: "proxyPath required" });
  const resolved = path.resolve(proxyPath);
  const outputRoot = path.resolve(req.ctx.outputDir);
  if (!resolved.startsWith(outputRoot + path.sep) && resolved !== outputRoot) {
    return res.status(403).json({ ok: false, error: "Proxy path is outside your media folder" });
  }
  return res.json({ ok: true, ...getVideoProxyStatus(resolved) });
});

// Resumable upload — step 1: mint a GCS session the browser PUTs chunks to
// directly, bypassing Cloudflare's 100MB body cap. The object is namespaced to
// the caller's own uploads/<userId>/ prefix.
router.post("/upload-session", async (req, res) => {
  try {
    if (!isFirebaseAdminEnabled()) {
      return res.status(501).json({ ok: false, error: "Large uploads are not available on this server" });
    }
    const filename = String(req.body?.filename || "").trim();
    const contentType = String(req.body?.contentType || "application/octet-stream").trim();
    const size = Number(req.body?.size || 0);
    if (!filename) return res.status(400).json({ ok: false, error: "filename required" });
    if (Number.isFinite(size) && size > RESUMABLE_MAX_BYTES) {
      return res.status(413).json({ ok: false, error: `File exceeds the ${Math.floor(RESUMABLE_MAX_BYTES / (1024 * 1024))} MB limit` });
    }
    const { sessionUrl, objectPath } = await createResumableUploadSession({
      userId: req.ctx.userId,
      filename,
      contentType,
    });
    return res.json({ ok: true, sessionUrl, objectPath });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Resumable upload — step 2: the browser finished uploading to GCS. Pull the
// object down to the user's local output dir (the Story pipeline reads local
// files), validate + process it exactly like a direct audio upload, then delete
// the transient GCS copy. objectPath is jailed to the caller's own prefix so a
// user can never finalize (and download) someone else's object.
router.post("/upload-finalize", async (req, res) => {
  try {
    if (!isFirebaseAdminEnabled()) {
      return res.status(501).json({ ok: false, error: "Large uploads are not available on this server" });
    }
    const objectPath = String(req.body?.objectPath || "").trim();
    const filename = String(req.body?.filename || "").trim();
    const contentType = String(req.body?.contentType || "").trim();
    if (!isOwnUploadPath(objectPath, req.ctx.userId)) {
      return res.status(403).json({ ok: false, error: "Not your upload" });
    }

    const size = await getUploadObjectSize(objectPath);
    if (size != null && size > RESUMABLE_MAX_BYTES) {
      deleteUploadObject(objectPath).catch(() => {});
      return res.status(413).json({ ok: false, error: "File exceeds the upload limit" });
    }

    const kind = String(req.body?.kind || "audio").trim();
    const extHint = filename ? path.extname(filename).replace(".", "").toLowerCase() : "";
    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const headroom = hasDiskHeadroomForUpload(outDir, size);
    if (!headroom.ok) {
      deleteUploadObject(objectPath).catch(() => {});
      return res.status(507).json({ ok: false, error: headroom.error, availableBytes: headroom.availableBytes, requiredBytes: headroom.requiredBytes });
    }
    const cleanupGcs = () => deleteUploadObject(objectPath).catch(() => {}); // local copy becomes source of truth

    if (kind === "background") {
      const cls = classifyBackground(contentType, extHint);
      if (!cls.ok) { cleanupGcs(); return res.status(400).json({ ok: false, error: cls.error }); }
      const outFile = path.join(outDir, `bg-${cls.kind}-${uuid()}.${cls.ext}`);
      await downloadUploadToLocal(objectPath, outFile);
      cleanupGcs();
      return respondWithBackground(res, outFile, cls.kind, cls.isImage, contentType || (cls.isImage ? `image/${cls.ext}` : `video/${cls.ext}`));
    }

    if (kind === "source-video") {
      const ext = videoMimeToExt(contentType, extHint);
      const outFile = path.join(outDir, `source-video-${uuid()}.${ext}`);
      await downloadUploadToLocal(objectPath, outFile);
      cleanupGcs();
      const proxy = startVideoProxyGeneration(outFile);
      return res.json({ ok: true, file: outFile.replace(/\\/g, "/"), mime: contentType || `video/${ext}`, proxyPath: proxy.proxyPath, proxyStatus: proxy.status });
    }

    // default: audio — validate + native/transcode exactly like /upload-audio.
    const ext = audioMimeToExt(contentType, extHint);
    const mime = contentType || `audio/${ext}`;
    const rawFile = path.join(outDir, `user-audio-${uuid()}.${ext}`);
    await downloadUploadToLocal(objectPath, rawFile);
    cleanupGcs();
    return processReceivedAudio(rawFile, ext, mime, res);
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/audio-list", (req, res) => {
  try {
    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const entries = fs.readdirSync(outDir)
      .filter(name => audioExtensions.has(path.extname(name).toLowerCase()))
      .map(name => {
        const full = path.join(outDir, name);
        const stat = fs.statSync(full);
        return {
          name,
          path: full.replace(/\\/g, "/"),
          size: stat.size,
          mtime: stat.mtime?.toISOString?.() || null
        };
      })
      .sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));
    res.json({ ok: true, items: entries });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/video-list", (req, res) => {
  try {
    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const entries = fs.readdirSync(outDir)
      .filter(name => videoExtensions.has(path.extname(name).toLowerCase()))
      .map(name => {
        const full = path.join(outDir, name);
        const stat = fs.statSync(full);
        return {
          name,
          path: full.replace(/\\/g, "/"),
          size: stat.size,
          mtime: stat.mtime?.toISOString?.() || null
        };
      })
      .sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));
    res.json({ ok: true, items: entries });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

const videoMimeToExt = (mime, hint) => {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("webm")) return "webm";
  return videoExtensions.has(`.${hint}`) ? hint : "mp4";
};

// Image counterpart for the captioned-video background path. Falls back to
// the filename hint when the dataUrl carried a generic mime; defaults to jpg
// because that's the highest-survivability bet for an unknown bitmap.
const imageMimeToExt = (mime, hint) => {
  const m = String(mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return imageExtensions.has(`.${hint}`) ? hint : "jpg";
};

// Decide whether a background upload is an image or a video, and pick its
// extension + kind. Shared by the direct (/upload-background) and resumable
// (/upload-finalize) paths so both classify identically.
function classifyBackground(mime, extHint) {
  const m = String(mime || "").toLowerCase();
  const isImage = m.startsWith("image/") || imageExtensions.has(`.${extHint}`);
  const isVideo = m.startsWith("video/") || videoExtensions.has(`.${extHint}`);
  if (!isImage && !isVideo) {
    return { ok: false, error: `Background must be an image (jpg/png/webp) or video (mp4/mov/webm); got mime=${mime || "unknown"}` };
  }
  return { ok: true, isImage, ext: isImage ? imageMimeToExt(m, extHint) : videoMimeToExt(m, extHint), kind: isImage ? "image" : "video" };
}

// Finish a background upload once its bytes are on disk (either transport):
// extract a first-frame poster for videos (so tiles aren't black) and reply
// with the shape the client expects. Poster is best-effort — never fatal.
function respondWithBackground(res, outFile, kind, isImage, mimeOut) {
  let thumb = "";
  if (!isImage) {
    try {
      thumb = generateVideoThumbnail(outFile, { outputBaseName: path.basename(outFile, path.extname(outFile)) }) || "";
    } catch {
      thumb = "";
    }
  }
  return res.json({ ok: true, file: outFile.replace(/\\/g, "/"), kind, thumb, mime: mimeOut });
}

// Sibling of /upload-audio that preserves the original video tracks for the
// "Render Captioned Video" mode. Skips the ffprobe playability check that
// /upload-audio runs — video probing is expensive and the file goes through
// FFmpeg downstream during the render anyway. Trust here means authenticated
// upload, not absence of validation.
router.post("/upload-source-video", async (req, res) => {
  try {
    const fileNameHint = String(req.query?.filename || req.body?.filename || "").trim();
    const meta = resolveUploadMeta(req);
    if (!meta.ok) return res.status(400).json({ ok: false, error: meta.error });

    const extHint = fileNameHint ? path.extname(fileNameHint).replace(".", "").toLowerCase() : "";
    const ext = videoMimeToExt(meta.mime, extHint);

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `source-video-${uuid()}.${ext}`);
    const recv = await receiveUploadToFile(req, outFile, { b64: meta.b64, mime: meta.mime });
    if (!recv.ok) return res.status(recv.status || 400).json({ ok: false, error: recv.error });

    const proxy = startVideoProxyGeneration(outFile);
    return res.json({ ok: true, file: outFile.replace(/\\/g, "/"), mime: meta.mime || `video/${ext}`, proxyPath: proxy.proxyPath, proxyStatus: proxy.status });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Background-clip upload — accepts video (mp4/mov/webm) OR image (jpg/png/webp).
// Both land in outputDir and are referenced by their local path from the
// captioned-video render route. The render route detects images by file
// extension and switches FFmpeg's input flags accordingly (-loop 1 -t SEG vs
// -stream_loop -1). `kind` is returned so the client can render a still
// preview instead of a <video> for images.
router.post("/upload-background", async (req, res) => {
  try {
    const fileNameHint = String(req.query?.filename || req.body?.filename || "").trim();
    const meta = resolveUploadMeta(req);
    if (!meta.ok) return res.status(400).json({ ok: false, error: meta.error });

    const extHint = fileNameHint ? path.extname(fileNameHint).replace(".", "").toLowerCase() : "";
    const cls = classifyBackground(meta.mime, extHint);
    if (!cls.ok) return res.status(400).json({ ok: false, error: cls.error });

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `bg-${cls.kind}-${uuid()}.${cls.ext}`);
    const recv = await receiveUploadToFile(req, outFile, { b64: meta.b64, mime: meta.mime });
    if (!recv.ok) return res.status(recv.status || 400).json({ ok: false, error: recv.error });

    return respondWithBackground(res, outFile, cls.kind, cls.isImage, meta.mime || (cls.isImage ? `image/${cls.ext}` : `video/${cls.ext}`));
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Trim an uploaded clip to [startSec, endSec], producing a NEW file. The cut
// is an accurate re-encode (not a stream copy) so it lands exactly on the
// handles the user dragged. The original is left in place so re-trim is cheap.
// Security: validateTrimRequest jails inputPath to the caller's own outputDir.
router.post("/trim", async (req, res) => {
  try {
    const v = validateTrimRequest({
      inputPath: req.body?.inputPath,
      startSec: req.body?.startSec,
      endSec: req.body?.endSec,
      outputDir: req.ctx.outputDir,
    });
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    const { resolvedPath, startSec, endSec } = v;
    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ext = path.extname(resolvedPath).toLowerCase();
    const isVideo = videoExtensions.has(ext);
    const outExt = isVideo ? "mp4" : "mp3";
    const outFile = path.join(outDir, `trimmed-${uuid()}.${outExt}`);
    const duration = endSec - startSec;

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    // -ss/-t AFTER -i = decode-accurate seek. re-encode so output starts cleanly.
    const args = isVideo
      ? ["-y", "-i", resolvedPath, "-ss", String(startSec), "-t", String(duration),
         "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", outFile]
      : ["-y", "-i", resolvedPath, "-ss", String(startSec), "-t", String(duration),
         "-vn", "-c:a", "libmp3lame", "-ar", "44100", "-ac", "2", outFile];

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { if (stderr.length < 10000) stderr += d.toString(); });
    proc.on("error", (err) => {
      if (res.headersSent) return;
      res.status(400).json({ ok: false, error: `ffmpeg launch failed: ${err?.message || err}` });
    });
    proc.on("close", (code) => {
      if (res.headersSent) return;
      if (code !== 0 || !fs.existsSync(outFile)) {
        return res.status(400).json({ ok: false, error: "trim failed", details: stderr.slice(-800) });
      }
      const durationSec = probeDurationSec(outFile);
      return res.json({
        ok: true,
        file: outFile.replace(/\\/g, "/"),
        durationSec: Number.isFinite(durationSec) ? durationSec : duration,
      });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;

