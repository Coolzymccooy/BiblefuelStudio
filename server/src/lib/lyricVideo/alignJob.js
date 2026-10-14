// server/src/lib/lyricVideo/alignJob.js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readProject, updateProject } from "./projectStore.js";
import { transcribeSong } from "./transcribeWindows.js";
import { transcribePrompted } from "./whisperPrompted.js";
import { placeLines, FLAG_CONFIDENCE } from "./align.js";
import { detectBeats as realDetectBeats } from "./beats.js";
import { measureAudibleEnd as realMeasureAudibleEnd } from "./audibleEnd.js";
import { requestVocalStem } from "./vocalStem.js";

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
function defaultDeps(workDir, projectId, { userId, dataDir } = {}) {
  const stem = path.join(workDir, `lyric-${projectId}-${crypto.randomBytes(4).toString("hex")}`);
  const made = new Set();
  let prepared = null;
  let preparedCount = 0;
  const cuts = new Set();
  const track = (file) => { made.add(file); return file; };
  return {
    // Each call writes its own file (the mix and the vocals are both prepared); cuts are taken from the latest that succeeded.
    prepareAudio: async (song) => {
      const out = track(`${stem}-16k${preparedCount ? `-${preparedCount}` : ""}.m4a`);
      preparedCount += 1;
      await ffmpeg(["-i", song, "-vn", "-ac", "1", "-ar", String(CUT_RATE), "-c:a", "aac", "-b:a", "64k", out]);
      prepared = out;
      return out;
    },
    // Without a signed-in user there is nobody to queue the laptop's work for: hear the mix.
    vocalStem: (song, { onQueued } = {}) => (userId ? requestVocalStem({ userId, input: song, dataDir, outputDir: workDir, onQueued }) : Promise.resolve(null)),
    // Re-encoded, not stream-copied: a copy cuts at packet boundaries and shifts every word.
    cutAudio: async (from, to) => {
      if (!prepared) throw new Error("ffmpeg cut asked before the audio was prepared");
      const out = track(`${stem}-cut-${Math.round(from * 1000)}-${Math.round(to * 1000)}.wav`);
      cuts.add(out);
      await ffmpeg(["-ss", String(from), "-i", prepared, "-t", String(to - from), "-vn", "-ac", "1", "-ar", String(CUT_RATE), "-c:a", "pcm_s16le", out]);
      return out;
    },
    transcribe: (file, prompt) => transcribePrompted(file, prompt),
    detectBeats: realDetectBeats,
    measureAudibleEnd: realMeasureAudibleEnd,
    // A cut is used once; removing it right away keeps one cut on disk at a time.
    discard: (file) => { if (cuts.delete(file)) { made.delete(file); fs.rmSync(file, { force: true }); } },
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

/**
 * The timing after a run that failed with `message`. A re-run (one started on
 * lyrics already timed) keeps the earlier good timing, still "done", and notes
 * the failure in lastError; a first run is an error, as before.
 */
export function failedTiming(timing, message) {
  const { rerun, ...rest } = timing || {};
  return rerun
    ? { ...rest, status: "done", progress: null, error: null, lastError: message }
    : { ...rest, status: "error", progress: null, error: message };
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
    // On the grid, but never after the line it introduces.
    const start = snap ? Math.min(first.start, snapToBeat(first.start - period / 2, beats.times)) : first.start;
    return { ...s, start: Math.max(0, start) };
  });
}

/**
 * Times the lyrics of one project in the background: prepares the audio, hears
 * it in lyric-primed Whisper windows, places every line, finds the beat, and
 * saves progress and the result into the project. Never throws: a failure is
 * stored as timing.status "error". Every write goes through updateProject on
 * the latest saved project, so edits made while it runs are not overwritten.
 */
