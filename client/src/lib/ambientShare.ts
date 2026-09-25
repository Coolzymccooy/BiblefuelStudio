import type { AmbientDrop, AmbientProject, AmbientTrackEntry } from './ambientTypes';
import { formatDuration } from './soundtrack';
import { chapterStamp } from './youtubeChapters';

/**
 * YouTube metadata drawn from what an ambient session already knows: its
 * theme, its verses, its music and its pictures. The description is the
 * video's record: every song with when it starts and how long it plays,
 * every verse with when it is spoken and its words, and who made the music.
 * The operator can still edit it before publishing.
 */

export interface Chapter {
  startMs: number;
  title: string;
}

const spoken = (drops: AmbientDrop[]): AmbientDrop[] =>
  [...(drops || [])].filter((d) => d.status === 'done' && d.reference).sort((a, b) => a.atMs - b.atMs);

const versesOf = (project: AmbientProject): AmbientDrop[] => (project.words === 'none' ? [] : spoken(project.drops));

/** YouTube ignores a chapter shorter than ten seconds. */
const MIN_CHAPTER_MS = 10_000;
/** YouTube's description limit (the server enforces it too, by cutting the end). */
const DESCRIPTION_MAX = 5000;
/** Room left for the server's own joins and anything the operator adds. */
const DESCRIPTION_SLACK = 150;
/** A long passage is quoted, not reprinted. */
const VERSE_TEXT_MAX = 240;
/** Chapters need at least three entries or YouTube ignores them all. */
const MIN_CHAPTERS = 3;

const played = (project: AmbientProject): AmbientTrackEntry[] =>
  (project.bed?.builtOrder || []).filter((t) => Number(t.durationSec) > 0);

/**
 * YouTube links any "12:34" in a description as a timestamp, so "John 14:27"
 * jumped the video to minute 14. U+2236 (RATIO) looks the same and isn't
 * linked. The server does the same for chapter titles.
 */
export function unlinkVerseTimes(text: string): string {
  return String(text || '').replace(/(\d):(?=\d)/g, '$1∶');
}

interface TimelineEvent {
  atMs: number;
  title: string;
}

function timelineEvents(project: AmbientProject, withLengths: boolean): TimelineEvent[] {
  const music = played(project).map((t) => ({
    atMs: Math.round(t.startSec * 1000),
    title: withLengths ? `♪ ${t.label} (${formatDuration(t.durationSec)})` : `♪ ${t.label}`,
  }));
  const verses = versesOf(project).map((d) => ({ atMs: d.atMs, title: `📖 ${d.reference}` }));
  // Stable sort: at the same moment the song is named before the verse.
  return [...music, ...verses].sort((a, b) => a.atMs - b.atMs);
}

/** Events closer than a chapter's minimum share its line. */
function toChapters(events: TimelineEvent[]): Chapter[] {
  const out: Chapter[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.atMs - last.startMs < MIN_CHAPTER_MS) out[out.length - 1] = { ...last, title: `${last.title} · ${e.title}` };
    else out.push({ startMs: e.atMs, title: e.title });
  }
  return out;
}

const chaptersLength = (chapters: Chapter[]): number =>
  chapters.reduce((n, c, i) => n + chapterStamp(i === 0 ? 0 : c.startMs).length + 1 + c.title.length + 1, 0);

/** The most a timeline may take, leaving room for the words above it. */
const TIMELINE_BUDGET = 3600;

/**
 * The video's timeline as YouTube chapters: every song as it plays (repeats
 * included) with how long it plays, and every verse at the moment it is
 * spoken. A very long timeline drops the song lengths, then its tail, so it
 * always fits in the description. The server forces the first to 00:00.
 */
export function ambientChapters(project: AmbientProject): Chapter[] {
  let chapters = toChapters(timelineEvents(project, true));
  if (chaptersLength(chapters) > TIMELINE_BUDGET) chapters = toChapters(timelineEvents(project, false));
  while (chapters.length > MIN_CHAPTERS && chaptersLength(chapters) > TIMELINE_BUDGET) chapters = chapters.slice(0, -1);
  return chapters;
}

/** "2 hours", "1 hour", "45 minutes": the length as a poster line says it. */
export function lengthPhrase(sec: number): string {
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 hours · 23 songs · 8 scriptures (KJV)" */
function overviewLine(project: AmbientProject, translation: string): string {
  const songs = new Set(played(project).map((t) => t.ref)).size;
  const verses = versesOf(project).length;
  return [
    lengthPhrase(project.targetSec),
    songs ? plural(songs, 'song', 'songs') : '',
    verses ? `${plural(verses, 'scripture', 'scriptures')} (${translation})` : '',
  ].filter(Boolean).join(' · ');
}

function quote(text: string): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const cut = clean.length > VERSE_TEXT_MAX ? `${clean.slice(0, VERSE_TEXT_MAX).replace(/\s+\S*$/, '')} …` : clean;
  return ` — “${cut}”`;
}

/** Every verse read, with its words when there is room for them. */
function scriptureBlock(project: AmbientProject, translation: string, withText: boolean): string {
  const verses = versesOf(project);
  if (!verses.length) return '';
  if (!withText) return `Scripture (${translation}): ${unlinkVerseTimes(verses.map((d) => d.reference).join(' · '))}`;
  const lines = verses.map((d) => unlinkVerseTimes(`${d.reference}${quote(d.text || '')}`));
  return `Scripture (${translation})\n${lines.join('\n')}`;
}

/** Each source credited once; a track with no credit is named instead. */
function creditsBlock(project: AmbientProject): string {
  const lines = [...new Set(played(project).map((t) => (t.credit || t.label).trim()).filter(Boolean))];
  return lines.length ? `Music credits:\n${lines.join('\n')}` : '';
}

/**
 * The words above the timeline. The server adds the timeline (the chapters)
 * underneath at publish time, so this ends with its heading, and leaves the
 * timeline its room: the verse words go first when space runs short.
 */
export function ambientDescription(project: AmbientProject): string {
  const translation = String(project.translation || 'kjv').toUpperCase();
  const chapters = ambientChapters(project);
  const hasTimeline = chapters.length >= MIN_CHAPTERS;
  const heading = hasTimeline ? `Timeline (${[played(project).length ? '♪ music' : '', versesOf(project).length ? '📖 scripture' : ''].filter(Boolean).join(' · ')}):` : '';
  const room = DESCRIPTION_MAX - DESCRIPTION_SLACK - (hasTimeline ? chaptersLength(chapters) : 0);
  const build = (withText: boolean) => [
    String(project.theme || '').trim(),
    overviewLine(project, translation),
    scriptureBlock(project, translation, withText),
    creditsBlock(project),
    heading,
  ].filter(Boolean).join('\n\n');
  const full = build(true);
  if (full.length <= room) return full;
  return build(false).slice(0, Math.max(0, room));
}

export function ambientThumbnails(project: AmbientProject): Array<{ label: string; path: string }> {
  return (project.movements || [])
    .map((m, i) => ({ label: `Picture ${i + 1}`, path: m.imageUrl || '' }))
    .filter((o) => o.path);
}
