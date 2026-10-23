import fs from "fs";
import path from "path";
import { synthesizeSsmlWithBoundaries } from "../voice/providers/azureSpeechClient.js";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./projectStore.js";
import { deliveryForLine } from "./cast.js";
import { speakableText, ssmlFor, audioKey } from "./speech.js";
import { alignWords } from "./align.js";
import { computeTimeline } from "./timeline.js";

/**
 * Voice a scene-script project: one WAV per line in its speaker's voice
 * (Azure SSML, so rate and pitch are honoured), the ensemble chant mixed
 * from every ensemble voice, then the timeline. A line is re-voiced only
 * when what would be heard changed (its audio key), so re-takes and edits
 * cost one line, not the whole script.
 */

export const VOICE_CONCURRENCY = 4;
const OUTPUT_FORMAT = "Riff48Khz16BitMonoPcm";
const ROOMS = Object.freeze({
  small: "aecho=0.8:0.5:30|60:0.25|0.15",
  hall: "aecho=0.8:0.6:45|95|160:0.35|0.25|0.15",
  church: "aecho=0.8:0.7:70|160|280:0.4|0.3|0.2",
});
const TICKS_PER_SEC = 10_000_000;

const defaultDeps = Object.freeze({
  synth: synthesizeSsmlWithBoundaries,
  ffmpeg: runFfmpeg,
  probe: probeAudioDurationSec,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

const runs = new Set();

export function isVoicing(id) {
  return runs.has(id);
}

function loudnessTarget(line) {
  if (line.kind === "chant") return -21;
  return line.emphasis ? -14 : -16;
}

/** What would be heard for this line; a change means it must be voiced again. */
export function lineAudioKey(line, cast) {
  return audioKey({ d: deliveryForLine(line, cast), t: speakableText(line), k: line.kind, e: Boolean(line.emphasis) });
}

async function synthWithRetry(deps, ssml) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await deps.synth({ ssml, outputFormat: OUTPUT_FORMAT });
    } catch (e) {
      last = e;
      if (/40[013]|not configured/i.test(String(e?.message))) break;
      await deps.sleep(1500 * attempt);
    }
  }
  throw last;
}

function wordsFrom(boundaries) {
  return (boundaries || [])
    .filter((b) => b.boundaryType === "Word")
    .map((b) => ({
      text: b.text,
      start: b.audioOffsetTicks / TICKS_PER_SEC,
      end: (b.audioOffsetTicks + b.durationTicks) / TICKS_PER_SEC,
    }));
}

async function ffmpegOrThrow(deps, args) {
  const r = await deps.ffmpeg(["-y", "-v", "error", ...args]);
  if (!r.ok) throw new Error(`ffmpeg failed: ${String(r.stderr || r.error || "").slice(-300)}`);
}

async function voiceSingle(deps, dir, line, delivery, key) {
  const raw = path.join(dir, `${line.id}-${key}.raw.wav`);
  const { audio, boundaries } = await synthWithRetry(deps, ssmlFor({ ...delivery, text: speakableText(line) }));
  fs.writeFileSync(raw, audio);
  return { raw, heard: wordsFrom(boundaries) };
}

async function voiceChant(deps, dir, line, delivery, key, room) {
  const layers = [];
  for (const [i, layer] of delivery.ensemble.entries()) {
    const file = path.join(dir, `${line.id}-${key}-v${i}.wav`);
    if (!fs.existsSync(file)) {
      const { audio } = await synthWithRetry(deps, ssmlFor({ voice: layer.voice, rate: delivery.rate, pitch: layer.pitch, text: speakableText(line) }));
      // Reused on the next run, so it must never exist half-written.
      fs.writeFileSync(`${file}.part`, audio);
      fs.renameSync(`${file}.part`, file);
    }
    layers.push({ file, offsetMs: layer.offsetMs });
  }
  const raw = path.join(dir, `${line.id}-${key}.raw.wav`);
  const legs = layers.map((l, i) => `[${i}:a]adelay=${l.offsetMs}|${l.offsetMs},volume=0.8[a${i}]`).join(";");
  const ins = layers.map((_, i) => `[a${i}]`).join("");
  const filter = `${legs};${ins}amix=inputs=${layers.length}:normalize=0,volume=0.45,lowpass=f=7000,`
    + `${ROOMS[room] || ROOMS.hall},highpass=f=90,alimiter=limit=0.8[out]`;
  await ffmpegOrThrow(deps, [...layers.flatMap((l) => ["-i", l.file]), "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-ac", "2", raw]);
  return { raw, heard: [] };
}

