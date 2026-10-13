// server/src/lib/lyricVideo/alignJob.js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readProject, updateProject } from "./projectStore.js";
import { transcribeSong } from "./transcribeWindows.js";
import { transcribePrompted } from "./whisperPrompted.js";
import { placeLines } from "./align.js";
import { detectBeats as realDetectBeats } from "./beats.js";

const WINDOW_SEC_ESTIMATE = 28; // a window of 30 s that placed something moves the frontier about this far
const CUT_RATE = 16000;
const LYRICS_CHANGED = "The lyrics changed while timing ran — run timing again.";

const running = new Set();
/** True while a timing job for this project is in flight in this process (one job per project). */
export function isAligning(projectId) { return running.has(projectId); }

/** An error whose message is already fit to show the user. */
class UserFacing extends Error {}
/** Thrown when the project is deleted mid-job, to stop spending on Whisper; ends the job silently. */
class ProjectGone extends Error {}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-nostdin", "-v", "error", "-y", ...args]);
    let err = "";
    proc.stderr.on("data", (d) => { err = (err + d).slice(-500); });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))));
  });
}

/**
 * The real audio steps. Temp files are named by project and a per-run token (two jobs
 * cannot collide) and every one is removed by cleanup().
 */
function defaultDeps(workDir, projectId) {
  const stem = path.join(workDir, `lyric-${projectId}-${crypto.randomBytes(4).toString("hex")}`);
  const made = new Set();
  let prepared = null;
  const track = (file) => { made.add(file); return file; };
  return {
    prepareAudio: async (song) => {
      prepared = track(`${stem}-16k.m4a`);
      await ffmpeg(["-i", song, "-vn", "-ac", "1", "-ar", String(CUT_RATE), "-c:a", "aac", "-b:a", "64k", prepared]);
      return prepared;
    },
    // Re-encoded, not stream-copied: a copy cuts at packet boundaries and shifts every word.
    cutAudio: async (from, to) => {
      if (!prepared) throw new Error("ffmpeg cut asked before the audio was prepared");
      const out = track(`${stem}-cut-${Math.round(from * 1000)}-${Math.round(to * 1000)}.wav`);
      await ffmpeg(["-ss", String(from), "-i", prepared, "-t", String(to - from), "-vn", "-ac", "1", "-ar", String(CUT_RATE), "-c:a", "pcm_s16le", out]);
      return out;
    },
    transcribe: (file, prompt) => transcribePrompted(file, prompt),
    detectBeats: realDetectBeats,
    cleanup: () => { for (const f of made) fs.rmSync(f, { force: true }); made.clear(); },
  };
}

/** Plain-English reason for the user; the technical detail goes to the server log. */
export function explainFailure(err) {
  if (err instanceof UserFacing) return err.message;
  const raw = String(err?.message || err || "");
  const whisper = /Whisper (\d{3})/.exec(raw);
  if (/OPENAI_API_KEY/.test(raw)) return "Timing needs the speech service, and it is not set up on this server yet.";
  if (whisper) {
    const status = Number(whisper[1]);
    if (status === 429) return "The speech service is busy right now — wait a minute, then run timing again.";
    if (status === 401 || status === 403) return "The speech service is not accepting this server's key, so timing cannot run yet.";
    if (status === 413) return "This song is too long for the speech service.";
    if (status >= 500) return "The speech service had a problem — run timing again in a moment.";
    return "The speech service could not listen to this song — run timing again.";
  }
  if (err?.name === "AbortError" || /aborted|timed? ?out/i.test(raw)) return "The speech service took too long to answer — run timing again.";
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i.test(raw)) return "Could not reach the speech service — check the connection, then run timing again.";
  if (/ENOENT/.test(raw) && /ffmpeg/i.test(raw)) return "The audio tools are not available on this server.";
  if (/^ffmpeg/i.test(raw)) return "Could not read this song's audio. Try uploading the song again.";
  return "Timing did not finish — run it again. If it keeps failing, check that the lyrics match the song.";
}

function snapToBeat(t, beats) {
  return beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]);
}

const sameLyrics = (a, b) => a.length === b.length && a.every((l, i) => l.id === b[i].id && l.text === b[i].text);
const timingOf = ({ words, start, end, confidence, flag }) => ({ words, start, end, confidence, flag });

