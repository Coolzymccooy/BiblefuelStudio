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
  if (typeof metadata.containsSyntheticMedia === "boolean") status.containsSyntheticMedia = metadata.containsSyntheticMedia;
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
  // Closed whatever happens: a refusal before the body is read would leave it
  // open, and its late open of a since-deleted temp file threw uncaught.
  const body = fs.createReadStream(thumbnailPath);
  body.on("error", () => { /* reported by the request itself */ });
  try {
    await youtube.thumbnails.set({ videoId, media: { mimeType, body } });
    return undefined;
  } catch (e) {
    // Custom thumbnails need a phone-verified channel. The video is already
    // up; report the reason instead of failing a successful upload.
    const message = String(e?.message || e);
    return THUMBNAIL_NOT_ALLOWED_RE.test(message) ? THUMBNAIL_NOT_ALLOWED : message;
  } finally {
    body.destroy();
  }
}

// Google's wording ("The authenticated user doesn't have permissions to upload
// and set custom video thumbnails") names the cause but not the one-time fix.
const THUMBNAIL_NOT_ALLOWED_RE = /permission.*thumbnail|thumbnail.*permission/i;
const THUMBNAIL_NOT_ALLOWED = "YouTube only allows custom thumbnails on verified channels. "
  + "Verify yours once at youtube.com/verify, then set this thumbnail in YouTube Studio.";

// Pages of 50; a channel with more than 500 playlists stops being searched.
const MAX_PLAYLIST_PAGES = 10;

async function ownPlaylists(youtube, { complete = false } = {}) {
  const out = [];
  let pageToken;
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
    const res = await youtube.playlists.list({
      part: ["snippet", "contentDetails", "status"], mine: true, maxResults: 50, ...(pageToken ? { pageToken } : {}),
    });
    for (const p of res?.data?.items || []) {
      out.push({
        id: String(p.id),
        title: String(p.snippet?.title || ""),
        itemCount: Number(p.contentDetails?.itemCount || 0),
        privacyStatus: String(p.status?.privacyStatus || ""),
      });
    }
    pageToken = res?.data?.nextPageToken;
    if (!pageToken) break;
  }
  // Searching by name must see every playlist, or it would make a duplicate.
  if (complete && pageToken) {
    throw new Error("This channel has too many playlists to search by name. Choose the playlist from the list instead.");
  }
  return out;
}

/** The named playlist, made public if the channel has none by that name. */
async function playlistIdByTitle(youtube, title) {
  const wanted = title.toLocaleLowerCase();
  const found = (await ownPlaylists(youtube, { complete: true })).find((p) => p.title.trim().toLocaleLowerCase() === wanted);
  if (found) return found.id;
  const made = await youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: { snippet: { title }, status: { privacyStatus: "public" } },
  });
  const id = String(made?.data?.id || "").trim();
  if (!id) throw new Error("YouTube did not return the new playlist's id");
  return id;
}

// Connections made before playlists were offered only granted upload and
// read access; Google's answer then is about "scopes", which says nothing
// about the one-click fix.
const SCOPE_MISSING_RE = /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i;
const SCOPE_MISSING = "Studio needs one more permission for playlists. "
  + "Reconnect YouTube in Settings, then add this video to the playlist in YouTube Studio.";

async function addToPlaylist(youtube, videoId, playlist) {
  if (!playlist) return {};
  try {
    const playlistId = playlist.id || await playlistIdByTitle(youtube, playlist.title);
    await youtube.playlistItems.insert({
      part: ["snippet"],
      requestBody: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
    });
    return { playlistId };
  } catch (e) {
    // The video is already up; report why it isn't in the playlist instead.
    const message = String(e?.message || e);
    return { playlistError: SCOPE_MISSING_RE.test(message) ? SCOPE_MISSING : message };
  }
}

function youtubeClient(credentials) {
  const oauth2 = new _google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2.setCredentials({ refresh_token: credentials.refreshToken });
  return _google.youtube({ version: "v3", auth: oauth2 });
}

/**
 * Replace the thumbnail of a video already on the connected channel.
 * @returns {Promise<{ thumbnailError?: string }>}
 */
export async function setYoutubeThumbnail({ credentials, videoId, thumbnailPath }) {
  const thumbnailError = await setThumbnail(youtubeClient(credentials), videoId, thumbnailPath);
  return thumbnailError ? { thumbnailError } : {};
}

/**
 * Upload one video with full metadata, then (best-effort) its thumbnail.
 * Throws only when the video itself cannot be uploaded.
 */
export async function uploadToYoutube({ credentials, filePath, metadata, thumbnailPath }) {
  const youtube = youtubeClient(credentials);

  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: buildRequestBody(metadata),
    media: { body: fs.createReadStream(filePath) },
  });
  const videoId = String(result?.data?.id || "").trim();
  if (!videoId) throw new Error("YouTube did not return a video id — the upload may have been rejected");

  const thumbnailError = await setThumbnail(youtube, videoId, thumbnailPath);
  const listed = await addToPlaylist(youtube, videoId, metadata.playlist);
  return {
    data: result.data,
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    ...(thumbnailError ? { thumbnailError } : {}),
    ...listed,
  };
}

/**
 * The connected channel's own playlists, for choosing one before an upload.
 * @returns {Promise<Array<{ id: string, title: string, itemCount: number, privacyStatus: string }>>}
 */
export async function listYoutubePlaylists({ credentials }) {
  return ownPlaylists(youtubeClient(credentials));
}
