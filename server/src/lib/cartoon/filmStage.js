import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  SEEDANCE_MODELS, seedanceRatio, submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "../videoGen/providers/seedance.js";
import { estimateTokens, usdForTokens, reserveSpend, settleSpend, releaseSpend, isReserved } from "../videoGen/spend.js";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { addClip, getClip, clipFile } from "../visualLibrary/store.js";
import { downloadClip, makePoster } from "../sceneScript/shotStage.js";
import { clipPrompt, referencedCast } from "./prompts.js";
import { transcribeClip, speechScore, speechWindows, SPEECH_OK } from "./speech.js";
import { readProject, updateProject, projectOutputDir } from "./store.js";
import { runInOrder } from "./chain.js";

/**
 * The film stage of cartoon mode (spec section 7.6): one talking Seedance clip
 * per shot, through the shared spend ledger, every clip kept in the visual
 * library. It follows the scene script shot stage: reserve, submit, save the
 * task id before waiting (so a restart collects instead of paying again),
 * charge once per task, download, poster, library.
 *
 * What is different for cartoons:
 *  - a fresh shot sends the approved character portraits as reference
 *    pictures; a chained shot starts from the last frame of the shot before
 *    it, so it waits for that shot (chain.js decides when each shot runs);
 *  - audio is generated and a picture refusal never falls back to text, which
 *    would drop the approved face; a refusal marks the shot "refused";
 *  - after download the clip's speech windows are found and a line's speech is
 *    checked against the script. A mismatch is only flagged, never re-made.
 *
 * Clip states: queued, generating, waiting, done, error, refused.
 */

export const FILM_CONCURRENCY = 4;
export const FILM_MODEL = SEEDANCE_MODELS.mini;
export const FILM_RESOLUTION = "720p";
const IN_FLIGHT = new Set(["queued", "generating"]);
const NOT_CHARGED = new Set(["FAILED", "NOT_FOUND", "REFUSED"]);
/** BytePlus keeps a finished clip's URL for 24 h, so a paid clip that failed to download can be fetched again. */
const REFETCH_MS = 23 * 60 * 60 * 1000;

const STOPPED = "Stopped before this clip was ordered.";
const NO_FRAME = "The starting picture for this shot could not be made. Make the shot before it again.";
const BAD_PICTURE = "A character picture could not be read. Make the portrait again.";
const INTERRUPTED = "Interrupted by a server restart before the clip was ordered. Order it again.";
const GENERIC = "Something went wrong making this clip. Try again.";
const DECLINED = "BytePlus declined this shot. Change its note or action and try again.";
const PERSON_FRESH = "BytePlus thinks a character picture shows a real person. Make that portrait again.";
const PERSON_CHAINED = "BytePlus thinks this shot's starting picture shows a real person. Make the shot before it again.";
const NOT_FETCHED = "The clip was made and paid for but could not be downloaded. Order this shot again within a day to fetch it at no cost.";
const waitingFor = (n) => `Waiting for shot ${n}`;
const approveFirst = (name) => `Approve ${name}'s portrait first.`;

export const defaultDeps = Object.freeze({
  submit: submitSeedanceTask,
  wait: waitForSeedanceTask,
  download: downloadSeedanceVideo,
  ffmpeg: runFfmpeg,
  probe: probeAudioDurationSec,
  transcribe: transcribeClip,
  windows: speechWindows,
});

const runs = new Set();
const cancels = new Set();
export const isFilming = (id) => runs.has(id);
export const filmLedgerKey = (projectId, shotId) => `cartoon:${projectId}:${shotId}`;

/** Stop a running film: shots not yet ordered fail; ordered ones are still collected. False when nothing runs. */
export function cancelFilm(id) {
  if (!runs.has(id)) return false;
  cancels.add(id);
  return true;
}

const isChained = (shot, index) => shot?.firstFrame === "chain" && index > 0;
/** The shot as it is ordered: the first shot has no shot before it, so it is always fresh. */
const asOrdered = (shot, index) => (isChained(shot, index) ? shot : { ...shot, firstFrame: "fresh" });

