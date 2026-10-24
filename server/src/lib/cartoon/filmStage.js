import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  SEEDANCE_MODELS, seedanceRatio, submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "../videoGen/providers/seedance.js";
import {
  estimateTokens, usdForTokens, holdSpend, drawSpend, shrinkHold, releaseSpend, releaseReservations,
} from "../videoGen/spend.js";
import { chargeTaskOnce } from "../videoGen/chargeOnce.js";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { addClip } from "../visualLibrary/store.js";
import { downloadClip, makePoster } from "../sceneScript/shotStage.js";
import { clipPrompt, referencedCast } from "./prompts.js";
import { transcribeClip, speechScore, speechWindows, SPEECH_OK } from "./speech.js";
import { readProject, updateProject, projectOutputDir } from "./store.js";
import { runInOrder } from "./chain.js";
import { picturesFor, isChained, asOrdered, waitingFor } from "./shotPictures.js";
import { fetchesAgain } from "./model.js";
import { listNames } from "./edits.js";

export { lastFrameOf } from "./shotPictures.js";

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
 *    it, so it waits for that shot (shotPictures.js picks the pictures,
 *    chain.js decides when each shot runs);
 *  - audio is generated and a picture refusal never falls back to text, which
 *    would drop the approved face; a refusal marks the shot "refused";
 *  - after download the clip's speech windows are found and a line's speech is
 *    checked against the script. A mismatch is only flagged, never re-made;
 *  - a re-make that ends without a new clip (refused, failed, stopped, cut off
 *    by a restart) puts the earlier paid clip back, with `remakeError` saying
 *    why, so the film never has to be paid for twice. A paid re-make that could
 *    not be downloaded is kept on `remake` and is fetched later at no cost;
 *  - the whole run is paid for up front (spec section 7.6: never half-made):
 *    startFilm holds every clip's estimate in one ledger write, checked
 *    against the cap in that same write, so a second film (or any other AI
 *    video order) started a moment later already counts it. Each clip then
 *    draws its own reservation out of the hold, which the cap never refuses,
 *    and whatever is left of the hold is released when the run ends. A shot
 *    that ends before it draws (stopped, picture refused) gives its share
 *    back at once. A hold left by a run a restart cut off is released on
 *    resume, and at boot.
 *
 * Clip states: queued, generating, waiting, done, error, refused.
 */

export const FILM_CONCURRENCY = 4;
export const FILM_MODEL = SEEDANCE_MODELS.mini;
export const FILM_RESOLUTION = "720p";
const IN_FLIGHT = new Set(["queued", "generating"]);
const NOT_CHARGED = new Set(["FAILED", "NOT_FOUND", "REFUSED"]);

const STOPPED = "Stopped before this clip was ordered.";
const INTERRUPTED = "Interrupted by a server restart before the clip was ordered. Order it again.";
const GENERIC = "Something went wrong making this clip. Try again.";
const DECLINED = "BytePlus declined this shot. Change its note or action and try again.";
const PERSON_FRESH = "BytePlus thinks a character picture shows a real person. Make that portrait again.";
const PERSON_CHAINED = "BytePlus thinks this shot's starting picture shows a real person. Make the shot before it again.";
const NOT_FETCHED = "The clip was made and paid for but could not be downloaded. Order this shot again within a day to fetch it at no cost.";
const SPEECH_FAILED = "The speech check could not run.";
const AFTER_PARENT = "The shot before it was not re-made, so this one was not either.";
/** Failures that say the task will never give a clip: a re-wait ending in one is not tried again. */
const DEFINITE = new Set(["FAILED", "NOT_FOUND", "REFUSED", "NO_VIDEO"]);
/** What a paid clip needs to be fetched again (see canRefetch in sceneScript/shotStage.js). */
const REFETCH_FIELDS = ["taskId", "chargedTaskId", "startedAt", "seconds", "prompt", "references"];

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
/** The ledger key of a run's hold; its own prefix, so no clip key ever matches it. */
export const FILM_HOLD_PREFIX = "cartoon-film:";
export const filmHoldKey = (projectId) => `${FILM_HOLD_PREFIX}${projectId}`;

/** Stop a running film: shots not yet ordered fail; ordered ones are still collected. False when nothing runs. */
export function cancelFilm(id) {
  if (!runs.has(id)) return false;
  cancels.add(id);
  return true;
}

function pickShots(project, only) {
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  return project.shots.filter((s) => (wanted ? wanted.has(s.id) : s.clip?.status !== "done") && !IN_FLIGHT.has(s.clip?.status));
}

