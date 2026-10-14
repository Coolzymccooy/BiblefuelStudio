import { api } from './api';
import { toOutputUrl } from './storage';

/** Characters a file name cannot hold on some systems; they become spaces. */
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|]+/g;

/** Where a finished video plays from. */
export const lyricVideoUrl = (file: string): string => toOutputUrl(file, api.mediaBaseUrl);

/**
 * The link that saves a finished lyric video. `?dl=` makes the server send the
 * file as a download named after the song, which also works on phones.
 */
export function lyricDownloadUrl(file: string, title: string): string {
  const name = title.replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'lyric-video';
  return `${lyricVideoUrl(file)}?dl=${encodeURIComponent(`${name}.mp4`)}`;
}
