/**
 * See exactly what ffmpeg/ffprobe were asked to open, from outside the code.
 *
 * FFREPORT makes every ffmpeg and ffprobe the server spawns write a report
 * whose first lines are its full command line. The env var is inherited, so a
 * test can check the arguments of a route that spawns ffmpeg internally.
 * Reports are named <program>-<time to the second>.log, so two runs of one
 * program in the same second keep only the last; tests use one directory per
 * case and assert what survives.
 */
import fs from "node:fs";
import path from "node:path";

export const PROTOCOL_GUARD = ["-protocol_whitelist", "file,pipe"];

/** Start capturing reports into `dir`; returns a reader and a stop function. */
export function captureFfmpegReports(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const previous = process.env.FFREPORT;
  const escaped = dir.replace(/\\/g, "/").replace(/:/g, "\\:");
  process.env.FFREPORT = `file=${escaped}/%p-%t.log:level=16`;
  return {
    /** [{ program, tokens }] for every report written so far. */
    commands() {
      return fs.readdirSync(dir).filter((f) => f.endsWith(".log")).map((f) => {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        const lines = text.split(/\r?\n/);
        const line = lines[lines.indexOf("Command line:") + 1] || "";
        const tokens = tokenize(line);
        return { program: path.basename(tokens[0] || "").replace(/\.exe$/i, ""), tokens };
      });
    },
    stop() {
      if (previous === undefined) delete process.env.FFREPORT;
      else process.env.FFREPORT = previous;
    },
  };
}

/** Split a report's command line: space-separated, "..." quoted, \ escapes. */
export function tokenize(line) {
  const out = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) { current += line[i + 1]; i += 1; started = true; continue; }
    if (ch === "\"") { quoted = !quoted; started = true; continue; }
    if (ch === " " && !quoted) {
      if (started) out.push(current);
      current = ""; started = false;
      continue;
    }
    current += ch; started = true;
  }
  if (started) out.push(current);
  return out;
}

function hasGuard(tokens) {
  return tokens.some((t, i) => t === PROTOCOL_GUARD[0] && tokens[i + 1] === PROTOCOL_GUARD[1]);
}

/**
 * The inputs of an ffmpeg argument list that are NOT preceded (within their
 * own input options) by `-protocol_whitelist file,pipe`. lavfi inputs are
 * generated, not opened, and are skipped.
 * @param {string[]} args ffmpeg arguments (program name optional)
 */
export function unguardedInputs(args) {
  const missing = [];
  let groupStart = 0;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "-i") continue;
    const group = args.slice(groupStart, i);
    const lavfi = group.some((t, k) => t === "-f" && group[k + 1] === "lavfi");
    if (!lavfi && !hasGuard(group)) missing.push(args[i + 1]);
    groupStart = i + 2;
  }
  return missing;
}

/** True when an ffprobe command line carries the guard. */
export function ffprobeGuarded(tokens) {
  return hasGuard(tokens);
}