const canRefetch = (shot, now = Date.now()) => shot.clip?.status === "error"
  && Boolean(shot.clip.taskId) && shot.clip.chargedTaskId === shot.clip.taskId
  && now - (Number(shot.clip.startedAt) || 0) < REFETCH_MS;

function pickShots(project, only) {
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  return project.shots.filter((s) => (wanted ? wanted.has(s.id) : s.clip?.status !== "done") && !IN_FLIGHT.has(s.clip?.status));
}

/** Who a fresh shot would show if every portrait were approved: the speaker first, then the scene. */
function wantedCast(project, shot) {
  const cast = Object.fromEntries(Object.entries(project.cast || {})
    .map(([name, member]) => [name, { ...member, approved: true, portrait: member?.portrait || {} }]));
  return referencedCast({ ...project, cast }, { ...shot, firstFrame: "fresh" });
}

/** A new queued clip. The reference names are fixed now, so the prompt's "reference picture N" and the files agree. */
function queuedClip(project, shot, index) {
  const ordered = asOrdered(shot, index);
  const { previous: _older, ...current } = shot.clip || {};
  return {
    status: "queued", taskId: null, error: null, seconds: shot.seconds,
    prompt: clipPrompt(project, ordered),
    references: referencedCast(project, ordered),
    previous: shot.clip?.status === "done" ? current : shot.clip?.previous || null,
  };
}

function patchShot(dataDir, id, shotId, fn) {
  let changed = null;
  updateProject(dataDir, id, (p) => {
    const shots = p.shots.map((s) => {
      if (s.id !== shotId) return s;
      changed = fn(s);
      return changed || s;
    });
    return changed ? { ...p, shots } : null;
  });
  return changed;
}

/** End an in-flight shot (error, refused or waiting), only while it is still on this task. */
function endShot(dataDir, id, shotId, taskId, patch) {
  patchShot(dataDir, id, shotId, (s) => (
    IN_FLIGHT.has(s.clip?.status) && (s.clip.taskId ?? null) === (taskId ?? null)
      ? { ...s, clip: { ...s.clip, ...patch } }
      : null
  ));
}

/** The last frame of a clip as a PNG, or null when ffmpeg made none (missing or empty). Never throws. */
export async function lastFrameOf(deps, clipFilePath, out) {
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true });
    const made = await deps.ffmpeg(["-y", "-v", "error", "-sseof", "-0.1", "-i", clipFilePath, "-frames:v", "1", out]);
    return made?.ok && fs.existsSync(out) && fs.statSync(out).size > 0 ? out : null;
  } catch {
    return null;
  }
}

/** A chained shot's first frame: the last frame of the shot before it, which must be done. */
async function startingFrame(ctx, project, index, deps) {
  const shot = project.shots[index];
  const parent = project.shots[index - 1];
  if (parent.clip?.status !== "done" || !parent.clip.libraryId) return { ok: false, status: "waiting", error: waitingFor(index) };
  const clip = getClip(ctx.dataDir, parent.clip.libraryId);
  const source = clip ? clipFile(ctx, clip) : null;
  const name = `${String(shot.id).replace(/[^A-Za-z0-9_-]/g, "") || "shot"}-last.png`;
  const frame = source ? await lastFrameOf(deps, source, path.join(projectOutputDir(ctx.outputDir, project.id), "frames", name)) : null;
  return frame ? { ok: true, input: { firstFramePath: frame } } : { ok: false, error: NO_FRAME };
}

/** A fresh shot's reference pictures: the approved portraits named when it was queued, inside the project folder. */
function referencePictures(ctx, project, shot) {
  const names = Array.isArray(shot.clip.references) ? shot.clip.references : [];
  if (!names.length) {
    const wanted = wantedCast(project, shot);
    return wanted.length ? { ok: false, error: approveFirst(wanted[0]) } : { ok: true, input: { referenceImagePaths: [] } };
  }
  const base = projectOutputDir(ctx.outputDir, project.id);
  const paths = [];
  for (const name of names) {
    const member = Object.hasOwn(project.cast || {}, name) ? project.cast[name] : null;
    if (!member?.approved || !member.portrait?.file) return { ok: false, error: approveFirst(name) };
    const full = path.resolve(base, member.portrait.file);
    const rel = path.relative(base, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, error: BAD_PICTURE };
    paths.push(full);
  }
  return { ok: true, input: { referenceImagePaths: paths } };
}

