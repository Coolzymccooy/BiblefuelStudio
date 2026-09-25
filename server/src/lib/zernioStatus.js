/**
 * Read the real outcome of a Zernio create-post call.
 *
 * WHY THIS IS NOT JUST `resp.ok`
 *
 * Zernio accepts a post and reports a platform rejection in the SAME response,
 * with a 2xx status. Its TikTok documentation is explicit:
 *
 *   "A publishNow: true post that TikTok rejects returns 207 with
 *    post.status: 'failed' ... 207 is a 2xx status, so fetch(...).ok is true;
 *    branch on the status code and on post.status."
 *
 * The first version of the capacity fallback branched on `!resp.ok`, so it
 * never ran: every capacity failure returned ok:true, the job was marked DONE,
 * the UI said "Auto-Publish posted", and the video never reached TikTok. Nine
 * days of posts were lost that way while the app reported success.
 *
 * So the outcome is read from the BODY, not the status line.
 */

import { isTikTokCapacityError } from "./zernioPayload.js";

/** Statuses that mean "this did not publish and will not publish itself". */
const FAILED_STATUSES = new Set(["failed", "partial"]);

/**
 * @param {number} status HTTP status code
 * @param {any} body parsed JSON body (null when it could not be parsed)
 * @returns {{ ok: boolean, atCapacity: boolean, error: string, postId: string, isDraft: boolean }}
 */
export function readTikTokOutcome(status, body) {
  const post = body?.post ?? null;
  const platforms = Array.isArray(post?.platforms) ? post.platforms : [];
  const tiktok = platforms.find((p) => String(p?.platform || "").toLowerCase() === "tiktok") || null;

  const postId = String(post?._id || "").trim();
  const isDraft = tiktok?.platformSpecificData?.isDraft === true;

  // Every place Zernio might name the reason. Checked together so a capacity
  // failure is recognised wherever it is reported.
  const messages = [
    tiktok?.errorMessage,
    body?.error,
    body?.message,
    ...platforms.map((p) => p?.errorMessage),
  ].filter(Boolean).map(String);

  const atCapacity = messages.some(isTikTokCapacityError);
  const firstError = messages.find(Boolean) || "";

  // A hard HTTP error is a failure regardless of the body.
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      // A 409 duplicate names no capacity problem, so it must not be retried as
      // a draft — that would just duplicate the post into the Creator Inbox.
      atCapacity,
      error: firstError || `Zernio returned ${status}`,
      postId,
      isDraft,
    };
  }

  // 2xx with no readable body: we cannot claim this published.
  if (!post) {
    return {
      ok: false,
      atCapacity,
      error: firstError || `Zernio returned ${status} with an unreadable body`,
      postId,
      isDraft,
    };
  }

  const postStatus = String(post.status || "").toLowerCase();
  const tiktokStatus = String(tiktok?.status || "").toLowerCase();
  // The per-platform entry is the authority when it exists: post.status is
  // "partial" when ANY platform failed, so a top-level "partial" alongside a
  // published TikTok entry means our video IS live. Reading the top level
  // first would report a false failure.
  const failed = tiktokStatus
    ? tiktokStatus === "failed"
    : FAILED_STATUSES.has(postStatus);

  if (failed) {
    return {
      ok: false,
      atCapacity,
      error: firstError || `Zernio reported status "${postStatus || tiktokStatus}"`,
      postId,
      isDraft,
    };
  }

  // published / scheduled / publishing are all fine: either it is live, or
  // Zernio owns it from here and will publish it itself.
  return { ok: true, atCapacity: false, error: "", postId, isDraft };
}
