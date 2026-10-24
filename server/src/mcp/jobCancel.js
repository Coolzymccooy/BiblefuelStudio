import { routeSegment } from "./jobHandle.js";

/**
 * The cancel route of every job kind that has one (#121), for jobs_cancel. Each entry takes the
 * address and the job's current (running or queued) handle and returns the route to POST, or a
 * refusal `{ code, message }` for work that cannot be stopped. Kinds missing here (lyric_align,
 * timeline, instrumental, publish) have no cancel route. Lives outside tools/ because the
 * registry loads every file there as tools.
 */

const VOICING_MESSAGE = "Voicing cannot be stopped; it finishes on its own in a few seconds per line. Wait for it with jobs_wait.";
const voicing = { code: "VOICING_CANNOT_CANCEL", message: VOICING_MESSAGE };

/** Stops the project's running step, or (while only its AI motion clips are being made) further clip orders. */
function storyCancel({ id, handle }) {
  const suffix = handle.phase === "animating" ? "/animate/cancel" : "/cancel";
  return `/api/story/${routeSegment(id)}${suffix}`;
}

/** The stage the handle shows running: the render first, then clip orders; voicing cannot stop. */
function sceneCancel({ id, handle }) {
  if (handle.phase === "voicing") return voicing;
  const what = handle.phase === "making_shots" ? "shots" : "render";
  return `/api/scene-script/${routeSegment(id)}/${what}/cancel`;
}

export const CANCEL_ROUTES = {
  job: ({ id }) => `/api/jobs/${routeSegment(id)}/cancel`,
  captioned: ({ id }) => `/api/render/captioned-video/${routeSegment(id)}/cancel`,
  story: storyCancel,
  longform: storyCancel,
  ambient: ({ id, handle }) => (handle.phase === "voicing" ? voicing : `/api/ambient/${routeSegment(id)}/cancel`),
  moments: ({ id }) => `/api/moments/${routeSegment(id)}/cancel`,
  scene: sceneCancel,
  lyric_render: ({ id, projectId }) => `/api/lyric-video/${routeSegment(projectId, "projectId")}/render/${routeSegment(id)}/cancel`,
};

export const CANCELLABLE_KINDS = Object.keys(CANCEL_ROUTES);

/** The routers jobs_cancel reads and posts to (the coverage test reads a tool's routes). */
export const CANCEL_ROUTERS = ["/api/jobs", "/api/render", "/api/story", "/api/ambient", "/api/scene-script", "/api/lyric-video", "/api/moments"];
