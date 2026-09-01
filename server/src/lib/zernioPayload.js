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
 * @param {{caption: string, title: string, videoUrl: string, accountId: string, draft?: boolean}} opts
 */
export function buildZernioPost({ caption, title, videoUrl, accountId, draft = false }) {
  const post = {
    content: caption,
    title,
    publishNow: !draft,
    isDraft: false,
    platforms: [{ platform: "tiktok", accountId }],
    mediaItems: [{ type: "video", url: videoUrl }],
  };
  // Only send tiktokSettings when falling back: passing draft:false explicitly
  // is not the same as omitting it, and we do not want to change the happy
  // path's behaviour.
  if (draft) post.tiktokSettings = { draft: true };
  return post;
}
