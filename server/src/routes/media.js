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
    if (!dataUrl.startsWith("data:audio/")) {
      return res.status(400).json({ ok: false, error: "dataUrl must be a data:audio/* base64 URL" });
    }

    const m = dataUrl.match(/^data:(audio\/[^;]+);base64,(.*)$/);
    if (!m) return res.status(400).json({ ok:false, error:"Invalid dataUrl" });

    const mime = m[1];
    const b64 = m[2];
    const ext = mime.includes("webm") ? "webm" : (mime.includes("wav") ? "wav" : (mime.includes("mpeg") ? "mp3" : "bin"));

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const rawFile = path.join(outDir, `user-audio-${uuid()}.${ext}`);
    fs.writeFileSync(rawFile, Buffer.from(b64, "base64"));

    // If already mp3 or wav, just return
    if (ext === "mp3" || ext === "wav") {
      return res.json({ ok: true, file: rawFile, mime });
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
        return res.json({ ok: true, file: rawFile, mime, warning: "ffmpeg conversion failed; using raw file", details: stderr.slice(-800) });
      }
      // Optionally delete raw file to reduce clutter
      try { fs.unlinkSync(rawFile); } catch {}
      return res.json({ ok: true, file: mp3File, mime: "audio/mpeg" });
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
