export type MomentStyle = 'glow' | 'celebrate' | 'hype' | 'gallery';
export type DetailField = 'name' | 'milestone' | 'eventTitle' | 'date' | 'venue' | 'verse';

export type PhotoRef = { kind: 'upload'; path: string } | { kind: 'library'; id: string };

export interface MomentPhoto {
  ref: PhotoRef;
  url: string;
  width: number;
  height: number;
}

export interface MomentRender {
  jobId: string | null;
  status: 'running' | 'done' | 'error' | 'interrupted';
  percent: number;
  stage: string;
  file?: string;
  error?: string;
  notes?: string[];
}

export interface MomentHistoryEntry {
  jobId: string;
  file: string;
  createdAt: number;
  seed: number;
  notes?: string[];
}

export interface MomentProject {
  projectId: string;
  createdAt: number;
  updatedAt: number;
  occasion: string;
  details: Partial<Record<DetailField, string>>;
  photos: MomentPhoto[];
  heroIndex: number;
  sound: {
    song: { ref: string; windowStartSec: number | null } | null;
    voiceover: { script: string; voiceId: string | null; file: string } | null;
  };
  title: string;
  statements: string[];
  style: MomentStyle;
  energy: number;
  lengthSec: number;
  seed: number;
  render: MomentRender | null;
  history: MomentHistoryEntry[];
}

export interface MomentSummary {
  projectId: string;
  occasion: string;
  title: string;
  updatedAt: number;
  thumb: string | null;
  lastFile: string | null;
}

export interface MomentOccasion {
  id: string;
  label: string;
  church: boolean;
  fields: DetailField[];
  style: MomentStyle;
  energy: number;
  song: string;
}

export interface MomentMeta {
  occasions: MomentOccasion[];
  /** `energy` is the style's natural level (0..1): picking the style moves the slider there. */
  styles: Array<{ id: MomentStyle; label: string; description: string; energy: number }>;
  lengths: number[];
  limits: {
    statements: Record<string, number>;
    maxStatements: number;
    title: number;
    statement: number;
    detail: number;
    minPhotos: number;
    maxPhotos: number;
    scriptMax: number;
  };
}

export interface MomentSuggestion {
  title: string;
  statements: string[];
  verse?: { reference: string; text: string };
  source: 'ai' | 'template';
}

export interface SongWindow {
  durationSec: number;
  tempo: number | null;
  windowStartSec: number;
  autoStartSec: number;
}

export interface LibraryImage {
  id: string;
  url: string;
  aspect: string;
  source: 'upload' | 'generated';
  createdAt: number;
}

/** What PUT /api/moments/:id accepts. Photos go up as refs; the server resolves them. */
export interface MomentPatch {
  occasion?: string;
  details?: Partial<Record<DetailField, string>>;
  photos?: PhotoRef[];
  heroIndex?: number;
  title?: string;
  statements?: string[];
  style?: MomentStyle;
  energy?: number;
  lengthSec?: number;
  seed?: number;
  sound?: { song?: { ref: string; windowStartSec: number | null } | null; voiceover?: null };
}
