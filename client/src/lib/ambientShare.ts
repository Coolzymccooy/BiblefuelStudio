import type { AmbientDrop, AmbientProject, AmbientTrackEntry } from './ambientTypes';

/**
 * YouTube metadata drawn from what an ambient session already knows: its
 * theme, its verses, and its pictures. The operator edits it before publish;
 * this only saves them retyping the references.
 */

export interface Chapter {
  startMs: number;
  title: string;
}

const spoken = (drops: AmbientDrop[]): AmbientDrop[] =>
  [...(drops || [])].filter((d) => d.status === 'done' && d.reference).sort((a, b) => a.atMs - b.atMs);

/** YouTube ignores a chapter shorter than ten seconds. */
const MIN_CHAPTER_SEC = 10;

const tracklist = (project: AmbientProject): AmbientTrackEntry[] =>
  (project.bed?.builtOrder || []).filter((t) => t.durationSec >= MIN_CHAPTER_SEC);

/**
 * One chapter per verse, at the start of the picture it belongs to; for a
 * music-only session (or one with no spoken verses), one per track of the
 * assembled bed. The server forces the first to 00:00 and drops them below
 * three (the YouTube minimum).
 */
export function ambientChapters(project: AmbientProject): Chapter[] {
  const verses = project.words === 'none' ? [] : spoken(project.drops);
  if (verses.length === 0) {
    return tracklist(project).map((t) => ({ startMs: Math.round(t.startSec * 1000), title: t.label }));
  }
  const movements = project.movements || [];
  return verses.map((d) => {
    const m = movements.find((mv, i) => d.atMs >= mv.startMs && (d.atMs < mv.endMs || i === movements.length - 1));
    return { startMs: m ? m.startMs : d.atMs, title: d.reference };
  });
}

/**
 * YouTube links any "12:34" in a description as a timestamp, so "John 14:27"
 * jumped the video to minute 14. U+2236 (RATIO) looks the same and isn't
 * linked. The server does the same for chapter titles.
 */
export function unlinkVerseTimes(text: string): string {
  return String(text || '').replace(/(\d):(?=\d)/g, '$1∶');
}

/** "2 hours", "1 hour", "45 minutes": the length as a poster line says it. */
function lengthPhrase(sec: number): string {
  const s = Math.round(Number(sec) || 0);
  if (s <= 0) return '';
  if (s >= 3600 && s % 3600 === 0) return s === 3600 ? '1 hour' : `${s / 3600} hours`;
  return `${Math.round(s / 60)} minutes`;
}

/**
 * The small line above the title on the thumbnail: how long, and what kind
 * of listening it is. The operator can change it before publishing.
 */
export function ambientTagline(project: AmbientProject): string {
  const kind = project.words === 'none' ? 'soaking worship music' : 'scripture & soaking worship';
  return [lengthPhrase(project.targetSec), kind].filter(Boolean).join(' · ');
}

/** Each source credited once; a track with no credit is named instead. */
function creditsBlock(project: AmbientProject): string {
  const lines = [...new Set((project.bed?.builtOrder || []).map((t) => (t.credit || t.label).trim()).filter(Boolean))];
  return lines.length ? `Music credits:\n${lines.join('\n')}` : '';
}

export function ambientDescription(project: AmbientProject): string {
  const theme = String(project.theme || '').trim();
  const refs = project.words === 'none' ? [] : spoken(project.drops).map((d) => d.reference);
  const translation = String(project.translation || 'kjv').toUpperCase();
  const blocks = [
    theme,
    refs.length ? `Scripture (${translation}): ${unlinkVerseTimes(refs.join(' · '))}` : '',
    creditsBlock(project),
  ].filter(Boolean);
  return blocks.join('\n\n');
}

export function ambientThumbnails(project: AmbientProject): Array<{ label: string; path: string }> {
  return (project.movements || [])
    .map((m, i) => ({ label: `Picture ${i + 1}`, path: m.imageUrl || '' }))
    .filter((o) => o.path);
}
