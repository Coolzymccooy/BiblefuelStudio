import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";

/**
 * Extract the audio track of a video (or re-encode a non-MP3 audio file) to
 * MP3 at 22.05 kHz mono — small enough for Whisper, lossy enough that long
 * sermons stay under the 25 MB API limit.
 *
 * Resolves to the absolute path of the new MP3. Rejects if the source is
 * missing or FFmpeg exits non-zero.
 *
 * @param {string} sourcePath  Absolute path to an audio or video file.
 * @param {string} outDir      Directory where the MP3 will be written.
 * @returns {Promise<string>}
 */
export async function extractAudioToMp3(sourcePath, outDir) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`source not found: ${sourcePath}`);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const outFile = path.join(outDir, `extract-${uuid()}.mp3`);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      "-y", "-i", sourcePath,
      "-vn",
      "-ac", "1",
      "-ar", "22050",
      "-b:a", "64k",
      outFile,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });

  return outFile;
}
