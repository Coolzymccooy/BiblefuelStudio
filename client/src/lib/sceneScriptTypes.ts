export type LineKind = 'narration' | 'scripture' | 'reference' | 'chant';

export interface SceneScriptWord { text: string; start: number; end: number }

export interface SceneScriptLine {
  id: string;
  sceneId: string;
  speaker: string;
  tone: string | null;
  kind: LineKind;
  text: string;
  emphasis: boolean;
  reference?: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  gapAfter?: number;
  audio: { key: string; url: string; durationSec: number; words: SceneScriptWord[] } | null;
  audioError?: string | null;
}

export interface SceneScriptScene {
  id: string;
  number: number;
  title: string;
  targetStart: number | null;
  targetEnd: number | null;
  visual: string;
}

export interface EnsembleLayer { voice: string; pitch: string; offsetMs: number }

export interface CastEntry {
  voice?: string;
  rate: string;
  pitch?: string;
  ensemble?: EnsembleLayer[];
  room?: string;
}

export interface ShotClip {
  status: 'queued' | 'generating' | 'done' | 'error';
  error?: string | null;
  libraryId?: string;
  url?: string;
  posterUrl?: string | null;
  durationSec?: number;
  costUsd?: number;
  fromLibrary?: boolean;
  seconds?: number;
}

export interface SimilarClip { id: string; url: string; posterUrl: string | null; prompt: string; score: number }

export type GradeName = 'none' | 'warm' | 'cool' | 'golden' | 'faded' | 'vivid' | 'mono';

/** Free refine of a shot's clip, applied in the render (server: lib/sceneScript/refine.js). */
export interface ShotRefine {
  in: number;
  out: number | null;
  rate: number | null;
  flip: boolean;
  zoom: number;
  x: number;
  y: number;
  grade: GradeName;
}

/** How the clip fills its place in the video, as the render will play it. */
export interface ShotPlayback { rate: number; from: number; to: number; hold: number; placeSec: number }

export interface SceneScriptShot {
  id: string;
  sceneId: string;
  startLineId: string;
  offsetSec: number;
  text: string;
  montage: boolean;
  framing: string;
  suggested: boolean;
  prompt?: string | null;
  effectivePrompt: string;
  similar: SimilarClip[];
  clip: ShotClip | null;
  refine: ShotRefine | null;
  playback: ShotPlayback | null;
}

export interface MusicCue {
  id: string;
  from: number | null;
  to: number | null;
  mood: string;
  notes: string;
  sceneIds: string[];
  sfx: string[];
  bed: string | null;
  bedSuggested?: boolean;
  offsetSec: number;
}

export interface ShotEstimate {
  clips: number;
  /** Paid clips that failed to download and can be fetched again for free. */
  refetch?: number;
  seconds: number;
  usd: number;
  fromLibrary: number;
  spentUsd: number;
  totalUsd: number;
  benchmarkUsd: number;
  overBenchmark: boolean;
}

export interface StageStatus {
  status: 'idle' | 'running' | 'queued' | 'rendering' | 'done' | 'error' | 'cancelled';
  error?: string | null;
  progress?: number;
}

export interface SceneScriptProject {
  id: string;
  meta: { title: string; reference: string; targetSec: number | null; aspect: 'portrait' | 'landscape' | 'square'; notes: string[] };
  scenes: SceneScriptScene[];
  lines: SceneScriptLine[];
  speakers: { name: string }[];
  music: { cues: MusicCue[]; drops: { beforeLineId: string; phrase: string }[] };
  endCard: { reference: string; text: string } | null;
  cast: Record<string, CastEntry>;
  look: { lead: string; peopleNote: string; style: string };
  captions: { enabled: boolean };
  shots: SceneScriptShot[];
  timeline: { total: number; lines: { id: string; start: number; dur: number; gap: number }[] } | null;
  voice: StageStatus;
  render: StageStatus & { url?: string; sizeBytes?: number; durationSec?: number; renderSec?: number };
  source: { ignored: { lineNo: number; text: string; reason: string }[]; warnings: { code: string; message: string }[] };
  spentUsd?: number;
  needsVoice: boolean;
  estimate: ShotEstimate;
  blockers: string[];
  running: { voice: boolean; shots: boolean; render: boolean };
}

export interface SceneScriptSummary { id: string; title: string; updatedAt: number; renderStatus: string }

export interface VoiceOption { id: string; label: string; gender: string; age: string }

export interface LibraryClip {
  id: string;
  prompt: string;
  /** false when the clip came in without the prompt that made it. */
  promptKnown?: boolean;
  lead?: string;
  url: string;
  posterUrl: string | null;
  /** true when no poster could be made from the clip; it is not tried again. */
  posterFailed?: boolean;
  durationSec: number | null;
  costUsd: number;
  aspect: string;
  tags: string[];
  rating?: number | null;
  source?: { kind: string; projectId?: string } | null;
  createdAt: number;
}

export interface LibraryLead { lead: string; clips: number }

export interface LibraryFilters { q?: string; aspect?: string; lead?: string; tag?: string; rating?: number; limit?: number }
