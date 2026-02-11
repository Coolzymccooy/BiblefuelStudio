import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";

const router = Router();
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"]);

/**
 * Upload audio as dataUrl (base64) and save to outputs/.
 * Optionally converts to mp3 if ffmpeg is available.
 * Body: { dataUrl: "data:audio/webm;base64,...", filename?: "recording.webm" }
 */
router.post("/upload-audio", async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || "");
    const fileNameHint = String(req.body?.filename || "").trim();
    let mime = "application/octet-stream";
    let b64 = "";

    if (dataUrl.startsWith("data:")) {
      const m = dataUrl.match(/^data:([^;]+)(?:;[^,]*)?,base64,(.*)$/);
      if (!m) return res.status(400).json({ ok:false, error:"Invalid dataUrl" });
      mime = m[1];
      b64 = m[2];
    } else if (dataUrl.startsWith("base64,")) {
      b64 = dataUrl.slice("base64,".length);
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(dataUrl) && dataUrl.length > 0) {
      b64 = dataUrl;
    } else {
      return res.status(400).json({ ok: false, error: "Invalid dataUrl" });
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
    fs.writeFileSync(rawFile, Buffer.from(b64, "base64"));

    // If already mp3 or wav, just return
    if (ext === "mp3" || ext === "wav") {
      return res.json({ ok: true, file: rawFile.replace(/\\/g, "/"), mime });
    }

    // Try converting to mp3 via ffmpeg for best compatibility
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const mp3File = rawFile.replace(/\.[^.]+$/, ".mp3");

    const args = ["-y", "-i", rawFile, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "2", mp3File];

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());

    proc.on("close", (code) => {
      if (code !== 0) {
        // Return raw file even if conversion fails
        return res.json({ ok: true, file: rawFile.replace(/\\/g, "/"), mime, warning: "ffmpeg conversion failed; using raw file", details: stderr.slice(-800) });
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
