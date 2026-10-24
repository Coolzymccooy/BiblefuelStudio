import fs from "fs";
import crypto from "crypto";
import { pipeline } from "stream/promises";

/**
 * Stock clips (Pexels, Pixabay) live under one global name per provider id,
 * shared by every account (#112), and a render may be reading one while the
 * same id is downloaded again. So a clip that is already there (non-empty)
 * is reused, and a new download goes to a unique .part file that is renamed
 * into place only once complete: the final name never holds a partial file.
 */

/** The file when it exists and is not empty, else null. */
export function existingStockFile(file) {
  try {
    return fs.statSync(file).size > 0 ? file : null;
  } catch {
    return null;
  }
}

/**
 * Write `body` (a readable stream) to `outFile` through a unique .part file.
 * A failed download leaves neither file behind.
 *
 * @param {NodeJS.ReadableStream} body
 * @param {string} outFile
 */
export async function writeStockFile(body, outFile) {
  const tmpFile = `${outFile}.${crypto.randomBytes(6).toString("hex")}.part`;
  try {
    await pipeline(body, fs.createWriteStream(tmpFile));
    fs.renameSync(tmpFile, outFile);
  } catch (err) {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* best effort */ }
    throw err;
  }
  return outFile;
}
