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
