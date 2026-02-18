import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn, spawnSync } from "child_process";

const router = Router();
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"]);

function parseDataUrlPayload(dataUrl) {
  const value = String(dataUrl || "");
  if (!value) return { ok: false, error: "Invalid dataUrl" };

  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0) return { ok: false, error: "Invalid dataUrl" };

    const meta = value.slice(5, comma); // after "data:"
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

/**
 * Upload audio as dataUrl (base64) and save to outputs/.
 * Optionally converts to mp3 if ffmpeg is available.
 * Body: { dataUrl: "data:audio/webm;base64,...", filename?: "recording.webm" }
 */
router.post("/upload-audio", async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || "");
    const fileNameHint = String(req.body?.filename || "").trim();
    const parsed = parseDataUrlPayload(dataUrl);
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error || "Invalid dataUrl" });

    const mime = parsed.mime || "application/octet-stream";
    const b64 = parsed.b64 || "";
    const decodedBuffer = Buffer.from(b64, "base64");
    if (!decodedBuffer.length || decodedBuffer.length < 128) {
      return res.status(400).json({ ok: false, error: "Audio payload is empty or too small" });
    }

    const extFromName = fileNameHint ? path.extname(fileNameHint).replace('.', '').toLowerCase() : "";
    const ext =
      mime.includes("webm") ? "webm" :
      mime.includes("wav") ? "wav" :
      mime.includes("mpeg") ? "mp3" :
      mime.includes("mp3") ? "mp3" :
      mime.includes("ogg") ? "ogg" :
      mime.includes("flac") ? "flac" :
      mime.includes("aac") ? "aac" :
      mime.includes("mp4") ? "m4a" :
      extFromName || "bin";

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const rawFile = path.join(outDir, `user-audio-${uuid()}.${ext}`);
    fs.writeFileSync(rawFile, decodedBuffer);

    // If already mp3 or wav, just return
    if (ext === "mp3" || ext === "wav") {
      if (!isPlayableAudio(rawFile)) {
        return res.status(400).json({ ok: false, error: "Uploaded audio is invalid or too short" });
      }
      return res.json({ ok: true, file: rawFile.replace(/\\/g, "/"), mime });
    }

    // Try converting to mp3 via ffmpeg for best compatibility
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const mp3File = rawFile.replace(/\.[^.]+$/, ".mp3");

    const args = ["-y", "-i", rawFile, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "2", mp3File];

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("error", () => {
      if (!res.headersSent) {
        if (isPlayableAudio(rawFile)) {
          return res.json({
            ok: true,
            file: rawFile.replace(/\\/g, "/"),
            mime,
            warning: "ffmpeg unavailable; using raw file",
          });
        }
        return res.status(400).json({ ok: false, error: "Failed to convert/upload audio" });
      }
    });

    proc.on("close", (code) => {
      if (res.headersSent) return;
      if (code !== 0) {
        // Return raw file only if it's playable
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

      // Optionally delete raw file to reduce clutter
      try { fs.unlinkSync(rawFile); } catch {}
      return res.json({ ok: true, file: mp3File.replace(/\\/g, "/"), mime: "audio/mpeg" });
    });
  } catch (e) {
    res.status(400).json({ ok:false, error: String(e?.message || e) });
  }
});

router.get("/audio-list", (req, res) => {
  try {
    const outDir = process.env.OUTPUT_DIR || "./outputs";
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

export default router;
