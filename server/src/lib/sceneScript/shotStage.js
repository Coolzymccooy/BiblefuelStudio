import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  SEEDANCE_MODELS, clampSeedanceDuration, seedanceRatio,
  submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "../videoGen/providers/seedance.js";
import { estimateTokens, usdForTokens, reserveSpend, settleSpend, releaseSpend, isReserved } from "../videoGen/spend.js";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { addClip, getClip } from "../visualLibrary/store.js";
import { readProject, updateProject, projectOutputDir } from "./projectStore.js";
import { promptForShot, shotSpans, SHOT_TARGET_SEC } from "./shots.js";

/**
 * Order each shot's clip from Seedance (Mini, 720p, text-to-video), through
 * the shared spend ledger, and keep every clip in the user's visual library.
 * The task id is saved on the shot before waiting, so after a restart the
 * clip is collected instead of ordered (and paid for) again. A shot can take
 * a library clip instead, which costs nothing.
 */

export const SHOT_CONCURRENCY = 4;
export const SHOT_MODEL = SEEDANCE_MODELS.mini;
export const SHOT_RESOLUTION = "720p";
const IN_FLIGHT = new Set(["queued", "generating"]);
const NOT_CHARGED = new Set(["FAILED", "NOT_FOUND", "REFUSED"]);