export async function runAlignJob({ dataDir, workDir, projectId, userId, deps }) {
  if (running.has(projectId)) return readProject(dataDir, projectId); // already running: report where it stands
  running.add(projectId);
  const defaults = defaultDeps(workDir, projectId, { userId, dataDir });
  const d = { ...defaults, ...(deps || {}) };
  const log = d.log || console.error;
  // Files this run made that the default cleanup does not know about (the vocals from the laptop).
  const owned = new Set();
  try {
    let snapshot = null;
    const begun = updateProject(dataDir, projectId, (latest) => {
      snapshot = latest;
      // A re-run keeps the earlier timing if it fails, so remember that there was one.
      const rerun = latest.timing?.status === "done";
      return { ...latest, timing: { ...latest.timing, status: "running", progress: { step: "preparing" }, error: null, lastError: null, rerun } };
    });
    if (!begun) return null;
    return await timeLyrics({ dataDir, projectId, snapshot, d, log, owned });
  } catch (err) {
    if (err instanceof ProjectGone) return null;
    log(`[lyric-video] timing failed for ${projectId}:`, err);
    try {
      return updateProject(dataDir, projectId, (latest) => ({ ...latest, timing: failedTiming(latest.timing, explainFailure(err)) }));
    } catch (writeErr) {
      log(`[lyric-video] could not save the timing error for ${projectId}:`, writeErr);
      return null;
    }
  } finally {
    running.delete(projectId);
    try { defaults.cleanup(); } catch (err) { (d.log || console.error)(`[lyric-video] could not remove timing files for ${projectId}:`, err); }
    for (const file of owned) {
      try { fs.rmSync(file, { force: true }); } catch (err) { (d.log || console.error)(`[lyric-video] could not remove the vocals file for ${projectId}:`, err); }
    }
  }
}

/**
 * The latest project with the job's placements merged in, or null when its
 * lyrics differ from the ones the job started with. A line the user locked
 * while the job ran keeps the user's timing; the rest takes the job's.
 */
function mergePlacement(latest, snapshot, placed, beats) {
  if (!sameLyrics(latest.lines, snapshot.lines)) return null;
  const lines = latest.lines.map((line, i) => (line.locked ? line : { ...line, ...timingOf(placed[i]) }));
  return { lines, sections: sectionStarts(latest.sections, lines, beats) };
}

const withoutRerun = ({ rerun, ...timing } = {}) => timing;
const lyricsChanged = (latest) => ({ ...latest, timing: { ...withoutRerun(latest.timing), status: "error", progress: null, error: LYRICS_CHANGED } });

/**
 * Places what Whisper heard before a failure and stores it with the failure, so the lines that were
 * heard keep their times. A re-run keeps the earlier full timing instead of these partial placements.
 */
function savePartial({ dataDir, projectId, snapshot, partial, err, durationSec, measuredEnd, lockedLines }) {
  const rerun = snapshot.timing?.status === "done";
  const audibleEnd = atLeastHeard(measuredEnd, snapshot.lines, partial?.heard, lockedLines, durationSec);
  const placed = !rerun && partial?.heard?.length ? placeLines(snapshot.lines, partial.heard, { locked: lockedLines, durationSec, audibleEnd }) : null;
  const message = explainFailure(err);
  return updateProject(dataDir, projectId, (latest) => {
    const merged = placed ? mergePlacement(latest, snapshot, placed, { bpm: 0, times: [] }) : null;
    if (placed && !merged) return lyricsChanged(latest);
    return { ...latest, ...(merged || {}), timing: { ...failedTiming(latest.timing, message), ...(merged ? { passes: partial.passes, audibleEnd } : {}) } };
  });
}

/**
 * Where the music stops, measured once on the prepared audio. Never fails the
 * job: a failed or nonsense measurement falls back to the song's length.
 */
async function findAudibleEnd({ d, audio, durationSec, projectId, log }) {
  try {
    const end = Number(await d.measureAudibleEnd(audio, durationSec));
    return Number.isFinite(end) && end > 0 ? Math.min(end, durationSec) : durationSec;
  } catch (err) {
    log(`[lyric-video] could not measure where the music stops for ${projectId}; using the song's length:`, err);
    return durationSec;
  }
}

/**
 * The audible end, never earlier than the end of the last word heard with
 * confidence (inside a line placed unflagged against the song's full length):
 * a click and then near-silence must not squeeze lyrics that were plainly heard.
 */
export function atLeastHeard(audibleEnd, lines, heard, locked, durationSec) {
  if (audibleEnd >= durationSec || !heard?.length) return audibleEnd;
  const confident = placeLines(lines, heard, { locked, durationSec })
    .filter((l) => !locked.has(l.id) && l.flag === null && l.confidence >= FLAG_CONFIDENCE);
  const inConfidentLine = (h) => confident.some((l) => h.start >= l.start && h.start <= l.end);
  const heardEnd = heard.reduce((latest, h) => (Number.isFinite(h.end) && inConfidentLine(h) ? Math.max(latest, h.end) : latest), 0);
  return Math.min(durationSec, Math.max(audibleEnd, heardEnd));
}

/** The name the vocal-stem step gives its file; only a file named like this is ever removed as ours. */
const VOCALS_FILE = /^lyric-vocals-[\w-]+\.m4a$/;

/**
 * The audio to transcribe, and the audio to measure where the music stops. When a
 * laptop supplies the song's vocals, the words are heard in those and the end is
 * measured on the mix; otherwise both are the mix. This step never fails the job
 * on account of the vocals: any problem with them is logged once and the mix is used.
 */
