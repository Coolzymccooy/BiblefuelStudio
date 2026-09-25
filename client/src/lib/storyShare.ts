import type { StoryProject } from './storyTypes';
import { STORY_STYLES } from './storyWizard';
import { lengthPhrase, unlinkVerseTimes } from './ambientShare';

/**
 * YouTube metadata for a Story video, in the same shape as Ambient's: a
 * poster tagline, and a description that records what is in the video.
 */

/** Chapters need at least three entries or YouTube ignores them all. */
const MIN_CHAPTERS = 3;

const styleLabel = (style: string) => STORY_STYLES.find((s) => s.id === style)?.label ?? '';

export function storyChapters(project: StoryProject): Array<{ startMs: number; title: string }> {
  return (project.longform?.sections || []).map((s) => ({ startMs: s.startMs ?? 0, title: s.heading }));
}

/** "8 minutes · cinematic bible", for the line above the title on the thumbnail. */
export function storyTagline(project: StoryProject): string {
  return [
    lengthPhrase(Math.round((project.source?.durationMs || 0) / 1000)),
    styleLabel(project.style).toLowerCase(),
  ].filter(Boolean).join(' · ');
}

/**
 * The summary, an overview line, the music credit, and the heading for the
 * chapters the server adds underneath. Verse references never become links.
 */
export function storyDescription(project: StoryProject, music?: { label: string; credit?: string } | null): string {
  const scenes = (project.scenes || []).length;
  const overview = [
    lengthPhrase(Math.round((project.source?.durationMs || 0) / 1000)),
    scenes ? `${scenes} ${scenes === 1 ? 'scene' : 'scenes'}` : '',
    styleLabel(project.style),
  ].filter(Boolean).join(' · ');
  const credit = music ? `Music: ${(music.credit || music.label).trim()}` : '';
  const heading = storyChapters(project).filter((c) => String(c.title || '').trim()).length >= MIN_CHAPTERS ? 'Chapters:' : '';
  return [
    unlinkVerseTimes(String(project.longform?.summary || '').trim()),
    overview,
    credit,
    heading,
  ].filter(Boolean).join('\n\n');
}
