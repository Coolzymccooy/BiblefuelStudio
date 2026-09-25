/**
 * A thumbnail as the operator designs it before publishing, and the helpers
 * the preview and the "put it on a video already up" control share.
 */

export interface ThumbnailDesign {
  /** The picture, as a served `/outputs/...` path. */
  path: string;
  title: string;
  /** Draw the title (and tagline) on the picture. */
  withTitle: boolean;
  tagline: string;
}

/** The body the server's thumbnail routes take for a design. */
export function thumbnailBody(d: ThumbnailDesign) {
  return {
    thumbnailPath: d.path,
    title: d.title.trim(),
    thumbnailTitle: d.withTitle,
    thumbnailTagline: d.withTitle ? d.tagline.trim() : '',
  };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in a YouTube link (watch, youtu.be, shorts, live, embed) or a
 * bare id; '' when there isn't one.
 */
export function youtubeVideoId(input: string): string {
  const text = String(input || '').trim();
  if (VIDEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') {
    id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/)?.[1] || '';
  }
  return VIDEO_ID.test(id) ? id : '';
}