/** A new queued clip. The reference names are fixed now, so the prompt's "reference picture N" and the files agree. */
function queuedClip(project, shot, index) {
  const ordered = asOrdered(shot, index);
  const { previous: _older, remake: _remake, remakeError: _why, ...current } = shot.clip || {};
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

/**
 * How a clip ends without a new clip. A re-make of a done shot puts the
 * earlier clip back and says why (`remakeError`); a paid re-make that can
 * still be fetched rides along on `remake`. Anything else just takes the patch.
 */
function endedClip(clip, patch) {
  const earlier = clip.previous;
  if (earlier?.status !== "done" || !earlier.libraryId) return { ...clip, ...patch };
  const ended = { ...clip, ...patch };
  const why = patch.status === "waiting" ? AFTER_PARENT : patch.error || GENERIC;
  const kept = { ...earlier, remakeError: why };
  if (!fetchesAgain({ clip: ended })) return kept;
  return { ...kept, remake: Object.fromEntries(REFETCH_FIELDS.filter((k) => ended[k] !== undefined).map((k) => [k, ended[k]])) };
}

/** End an in-flight shot (error, refused or waiting), only while it is still on this task. */
function endShot(dataDir, id, shotId, taskId, patch) {
  patchShot(dataDir, id, shotId, (s) => (
    IN_FLIGHT.has(s.clip?.status) && (s.clip.taskId ?? null) === (taskId ?? null)
      ? { ...s, clip: endedClip(s.clip, patch) }
      : null
  ));
}

/** A fresh shot's person refusal names the portraits it was sent with. */
function personFresh(references) {
  const names = Array.isArray(references) ? references : [];
  if (names.length === 1) return `BytePlus thinks ${names[0]}'s portrait shows a real person. Make that portrait again.`;
  if (names.length > 1) return `BytePlus thinks one of these portraits shows a real person: ${listNames(names)}. Make them again.`;
  return PERSON_FRESH;
}

/** Why a submit failed, as the shot's end state. Nothing was created, so nothing is charged. */
function submitFailure(submitted, chained, references) {
  if (submitted.code === "PERSON_REFUSED") return { status: "refused", error: chained ? PERSON_CHAINED : personFresh(references) };
  if (submitted.code === "REFUSED") return { status: "refused", error: DECLINED };
  return { status: "error", error: submitted.error || GENERIC };
}

/** Count a task's cost once (see chargeOnce.js): collecting again after a restart never charges twice. */
function chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens }) {
  return chargeTaskOnce({
    ledgerDir, key: filmLedgerKey(id, shotId), shotId, taskId,
    spend: { model: FILM_MODEL, resolution: FILM_RESOLUTION, tokens },
    update: (fn) => updateProject(ctx.dataDir, id, fn),
  });
}

/** What a clip of this length is expected to cost in tokens, for a task whose real count is unknown. */
function estimatedTokens(project, seconds) {
  return estimateTokens({ durationSec: seconds, ratio: seedanceRatio(project?.meta?.aspect), resolution: FILM_RESOLUTION });
}

/** What one clip of this length is reserved at: the hold and each clip's draw use this same figure. */
function clipUsd(project, seconds) {
  return usdForTokens({ model: FILM_MODEL, resolution: FILM_RESOLUTION, tokens: estimatedTokens(project, seconds) });
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
    if (!heard?.ok) return { windows, speech: { ok: null, error: String(heard?.error || SPEECH_FAILED) } };
    const score = speechScore(line, heard.text);
    return { windows, speech: { heard: heard.text, score: Math.round(score * 100) / 100, ok: score >= SPEECH_OK } };
  } catch {
    // A fixed sentence: an error's own text can carry a server path to the page.
    return { windows, speech: { ok: null, error: SPEECH_FAILED } };
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
  // Waiting again on a task already charged: a paid clip whose download failed.
  const rewait = Boolean(taskId) && shot?.clip?.chargedTaskId === taskId;
  if (!done.ok) {
    const free = NOT_CHARGED.has(done.code);
    if (free) releaseSpend(ledgerDir, filmLedgerKey(id, shotId));
    // Unknown outcome (timeout, auth): BytePlus may still bill it, so the estimate is counted.
    else chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens: estimatedTokens(project, secs) });
    // Only a free failure is a refusal; a charged one is an error, whatever its text says.
    const refused = free && (done.code === "REFUSED" || /sensitive|copyright|declined/i.test(done.error || ""));
    // A re-wait that can never give the clip ends the free fetch, so the next Retry orders anew.
    const deadEnd = rewait && DEFINITE.has(done.code) ? { refetchable: false } : {};
    return endShot(ctx.dataDir, id, shotId, taskId, refused
      ? { status: "refused", error: DECLINED, ...deadEnd }
      : { status: "error", error: `BytePlus did not return this clip (${done.error}).`, ...deadEnd });
  }
  const tokens = Number(done.tokens) > 0 ? done.tokens : estimatedTokens(project, secs);
  const costUsd = chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens });
  const tmpDir = path.join(projectOutputDir(ctx.outputDir, id), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `${randomUUID()}.mp4`);
  try {
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
  } finally {
    // The library keeps its own copies; nothing of this clip is left in tmp/.
    removeQuietly(file);
    removeQuietly(`${file}.jpg`);
  }
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}

