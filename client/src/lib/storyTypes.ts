export type StoryStatus =
  | 'draft' | 'transcribing' | 'segmenting' | 'generating_images'
  | 'ready_to_render' | 'rendering' | 'done' | 'error'
  | 'draft_script' | 'narrating';

export type ImageStatus = 'pending' | 'generating' | 'done' | 'error';

export interface StoryWord { text: string; startMs: number; endMs: number }

export interface StoryScene {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  imagePrompt: string;
  imagePath: string | null;
  imageUrl?: string | null;
  imageStatus: ImageStatus;
  /** When imageStatus === 'error', a short human-readable reason (quota, timeout, safety, …). */
  imageError?: string | null;
  promptEditedByUser: boolean;
}

export interface LongformSection {
  heading: string;
  reference?: string | null;
  verseText?: string;
  text: string;
  targetSec: number;
  startMs?: number;
  endMs?: number;
}

export interface StoryLongform {
  templateId: string;
  idea?: string;
  summary?: string;
  sections: LongformSection[];
}

export interface StoryProject {
  projectId: string;
  title: string;
  style: string;
  /** Biblical figures appearing in this story; applied to every scene prompt. */
  cast?: string[];
  status: StoryStatus;
  source: { audioPath: string | null; durationMs: number };
  transcript: { words: StoryWord[]; hash: string | null };
  scenes: StoryScene[];
  music: { path: string | null; volume: number; autoDuck?: boolean };
  captionPreset: string;
  longform?: StoryLongform;
  aspect?: 'portrait' | 'landscape';
  captions?: 'none' | 'static' | 'kinetic';
  render: {
    jobId: string | null;
    outputPath: string | null;
    status: string | null;
    /** Live ffmpeg progress 0–100 while rendering (absent if the render isn't alive in the server process). */
    percent?: number;
    phase?: 'preparing' | 'encoding';
  };
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoryProjectSummary {
  projectId: string;
  title: string;
  status: StoryStatus;
  style: string;
  updatedAt: number;
}

export interface StoryStyleOption { id: string; label: string; blurb: string }
