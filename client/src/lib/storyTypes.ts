export type StoryStatus =
  | 'draft' | 'transcribing' | 'segmenting' | 'generating_images'
  | 'ready_to_render' | 'rendering' | 'done' | 'error';

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
  promptEditedByUser: boolean;
}

export interface StoryProject {
  projectId: string;
  title: string;
  style: string;
  status: StoryStatus;
  source: { audioPath: string | null; durationMs: number };
  transcript: { words: StoryWord[]; hash: string | null };
  scenes: StoryScene[];
  music: { path: string | null; volume: number; autoDuck?: boolean };
  captionPreset: string;
  render: { jobId: string | null; outputPath: string | null; status: string | null };
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
