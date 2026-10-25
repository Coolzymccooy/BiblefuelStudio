/**
 * Tell the operator when something on the server needs attention: a render
 * failed, the disk is nearly full, a backup did not run.
 *
 * Every alert is logged with an [ALERT] prefix and sent to error tracking.
 * In production it is also emailed to the operator, at most once an hour for
 * each kind (a full disk, twice a day), so a render that fails for everyone
 * sends one email, not hundreds; the email says how many were held back
 * since the last one.
 */

const HOUR_MS = 60 * 60 * 1000;
/** Standing conditions are re-checked every few minutes; they email less often than one-off failures. */
const KIND_THROTTLE_MS = Object.freeze({ "disk-low": 12 * HOUR_MS });

/**
 * Alert emails are for production. A dev machine logs its alerts but does not email them (its
 * disk checks and test failures are not the operator's to act on), unless ALERT_EMAILS is on.
 */
export function alertEmailsEnabled(env = process.env) {
  const flag = String(env.ALERT_EMAILS || "").trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(flag)) return false;
  return env.NODE_ENV === "production" || ["true", "1", "yes", "on"].includes(flag);
}

export function createAlerter({
  sendEmail = null, to = "", captureMessage = null, throttleMs = HOUR_MS, throttleByKind = KIND_THROTTLE_MS, now = () => Date.now(), log = console,
} = {}) {
  const lastSent = new Map();
  const held = new Map();

  return async function alert(kind, subject, detail = "") {
    const text = String(detail || "").slice(0, 4000);
    log.error?.(`[ALERT] ${kind}: ${subject}${text ? `\n${text}` : ""}`);
    try {
      captureMessage?.(`${kind}: ${subject}`, { kind, detail: text });
    } catch {
      // error tracking must never break the caller
    }

    if (!sendEmail || !to) return { emailed: false, reason: "no-email" };
    const t = now();
    const last = lastSent.get(kind);
    if (last !== undefined && t - last < (throttleByKind[kind] ?? throttleMs)) {
      held.set(kind, (held.get(kind) || 0) + 1);
      return { emailed: false, reason: "throttled" };
    }
    const skipped = held.get(kind) || 0;
    lastSent.set(kind, t);
    held.delete(kind);
    const more = skipped ? `\n\n(${skipped} more "${kind}" alert(s) since the last email.)` : "";
    try {
      const r = await sendEmail({ kind: "ops-alert", to, subject, detail: `${text}${more}`, at: new Date(t).toISOString() });
      if (!r?.ok) log.warn?.(`[ALERT] email not sent: ${r?.error || "unknown error"}`);
      return { emailed: Boolean(r?.ok) };
    } catch (e) {
      log.warn?.(`[ALERT] email not sent: ${e?.message || e}`);
      return { emailed: false, reason: "send-failed" };
    }
  };
}

// The process-wide alerter; index.js configures it once email is set up.
let current = createAlerter();

export function configureAlerts(options) {
  current = createAlerter(options);
  return current;
}

/** Raise an alert. Never throws and never waits on the email. */
export function alert(kind, subject, detail) {
  current(kind, subject, detail).catch(() => {});
}
