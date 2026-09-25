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
//
// Measured on the operator's laptop (Ryzen 7 8840HS, CPU only, 20 s clip):
// BS-Roformer took 4m38s (~14x the song's length — an hour for a 4-minute
// song) and Demucs with --single_stem Instrumental wrote nothing (it has no
// "Instrumental" stem). MDX-Net Inst HQ3 took ~16 s, or ~13 s with a lower
// overlap, so both options use it and Fast trades a little quality for speed.
const MDX_INST = "UVR-MDX-NET-Inst_HQ_3.onnx";
export const MODELS = Object.freeze({ best: MDX_INST, fast: MDX_INST });
const EXTRA_ARGS = Object.freeze({ best: [], fast: ["--mdx_overlap", "0.1"] });

let _spawn = spawn;
export function _setSpawnImpl(fn) { _spawn = fn; }
export function _resetSpawnImpl() { _spawn = spawn; }

// How long to wait for a killed process to actually emit "close" before
// giving up and rejecting anyway. Bounded so an abort can never hang
// forever, but long enough on a real machine for Windows to tear the
// process (and its file handles) down before we sweep the work dir.
const DEFAULT_KILL_GRACE_MS = 5000;
let _killGraceMs = DEFAULT_KILL_GRACE_MS;
export function _setKillGraceMs(ms) { _killGraceMs = ms; }
export function _resetKillGraceMs() { _killGraceMs = DEFAULT_KILL_GRACE_MS; }

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
  const q = MODELS[quality] ? quality : "best";
  const args = [
    input,
    "--model_filename", MODELS[q],
    "--output_dir", outDir,
    "--output_format", "WAV",
    "--single_stem", "Instrumental",
    ...EXTRA_ARGS[q],
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

/**
 * Spawn without a shell; resolve on exit 0, reject with the stderr tail
 * otherwise. On abort, kill the process and WAIT for it to actually close
 * (so a Windows caller can safely clean up files the process held open)
 * up to `_killGraceMs`, after which we give up and reject "Cancelled."
 * regardless — an abort can never hang forever.
 */
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
    let aborting = false;
    let graceTimer = null;
    const detach = () => {
      proc.stdout?.removeListener("data", take);
      proc.stderr?.removeListener("data", take);
    };
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      detach();
      fn(arg);
    };
    const onAbort = () => {
      aborting = true;
      try { proc.kill(); } catch { /* already gone */ }
      graceTimer = setTimeout(() => finish(reject, new Error("Cancelled.")), _killGraceMs);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const take = (d) => {
      if (settled) return; // a killed process can still flush buffered output
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      onOutput?.(s);
    };
    proc.stdout?.on("data", take);
    proc.stderr?.on("data", take);
    proc.on("error", (e) => { signal?.removeEventListener("abort", onAbort); finish(reject, e); });
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (aborting) return finish(reject, new Error("Cancelled."));
      if (code === 0) return finish(resolve);
      return finish(reject, new Error(`${path.basename(cmd)} exited ${code}: ${tail.slice(-400)}`));
    });
    return undefined;
  });
}

let cached = null;
export function _resetAvailability() { cached = null; }

/**
 * Whether this machine can remove vocals. A stable outcome (available, or
 * STEMS_CLI simply unset) is cached for the life of the process. A
 * transient failure (probe timeout, non-zero exit, spawn error) is NOT
 * cached — a cold start or a momentary hiccup must not hide vocal removal
 * for the rest of the server's life, so the next call re-probes.
 */
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
    return cached;
  } catch (e) {
    return { ok: false, reason: ctrl.signal.aborted ? "timed out" : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode `input` to WAV, separate it, keep only the instrumental, and store
 * it as AAC at `outPath`. The separator reads audio through libsndfile, which
 * cannot open m4a/AAC (the usual format of a downloaded song), so ffmpeg
 * decodes first. The WAV working files are removed whatever happens.
 */
export async function removeVocals({ input, outPath, workDir, quality, onProgress, signal }) {
  const py = stemsCli();
  if (!py) throw new Error("vocal removal is not set up on this machine");
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const source = path.join(workDir, "source.wav");
    try {
      await run(ff, ["-y", "-i", input, "-vn", "-ac", "2", "-ar", "44100", source], { signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(`could not read this song file: ${e.message}`);
    }
    const args = buildSeparatorArgs({ input: source, outDir: workDir, quality, modelDir: process.env.STEMS_MODEL_DIR?.trim() || undefined });
    await run(py, args, {
      signal,
      onOutput: (s) => { const p = parseProgress(s); if (p !== null) onProgress?.(p); },
    });
    const wav = fs.readdirSync(workDir).find((f) => /instrumental/i.test(f) && /\.wav$/i.test(f));
    if (!wav) throw new Error("the separator finished but wrote no instrumental");
    await run(ff, ["-y", "-i", path.join(workDir, wav), "-c:a", "aac", "-b:a", "192k", outPath], { signal });
    return outPath;
  } finally {
    // Best-effort: a killed separator process can briefly hold a WAV open
    // on Windows, so rmSync can throw EBUSY/EPERM right after an abort. A
    // cleanup failure here must never mask the real outcome (success or
    // the actual error) — any leftovers are swept up by the next run's
    // stale-workDir cleanup rather than by this one succeeding.
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch { /* swept up later */ }
  }
}
