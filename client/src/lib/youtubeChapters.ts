/**
 * Chapters as the server writes them under a YouTube description
 * (server/src/lib/social/youtubeMetadata.js), so the operator can read the
 * timeline before publishing.
 */

export interface ChapterEntry {
  startMs: number;
  title: string;
}

/** "07:30" under an hour, "1:07:30" from an hour. */
export function chapterStamp(ms: number): string {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Sorted, the first at 00:00, a verse's colon swapped so it isn't a link. */
export function chapterPreviewLines(chapters: readonly ChapterEntry[]): string[] {
  return [...chapters]
    .filter((c) => String(c.title || '').trim())
    .sort((a, b) => a.startMs - b.startMs)
    .map((c, i) => `${chapterStamp(i === 0 ? 0 : c.startMs)} ${c.title.trim().replace(/(\d):(?=\d)/g, '$1∶')}`);
}
