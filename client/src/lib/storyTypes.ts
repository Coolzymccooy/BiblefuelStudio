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
  /** Where this picture came from: reused from the library, or freshly generated. */
  imageSource?: 'library' | 'generated';
  /** Cosine score of the library match, when imageSource === 'library'. */
  imageReuseScore?: number | null;
  /** Library entry id — the same image is never used twice in one video. */
  imageLibraryId?: string | null;
}

export interface LongformSection {
  heading: string;
  reference?: string | null;
  verseText?: string;
  text: string;
  targetSec: number;
  startMs?: number;
  endMs?: number;
  /** Pasted-script [pause]: this section continues the previous chapter rather than starting one. */
  continuation?: boolean;
  /** Silence before this section in ms (a [pause N] in a pasted script); template default otherwise. */
  pauseBeforeMs?: number;
}

export interface StoryLongform {
  templateId: string;
  idea?: string;
  summary?: string;
  sections: LongformSection[];
  /**
   * Chunk-level narration heartbeat while status === 'narrating' (server-persisted, best-effort).
   * `provider` is the TTS provider that actually voiced the chunks, once known.
   * `alive` is added on the wire by GET /api/story/:id: false ⇒ the server has no
   * run in flight for this project (it restarted mid-narration) and Resume is the
   * only way forward.
   */
  progress?: { done: number; total: number; provider?: string; alive?: boolean };
  /** TTS voice the user picked for narration (persisted at narrate time so Resume reuses it). */
  voiceId?: string | null;
  /** 'pasted' when the outline came from the operator's own script rather than the planner. */
  source?: 'pasted';
}

/**
 * How a Story render burns its captions. Mirrors the server catalogue
 * (PATCH /api/story/:id/captions); unknown values are dropped there, so an
 * older project simply keeps the renderer defaults.
 */
export interface StoryCaptionSettings {
  /** Off, whole lines, or word-synced. */
  captions?: 'none' | 'static' | 'kinetic';
  /** Typography/animation preset id — the "Caption animation" picker. */
  captionPreset?: string;
  /** How captions are timed: per word, revealed line by line, or as a block. */
  captionMotion?: 'words' | 'lines' | 'block';
  captionLayout?: 'center' | 'center-large' | 'bottom-center' | 'bottom-left' | 'staggered';
  /** Ghost shadow behind each word. */
  captionDepth?: 'none' | 'soft' | 'hard';
  captionStagger?: boolean;
  captionHighlight?: boolean;
}

export interface StoryProject extends StoryCaptionSettings {
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
  longform?: StoryLongform;
  aspect?: 'portrait' | 'landscape';
  /** Always present on a stored project; the rest of the caption settings are optional. */
  captionPreset: string;
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
