// Mirrors what server/src/routes/lyricVideo.js sends (projectStore.js, alignJob.js, sheetParser.js).

export type SectionKind = 'intro' | 'verse' | 'pre' | 'chorus' | 'final' | 'bridge' | 'outro' | 'other';
export type LineKind = 'lead' | 'response' | 'soft';
export type LyricEffect = 'auto' | 'pop' | 'stack' | 'slam' | 'quote' | 'curve' | 'frame' | 'echo' | 'title';
export type LyricEnergy = 'calm' | 'lively' | 'wild';
export type BackgroundFit = 'auto' | 'cover' | 'contain';
export type RenderAspect = 'portrait' | 'landscape' | 'square';
export type RenderQuality = '720p' | '1080p';

export interface LyricWord { text: string; start: number; end: number }

export interface LyricSection {
  id: string;
  kind: SectionKind;
  label: string;
  /** Set once the lyrics have been timed. */
  start?: number;
}

export interface LyricLine {
  id: string;
  sectionId: string;
  kind: LineKind;
  text: string;
  effect: LyricEffect;
  /** True once the user has moved the line by hand; timing keeps it where it is. */
  locked?: boolean;
  /** The next four are set by timing; a line that was never placed has none of them. */
  words?: LyricWord[];
  start?: number;
  end?: number;
  confidence?: number;
  /** "check" marks a line worth a second look. */
  flag?: 'check' | null;
}

export type TimingStep = 'preparing' | 'vocals' | 'listening' | 'matching' | 'beats';

export interface LyricTiming {
  status: 'idle' | 'running' | 'done' | 'error';
  progress?: { step: TimingStep; window?: number; total?: number } | null;
  /** A plain sentence, set when status is "error". */
  error?: string | null;
  /** A plain sentence, set when timing was run again and failed; the earlier timing (status "done") is kept. */
  lastError?: string | null;
  beats?: { bpm: number; times: number[] };
  /** True when the words were heard in the vocals alone (a laptop separated them), false when in the whole mix. */
  usedVocalStem?: boolean;
  finishedAt?: string;
}

export interface LyricLook { id: string; energy: LyricEnergy; seed: number }

export interface LyricBackground { file: string; kind: 'video' | 'image'; fit: BackgroundFit }

/** What the YouTube publish panel opens with; the user can change all of it. */
export interface LyricPublishDraft {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  /** A plain sentence on what the upload cannot set, shown beside the panel. */
  note: string;
}

export interface LyricRender {
  jobId: string;
  aspect: RenderAspect;
  quality: RenderQuality;
  file: string;
  durationSec: number;
  at: string;
}

export interface LyricProject {
  projectId: string;
  title: string;
  artist: string;
  createdAt: string;
  updatedAt: string;
  song: { file: string; durationSec: number; coverStill: string | null } | null;
  sheet: { raw: string; parsedAt: string | null; skipped?: string[] };
  sections: LyricSection[];
  lines: LyricLine[];
  timing: LyricTiming;
  look: LyricLook;
  background: LyricBackground | null;
  renders: LyricRender[];
  /** The render being made now, saved so the page can pick it up again after leaving. */
  render?: { activeJobId: string } | null;
}

export interface LyricProjectSummary {
  projectId: string;
  title: string;
  artist: string;
  updatedAt: string;
  hasRender: boolean;
}

/** A render job as the server reports it; `file` is a file name, not a path. */
export interface LyricRenderJob {
  jobId: string;
  status: string;
  /** 0 to 100. */
  progress: number;
  error: string | null;
  file: string | null;
}
