import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { extractAudioToMp3 } from "../lib/transcode.js";
import {
  transcribeAudio,
  chunkAudioForTranscription,
  stitchTranscriptions,
} from "../lib/voice/alignment.js";

// Mockable seam: ESM exports are non-configurable, so node:test's mock.method
// can't replace alignment.transcribeAudio directly. Mirror the codebase
// convention (see _setAlignmentImpl in orchestrator.js) and let tests swap the
// implementation via _setTranscribeAudioImpl.
let _transcribeFn = transcribeAudio;
export function _setTranscribeAudioImpl(impl) { _transcribeFn = impl; }
export function _resetTranscribeAudioImpl() { _transcribeFn = transcribeAudio; }

const router = Router();
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200);

function isFileTooLarge(p) {
  try { return fs.statSync(p).size > MAX_INPUT_MB * 1024 * 1024; } catch { return false; }
}

function probeDurationMs(filePath) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const sec = Number(String(out).trim());
      resolve(Number.isFinite(sec) ? Math.round(sec * 1000) : null);
    });
  });
}

router.post("/", async (req, res) => {
  try {
    const mediaPath = String(req.body?.mediaPath || "").trim();
    if (!mediaPath) return res.status(400).json({ ok: false, error: "mediaPath is required" });
    if (!fs.existsSync(mediaPath)) return res.status(400).json({ ok: false, error: "mediaPath not found" });
    if (isFileTooLarge(mediaPath)) return res.status(400).json({ ok: false, error: `mediaPath too large (>${MAX_INPUT_MB}MB)` });

    const outDir = req.ctx.outputDir;
    const isVideo = videoExtensions.has(path.extname(mediaPath).toLowerCase());
    const audioPath = isVideo ? await extractAudioToMp3(mediaPath, outDir) : mediaPath;

    const durationMs = (await probeDurationMs(audioPath)) ?? 0;
    const chunks = await chunkAudioForTranscription(audioPath, outDir, durationMs);

    const transcribed = await Promise.all(
      chunks.map(async (c) => ({ offsetMs: c.offsetMs, transcription: await _transcribeFn(c.path) })),
    );
    const stitched = stitchTranscriptions(transcribed);

    if (!stitched.words.length) {
      return res.status(502).json({ ok: false, error: "Transcription returned no words (Whisper unavailable or audio silent)" });
    }

    return res.json({ ok: true, audioPath, durationMs, words: stitched.words });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
