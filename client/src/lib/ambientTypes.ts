import type { StoryCaptionSettings } from './storyTypes';

/** How the pictures move: see server/src/lib/ambient/ambientMotion.js. */
export type AmbientMotion = 'still' | 'drift';

export type AmbientStatus =
  | 'draft' | 'voicing' | 'assembling' | 'generating_images'
  | 'ready_to_render' | 'rendering' | 'done' | 'error';

export type AmbientAspect = 'landscape' | 'portrait';

export type AmbientBedMode = 'assemble' | 'file';

export interface AmbientBed {
  /** Cycle a shuffled library into a chain, or use one uploaded mix as-is. */
  mode: AmbientBedMode;
  /** Resolved track order when mode === 'assemble' (each a `library:`/`mylib:` ref). */
  trackRefs: string[];
  /** The uploaded mix when mode === 'file'. */
  filePath: string | null;
  crossfadeSec: number;
  /** The bed sits loud in the mix; it is the product. */
  volume: number;
  /** Cached assembly output; skipped on re-render when builtHash still matches. */
  builtPath?: string | null;
  builtHash?: string | null;
  /** Operator acknowledged an unknown-licence track despite the warning. */
  allowUncleared?: boolean;
}

export type DropStatus = 'pending' | 'done' | 'error';

export interface AmbientDrop {
  id: string;
  /** Offset from the start of the render, in ms. */
  atMs: number;
  reference: string;
  /** Defaults to the project's translation ('kjv') when unset. */
  translation?: string;
  /** Verbatim scripture text, filled by the server's lookupVerses. */
  text?: string | null;
  voiceId?: string | null;
  audioPath?: string | null;
  durationMs?: number | null;
  status: DropStatus;
  error?: string | null;
}

export type ImageStatus = 'pending' | 'generating' | 'done' | 'error';

/** How long a verse stays on screen: while it is heard, or for its whole picture. */
export type AmbientCaptionSpan = 'spoken' | 'section';
export type AmbientCaptionPosition = 'lower' | 'centre';

export interface AmbientMovement {
  id: string;
  startMs: number;
  endMs: number;
  imagePrompt: string;
  imagePath: string | null;
  imageUrl?: string | null;
  imageStatus: ImageStatus;
  imageError?: string | null;
  /** Where this picture came from: your upload, picked or reused from the library, or freshly generated. */
  imageSource?: 'upload' | 'library' | 'generated';
  imageLibraryId?: string | null;
  imageReuseScore?: number | null;
}

/** sidechaincompress units: threshold is linear, not dB. */
export interface AmbientDuck {
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export interface AmbientRenderState {
  jobId: string | null;
  outputPath: string | null;
  status: string | null;
  /** Live ffmpeg progress 0-100 while rendering (absent if the job isn't alive server-side). */
  percent?: number;
  phase?: string;
}

export interface AmbientProject extends StoryCaptionSettings {
  projectId: string;
  title: string;
  /** Drives verse suggestion via POST /:id/plan. */
  theme: string;
  translation: string;
  targetSec: number;
  aspect: AmbientAspect;
  status: AmbientStatus;
  bed: AmbientBed;
  drops: AmbientDrop[];
  movements: AmbientMovement[];
  /** A slow breathing zoom on each picture, or no motion at all. */
  motion: AmbientMotion;
  /** Always present on a stored project; the rest of the caption settings are optional. */
  captionPreset: string;
  /** How long a verse stays on screen. Absent on projects saved before the choice: renders as 'spoken'. */
  captionSpan?: AmbientCaptionSpan;
  captionPosition?: AmbientCaptionPosition;
  duck: AmbientDuck;
  render: AmbientRenderState;
  /** Every upload of this session's video, oldest first (the server keeps twenty). */
  published?: AmbientPublished[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One upload of a session's video. The server builds `url` from the id. */
export interface AmbientPublished {
  videoId: string;
  url: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  /** When YouTube will make it public, if it was scheduled. */
  publishAt: string | null;
  at: number;
}

export interface AmbientProjectSummary {
  projectId: string;
  title: string;
  status: AmbientStatus;
  targetSec?: number;
  aspect?: AmbientAspect;
  /** The finished video is on disk: it can be watched, downloaded and published. */
  hasVideo?: boolean;
  lastPublished?: AmbientPublished | null;
  updatedAt: number;
}
