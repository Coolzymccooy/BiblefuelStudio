import fs from "fs";
import path from "path";
import { spawn } from "child_process";

/**
 * Vocal removal through the `audio-separator` CLI installed in its own
 * Python venv; STEMS_CLI is the path to that venv's audio-separator.exe
 * (`python -m audio_separator.utils.cli` exits 0 without doing anything). Laptop-only: with STEMS_CLI unset the feature is
 * hidden, which is how the deployed server runs. Model names and the module
 * path were confirmed on the operator's laptop (docs/vocal-removal.md).
 */
export const MODELS = Object.freeze({
  best: "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
  fast: "htdemucs.yaml",
});

let _spawn = spawn;
export function _setSpawnImpl(fn) { _spawn = fn; }
export function _resetSpawnImpl() { _spawn = spawn; }

export function stemsCli(env = process.env) {
  const p = String(env.STEMS_CLI || "").trim();
  return p || null;
}

export function buildSeparatorArgs({ input, outDir, quality, modelDir }) {
  // The input sits where the CLI expects a positional argument; a relative
  // value such as "-rf" would be read as a flag.
  if (!path.isAbsolute(String(input || "")) || !path.isAbsolute(String(outDir || ""))) {
    throw new Error("separator paths must be absolute");
  }
  const model = MODELS[quality] || MODELS.best;
  const args = [
    input,
    "--model_filename", model,
    "--output_dir", outDir,
    "--output_format", "WAV",
    "--single_stem", "Instrumental",
  ];
  if (modelDir) args.push("--model_file_dir", modelDir);
  return args;
}

/** The last "NN%|" progress-bar percentage in a chunk of output. */
export function parseProgress(text) {
  const all = [...String(text || "").matchAll(/(\d{1,3})%\|/g)];
  if (all.length === 0) return null;
  const n = Number(all[all.length - 1][1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Spawn without a shell; resolve on exit 0, reject with the stderr tail otherwise. */
function run(cmd, args, { onOutput, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled."));
    let proc;
    try {
      proc = _spawn(cmd, args, { shell: false, windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    let tail = "";
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; fn(arg); };
    const onAbort = () => {
      try { proc.kill(); } catch { /* already gone */ }
      finish(reject, new Error("Cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const take = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      onOutput?.(s);
    };
    proc.stdout?.on("data", take);
    proc.stderr?.on("data", take);
    proc.on("error", (e) => { signal?.removeEventListener("abort", onAbort); finish(reject, e); });
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) return finish(resolve);
      return finish(reject, new Error(`${path.basename(cmd)} exited ${code}: ${tail.slice(-400)}`));
    });
    return undefined;
  });
}

let cached = null;
export function _resetAvailability() { cached = null; }

/** Whether this machine can remove vocals. Probed once per process. */
export async function separatorAvailable({ timeoutMs = 20_000 } = {}) {
  if (cached) return cached;
  const py = stemsCli();
  if (!py) {
    cached = { ok: false, reason: "STEMS_CLI is not set" };
    return cached;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let out = "";
  try {
    await run(py, ["--version"], { onOutput: (s) => { out += s; }, signal: ctrl.signal });
    cached = { ok: true, version: out.trim().split(/\s+/).pop() || "" };
  } catch (e) {
    cached = { ok: false, reason: ctrl.signal.aborted ? "timed out" : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
  return cached;
}

/**
 * Separate `input`, keep only the instrumental, and store it as AAC at
 * `outPath`. The WAV working files are removed whatever happens.
 */
export async function removeVocals({ input, outPath, workDir, quality, onProgress, signal }) {
  const py = stemsCli();
  if (!py) throw new Error("vocal removal is not set up on this machine");
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const args = buildSeparatorArgs({ input, outDir: workDir, quality, modelDir: process.env.STEMS_MODEL_DIR?.trim() || undefined });
    await run(py, args, {
      signal,
      onOutput: (s) => { const p = parseProgress(s); if (p !== null) onProgress?.(p); },
    });
    const wav = fs.readdirSync(workDir).find((f) => /instrumental/i.test(f) && /\.wav$/i.test(f));
    if (!wav) throw new Error("the separator finished but wrote no instrumental");
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    await run(ff, ["-y", "-i", path.join(workDir, wav), "-c:a", "aac", "-b:a", "192k", outPath], { signal });
    return outPath;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
