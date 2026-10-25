export type MomentStyle = 'glow' | 'celebrate' | 'hype' | 'gallery' | 'fellowship' | 'scrapbook' | 'partyPop' | 'premiere';
/** Classic styles show one photo at a time; Showcase styles several per scene. */
export type MomentStyleFamily = 'classic' | 'showcase';
/** tall is 9:16 (phones); wide is 16:9 (church screens, YouTube). Only Showcase styles draw wide. */
export type MomentShape = 'tall' | 'wide';
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
  /** The finished video's shape; renders made before shapes existed have none (tall). */
  shape?: MomentShape;
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
  /** Missing on Moments saved before shapes existed: those are tall. */
  shape?: MomentShape;
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
  styles: Array<{ id: MomentStyle; label: string; description: string; energy: number; family?: MomentStyleFamily }>;
  lengths: number[];
  /** Each family's own lengths; older servers send only `lengths`. */
  lengthsByFamily?: Record<MomentStyleFamily, number[]>;
  shapes?: MomentShape[];
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
  shape?: MomentShape;
  energy?: number;
  lengthSec?: number;
  seed?: number;
  sound?: { song?: { ref: string; windowStartSec: number | null } | null; voiceover?: null };
}
