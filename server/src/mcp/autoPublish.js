/**
 * Publish consent and the user's Postiz auto-publish, shared by every tool
 * that can post (rulings R23, R24, R30). A finished render_video or
 * render_waveform job is posted by `maybeAutoPublish` when the user's own
 * Postiz auto-publish is on, so starting such a render can be a publish.
 *
 * Lives outside tools/ because the registry loads every file there as tools.
 * Never imports ../api.js (it loads auth.js, which reads env at import time).
 */

/** Fails closed: no agent key, or anything but a true publish switch, means no consent to post. */
export const lacksPublishConsent = (ctx) => ctx?.agentKey?.publishAllowed !== true;

/**
 * True when the user's Postiz auto-publish would post a finished render.
 * If the setting cannot be read, assume it would (a render that may post counts as one).
 */
export async function autoPublishIsOn(ctx) {
  try {
    const setting = await ctx.api.call("GET", "/api/postiz/auto-publish");
    return Boolean(setting?.enabled) && Array.isArray(setting?.platforms) && setting.platforms.length > 0;
  } catch (err) {
    // Matched by name: importing ApiError from ./api.js would load auth.js.
    if (err?.name === "ApiError") return true;
    throw err;
  }
}

/**
 * What a render that may auto-post needs. It may post only when the key has
 * consent AND the user's auto-publish is on now, and then it also spends a
 * publish. Every other render is queued with auto-publish suppressed, so
 * switching auto-publish on later can never post a render no publish was
 * charged for. `charge` is the extra cap amount to add to the render's own
 * charge, so the caller spends every bucket in one atomic `ctx.chargeCap({ ... })`.
 * `state` says which: "suppressed" (no consent), "off" or "on".
 *
 * @returns {Promise<{ suppress: boolean, charge: { publishes?: number }, state: "suppressed" | "off" | "on" }>}
 */
export async function renderPublishPlan(ctx) {
  if (lacksPublishConsent(ctx)) return { suppress: true, charge: {}, state: "suppressed" };
  if (await autoPublishIsOn(ctx)) return { suppress: false, charge: { publishes: 1 }, state: "on" };
  return { suppress: true, charge: {}, state: "off" };
}
