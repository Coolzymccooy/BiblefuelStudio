/**
 * One place every render reports a failure, so the operator hears about it
 * (index.js points this at the alerter). A cancelled render is not a failure
 * and is never reported. Reporting never throws into the render.
 */

let handler = null;

export function onRenderFailure(fn) {
  handler = typeof fn === "function" ? fn : null;
}

/** @param {string} kind e.g. "story", "scene-script", "timeline" */
export function reportRenderFailure(kind, { jobId = null, userId = null, projectId = null, error = "" } = {}) {
  if (!handler) return;
  try {
    handler({ kind, jobId, userId, projectId, error: String(error || "render failed").slice(0, 1000) });
  } catch {
    // never break the render over a report
  }
}
