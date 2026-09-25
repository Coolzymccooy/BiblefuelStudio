import fs from "fs";
import path from "path";
import { google as realGoogle } from "googleapis";

let _google = realGoogle;
export function _setGoogleImpl(impl) { _google = impl; }
export function _resetGoogleImpl() { _google = realGoogle; }

const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function buildRequestBody(metadata) {
  const status = { privacyStatus: metadata.privacyStatus, selfDeclaredMadeForKids: false };
  if (metadata.publishAt) status.publishAt = metadata.publishAt;
  return {
    snippet: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: metadata.categoryId,
    },
    status,
  };
}

async function setThumbnail(youtube, videoId, thumbnailPath) {
  if (!thumbnailPath) return undefined;
  if (!fs.existsSync(thumbnailPath)) return `thumbnail not found: ${thumbnailPath}`;
  const mimeType = MIME_BY_EXT[path.extname(thumbnailPath).toLowerCase()] || "image/jpeg";
  try {
    await youtube.thumbnails.set({ videoId, media: { mimeType, body: fs.createReadStream(thumbnailPath) } });
    return undefined;
  } catch (e) {
    // Custom thumbnails need a phone-verified channel. The video is already
    // up; report the reason instead of failing a successful upload.
    const message = String(e?.message || e);
    return THUMBNAIL_NOT_ALLOWED_RE.test(message) ? THUMBNAIL_NOT_ALLOWED : message;
  }
}

// Google's wording ("The authenticated user doesn't have permissions to upload
// and set custom video thumbnails") names the cause but not the one-time fix.
const THUMBNAIL_NOT_ALLOWED_RE = /permission.*thumbnail|thumbnail.*permission/i;
const THUMBNAIL_NOT_ALLOWED = "YouTube only allows custom thumbnails on verified channels. "
  + "Verify yours once at youtube.com/verify, then set this thumbnail in YouTube Studio.";

/**
 * Upload one video with full metadata, then (best-effort) its thumbnail.
 * Throws only when the video itself cannot be uploaded.
 */
export async function uploadToYoutube({ credentials, filePath, metadata, thumbnailPath }) {
  const oauth2 = new _google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2.setCredentials({ refresh_token: credentials.refreshToken });
  const youtube = _google.youtube({ version: "v3", auth: oauth2 });

  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: buildRequestBody(metadata),
    media: { body: fs.createReadStream(filePath) },
  });
  const videoId = String(result?.data?.id || "").trim();
  if (!videoId) throw new Error("YouTube did not return a video id — the upload may have been rejected");

  const thumbnailError = await setThumbnail(youtube, videoId, thumbnailPath);
  return {
    data: result.data,
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    ...(thumbnailError ? { thumbnailError } : {}),
  };
}
