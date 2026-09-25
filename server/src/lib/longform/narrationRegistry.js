// In-process registry of long-form projects whose narration run is currently
// in flight. It lives here (not in routes/longform.js) because two routers
// need it: longform.js marks/clears runs, and story.js's GET /:id reports
// whether the narration a project claims to be doing is actually alive in
// this process. A server restart empties the set — that is the signal the
// client uses to offer Resume straight away instead of waiting out a stall
// timer on a run that will never progress.

/** @type {Set<string>} */
const active = new Set();

export function markNarrationActive(projectId) { active.add(projectId); }
export function clearNarrationActive(projectId) { active.delete(projectId); }
export function isNarrationActive(projectId) { return active.has(projectId); }