/** Each section starts half a beat before its first line, on the beat grid; unsnapped when no beat was found. */
function sectionStarts(sections, lines, beats) {
  const period = beats.bpm > 0 ? 60 / beats.bpm : 0;
  const snap = period > 0 && beats.times.length > 0;
  return sections.map((s) => {
    const first = lines.find((l) => l.sectionId === s.id && Number.isFinite(l.start));
    if (!first) return s;
    return { ...s, start: snap ? snapToBeat(first.start - period / 2, beats.times) : Math.max(0, first.start) };
  });
}

/**
 * Times the lyrics of one project in the background: prepares the audio, hears
 * it in lyric-primed Whisper windows, places every line, finds the beat, and
 * saves progress and the result into the project. Never throws: a failure is
 * stored as timing.status "error". Every write goes through updateProject on
 * the latest saved project, so edits made while it runs are not overwritten.
 */
export async function runAlignJob({ dataDir, workDir, projectId, deps }) {
  if (running.has(projectId)) return readProject(dataDir, projectId); // already running: report where it stands
  running.add(projectId);
  const defaults = defaultDeps(workDir, projectId);
  const d = { ...defaults, ...(deps || {}) };
  const log = d.log || console.error;
  try {
    let snapshot = null;
    const begun = updateProject(dataDir, projectId, (latest) => {
      snapshot = latest;
      return { ...latest, timing: { ...latest.timing, status: "running", progress: { step: "preparing" }, error: null } };
    });
    if (!begun) return null;
    return await timeLyrics({ dataDir, projectId, snapshot, d });
  } catch (err) {
    if (err instanceof ProjectGone) return null;
    log(`[lyric-video] timing failed for ${projectId}:`, err);
    try {
      return updateProject(dataDir, projectId, (latest) => ({ ...latest, timing: { ...latest.timing, status: "error", progress: null, error: explainFailure(err) } }));
    } catch (writeErr) {
      log(`[lyric-video] could not save the timing error for ${projectId}:`, writeErr);
      return null;
    }
  } finally {
    running.delete(projectId);
    try { defaults.cleanup(); } catch (err) { (d.log || console.error)(`[lyric-video] could not remove timing files for ${projectId}:`, err); }
  }
}

async function timeLyrics({ dataDir, projectId, snapshot, d }) {
  const durationSec = Number(snapshot.song?.durationSec) || 0;
  if (!snapshot.song?.file || durationSec <= 0) throw new UserFacing("Add the song first, then run timing.");
  if (!snapshot.lines.length) throw new UserFacing("Paste the lyrics, one line per line, then run timing.");

  // Progress only ever touches `timing`. A deleted project stops the job.
  const progress = (step, extra = {}) => {
    const next = updateProject(dataDir, projectId, (latest) => ({ ...latest, timing: { ...latest.timing, status: "running", progress: { step, ...extra } } }));
    if (!next) throw new ProjectGone(projectId);
  };

  const audio = await d.prepareAudio(snapshot.song.file);
  const total = Math.max(1, Math.ceil(durationSec / WINDOW_SEC_ESTIMATE));
  progress("listening");
  const { heard, passes } = await transcribeSong({
    audioPath: audio, durationSec, lines: snapshot.lines,
    transcribe: d.transcribe, cutAudio: d.cutAudio,
    onProgress: ({ window }) => progress("listening", { window, total: Math.max(window, total) }),
  });
  progress("matching");
  const locked = new Map(snapshot.lines.filter((l) => l.locked && l.words?.length).map((l) => [l.id, { words: l.words }]));
  const placed = placeLines(snapshot.lines, heard, { locked, durationSec });
  progress("beats");
  const beats = await d.detectBeats(snapshot.song.file);

  const done = updateProject(dataDir, projectId, (latest) => {
    if (!sameLyrics(latest.lines, snapshot.lines)) {
      return { ...latest, timing: { ...latest.timing, status: "error", progress: null, error: LYRICS_CHANGED } };
    }
    // A line the user locked while the job ran keeps the user's timing.
    const lines = latest.lines.map((line, i) => (line.locked ? line : { ...line, ...timingOf(placed[i]) }));
    return {
      ...latest, lines, sections: sectionStarts(latest.sections, lines, beats),
      timing: { ...latest.timing, status: "done", progress: null, error: null, beats, passes, finishedAt: new Date().toISOString() },
    };
  });
  if (!done) throw new ProjectGone(projectId);
  return done;
}