/** Why a submit failed, as the shot's end state. Nothing was created, so nothing is charged. */
function submitFailure(submitted, chained) {
  if (submitted.code === "PERSON_REFUSED") return { status: "refused", error: chained ? PERSON_CHAINED : PERSON_FRESH };
  if (submitted.code === "REFUSED") return { status: "refused", error: DECLINED };
  return { status: "error", error: submitted.error || GENERIC };
}

/**
 * Count a task's cost once. The ledger settles only while the reservation
 * stands, and the project total moves in the same write that marks the shot
 * charged for this task, so collecting again after a restart never charges twice.
 */
function chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens }) {
  const key = filmLedgerKey(id, shotId);
  const spend = { model: FILM_MODEL, resolution: FILM_RESOLUTION, tokens };
  const usd = isReserved(ledgerDir, key) ? settleSpend(ledgerDir, key, spend) : usdForTokens(spend);
  updateProject(ctx.dataDir, id, (p) => {
    const shot = p.shots.find((s) => s.id === shotId);
    if (!shot || shot.clip?.chargedTaskId === taskId) return null;
    return {
      ...p,
      spentUsd: (Number(p.spentUsd) || 0) + usd,
      shots: p.shots.map((s) => (s.id === shotId ? { ...s, clip: { ...s.clip, chargedTaskId: taskId } } : s)),
    };
  });
  return usd;
}

/** Speech windows for every clip and, for a line, the speech check. Never throws and never blocks the clip. */
async function checkClip(deps, file, line) {
  let windows = [];
  try {
    const found = await deps.windows(file, { ffmpeg: deps.ffmpeg, probe: deps.probe });
    windows = Array.isArray(found) ? found : [];
  } catch {
    windows = [];
  }
  if (typeof line !== "string" || !line.trim()) return { windows, speech: null };
  try {
    const heard = await deps.transcribe(file, { ffmpeg: deps.ffmpeg });
    if (!heard?.ok) return { windows, speech: { ok: null, error: String(heard?.error || "transcription failed") } };
    const score = speechScore(line, heard.text);
    return { windows, speech: { heard: heard.text, score: Math.round(score * 100) / 100, ok: score >= SPEECH_OK } };
  } catch (e) {
    return { windows, speech: { ok: null, error: String(e?.message || e) } };
  }
}

/** Mark a shot done in one write; a done chained next shot now starts from an old frame, so it is out of date. */
function markDone(dataDir, id, shotId, taskId, clip) {
  updateProject(dataDir, id, (p) => {
    const index = p.shots.findIndex((s) => s.id === shotId);
    if (index < 0 || p.shots[index].clip?.taskId !== taskId) return null;
    const previous = p.shots[index].clip.previous || null;
    return {
      ...p,
      shots: p.shots.map((s, i) => {
        if (i === index) return { ...s, clip: { ...clip, previous } };
        if (i === index + 1 && isChained(s, i) && s.clip?.status === "done") return { ...s, clip: { ...s.clip, stale: true } };
        return s;
      }),
    };
  });
}

