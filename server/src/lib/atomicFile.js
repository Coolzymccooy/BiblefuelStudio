import fs from "fs";

/**
 * Write a file so neither a reader nor a crash ever sees half of it: write a
 * temp file beside the target, then rename it over the target, which is atomic
 * on one volume. Each write gets its own temp name, so two writes at once
 * cannot mix; the last rename wins.
 *
 * Windows refuses a rename (EPERM, EBUSY, EACCES) while another process or
 * rename has the target open, so a refused rename is retried briefly, as
 * graceful-fs does. Only on Windows: elsewhere a refusal is a real error and fails at once.
 */
let seq = 0;
const tempFor = (file) => `${file}.${process.pid}.${(seq += 1)}.tmp`;
const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);
const retryable = (e) => process.platform === "win32" && BUSY.has(e?.code);
const RETRIES = 20;
const pause = new Int32Array(new SharedArrayBuffer(4));

function renameSyncRetrying(from, to) {
  for (let i = 0; ; i += 1) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      if (!retryable(e) || i >= RETRIES) throw e;
      Atomics.wait(pause, 0, 0, 5 * (i + 1));
    }
  }
}

async function renameRetrying(from, to) {
  for (let i = 0; ; i += 1) {
    try {
      return await fs.promises.rename(from, to);
    } catch (e) {
      if (!retryable(e) || i >= RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 5 * (i + 1)));
    }
  }
}

export function writeFileAtomic(file, data, encoding = "utf8") {
  const tmp = tempFor(file);
  try {
    fs.writeFileSync(tmp, data, encoding);
    renameSyncRetrying(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export const writeJsonAtomic = (file, value) => writeFileAtomic(file, JSON.stringify(value, null, 2));

export async function writeFileAtomicAsync(file, data, encoding = "utf8") {
  const tmp = tempFor(file);
  try {
    await fs.promises.writeFile(tmp, data, encoding);
    await renameRetrying(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}