export function benchmarkUsd() {
  const v = Number(process.env.SCENE_SCRIPT_BENCHMARK_USD);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

export const defaultDeps = Object.freeze({
  submit: submitSeedanceTask,
  wait: waitForSeedanceTask,
  download: downloadSeedanceVideo,
  ffmpeg: runFfmpeg,
  probe: probeAudioDurationSec,
});

const runs = new Set();
const cancels = new Set();
export const isOrderingShots = (id) => runs.has(id);
export const cancelShots = (id) => cancels.add(id);
export const ledgerKey = (projectId, shotId) => `ss:${projectId}:${shotId}`;

/** The prompt sent for a shot: the operator's own, else built from the visual. */
export function shotPrompt(project, shot) {
  if (shot.prompt && String(shot.prompt).trim()) return String(shot.prompt).trim();
  return promptForShot({
    text: shot.text, lead: project.look?.lead, montage: shot.montage,
    peopleNote: project.look?.peopleNote, framing: shot.framing, style: project.look?.style,
  });
}

/** How long the clip for each shot should be (4–12 s), from the timeline or, before voicing, the script. */
export function clipSeconds(project) {
  const out = {};
  if (project.timeline) {
    for (const span of shotSpans(project.shots, project.timeline)) out[span.id] = clampSeedanceDuration(span.seconds + 0.3);
  }
  for (const s of project.shots) if (!out[s.id]) out[s.id] = SHOT_TARGET_SEC;
  return out;
}

const hasClip = (shot) => shot.clip?.status === "done" && shot.clip.libraryId;

function pickShots(project, only) {
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  return project.shots.filter((s) => (wanted ? wanted.has(s.id) : !hasClip(s)) && !IN_FLIGHT.has(s.clip?.status));
}

/** What ordering would cost, and what this video's clips have cost so far. */
export function estimateShots(project, only) {
  const ratio = seedanceRatio(project.meta?.aspect);
  const secs = clipSeconds(project);
  const shots = pickShots(project, only);
  let tokens = 0;
  let seconds = 0;
  for (const s of shots) {
    if (canRefetch(s)) continue;
    seconds += secs[s.id];
    tokens += estimateTokens({ durationSec: secs[s.id], ratio, resolution: SHOT_RESOLUTION });
  }
  const usd = usdForTokens({ model: SHOT_MODEL, resolution: SHOT_RESOLUTION, tokens });
  const paid = shots.filter((s) => !canRefetch(s));
  const spentUsd = Number(project.spentUsd) || 0;
  const benchmark = benchmarkUsd();
  return {
    clips: paid.length, refetch: shots.length - paid.length, seconds, tokens, usd, shotIds: shots.map((s) => s.id),
    fromLibrary: project.shots.filter((s) => s.clip?.fromLibrary).length,
    spentUsd, totalUsd: spentUsd + usd, benchmarkUsd: benchmark, overBenchmark: spentUsd + usd > benchmark + 1e-9,
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

function failShot(dataDir, id, shotId, taskId, message) {
  patchShot(dataDir, id, shotId, (s) => (
    IN_FLIGHT.has(s.clip?.status) && (s.clip.taskId ?? null) === (taskId ?? null)
      ? { ...s, clip: { ...s.clip, status: "error", error: message } }
      : null
  ));
}

export async function makePoster(deps, clipFile, posterFile) {
  const r = await deps.ffmpeg(["-y", "-v", "error", "-ss", "1", "-i", clipFile, "-frames:v", "1", "-q:v", "3", posterFile]);
  return r.ok && fs.existsSync(posterFile) ? posterFile : null;
}

/**
 * Count a task's cost once. The ledger settles only while the reservation
 * stands (settling removes it in the same write), and the project total moves
 * in the same write that marks the shot charged for this task, so collecting
 * again after a restart never charges twice.
 */
function chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens }) {
  const key = ledgerKey(id, shotId);
  const spend = { model: SHOT_MODEL, resolution: SHOT_RESOLUTION, tokens };
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

/** BytePlus keeps a finished clip's URL for 24 h. A paid clip that failed to download can be fetched again until then. */
const REFETCH_MS = 23 * 60 * 60 * 1000;
export const canRefetch = (shot, now = Date.now()) => shot.clip?.status === "error"
  && Boolean(shot.clip.taskId) && shot.clip.chargedTaskId === shot.clip.taskId
  && now - (Number(shot.clip.startedAt) || 0) < REFETCH_MS;

const DOWNLOAD_TRIES = 3;

export async function downloadClip(deps, url, file) {
  for (let i = 1; ; i += 1) {
    try {
      await deps.download(url, file);
      return null;
    } catch (e) {
      fs.rmSync(file, { force: true });
      if (i >= DOWNLOAD_TRIES) return String(e?.message || e);
      await new Promise((r) => setTimeout(r, (deps.retryDelayMs ?? 2000) * i));
    }
  }
}

async function collect(ctx, id, shotId, taskId, { ledgerDir, deps }) {
  const done = await deps.wait(taskId);
  const project = readProject(ctx.dataDir, id);
  const shot = project?.shots.find((s) => s.id === shotId);
  const secs = shot?.clip?.seconds || SHOT_TARGET_SEC;
  const estimated = () => estimateTokens({ durationSec: secs, ratio: seedanceRatio(project?.meta?.aspect), resolution: SHOT_RESOLUTION });
  if (!done.ok) {
    if (NOT_CHARGED.has(done.code)) {
      releaseSpend(ledgerDir, ledgerKey(id, shotId));
    } else {
      // Unknown outcome (timeout, auth): BytePlus may still bill it, so the estimate is counted.
      chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens: estimated() });
    }
    const refused = /sensitive|copyright|declined/i.test(done.error || "");
    return failShot(ctx.dataDir, id, shotId, taskId, refused
      ? "BytePlus declined this shot's prompt. Reword it and try again."
      : `BytePlus did not return this clip (${done.error}).`);
  }
  const tokens = Number(done.tokens) > 0 ? done.tokens : estimated();
  const costUsd = chargeShot(ctx, id, shotId, taskId, { ledgerDir, tokens });
  const tmpDir = path.join(projectOutputDir(ctx.outputDir, id), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `${randomUUID()}.mp4`);
  const downloadError = await downloadClip(deps, done.videoUrl, file);
  if (downloadError) {
    console.warn(`[scene-script] clip ${taskId} paid but not downloaded: ${downloadError}`);
    return failShot(ctx.dataDir, id, shotId, taskId, "The clip was made and paid for but could not be downloaded. Choose Make this clip within a day to fetch it again at no cost.");
  }
  const poster = await makePoster(deps, file, `${file}.jpg`);
  const durationSec = Number(await deps.probe(file)) || secs;
  const clip = addClip(ctx, {
    file, posterFile: poster, prompt: shot?.clip?.prompt || "", lead: project?.look?.lead || "",
    model: SHOT_MODEL, resolution: SHOT_RESOLUTION, aspect: project?.meta?.aspect || "portrait",
    durationSec, tokens, costUsd, taskId, source: { kind: "scene-script", projectId: id, shotId },
    tags: [project?.meta?.title].filter(Boolean),
  });
  patchShot(ctx.dataDir, id, shotId, (s) => (s.clip?.taskId === taskId ? {
    ...s,
    clip: { status: "done", libraryId: clip.id, url: clip.url, posterUrl: clip.posterUrl, durationSec, costUsd, fromLibrary: false, prompt: clip.prompt },
    // Trim points and framing were set for the old clip.
    refine: null,
  } : null));
  return undefined;
}

async function orderOne(ctx, id, shotId, { ledgerDir, deps }) {
  const project = readProject(ctx.dataDir, id);
  const shot = project?.shots.find((s) => s.id === shotId);
  if (shot?.clip?.status === "generating" && shot.clip.taskId) return collect(ctx, id, shotId, shot.clip.taskId, { ledgerDir, deps });
  if (!shot || shot.clip?.status !== "queued") return;
  const seconds = shot.clip.seconds;
  const ratio = seedanceRatio(project.meta?.aspect);
  const estimate = usdForTokens({ model: SHOT_MODEL, resolution: SHOT_RESOLUTION, tokens: estimateTokens({ durationSec: seconds, ratio, resolution: SHOT_RESOLUTION }) });
  const key = ledgerKey(id, shotId);
  const reserved = reserveSpend(ledgerDir, key, estimate);
  if (!reserved.ok) return failShot(ctx.dataDir, id, shotId, null, reserved.error);
  const submitted = await deps.submit({ prompt: shot.clip.prompt, aspect: project.meta?.aspect, durationSec: seconds, model: SHOT_MODEL, resolution: SHOT_RESOLUTION });
  if (!submitted.ok) {
    releaseSpend(ledgerDir, key);
    return failShot(ctx.dataDir, id, shotId, null, submitted.code === "REFUSED"
      ? "BytePlus declined this shot's prompt. Reword it and try again." : submitted.error);
  }
  patchShot(ctx.dataDir, id, shotId, (s) => (s.clip?.status === "queued"
    ? { ...s, clip: { ...s.clip, status: "generating", taskId: submitted.taskId, startedAt: Date.now() } } : null));
  return collect(ctx, id, shotId, submitted.taskId, { ledgerDir, deps });
}