/**
 * A queued shot is ending before it drew its reservation: give its share of
 * the run's hold back now, so another order can use it before the run ends.
 * At most once per shot per run (`opts.shares` records shots drawn or given
 * back), so the hold never shrinks below what the other shots still need.
 */
function giveShareBack(ctx, id, shotId, opts) {
  if (!opts.shares || opts.shares.has(shotId)) return;
  opts.shares.add(shotId);
  const project = readProject(ctx.dataDir, id);
  const clip = project?.shots.find((s) => s.id === shotId)?.clip;
  // A free re-fetch was never part of the hold.
  if (clip?.status === "queued") shrinkHold(opts.ledgerDir, filmHoldKey(id), clipUsd(project, clip.seconds));
}

async function orderOne(ctx, id, shotId, opts) {
  const { ledgerDir, deps } = opts;
  const project = readProject(ctx.dataDir, id);
  const index = project ? project.shots.findIndex((s) => s.id === shotId) : -1;
  const shot = project?.shots[index];
  if (shot?.clip?.status === "generating" && shot.clip.taskId) return collect(ctx, id, shotId, shot.clip.taskId, { ledgerDir, deps });
  if (!shot || shot.clip?.status !== "queued") return undefined;
  const endUndrawn = (patch) => {
    giveShareBack(ctx, id, shotId, opts);
    return endShot(ctx.dataDir, id, shotId, null, patch);
  };
  if (cancels.has(id)) return endUndrawn({ status: "error", error: STOPPED });
  const chained = isChained(shot, index);
  const pictures = await picturesFor(ctx, project, index, deps);
  if (!pictures.ok) return endUndrawn({ status: pictures.status || "error", error: pictures.error });
  if (cancels.has(id)) return endUndrawn({ status: "error", error: STOPPED });
  const seconds = shot.clip.seconds;
  const key = filmLedgerKey(id, shotId);
  // Out of the run's hold: what startFilm held for this clip is never refused by the cap.
  const reserved = drawSpend(ledgerDir, filmHoldKey(id), key, clipUsd(project, seconds));
  if (!reserved.ok) return endUndrawn({ status: "error", error: reserved.error });
  opts.shares?.add(shotId);
  const submitted = await deps.submit({
    prompt: shot.clip.prompt, aspect: project.meta?.aspect, durationSec: seconds, model: FILM_MODEL, resolution: FILM_RESOLUTION,
    generateAudio: true, allowTextFallback: false, seed: project.seed, ...pictures.input,
  });
  if (!submitted.ok) {
    releaseSpend(ledgerDir, key);
    return endShot(ctx.dataDir, id, shotId, null, submitFailure(submitted, chained, shot.clip.references));
  }
  patchShot(ctx.dataDir, id, shotId, (s) => (s.clip?.status === "queued"
    ? { ...s, clip: { ...s.clip, status: "generating", taskId: submitted.taskId, startedAt: Date.now() } } : null));
  return collect(ctx, id, shotId, submitted.taskId, { ledgerDir, deps });
}