async function voiceLine(ctx, project, line, deps) {
  const key = lineAudioKey(line, project.cast);
  const dir = path.join(projectOutputDir(ctx.outputDir, project.id), "voice");
  const name = `${line.id}-${key}.wav`;
  const file = path.join(dir, name);
  if (line.audio?.key === key && fs.existsSync(file)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const delivery = deliveryForLine(line, project.cast);
  const raw = path.join(dir, `${line.id}-${key}.raw.wav`);
  try {
    const { heard } = delivery.ensemble
      ? await voiceChant(deps, dir, line, delivery, key, project.cast.Ensemble?.room)
      : await voiceSingle(deps, dir, line, delivery, key);
    await ffmpegOrThrow(deps, ["-i", raw, "-af", `loudnorm=I=${loudnessTarget(line)}:TP=-1.5:LRA=11`, "-ar", "48000", "-ac", "2", file]);
    return await finishLine(deps, project, line, { key, name, file, heard, dir });
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

/** Takes from earlier deliveries of this line are no longer used once the new one is saved. */
function removeOldTakes(dir, lineId, key) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${lineId}-`) && !f.startsWith(`${lineId}-${key}`)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

async function finishLine(deps, project, line, { key, name, file, heard, dir }) {
  const durationSec = Number(await deps.probe(file)) || 0;
  if (!(durationSec > 0)) throw new Error("The voice file came back empty.");
  removeOldTakes(dir, line.id, key);
  return {
    key, file: name, url: projectOutputUrl(project.id, "voice", name), durationSec: +durationSec.toFixed(3),
    words: line.kind === "chant" ? [] : alignWords(line.text, heard, durationSec),
  };
}

function patchLine(ctx, id, lineId, fields) {
  return updateProject(ctx.dataDir, id, (p) => ({
    ...p,
    lines: p.lines.map((l) => (l.id === lineId ? { ...l, ...fields } : l)),
  }));
}

/** Recompute the timeline from whatever audio the project has. */
export function withTimeline(project) {
  const durations = Object.fromEntries(project.lines.map((l) => [l.id, l.audio?.durationSec || 0]));
  return { ...project, timeline: computeTimeline(project, durations) };
}

async function runVoicing(ctx, id, deps) {
  const project = readProject(ctx.dataDir, id);
  const queue = [...project.lines];
  const failures = [];
  const worker = async () => {
    while (queue.length) {
      const line = queue.shift();
      const fresh = readProject(ctx.dataDir, id);
      const current = fresh?.lines.find((l) => l.id === line.id);
      if (!current) continue;
      try {
        const audio = await voiceLine(ctx, fresh, current, deps);
        if (audio) patchLine(ctx, id, line.id, { audio, audioError: null });
      } catch (e) {
        failures.push(line.id);
        patchLine(ctx, id, line.id, { audioError: String(e?.message || e).slice(0, 300) });
      }
    }
  };
  await Promise.allSettled(Array.from({ length: VOICE_CONCURRENCY }, worker));
  updateProject(ctx.dataDir, id, (p) => withTimeline({
    ...p,
    voice: failures.length
      ? { status: "error", finishedAt: Date.now(), error: `${failures.length} line(s) could not be voiced. Try again.` }
      : { status: "done", finishedAt: Date.now(), error: null },
  }));
}

/**
 * Start voicing in the background. Returns the project marked running, or
 * null when a run is already going for it.
 */
export function startVoicing(ctx, id, { deps } = {}) {
  if (runs.has(id)) return null;
  const marked = updateProject(ctx.dataDir, id, (p) => ({ ...p, voice: { status: "running", startedAt: Date.now(), error: null } }));
  if (!marked) return null;
  runs.add(id);
  runVoicing(ctx, id, { ...defaultDeps, ...deps })
    .catch((e) => {
      console.warn(`[scene-script] voicing ${id} failed: ${e?.message || e}`);
      updateProject(ctx.dataDir, id, (p) => ({ ...p, voice: { status: "error", error: String(e?.message || e) } }));
    })
    .finally(() => runs.delete(id));
  return marked;
}

/** After a restart a "running" voice pass has no worker; mark it stopped so it can be started again. */
export function recoverInterruptedVoicing(project) {
  if (project?.voice?.status !== "running" || runs.has(project.id)) return project;
  return { ...project, voice: { status: "error", error: "Interrupted by a server restart. Voice it again; finished lines are kept." } };
}
