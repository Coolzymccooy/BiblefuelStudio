import type { TimelineAsset } from './timelineProject';

/**
 * Where a video clip's poster frame lives.
 *
 * The server already extracts a first-frame JPEG for every uploaded video
 * (generateVideoThumbnail in server/src/lib/mediaThumb.js, called from
 * respondWithBackground at upload time) and writes it to /outputs/<stem>.jpg.
 * So the timeline does NOT need a new stored field that every asset uploaded
 * before today would lack — it derives the path, and mirrors the server's own
 * deriveOutputJpgPathFromVideo().
 *
 * A stored `thumbPath` still wins when one exists, so a later server change
 * can hand the path over explicitly without this helper fighting it.
 *
 * Returns null wherever there is no honest answer; the clip then keeps its
 * lane icon chip, which is the correct look for audio and captions anyway.
 */
export function timelineAssetThumbPath(asset?: TimelineAsset): string | null {
  if (!asset) return null;

  const stored = (asset as { thumbPath?: string }).thumbPath;
  if (typeof stored === 'string' && stored.trim()) return stored.trim();

  // Only video gets a derived frame. Audio wants a waveform, captions and
  // effects want their chip, and an image already renders itself — deriving a
  // .jpg beside a .png would point at a file nobody wrote.
  if (asset.kind !== 'video') return null;

  const raw = typeof asset.path === 'string' ? asset.path.trim() : '';
  if (!raw) return null;

  // Remote media is not processed through /outputs, so no sibling exists.
  if (/^https?:\/\//i.test(raw)) return null;

  const normalised = raw.replace(/\\/g, '/');
  const name = normalised.split('/').pop() || '';
  // Strip only the final extension: "take.2.final.mp4" keeps its dots.
  const stem = name.replace(/\.[^.]+$/, '');
  if (!stem) return null;

  return `/outputs/${stem}.jpg`;
}
