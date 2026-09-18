/**
 * Zernio publish payload for TikTok.
 *
 * Split out of routes/social.js so the capacity-fallback rule is testable
 * without a live HTTP call.
 *
 * WHY THE DRAFT FALLBACK EXISTS
 * TikTok's direct-posting API is rate limited at TikTok's end. When it is
 * saturated Zernio returns, verbatim:
 *
 *   "TikTok direct posting is at capacity right now. Use tiktokSettings.draft:
 *    true to deliver via Creator Inbox, or try again in a few hours as
 *    capacity frees up."
 *
 * The operator's posts published normally until 28 Aug and then failed on
 * every attempt from 30 Aug onward with that message - nothing in this app,
 * the media, the aspect ratio or the credentials had changed. Without a
 * fallback the video is simply lost; with draft delivery it lands in the
 * TikTok Creator Inbox, where it can be posted from the phone in one tap.
 */

/** Zernio's wording when direct posting is rate limited. */
export function isTikTokCapacityError(message) {
  const s = String(message || "").toLowerCase();
  return s.includes("at capacity") || s.includes("tiktoksettings.draft");
}

/**
 * @param {{caption: string, title: string, videoUrl: string, accountId: string,
 *          draft?: boolean, privacyLevel?: string}} opts
 *   privacyLevel - TikTok privacy for the post. Defaults to
 *   ZERNIO_TIKTOK_PRIVACY_LEVEL, then PUBLIC_TO_EVERYONE. Set the env var to
 *   SELF_ONLY (or MUTUAL_FOLLOW_FRIENDS / FOLLOWER_OF_CREATOR) when the
 *   connected account cannot post publicly — TikTok rejects a level the
 *   account does not allow, on direct posting AND Creator Inbox drafts.
 */
export function buildZernioPost({ caption, title, videoUrl, accountId, draft = false, privacyLevel }) {
  // TikTok requires these on EVERY post (Zernio's TikTok platform page marks
  // each "Required"); content_preview_confirmed and express_consent_given are
  // a legal requirement from TikTok and must be true. The original payload
  // omitted all of them.
  //
  // PRIVACY LEVEL. TikTok rejects a privacy_level the connected account does
  // not allow: a private or otherwise restricted account cannot post
  // PUBLIC_TO_EVERYONE, and the rejection hits BOTH direct posting and the
  // Creator Inbox fallback — so hardcoding public would break every post for
  // such an account, with no way to override it (the sole production caller
  // passes no privacyLevel). Codex flagged this on PR #5.
  //
  // The proper fix is to read the account's allowed options from TikTok's
  // creator_info endpoint, which Zernio does not surface here and which
  // cannot be exercised without a restricted test account. So: keep the
  // public default that suits a normal creator account, and make it
  // configurable the same way every other Zernio setting already is.
  // SELF_ONLY is the safe value for a private account.
  const tiktokSettings = {
    privacy_level: String(
      privacyLevel
        || process.env.ZERNIO_TIKTOK_PRIVACY_LEVEL
        || "PUBLIC_TO_EVERYONE",
    ).trim(),
    allow_comment: true,
    allow_duet: true,
    allow_stitch: true,
    content_preview_confirmed: true,
    express_consent_given: true,
  };
  // Creator Inbox delivery. Exempt from the direct-posting capacity cap, so
  // this is what rescues a post TikTok would otherwise reject outright.
  if (draft) tiktokSettings.draft = true;

  return {
    content: caption,
    title,
    publishNow: !draft,
    isDraft: false,
    platforms: [{ platform: "tiktok", accountId }],
    mediaItems: [{ type: "video", url: videoUrl }],
    tiktokSettings,
  };
}