async function collect(ctx, id, shotId, taskId, { ledgerDir, deps }) {
  const done = await deps.wait(taskId);
  const project = readProject(ctx.dataDir, id);
  const shot = project?.shots.find((s) => s.id === shotId);
  const secs = shot?.clip?.seconds || shot?.seconds || 4;
  const estimated = () => estimateTokens({ durationSec: secs, ratio: seedanceRatio(project?.meta?.aspect), resolution: FILM_RESOLUTION });
  if (!done.ok) {
    if (NOT_CHARGED.has(done.code)) releaseSpend(ledgerDir, filmLedgerKey(id, shotId));
    // Unknown outcome (timeout, auth): BytePlus may still bill it, so the estimate is counted.
    else chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens: estimated() });
    const refused = done.code === "REFUSED" || /sensitive|copyright|declined/i.test(done.error || "");
    return endShot(ctx.dataDir, id, shotId, taskId, refused
      ? { status: "refused", error: DECLINED }
      : { status: "error", error: `BytePlus did not return this clip (${done.error}).` });
  }
  const tokens = Number(done.tokens) > 0 ? done.tokens : estimated();
  const costUsd = chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens });
  const tmpDir = path.join(projectOutputDir(ctx.outputDir, id), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `${randomUUID()}.mp4`);
  const downloadError = await downloadClip(deps, done.videoUrl, file);
  if (downloadError) {
    console.warn(`[cartoon] clip ${taskId} paid but not downloaded: ${downloadError}`);
    return endShot(ctx.dataDir, id, shotId, taskId, { status: "error", error: NOT_FETCHED });
  }
  const poster = await makePoster(deps, file, `${file}.jpg`);
  const durationSec = Number(await deps.probe(file)) || secs;
  const checks = await checkClip(deps, file, shot?.line);
  const speaker = shot?.speaker || "";
  const clip = addClip(ctx, {
    file, posterFile: poster, prompt: shot?.clip?.prompt || "",
    lead: (speaker && project?.cast?.[speaker]?.look) || "",
    model: FILM_MODEL, resolution: FILM_RESOLUTION, aspect: project?.meta?.aspect || "portrait",
    durationSec, tokens, costUsd, taskId, source: { kind: "cartoon", projectId: id, shotId },
    tags: [project?.meta?.title, speaker].filter(Boolean),
  });
  markDone(ctx.dataDir, id, shotId, taskId, {
    status: "done", libraryId: clip.id, url: clip.url, posterUrl: clip.posterUrl, durationSec, costUsd,
    seconds: secs, prompt: clip.prompt, speech: checks.speech, windows: checks.windows,
  });
  return undefined;
}

async function orderOne(ctx, id, shotId, { ledgerDir, deps }) {
  const project = readProject(ctx.dataDir, id);
  const index = project ? project.shots.findIndex((s) => s.id === shotId) : -1;
  const shot = project?.shots[index];
  if (shot?.clip?.status === "generating" && shot.clip.taskId) return collect(ctx, id, shotId, shot.clip.taskId, { ledgerDir, deps });
  if (!shot || shot.clip?.status !== "queued") return undefined;
  if (cancels.has(id)) return endShot(ctx.dataDir, id, shotId, null, { status: "error", error: STOPPED });
  const chained = isChained(shot, index);
  const pictures = chained ? await startingFrame(ctx, project, index, deps) : referencePictures(ctx, project, shot);
  if (!pictures.ok) return endShot(ctx.dataDir, id, shotId, null, { status: pictures.status || "error", error: pictures.error });
  if (cancels.has(id)) return endShot(ctx.dataDir, id, shotId, null, { status: "error", error: STOPPED });
  const seconds = shot.clip.seconds;
  const tokens = estimateTokens({ durationSec: seconds, ratio: seedanceRatio(project.meta?.aspect), resolution: FILM_RESOLUTION });
  const key = filmLedgerKey(id, shotId);
  const reserved = reserveSpend(ledgerDir, key, usdForTokens({ model: FILM_MODEL, resolution: FILM_RESOLUTION, tokens }));
  if (!reserved.ok) return endShot(ctx.dataDir, id, shotId, null, { status: "error", error: reserved.error });
  const submitted = await deps.submit({
    prompt: shot.clip.prompt, aspect: project.meta?.aspect, durationSec: seconds, model: FILM_MODEL, resolution: FILM_RESOLUTION,
    generateAudio: true, allowTextFallback: false, seed: project.seed, ...pictures.input,
  });
  if (!submitted.ok) {
    releaseSpend(ledgerDir, key);
    return endShot(ctx.dataDir, id, shotId, null, submitFailure(submitted, chained));
  }
  patchShot(ctx.dataDir, id, shotId, (s) => (s.clip?.status === "queued"
    ? { ...s, clip: { ...s.clip, status: "generating", taskId: submitted.taskId, startedAt: Date.now() } } : null));
  return collect(ctx, id, shotId, submitted.taskId, { ledgerDir, deps });
}

