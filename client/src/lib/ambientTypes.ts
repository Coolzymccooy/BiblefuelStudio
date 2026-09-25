import type { StoryCaptionSettings } from './storyTypes';

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

export interface AmbientMovement {
  id: string;
  startMs: number;
  endMs: number;
  imagePrompt: string;
  imagePath: string | null;
  imageUrl?: string | null;
  imageStatus: ImageStatus;
  imageError?: string | null;
  /** Where this picture came from: reused from the library, or freshly generated. */
  imageSource?: 'library' | 'generated';
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
  /** Slow zoompan drift, or no motion at all. */
  motion: 'drift' | 'still';
  /** Always present on a stored project; the rest of the caption settings are optional. */
  captionPreset: string;
  duck: AmbientDuck;
  render: AmbientRenderState;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AmbientProjectSummary {
  projectId: string;
  title: string;
  status: AmbientStatus;
  updatedAt: number;
}
