import fs from "fs";
import { spawnSync } from "child_process";

/**
 * Some MP3 producers (msedge-tts, raw chunks from Chatterbox bridges) write
 * concatenated frames with no Xing/Info header. Browsers and ffmpeg can
 * decode the audio but can't compute duration without scrubbing the whole
 * file, so the HTML5 <audio> element shows 0:00 even though there's real
 * audio inside. We remux the file in place (`-c copy`, no re-encode) which
 * makes ffmpeg insert a proper Xing header — fast (~50ms) and lossless.
 *
 * No-op if ffmpeg is missing or the remux fails; the caller still gets the
 * original file rather than losing the generation.
 *
 * @param {string} filePath absolute path to an MP3 on disk
 * @returns {boolean} true if the file was rewritten with a fresh header
 */
export function addMp3HeaderInPlace(filePath) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const tmp = `${filePath}.fixed.mp3`;
  try {
    const result = spawnSync(
      ffmpeg,
      ["-y", "-loglevel", "error", "-i", filePath, "-c", "copy", tmp],
      { stdio: "ignore" }
    );
    if (result.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      fs.renameSync(tmp, filePath);
      return true;
    }
  } catch (err) {
    console.warn(`[TTS] MP3 header remux failed (non-fatal): ${err?.message || err}`);
  } finally {
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
  return false;
}
