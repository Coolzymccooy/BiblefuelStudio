import { readProject, writeProject, STORY_STATUS } from "./projectStore.js";

/**
 * Telling a story step that is still running from one a restart or deploy
 * killed (R50). A killed step leaves its project marked busy forever; GET
 * /api/story/:id flags it `interrupted` when nothing for the project is live
 * in this process and its last sign of life (a heartbeat, or a write that set
 * updatedAt) is over two minutes old. Steps beat every 30 s while they run,
 * and once as soon as they start, so a step still running in another process
 * (a deploy's overlap) is not flagged.
 */

const HEARTBEAT_MS = 30_000;
// Four missed heartbeats: long enough that a busy box is not flagged.
export const STALE_AFTER_MS = 2 * 60_000;

let _heartbeatMs = HEARTBEAT_MS;
export function _setStoryHeartbeatMsForTests(ms) { _heartbeatMs = Number(ms) > 0 ? Number(ms) : HEARTBEAT_MS; }

const STEP_STATUSES = new Set([STORY_STATUS.TRANSCRIBING, STORY_STATUS.SEGMENTING, STORY_STATUS.RENDERING]);
const CLIP_IN_FLIGHT = new Set(["queued", "generating"]);

/**
 * The step a project shows as running, or null when it is idle: transcribing,
 * segmenting or rendering; generating_images only while a scene is being made
 * (a run the image quota stopped leaves the status with nothing running); or
 * "animating" while AI clips are in flight. Narration has its own `alive` flag.
 */
export function busyStep(project) {
  const status = project?.status;
  if (STEP_STATUSES.has(status)) return status;
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  if (status === STORY_STATUS.GENERATING_IMAGES && scenes.some((s) => s?.imageStatus === "generating")) return status;
  if (scenes.some((s) => CLIP_IN_FLIGHT.has(s?.aiVideoStatus))) return "animating";
  return null;
}

/** True when a busy project's last sign of life (heartbeat or updatedAt) is older than two minutes. */
export function signOfLifeStale(project, now = Date.now()) {
  const lastSign = Math.max(Number(project?.heartbeatAt) || 0, Number(project?.updatedAt) || 0);
  return now - lastSign > STALE_AFTER_MS;
}

const running = new Map();

/** Is a step wrapped by asRunningStoryStep running for this project in this process? */
export function isStoryStepRunning(projectId) { return (running.get(String(projectId)) || 0) > 0; }

/**
 * One heartbeat onto the project as stored now. Read and write are synchronous,
 * so no step's write lands between them; a step that later writes an older copy
 * of the project drops the stamp only until the next beat. An idle or deleted
 * project is left alone.
 */
function beat(dataDir, projectId) {
  try {
    const live = readProject(dataDir, projectId);
    if (live && busyStep(live)) writeProject(dataDir, { ...live, heartbeatAt: Date.now() });
  } catch { /* a missed beat is only a later one */ }
}

/** Run `work` as a step of this project: listed as running, with a heartbeat, until it settles. */
export async function asRunningStoryStep(ctx, projectId, work) {
  const id = String(projectId);
  running.set(id, (running.get(id) || 0) + 1);
  const timer = setInterval(() => beat(ctx.dataDir, id), _heartbeatMs);
  timer.unref?.();
  try {
    // The work's synchronous start has written its busy status by now.
    const settled = work();
    beat(ctx.dataDir, id);
    return await settled;
  } finally {
    clearInterval(timer);
    const left = (running.get(id) || 1) - 1;
    if (left > 0) running.set(id, left); else running.delete(id);
  }
}