async function orderSafely(ctx, id, shotId, opts) {
  try {
    await orderOne(ctx, id, shotId, opts);
  } catch (e) {
    const project = readProject(ctx.dataDir, id);
    const clip = project?.shots.find((s) => s.id === shotId)?.clip;
    const taskId = clip?.taskId ?? null;
    if (!taskId) {
      giveShareBack(ctx, id, shotId, opts);
      releaseSpend(opts.ledgerDir, filmLedgerKey(id, shotId));
    } else if (clip.chargedTaskId !== taskId) {
      // A submitted task may be billed: settle the estimate (as for a timeout) rather than leave the reservation stuck.
      chargeShot(ctx, id, shotId, taskId, { ledgerDir: opts.ledgerDir, tokens: estimatedTokens(project, clip.seconds || 4) });
    }
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
  const run = { ...opts, shares: new Set() };
  return runInOrder(ids, { parentOf, concurrency: FILM_CONCURRENCY, run: (shotId) => orderSafely(ctx, id, shotId, run) });
}

/**
 * The clip a shot starts from when ordering it only fetches a paid clip again:
 * the failed clip itself, or a done shot's paid re-make (the done clip becomes
 * its `previous`, as for any re-make).
 */
function refetchClip(shot) {
  if (shot.clip.status !== "done") return { ...shot.clip, status: "generating", error: null };
  const { remake, remakeError: _why, previous: _older, ...earlier } = shot.clip;
  return { ...remake, status: "generating", error: null, previous: earlier };
}

/**
 * Queue the chosen shots (every shot without a done clip when `only` is
 * absent; `only` may name done shots, which is a paid re-make) and order them
 * in the background. A shot whose paid clip can still be fetched is fetched
 * again instead, at no cost.
 *
 * Every paid clip of the run is held on the ledger first, in the same
 * synchronous step as the cap check (see the module comment). `budgetUsd` is
 * what must fit under the cap, when that is more than the run's own price (the
 * route counts the whole remaining film for a Retry); only the run's own price
 * is held. Free re-fetches hold nothing.
 *
 * Returns the project as written; null when a run is going, the project is
 * missing, or nothing needs ordering; or `{ ok: false, code: "BUDGET", error }`
 * when the cap refuses, in which case nothing is held or queued.
 */
export function startFilm(ctx, id, { only, ledgerDir, deps, budgetUsd = 0 } = {}) {
  if (runs.has(id)) return null;
  const project = readProject(ctx.dataDir, id);
  if (!project) return null;
  const pickedShots = pickShots(project, only);
  if (!pickedShots.length) return null;
  const picked = new Set(pickedShots.map((s) => s.id));
  // Decided once, so the hold covers exactly the shots queued as paid orders.
  const refetch = new Set(pickedShots.filter((s) => fetchesAgain(s)).map((s) => s.id));
  const holdUsd = pickedShots.filter((s) => !refetch.has(s.id)).reduce((sum, s) => sum + clipUsd(project, s.seconds), 0);
  const holdKey = filmHoldKey(id);
  if (holdUsd > 0) {
    const held = holdSpend(ledgerDir, holdKey, holdUsd, { checkUsd: Math.max(holdUsd, Number(budgetUsd) || 0) });
    if (!held.ok) return { ok: false, code: "BUDGET", error: held.error };
  }
  let written = null;
  try {
    written = updateProject(ctx.dataDir, id, (p) => ({
      ...p,
      shots: p.shots.map((s, i) => {
        if (!picked.has(s.id)) return s;
        if (refetch.has(s.id)) return { ...s, clip: refetchClip(s) };
        return { ...s, clip: queuedClip(p, s, i) };
      }),
    }));
  } finally {
    if (!written) releaseSpend(ledgerDir, holdKey);
  }
  if (!written) return null;
  runs.add(id);
  cancels.delete(id);
  const ids = written.shots.filter((s) => picked.has(s.id)).map((s) => s.id);
  // Started on the next tick so even a synchronous throw lands in catch and the run is always cleared.
  Promise.resolve()
    .then(() => runFilm(ctx, id, ids, { ledgerDir, deps: { ...defaultDeps, ...deps } }))
    .catch((e) => console.warn(`[cartoon] film ${id} failed: ${e?.message || e}`))
    .finally(() => endRun(id, ledgerDir));
  return written;
}

/** A run is over: release what is left of its hold, then let the cartoon be filmed, edited or deleted again. */
function endRun(id, ledgerDir) {
  try {
    releaseSpend(ledgerDir, filmHoldKey(id));
  } catch (e) {
    // Left for the next resume to release; the run must still end.
    console.warn(`[cartoon] film ${id} hold not released: ${e?.message || e}`);
  } finally {
    runs.delete(id);
    cancels.delete(id);
  }
}

/** Release every film hold not owned by a run in this process. Returns how many were released. */
export function releaseOrphanFilmHolds(ledgerDir) {
  return releaseReservations(ledgerDir, FILM_HOLD_PREFIX, (key) => runs.has(key.slice(FILM_HOLD_PREFIX.length)));
}

/**
 * After a restart: collect clips that were ordered (never charged twice) and
 * end shots that were queued but never ordered. A chained shot whose parent
 * will not be done stays waiting rather than ordering from a missing frame.
 * Resolves with the number of clips collected.
 *
 * Every hold not owned by a run in this process is released first, including
 * one whose cartoon is gone: a hold stands only for clips not yet ordered, and
 * nothing is ordered on resume, so none may outlive the run that made it.
 */
export async function resumeFilm(ctx, projects, { ledgerDir, deps } = {}) {
  const d = { ...defaultDeps, ...deps };
  releaseOrphanFilmHolds(ledgerDir);
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