async function runShots(ctx, id, ids, opts) {
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const shotId = queue.shift();
      if (cancels.has(id)) { failShot(ctx.dataDir, id, shotId, null, "Stopped before this clip was ordered."); continue; }
      try {
        await orderOne(ctx, id, shotId, opts);
      } catch (e) {
        // Once a task is submitted BytePlus may bill it, so its reservation stays until it is collected.
        const taskId = readProject(ctx.dataDir, id)?.shots.find((s) => s.id === shotId)?.clip?.taskId ?? null;
        if (!taskId) releaseSpend(opts.ledgerDir, ledgerKey(id, shotId));
        console.warn(`[scene-script] shot ${shotId} of ${id} failed: ${e?.message || e}`);
        failShot(ctx.dataDir, id, shotId, taskId, "Something went wrong making this clip. Try again.");
      }
    }
  };
  await Promise.allSettled(Array.from({ length: Math.min(SHOT_CONCURRENCY, ids.length) }, worker));
}

/**
 * Queue the chosen shots (all shots with no clip when only is absent) and
 * order them in the background. Returns the project as written, or null when
 * a run is going or nothing needs ordering.
 */
export function startShots(ctx, id, { only, ledgerDir, deps } = {}) {
  if (runs.has(id)) return null;
  const project = readProject(ctx.dataDir, id);
  if (!project) return null;
  const picked = new Set(pickShots(project, only).map((s) => s.id));
  if (!picked.size) return null;
  const secs = clipSeconds(project);
  const written = updateProject(ctx.dataDir, id, (p) => ({
    ...p,
    shots: p.shots.map((s) => (picked.has(s.id) && canRefetch(s)
      ? { ...s, clip: { ...s.clip, status: "generating", error: null } }
      : picked.has(s.id)
      ? { ...s, clip: { status: "queued", taskId: null, error: null, seconds: secs[s.id], prompt: shotPrompt(p, s), previous: hasClip(s) ? s.clip : s.clip?.previous || null } }
      : s)),
  }));
  runs.add(id);
  cancels.delete(id);
  runShots(ctx, id, [...picked], { ledgerDir, deps: { ...defaultDeps, ...deps } })
    .catch((e) => console.warn(`[scene-script] shots ${id} failed: ${e?.message || e}`))
    .finally(() => { runs.delete(id); cancels.delete(id); });
  return written;
}

/** Use a clip already in the library for a shot. Costs nothing. */
export function useLibraryClip(ctx, id, shotId, clipId) {
  const clip = getClip(ctx.dataDir, clipId);
  if (!clip) return { ok: false, status: 404, error: "That clip is not in your library." };
  const project = readProject(ctx.dataDir, id);
  const shot = project?.shots.find((s) => s.id === shotId);
  if (!shot) return { ok: false, status: 404, error: "Shot not found." };
  if (IN_FLIGHT.has(shot.clip?.status)) return { ok: false, status: 409, error: "This shot's clip is still being made." };
  const written = updateProject(ctx.dataDir, id, (p) => ({
    ...p,
    shots: p.shots.map((s) => (s.id === shotId ? {
      ...s,
      clip: { status: "done", libraryId: clip.id, url: clip.url, posterUrl: clip.posterUrl, durationSec: clip.durationSec, costUsd: 0, fromLibrary: true, prompt: clip.prompt },
      refine: null,
    } : s)),
  }));
  return { ok: true, project: written };
}

/**
 * After a restart: collect clips that were ordered and fail shots that were
 * queued but never ordered. Resolves with the number being collected.
 */
export async function resumeShots(ctx, projects, { ledgerDir, deps } = {}) {
  const d = { ...defaultDeps, ...deps };
  let count = 0;
  const pending = [];
  for (const project of projects) {
    if (runs.has(project.id)) continue;
    const jobs = [];
    for (const s of project.shots || []) {
      if (!IN_FLIGHT.has(s.clip?.status)) continue;
      if (!s.clip.taskId) {
        releaseSpend(ledgerDir, ledgerKey(project.id, s.id));
        failShot(ctx.dataDir, project.id, s.id, null, "Interrupted by a server restart before the clip was ordered. Order it again.");
        continue;
      }
      jobs.push(collect(ctx, project.id, s.id, s.clip.taskId, { ledgerDir, deps: d })
        .catch((e) => console.warn(`[scene-script] collecting ${s.clip.taskId} failed: ${e?.message || e}`)));
    }
    if (!jobs.length) continue;
    count += jobs.length;
    runs.add(project.id);
    pending.push(Promise.allSettled(jobs).finally(() => runs.delete(project.id)));
  }
  await Promise.all(pending);
  return count;
}
