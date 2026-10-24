/**
 * The building blocks every job-kind normaliser shares (jobs.js and songJobs.js):
 * the status words routes use, percent and text clean-up, and the handle itself.
 * Kept apart from jobs.js so normalisers in other files can use them without an
 * import cycle.
 */

const STATUS_WORDS = {
  queued: "queued",
  running: "running",
  done: "done",
  complete: "done",
  completed: "done",
  failed: "failed",
  error: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const CANCEL_MESSAGE = /^(render |job )?cancell?ed\.?$/i;

// encodeURIComponent leaves "." and ".." as they are, and fetch then folds them, moving the route up a level.
const ROUTE_CHANGING_IDS = new Set(["", ".", ".."]);

/**
 * Why `value` cannot be a job or project id in a status route, or null when it can. `field` names it
 * in the message ("id" or "projectId"). Every job tool, the job resource and the route builders share it.
 */
export function jobIdProblem(field, value) {
  if (!ROUTE_CHANGING_IDS.has(String(value ?? ""))) return null;
  return `${field} is not a valid id: it may not be empty, "." or "..". Pass the ${field} from the handle that started the job.`;
}

/** The id as one encoded route segment; throws a BAD_INPUT error for an id that would change the route. */
export function routeSegment(value, field = "id") {
  const problem = jobIdProblem(field, value);
  if (problem) throw Object.assign(new Error(problem), { code: "BAD_INPUT" });
  return encodeURIComponent(String(value));
}

/** The first problem with a handle's id and (when given) projectId, or null. */
export function jobAddressProblem({ id, projectId }) {
  return jobIdProblem("id", id) || (projectId === undefined ? null : jobIdProblem("projectId", projectId));
}

/** A percent (clamped to 0..100) from a number, or from `{ percent }` / `{ pct }`; anything else is null. */
export function toPercent(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  if (value && typeof value === "object") return toPercent(value.percent ?? value.pct);
  return null;
}

/** A trimmed non-empty string, else null. */
export function text(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}

/**
 * Builds a handle from one route's already-picked fields. An unrecognised
 * status is still running work, with the raw word kept as the phase.
 */
export function toHandle(fields, { outputUrl: toUrl }) {
  const { kind, id, rawStatus, percent = null, phase = null, file = null, url = null, error = null } = fields;
  const known = STATUS_WORDS[String(rawStatus || "").toLowerCase()];
  let status = known || "running";
  const errorText = text(error);
  if (status === "failed" && errorText && CANCEL_MESSAGE.test(errorText)) status = "cancelled";
  const rawPhase = known ? phase : phase || text(rawStatus);
  const where = text(url) || text(file);
  return {
    kind,
    id: String(id ?? ""),
    status,
    percent: status === "done" ? (percent ?? 100) : percent,
    phase: rawPhase || null,
    output: where ? { url: toUrl(where), path: text(file) } : null,
    error: errorText,
  };
}
