/**
 * Error tracking (Sentry). Off unless SENTRY_DSN is set; then crashes,
 * unhandled errors, failed requests and every alert are reported there, and
 * Sentry's alert rules decide who is told. Sentry is loaded only when it is
 * switched on, and nothing here ever throws into the caller.
 */

let sentry = null;

export async function initErrorTracking(env = process.env, { load = () => import("@sentry/node") } = {}) {
  const dsn = String(env.SENTRY_DSN || "").trim();
  if (!dsn) return false;
  try {
    const mod = await load();
    mod.init({
      dsn,
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
      release: env.SOURCE_COMMIT || env.COOLIFY_GIT_COMMIT_SHA || undefined,
      // Errors only: no performance tracing, and no request bodies or cookies.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // Report an unhandled rejection, then exit as Node does without Sentry,
      // so turning tracking on never changes how the server fails.
      integrations: mod.onUnhandledRejectionIntegration ? [mod.onUnhandledRejectionIntegration({ mode: "strict" })] : [],
    });
    sentry = mod;
    return true;
  } catch (e) {
    console.warn("[errors] Sentry not started:", e?.message || e);
    return false;
  }
}

export function captureError(err, context = {}) {
  if (!sentry) return;
  try {
    sentry.captureException(err, { tags: context.tags, extra: context.extra });
  } catch {
    // reporting must never break the caller
  }
}

export function captureMessage(message, extra = {}) {
  if (!sentry) return;
  try {
    sentry.captureMessage(message, { level: "error", extra });
  } catch {
    // reporting must never break the caller
  }
}

/** For tests: forget the client. */
export function _resetErrorTracking() {
  sentry = null;
}
