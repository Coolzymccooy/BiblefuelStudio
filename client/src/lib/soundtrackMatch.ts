/**
 * Does a song being added as music look like the Story's own soundtrack?
 *
 * The soundtrack (the file the story was made from) already plays under the
 * whole story, in time with the captions. Adding the same song again as the
 * music bed plays it twice, out of step. Wrongly warning is a nuisance and
 * missing the case is only the status quo, so this leans to false negatives:
 * the same base name is enough, but a length match never is.
 */

/** The source's display facts, as stored on `project.source`. */
export interface SoundtrackFacts {
  name?: string;
  durationMs?: number;
}

/** A song about to be used as the music bed. */
export interface CandidateSong {
  name?: string | null;
  durationSec?: number | null;
}

const MEDIA_EXTENSION = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aif|aiff|mp4|m4v|mov|webm|mkv|avi)$/i;
const COPY_SUFFIX = /\s*\(\d{1,3}\)$/;
/** Shortest name that may match by containment; "Joy" is inside many titles. */
const MIN_CONTAINED_LENGTH = 5;
const LENGTH_TOLERANCE_SEC = 1.5;

/** "My Song (1).MP3" -> "my song": no extension, case, copy suffix or extra spaces. */
export function normaliseSongName(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    .replace(MEDIA_EXTENSION, '')
    .replace(COPY_SUFFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function looksLikeSoundtrack(candidate: CandidateSong, source: SoundtrackFacts | null | undefined): boolean {
  const theirs = normaliseSongName(source?.name);
  const mine = normaliseSongName(candidate.name);
  if (!theirs || !mine) return false;
  if (theirs === mine) return true;

  // "Amazing Grace - official audio" against "Amazing Grace": the same song
  // under a longer title, but only when the lengths agree.
  const [short, long] = theirs.length <= mine.length ? [theirs, mine] : [mine, theirs];
  if (short.length < MIN_CONTAINED_LENGTH || !long.includes(short)) return false;
  const sourceSec = Number(source?.durationMs) / 1000;
  const candidateSec = Number(candidate.durationSec);
  if (!(sourceSec > 0) || !(candidateSec > 0)) return false;
  return Math.abs(sourceSec - candidateSec) <= LENGTH_TOLERANCE_SEC;
}

/** What the Music panel shows about the story's own soundtrack. */
export interface SoundtrackInfo extends SoundtrackFacts {
  /** The name to show: the file's name, or a plain description when it has none. */
  label: string;
  trimmed: boolean;
  durationMs: number;
}

interface StoredSource {
  audioPath: string | null;
  durationMs: number;
  name?: string;
  trimmed?: boolean;
}

/**
 * The soundtrack a project plays, or null when it has none yet. A name is
 * stored for uploads; without one the audio is either generated narration
 * (a long-form project) or from before names were kept.
 */
export function soundtrackFor(source: StoredSource | null | undefined, narrated: boolean): SoundtrackInfo | null {
  if (!source?.audioPath) return null;
  const name = source.name || undefined;
  return {
    label: name ?? (narrated ? 'your narration' : 'your audio'),
    name,
    trimmed: source.trimmed === true,
    durationMs: Number(source.durationMs) || 0,
  };
}