async function orderSafely(ctx, id, shotId, opts) {
  try {
    await orderOne(ctx, id, shotId, opts);
  } catch (e) {
    // Once a task is submitted BytePlus may bill it, so its reservation stays until it is collected.
    const taskId = readProject(ctx.dataDir, id)?.shots.find((s) => s.id === shotId)?.clip?.taskId ?? null;
    if (!taskId) releaseSpend(opts.ledgerDir, filmLedgerKey(id, shotId));
    console.warn(`[cartoon] shot ${shotId} of ${id} failed: ${e?.message || e}`);
    endShot(ctx.dataDir, id, shotId, taskId, { status: "error", error: GENERIC });
  }
}

function runFilm(ctx, id, ids, opts) {
  const shots = readProject(ctx.dataDir, id)?.shots || [];
  const parentOf = (shotId) => {
    const index = shots.findIndex((s) => s.id === shotId);
    return isChained(shots[index], index) ? shots[index - 1].id : null;
  };
  return runInOrder(ids, { parentOf, concurrency: FILM_CONCURRENCY, run: (shotId) => orderSafely(ctx, id, shotId, opts) });
}

/**
 * Queue the chosen shots (every shot without a done clip when `only` is
 * absent; `only` may name done shots, which is a paid re-make) and order them
 * in the background. Returns the project as written, or null when a run is
 * going, the project is missing, or nothing needs ordering.
 */
export function startFilm(ctx, id, { only, ledgerDir, deps } = {}) {
  if (runs.has(id)) return null;
  const project = readProject(ctx.dataDir, id);
  if (!project) return null;
  const picked = new Set(pickShots(project, only).map((s) => s.id));
  if (!picked.size) return null;
  const written = updateProject(ctx.dataDir, id, (p) => ({
    ...p,
    shots: p.shots.map((s, i) => {
      if (!picked.has(s.id)) return s;
      if (canRefetch(s)) return { ...s, clip: { ...s.clip, status: "generating", error: null } };
      return { ...s, clip: queuedClip(p, s, i) };
    }),
  }));
  if (!written) return null;
  runs.add(id);
  cancels.delete(id);
  const ids = written.shots.filter((s) => picked.has(s.id)).map((s) => s.id);
  runFilm(ctx, id, ids, { ledgerDir, deps: { ...defaultDeps, ...deps } })
    .catch((e) => console.warn(`[cartoon] film ${id} failed: ${e?.message || e}`))
    .finally(() => { runs.delete(id); cancels.delete(id); });
  return written;
}

/**
 * After a restart: collect clips that were ordered (never charged twice) and
 * end shots that were queued but never ordered. A chained shot whose parent
 * will not be done stays waiting rather than ordering from a missing frame.
 * Resolves with the number of clips collected.
 */
export async function resumeFilm(ctx, projects, { ledgerDir, deps } = {}) {
  const d = { ...defaultDeps, ...deps };
  let count = 0;
  const pending = [];
  for (const listed of projects || []) {
    const project = listed?.id ? readProject(ctx.dataDir, listed.id) : null;
    if (!project || runs.has(project.id)) continue;
    const jobs = [];
    project.shots.forEach((s, i) => {
      if (!IN_FLIGHT.has(s.clip?.status)) return;
      if (s.clip.taskId) {
        jobs.push(collect(ctx, project.id, s.id, s.clip.taskId, { ledgerDir, deps: d })
          .catch((e) => console.warn(`[cartoon] collecting ${s.clip.taskId} failed: ${e?.message || e}`)));
        return;
      }
      releaseSpend(ledgerDir, filmLedgerKey(project.id, s.id));
      const parent = project.shots[i - 1]?.clip;
      const parentComes = parent?.status === "done" || (IN_FLIGHT.has(parent?.status) && Boolean(parent.taskId));
      endShot(ctx.dataDir, project.id, s.id, null, isChained(s, i) && !parentComes
        ? { status: "waiting", error: waitingFor(i) }
        : { status: "error", error: INTERRUPTED });
    });
    if (!jobs.length) continue;
    count += jobs.length;
    runs.add(project.id);
    pending.push(Promise.allSettled(jobs).finally(() => runs.delete(project.id)));
  }
  await Promise.all(pending);
  return count;
}