async function chooseAudio({ d, song, projectId, log, owned, progress }) {
  let vocals = null;
  let queued = false;
  try {
    // "vocals" is shown only once the laptop really has a job; with no laptop the user sees the normal steps.
    const found = await d.vocalStem(song, { onQueued: () => { queued = true; progress("vocals"); } });
    vocals = typeof found === "string" && found && found !== song ? found : null;
    // Ours to remove from the moment it exists, before any later step (which may end the job) can skip past it.
    if (vocals && VOCALS_FILE.test(path.basename(vocals))) owned.add(vocals);
  } catch (err) {
    if (err instanceof ProjectGone) throw err;
    log(`[lyric-video] vocals skipped for ${projectId}: ${err?.message || err}`);
  }
  if (queued) progress("preparing"); // the wait is over: back to getting the audio ready
  // The mix is prepared first so the vocals, prepared last, are what the windows are cut from.
  const mix = await d.prepareAudio(song);
  if (!vocals) return { audio: mix, endSource: mix, usedVocalStem: false };
  try {
    return { audio: await d.prepareAudio(vocals), endSource: mix, usedVocalStem: true };
  } catch (err) {
    log(`[lyric-video] vocals skipped for ${projectId}: could not prepare them: ${err?.message || err}`);
    return { audio: mix, endSource: mix, usedVocalStem: false };
  }
}

async function timeLyrics({ dataDir, projectId, snapshot, d, log, owned }) {
  const durationSec = Number(snapshot.song?.durationSec) || 0;
  if (!snapshot.song?.file || durationSec <= 0) throw new UserFacing("Add the song first, then run timing.");
  if (!snapshot.lines.length) throw new UserFacing("Paste the lyrics, one line per line, then run timing.");

  // Progress only ever touches `timing`. A deleted project stops the job.
  const progress = (step, extra = {}) => {
    const next = updateProject(dataDir, projectId, (latest) => ({ ...latest, timing: { ...latest.timing, status: "running", progress: { step, ...extra } } }));
    if (!next) throw new ProjectGone(projectId);
  };

  const { audio, endSource, usedVocalStem } = await chooseAudio({ d, song: snapshot.song.file, projectId, log, owned, progress });
  // The mix, not the vocals, decides where the music stops.
  const measuredEnd = await findAudibleEnd({ d, audio: endSource, durationSec, projectId, log });
  const total = Math.max(1, Math.ceil(durationSec / WINDOW_SEC_ESTIMATE));
  progress("listening");
  const locked = new Map(snapshot.lines.filter((l) => l.locked && l.words?.length).map((l) => [l.id, { words: l.words }]));
  let song;
  try {
    song = await transcribeSong({
      audioPath: audio, durationSec, lines: snapshot.lines,
      transcribe: async (file, prompt) => {
        try { return await d.transcribe(file, prompt); } finally { d.discard?.(file); }
      },
      cutAudio: d.cutAudio,
      onProgress: ({ window }) => progress("listening", { window, total: Math.max(window, total) }),
    });
  } catch (err) {
    if (err instanceof ProjectGone || !err?.partial) throw err;
    log(`[lyric-video] timing failed for ${projectId}:`, err);
    const saved = savePartial({ dataDir, projectId, snapshot, partial: err.partial, err, durationSec, measuredEnd, lockedLines: locked });
    if (!saved) throw new ProjectGone(projectId);
    return saved;
  }
  const { heard, passes } = song;
  const audibleEnd = atLeastHeard(measuredEnd, snapshot.lines, heard, locked, durationSec);
  progress("matching");
  // No line is placed after the music stops (lines still unheard there are squeezed in and flagged).
  const placed = placeLines(snapshot.lines, heard, { locked, durationSec, audibleEnd });
  progress("beats");
  // Beats are optional: without them, section starts are the first line's start.
  let beats = { bpm: 0, times: [] };
  try {
    beats = await d.detectBeats(snapshot.song.file);
  } catch (err) {
    log(`[lyric-video] beat detection failed for ${projectId}:`, err);
  }

  const done = updateProject(dataDir, projectId, (latest) => {
    const merged = mergePlacement(latest, snapshot, placed, beats);
    if (!merged) return lyricsChanged(latest);
    return { ...latest, ...merged, timing: { ...withoutRerun(latest.timing), status: "done", progress: null, error: null, lastError: null, beats, passes, audibleEnd, usedVocalStem, finishedAt: new Date().toISOString() } };
  });
  if (!done) throw new ProjectGone(projectId);
  return done;
}
